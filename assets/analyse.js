/* Toppers Copy — browser-side PDF reader for the Submit form.
   Lazy-loaded (only when the user opens the "estimate questions" panel).
   Loads pdf.js from a CDN on first use, pulls text out of the chosen PDF
   entirely in the browser (the file is never uploaded), reconstructs lines
   from glyph positions, and hands them to TC.extract. */
(function () {
  'use strict';
  var VER = '4.7.76';
  var CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + VER + '/build/';
  var pdfjsP = null;

  function loadPdfjs() {
    if (pdfjsP) return pdfjsP;
    pdfjsP = import(/* webpackIgnore: true */ CDN + 'pdf.min.mjs').then(function (m) {
      var lib = ('getDocument' in m) ? m : (m.default || m);
      lib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.worker.min.mjs';
      return lib;
    });
    return pdfjsP;
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
    var doc = await pdfjs.getDocument({ data: data, isEvalSupported: false }).promise;
    var N = Math.min(doc.numPages, 400), pages = [];
    for (var i = 1; i <= N; i++) {
      var pg = await doc.getPage(i);
      var tc = await pg.getTextContent();
      pages.push({ page: i, lines: linesFromItems(tc.items) });
    }
    return { pages: pages, numPages: doc.numPages };
  }

  async function analyse(source, onProgress) {
    if (onProgress) onProgress('reading');
    var data;
    if (source instanceof Blob) {
      data = new Uint8Array(await source.arrayBuffer());
    } else {
      var res = await fetch(source, { mode: 'cors' });
      if (!res.ok) throw new Error('Could not fetch the PDF (HTTP ' + res.status + ')');
      var ct = res.headers.get('content-type') || '';
      if (ct && ct.indexOf('pdf') < 0 && ct.indexOf('octet-stream') < 0) throw new Error('That link is not a direct PDF.');
      data = new Uint8Array(await res.arrayBuffer());
    }
    if (onProgress) onProgress('parsing');
    var pdf = await readPdf(data);
    var textLen = pdf.pages.reduce(function (n, p) { return n + p.lines.join('').length; }, 0);
    if (textLen < 60) {
      return { numPages: pdf.numPages, questions: [], count: 0, method: 'no-text' };
    }
    var ex = (self.TC.extract).extractQuestions(pdf.pages);
    ex.numPages = pdf.numPages;
    return ex;
  }

  self.TC = self.TC || {};
  self.TC.analyse = analyse;
})();
