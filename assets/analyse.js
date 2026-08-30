/* Toppers Copy — browser-side PDF reader for the Submit form.
   Lazy-loaded (only when the user opens the "estimate questions" panel).

   Two modes, both 100% in the browser — the file is never uploaded:
     1. text layer  — pdf.js pulls the embedded text, lines rebuilt from glyph x/y
     2. OCR         — for scanned PDFs with no text layer: pdf.js renders each page
                      to a canvas, we crop the top strip (where the printed question
                      sits, above the handwriting) and Tesseract.js reads it.
   Either way the lines go to TC.extract.extractQuestions. */
(function () {
  'use strict';
  var PDF_VER = '4.10.38';
  var PDF_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDF_VER + '/build/';
  var TESS_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  var pdfjsP = null, tessP = null;

  function loadPdfjs() {
    if (pdfjsP) return pdfjsP;
    pdfjsP = import(/* webpackIgnore: true */ PDF_CDN + 'pdf.min.mjs').then(function (m) {
      var lib = ('getDocument' in m) ? m : (m.default || m);
      lib.GlobalWorkerOptions.workerSrc = PDF_CDN + 'pdf.worker.min.mjs';
      return lib;
    });
    return pdfjsP;
  }
  function loadTesseract() {
    if (tessP) return tessP;
    tessP = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = TESS_SRC; s.onload = function () { res(self.Tesseract); }; s.onerror = rej;
      document.head.appendChild(s);
    });
    return tessP;
  }

  function linesFromItems(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5]), x = it.transform[4], row = null;
      for (var i = rows.length - 1; i >= 0 && i > rows.length - 8; i--) {
        if (Math.abs(rows[i].y - y) <= 2) { row = rows[i]; break; }
      }
      if (!row) { row = { y: y, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, s: it.str });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      return r.parts.map(function (p) { return p.s; }).join(' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
  }

  async function readPdf(data) {
    var pdfjs = await loadPdfjs();
    // pdf.js takes ownership of the buffer and detaches it — hand it a copy
    var doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
    var N = Math.min(doc.numPages, 400), pages = [];
    for (var i = 1; i <= N; i++) {
      var pg = await doc.getPage(i);
      var tc = await pg.getTextContent();
      pages.push({ page: i, lines: linesFromItems(tc.items) });
    }
    return { pages: pages, numPages: doc.numPages };
  }

  // OCR just the top TOP_FRAC of each page, at ~MAX_W px wide
  var TOP_FRAC = 0.42, MAX_W = 1100, PAGE_TIMEOUT = 30000;

  function withTimeout(p, ms, tag) {
    return Promise.race([p, new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('timeout:' + tag)); }, ms);
    })]);
  }

  async function ocrPdf(data, onProgress) {
    var pdfjs = await loadPdfjs();
    var Tesseract = await loadTesseract();
    var doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
    var N = Math.min(doc.numPages, 300);
    var worker = await Tesseract.createWorker('eng', 1);
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var pages = [], skipped = 0;
    try {
      for (var i = 1; i <= N; i++) {
        if (onProgress) onProgress('ocr', i, N);
        try {
          var pg = await doc.getPage(i);
          var base = pg.getViewport({ scale: 1 });
          var vp = pg.getViewport({ scale: Math.min(2, MAX_W / base.width) });
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height * TOP_FRAC);
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await withTimeout(pg.render({ canvasContext: ctx, viewport: vp }).promise, PAGE_TIMEOUT, 'render');
          var out = await withTimeout(worker.recognize(canvas), PAGE_TIMEOUT, 'ocr');
          var text = (out && out.data && out.data.text) || '';
          pages.push({ page: i, lines: text.split('\n').map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean) });
        } catch (e) {
          skipped++;
          pages.push({ page: i, lines: [] });
        }
      }
    } finally {
      try { await worker.terminate(); } catch (e) {}
      canvas.width = canvas.height = 0;
    }
    return { pages: pages, numPages: doc.numPages, skipped: skipped };
  }

  async function toData(source) {
    if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
    var res = await fetch(source, { mode: 'cors' });
    if (!res.ok) throw new Error('Could not fetch the PDF (HTTP ' + res.status + ')');
    var ct = res.headers.get('content-type') || '';
    if (ct && ct.indexOf('pdf') < 0 && ct.indexOf('octet-stream') < 0) throw new Error('That link is not a direct PDF.');
    return new Uint8Array(await res.arrayBuffer());
  }

  // opts.ocr === true forces the OCR path (for scanned PDFs)
  async function analyse(source, onProgress, opts) {
    opts = opts || {};
    if (onProgress) onProgress(opts.ocr ? 'ocr-init' : 'reading');
    var data = source.__tcData || await toData(source);
    if (source && typeof source === 'object') { try { source.__tcData = data; } catch (e) {} }

    var pdf, method;
    if (opts.ocr) {
      pdf = await ocrPdf(data, onProgress);
      method = 'ocr';
    } else {
      if (onProgress) onProgress('parsing');
      pdf = await readPdf(data);
      var textLen = pdf.pages.reduce(function (n, p) { return n + p.lines.join('').length; }, 0);
      if (textLen < 60) return { numPages: pdf.numPages, questions: [], count: 0, method: 'no-text' };
      method = 'text';
    }

    var ex = (self.TC.extract).extractQuestions(pdf.pages);
    ex.numPages = pdf.numPages;
    ex.skipped = pdf.skipped || 0;
    ex.method = ex.count ? method : (method === 'ocr' ? 'ocr-empty' : 'none');
    return ex;
  }

  self.TC = self.TC || {};
  self.TC.analyse = analyse;
})();
