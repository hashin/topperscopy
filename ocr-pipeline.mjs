#!/usr/bin/env node
/*
 * ocr-pipeline.mjs — maintainer tool. Turns link-only toppers' copies
 * (data/link-copies.json + data/optionals.json) into question-searchable rows,
 * the same {topper,coaching,subject,page_number,question,metadata,url} shape as
 * data/questions.csv / data/submissions.csv, so the site's question search,
 * syllabus map and Practice mode pick them up with no frontend change.
 *
 *   node ocr-pipeline.mjs plan
 *       Filename-only clustering. No network, no cost. Coaching test series
 *       reuse one printed question paper across dozens of toppers, so we OCR
 *       ONE representative per (source, test, paper) cluster and copy its
 *       questions to every other member. Writes .ocr/clusters.json + a summary.
 *
 *   node ocr-pipeline.mjs freepass [--limit N] [--source "X"]
 *       Downloads cluster representatives + singletons, tries the EXISTING
 *       free heuristic (assets/extract.js on a pdf.js text layer). Anything it
 *       reads costs $0 and is written straight to data/ocr-questions.csv.
 *       Marks the rest in .ocr/clusters.json as needing a vision call.
 *
 *   node ocr-pipeline.mjs status
 *       Prints where things stand: free-pass hits, clusters still needing OCR,
 *       estimated page count / cost for the vision step.
 *
 * Vision OCR itself (the paid step) is a separate command added once the plan
 * is approved for spend — it is intentionally not wired here yet.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import extractMod from './assets/extract.js';
const { extractQuestions, toCsvRows } = extractMod;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, '.ocr');
const PDFDIR = path.join(CACHE, 'pdfs');
const METADIR = path.join(CACHE, 'meta');
for (const d of [CACHE, PDFDIR, METADIR]) fs.mkdirSync(d, { recursive: true });

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const norm = u => (u || '').trim().split('#')[0].replace(/\?.*$/, '');
const decode = u => { try { return decodeURIComponent(u); } catch { return u; } };

/* ---------- load the corpus ---------- */
function loadCorpus() {
  const lc = JSON.parse(fs.readFileSync(path.join(DATA, 'link-copies.json'), 'utf8')).entries
    .map(e => ({ ...e, kind: 'gs', paper: e.paper }));
  const op = JSON.parse(fs.readFileSync(path.join(DATA, 'optionals.json'), 'utf8')).entries
    .map(e => ({ ...e, kind: 'opt', paper: 'Optional — ' + (e.subject || 'Other') }));
  return [...lc, ...op].filter(e => e.url);
}

/* ---------- what's already searchable — never re-OCR it ---------- */
function searchableBaseUrls() {
  const set = new Set();
  for (const f of ['questions.csv', 'submissions.csv', 'ocr-questions.csv']) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/https?:\/\/[^\s,"]+/g)) set.add(norm(m[0]));
  }
  return set;
}

/* ---------- Stage 0: resolve a link to a fetchable PDF url ---------- */
function resolve(url) {
  const u = url.trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
  if (m) return { fetchUrl: `https://drive.google.com/uc?export=download&id=${m[1]}`, note: 'drive-file' };
  m = u.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders|drive\/folders)\/([^/?]+)/);
  if (m) return { fetchUrl: null, note: 'drive-folder' }; // needs folder enumeration — handled separately
  m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) return { fetchUrl: `https://drive.google.com/uc?export=download&id=${m[1]}`, note: 'drive-open' };
  return { fetchUrl: u, note: 'direct' };
}

/* ---------- Stage 2: per-source test key (the clustering key) ---------- */
function testKey(e) {
  const src = e.source || '';
  const fn = decode(norm(e.url).split('/').pop() || '');
  const full = decode(norm(e.url));
  const hi = /hindi/i.test(e.note || '') || /hindi/i.test(full) ? ':hi' : '';

  if (src === 'VisionIAS' || src === 'IAS Exam Portal') {
    // <hex>-<studentId>_<testId>_<name>_rank_<N>.pdf   OR   <studentId>_<testId>_<Name>_Rank_<N>.pdf
    // studentId is per-person, testId repeats across everyone who sat that test.
    let m = fn.match(/^(?:[0-9a-f]+-)?\d+[_-](\d+)[_-]?[A-Za-z]/i)
         || fn.match(/^(?:[0-9a-f]+-)?\d+[_-](\d+)\.pdf$/i);
    if (m) return `${src}:${m[1]}${hi}`;
  }
  if (src === 'NextIAS') {
    // filenames end "<studentOrBatchCode>_<testCode>[.pdf]" (sometimes + "_<date>_<time>").
    // the last underscore-segment is the shared test code (M25GAT01, GSMAC2407, FLT2511, TC155, ...).
    let base = fn.replace(/\.pdf$/i, '').replace(/(_\d{6})+$/g, '').replace(/_\d{6}_\d{6}$/, '');
    const seg = base.split(/[_-]/).filter(Boolean).pop() || '';
    if (/^[A-Za-z]{1,6}\d{1,4}[A-Za-z]*\d*$/.test(seg) && seg.length <= 12) return `NextIAS:${seg.toUpperCase()}`;
    if (/^\d{2,4}$/.test(seg)) return `NextIAS:${seg}`;
  }
  if (src === 'Vajiram & Ravi') {
    const gs = (full.match(/GS[_ -]?(?:PAPER[_ -]?)?(?:GS[_ -]?)?([1-4])\b/i) || [])[1];
    const es = /ESSAY/i.test(full);
    const t = (full.match(/\b(?:T|TEST|FLT|SLT|GST|FGST|FGS)[_ -]?(\d{1,2})\b/i) || [])[1];
    if (es && t) return `Vajiram:ESSAY:T${t}`;
    if (es) return `Vajiram:ESSAY:prog`; // "Essay Programme" with no test no. — still one shared programme
    if (gs && t) return `Vajiram:GS${gs}:T${t}`;
  }
  if (src === 'Shubhra Ranjan (PSIR)') {
    const m = fn.match(/Test\s*(\d+)\s*,\s*(.+?)\.pdf$/i);
    if (m) return `ShubhraRanjan:${m[2].toLowerCase().replace(/\s+/g, '-')}:${m[1]}`;
  }
  if (src === 'ForumIAS') {
    if (/-QP\.pdf$/i.test(fn) || /question[_ -]?paper/i.test(fn)) {
      const p = (fn.match(/GS[_ -]?PAPER[_ -]?([1-4])/i) || [])[1] || (/ESSAY/i.test(fn) ? 'E' : 'X');
      const y = (fn.match(/20\d\d/) || [])[0] || '';
      return `ForumIAS:QP:${y}:GS${p}`;
    }
  }
  // small optional-subject sources with an explicit "test N"
  const tn = (fn.match(/test[_ -]?(?:no[_ .-]*)?(\d{1,2})/i) || [])[1];
  if (tn && ['IMS4Maths', 'Vishnu IAS', 'Sleepy Classes', 'SuccessClap', 'De Facto Law', 'LotusArise'].includes(src)) {
    return `${src}:${(e.subject || e.paper || 'x')}:T${tn}`;
  }
  return null; // singleton
}

/* ---------- fetch + parse a PDF (with small cache) ---------- */
let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}
function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]), x = it.transform[4];
    let row = null;
    for (let i = rows.length - 1; i >= 0 && i > rows.length - 8; i--) {
      if (Math.abs(rows[i].y - y) <= 2) { row = rows[i]; break; }
    }
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => (r.parts.sort((a, b) => a.x - b.x), r.parts.map(p => p.s).join(' ').replace(/\s+/g, ' ').trim())).filter(Boolean);
}
async function getPdf(url, opts = {}) {
  const key = sha1(url);
  const pdfPath = path.join(PDFDIR, key + '.pdf');
  const metaPath = path.join(METADIR, key + '.json');
  // Cached result is enough unless the caller needs the file itself back on disk
  // (freepass deletes PDFs after reading them; the OCR stages need to rasterise).
  if (fs.existsSync(metaPath) && !(opts.needFile && !fs.existsSync(pdfPath))) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }

  const meta = { url, key };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    if (!r.ok) { meta.error = `HTTP ${r.status}`; fs.writeFileSync(metaPath, JSON.stringify(meta)); return meta; }
    const buf = new Uint8Array(await r.arrayBuffer());
    meta.sizeKB = Math.round(buf.length / 1024);
    if (meta.sizeKB < 4) { meta.error = 'not-a-pdf'; fs.writeFileSync(metaPath, JSON.stringify(meta)); return meta; }
    fs.writeFileSync(pdfPath, buf);
    const pj = await loadPdfjs();
    const doc = await pj.getDocument({ data: buf, isEvalSupported: false }).promise;
    meta.numPages = doc.numPages;
    try { meta.pageHeightPts = Math.round((await doc.getPage(1)).getViewport({ scale: 1 }).height); } catch {}
    const pages = [];
    let textChars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      const lines = linesFromItems(tc.items);
      textChars += lines.join('').length;
      pages.push({ page: i, lines });
    }
    meta.textChars = textChars;
    // free heuristic
    if (textChars > 200) {
      const { questions, count, method } = extractQuestions(pages);
      meta.freepass = { count, method, questions };
    } else {
      meta.freepass = { count: 0, method: 'none' };
    }
    if (!KEEP_PDFS) { try { fs.unlinkSync(pdfPath); } catch {} } // Phase 0 only needs the text result
  } catch (e) {
    meta.error = (e && e.message) || String(e);
    try { fs.unlinkSync(pdfPath); } catch {}
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return meta;
}
let KEEP_PDFS = false;

// sources confirmed by sampling to be pure image scans (0 text layer) — no point
// downloading them for the free text-layer pass; they go straight to "needs vision".
const KNOWN_SCAN_SOURCES = new Set(['VisionIAS', 'NextIAS', 'Vajiram & Ravi', 'Shubhra Ranjan (PSIR)', 'IAS Exam Portal']);

async function pool(items, n, fn) {
  const q = items.slice();
  let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (q.length) { const idx = i++; const it = q.shift(); await fn(it, idx); }
  });
  await Promise.all(workers);
}

/* ================= commands ================= */
const cmd = process.argv[2];
const args = process.argv.slice(3);
const getArg = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };

if (cmd === 'plan') {
  const corpus = loadCorpus();
  const already = searchableBaseUrls();
  const todo = corpus.filter(e => !already.has(norm(e.url)));

  const clusters = new Map(); // key -> {key, source, paper, members:[], singleton}
  for (const e of todo) {
    const k = testKey(e);
    const ck = k || `SINGLETON:${sha1(norm(e.url)).slice(0, 12)}`;
    if (!clusters.has(ck)) clusters.set(ck, { key: ck, real: !!k, source: e.source, paper: e.paper, subject: e.subject || null, members: [] });
    clusters.get(ck).members.push({ url: norm(e.url), topper: e.topper, air: e.air || null, year: e.year || null, paper: e.paper, subject: e.subject || null, note: e.note || '', source: e.source, kind: e.kind });
  }

  const list = [...clusters.values()].sort((a, b) => b.members.length - a.members.length);
  for (const c of list) {
    c.members.sort((a, b) => decode(a.url).length - decode(b.url).length);
    c.representative = c.members[0].url;
    c.driveFolder = list.length && /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\//.test(c.representative);
  }

  fs.writeFileSync(path.join(CACHE, 'clusters.json'), JSON.stringify(list, null, 2));

  // summary
  const bySource = {};
  for (const c of list) {
    const s = bySource[c.source] ||= { docs: 0, clusters: 0, realClusters: 0, singletons: 0, driveFolders: 0 };
    s.docs += c.members.length;
    s.clusters += 1;
    if (c.real) s.realClusters += 1; else s.singletons += 1;
    if (c.driveFolder) s.driveFolders += c.members.length;
  }
  console.log('corpus not yet searchable:', todo.length, 'docs');
  console.log('distinct OCR units (clusters + singletons):', list.length);
  console.log('\nsource'.padEnd(26), 'docs'.padStart(6), 'units'.padStart(7), 'real-clu'.padStart(9), 'singles'.padStart(8), 'drivefldr'.padStart(10));
  for (const [s, v] of Object.entries(bySource).sort((a, b) => b[1].docs - a[1].docs)) {
    console.log(s.padEnd(26), String(v.docs).padStart(6), String(v.clusters).padStart(7), String(v.realClusters).padStart(9), String(v.singletons).padStart(8), String(v.driveFolders).padStart(10));
  }
  const reduction = (todo.length / Math.max(1, list.length)).toFixed(1);
  console.log(`\n→ clustering reduces ${todo.length} docs to ${list.length} OCR units (${reduction}x). Wrote .ocr/clusters.json`);
  console.log('  next: node ocr-pipeline.mjs freepass');
  process.exit(0);
}

if (cmd === 'freepass') {
  const clPath = path.join(CACHE, 'clusters.json');
  if (!fs.existsSync(clPath)) { console.error('run `node ocr-pipeline.mjs plan` first'); process.exit(1); }
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const only = getArg('source');
  const limit = getArg('limit') ? +getArg('limit') : Infinity;
  const conc = getArg('concurrency') ? +getArg('concurrency') : 6;
  KEEP_PDFS = args.includes('--keep-pdfs');
  const allScans = args.includes('--all'); // also download known-scan sources (for page counts)

  // decide the work list
  const work = [];
  for (const c of clusters) {
    if (only && c.source !== only) continue;
    if (c.freepassDone || c.error || c.needsManual) continue;
    const { fetchUrl, note } = resolve(c.representative);
    if (!fetchUrl) { c.resolveNote = note; c.needsManual = true; continue; }
    if (!allScans && KNOWN_SCAN_SOURCES.has(c.source)) {
      c.freepassDone = true; c.freepassHit = false; c.knownScan = true; // no download, straight to vision
      continue;
    }
    work.push({ c, fetchUrl });
  }
  fs.writeFileSync(clPath, JSON.stringify(clusters, null, 2));
  console.log(`${work.length} units to download & test (concurrency ${conc}); ${clusters.filter(c => c.knownScan).length} known-scan units skipped straight to vision.`);

  let done = 0, hits = 0, errs = 0;
  const t0 = Date.now();
  await pool(work.slice(0, limit === Infinity ? work.length : limit), conc, async ({ c, fetchUrl }) => {
    const meta = await getPdf(fetchUrl);
    c.freepassDone = true;
    c.numPages = meta.numPages || null;
    c.sizeKB = meta.sizeKB || null;
    if (meta.error) { c.error = meta.error; errs++; }
    else {
      const fp = meta.freepass || { count: 0 };
      c.freepassHit = fp.count > 0;
      if (c.freepassHit) hits++;
    }
    done++;
    if (done % 25 === 0 || done === work.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`  ${done}/${work.length}  hits ${hits}  errs ${errs}  (${rate.toFixed(1)}/s)`);
      fs.writeFileSync(clPath, JSON.stringify(clusters, null, 2));
    }
  });
  fs.writeFileSync(clPath, JSON.stringify(clusters, null, 2));

  // (re)write data/ocr-questions.csv from every free-pass hit recorded in the cache
  const allRows = [];
  for (const c of JSON.parse(fs.readFileSync(clPath, 'utf8'))) {
    if (!c.freepassHit) continue;
    const key = sha1(resolve(c.representative).fetchUrl || c.representative);
    const metaPath = path.join(METADIR, key + '.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const qs = meta.freepass && meta.freepass.questions;
    if (!qs || !qs.length) continue;
    for (const mem of c.members) {
      const m2 = { topper: mem.topper, coaching: mem.source, subject: mem.kind === 'opt' ? (mem.subject || 'Other') : mem.paper, url: mem.url };
      for (const r of toCsvRows(qs, m2)) allRows.push(r);
    }
  }
  const HEADER = 'topper,coaching,subject,page_number,question,metadata,url\n';
  fs.writeFileSync(path.join(DATA, 'ocr-questions.csv'), HEADER + allRows.join('\n') + (allRows.length ? '\n' : ''));

  const fresh = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const hitDocs = fresh.filter(c => c.freepassHit).reduce((a, c) => a + c.members.length, 0);
  const needVision = fresh.filter(c => c.freepassDone && !c.freepassHit && !c.error).length;
  console.log(`\nprocessed ${done} downloads · free-pass hits ${hits} (covering ${hitDocs} docs) · units needing vision ${needVision} · errors ${errs}`);
  console.log(`wrote data/ocr-questions.csv (${allRows.length} rows). next: node build.js, then review · node ocr-pipeline.mjs status`);
  process.exit(0);
}

if (cmd === 'status') {
  const clPath = path.join(CACHE, 'clusters.json');
  if (!fs.existsSync(clPath)) { console.error('run `node ocr-pipeline.mjs plan` first'); process.exit(1); }
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const need = clusters.filter(c => c.freepassDone && !c.freepassHit && !c.error);
  const pages = need.reduce((a, c) => a + (c.numPages || 40), 0);
  const bySource = {};
  for (const c of clusters) {
    const s = bySource[c.source] ||= { units: 0, freeHit: 0, needVision: 0, err: 0, pending: 0, visionPages: 0 };
    s.units++;
    if (c.error) s.err++;
    else if (!c.freepassDone) s.pending++;
    else if (c.freepassHit) s.freeHit++;
    else { s.needVision++; s.visionPages += c.numPages || 40; }
  }
  console.log('source'.padEnd(26), 'units'.padStart(6), 'free'.padStart(6), 'vision'.padStart(7), 'vpages'.padStart(8), 'pend'.padStart(6), 'err'.padStart(5));
  for (const [s, v] of Object.entries(bySource).sort((a, b) => b[1].visionPages - a[1].visionPages)) {
    console.log(s.padEnd(26), String(v.units).padStart(6), String(v.freeHit).padStart(6), String(v.needVision).padStart(7), String(v.visionPages).padStart(8), String(v.pending).padStart(6), String(v.err).padStart(5));
  }
  console.log(`\nvision step: ~${pages.toLocaleString()} pages`);
  console.log(`  Claude Haiku 4.5 batch  ~$${(pages * 0.0013).toFixed(0)}`);
  console.log(`  Gemini 2.5 Flash        ~$${(pages * 0.0004).toFixed(0)}`);
  process.exit(0);
}

/* ============================================================================
 * Stage 3 — vision OCR of the printed question header
 *
 * Anatomy of an evaluated test copy: the question is machine-PRINTED across the
 * top of the page; everything below is the candidate's HANDWRITING, which we
 * never need. So we render only the top strip and OCR that. Pages 1-3 render
 * whole, because some booklets open with the full question paper as an insert.
 * ========================================================================== */

const STRIP_FRACTION = 0.38;   // top share of the page that holds the printed question
const FULL_PAGE_UNTIL = 3;     // pages 1..3 render whole (question-paper inserts live here)
const RENDER_DPI = 150;
const PAGEDIR = path.join(CACHE, 'pages');
const OCRDIR = path.join(CACHE, 'ocr');
for (const d of [PAGEDIR, OCRDIR]) fs.mkdirSync(d, { recursive: true });

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  return r;
}

/** Render one page (or its top strip) to PNG. Returns the file path, or null. */
function renderPage(pdfPath, pageNo, heightPts, outPrefix) {
  const full = pageNo <= FULL_PAGE_UNTIL;
  const argv = ['-png', '-r', String(RENDER_DPI), '-f', String(pageNo), '-l', String(pageNo), '-aa', 'yes', '-aaVector', 'yes'];
  if (!full && heightPts) {
    const hPx = Math.round(heightPts * (RENDER_DPI / 72) * STRIP_FRACTION);
    argv.push('-x', '0', '-y', '0', '-W', '20000', '-H', String(hPx));
  }
  argv.push(pdfPath, outPrefix);
  const r = sh('pdftoppm', argv);
  if (r.status !== 0) return null;
  // pdftoppm appends -N (zero padded to the page-count width); find whatever it wrote
  const dir = path.dirname(outPrefix), base = path.basename(outPrefix);
  const hit = fs.readdirSync(dir).find(f => f.startsWith(base + '-') && f.endsWith('.png'));
  return hit ? path.join(dir, hit) : null;
}

/** Tesseract → plain text for one image. */
function tesseractText(imgPath) {
  const r = sh('tesseract', [imgPath, 'stdout', '--psm', '6', '-l', 'eng']);
  if (r.status !== 0) return '';
  return (r.stdout || '').replace(/\r/g, '');
}

/** Turn raw OCR text for one page into question rows, reusing the project heuristic. */
function questionsFromOcr(text, pageNo) {
  const lines = String(text || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return [];
  const { questions } = extractQuestions([{ page: pageNo, lines }]);
  return questions;
}

/** Cheap confidence signal: does this look like a real UPSC question? */
function questionConfidence(q) {
  const t = String(q.question || '');
  let c = 0;
  if (t.length >= 40) c += 1;
  if (/\?/.test(t)) c += 1;
  if (/\b(discuss|examine|analyse|analyze|elucidate|evaluate|comment|critically|substantiate|illustrate|justify|explain|describe|suggest|highlight|enumerate|do you agree|to what extent|account for|bring out)\b/i.test(t)) c += 2;
  if (q.marks || q.words) c += 1;
  const alpha = (t.match(/[A-Za-z]/g) || []).length / Math.max(1, t.length);
  if (alpha < 0.6) c -= 2;                       // OCR noise is punctuation-heavy
  if (/(.)\1{4,}/.test(t)) c -= 2;               // "aaaaa" garbage
  return c;
}

function unitsNeedingOcr(clusters) {
  return clusters.filter(c => c.freepassDone && !c.freepassHit && !c.error && !c.needsManual);
}

if (cmd === 'ocr') {
  const clPath = path.join(CACHE, 'clusters.json');
  if (!fs.existsSync(clPath)) { console.error('run `plan` then `freepass` first'); process.exit(1); }
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const chunk = getArg('chunk') ? +getArg('chunk') : 0;
  const of = getArg('of') ? +getArg('of') : 1;
  const limit = getArg('limit') ? +getArg('limit') : Infinity;
  const only = getArg('source');

  let units = unitsNeedingOcr(clusters);
  if (only) units = units.filter(c => c.source === only);
  units = units.filter((_, i) => i % of === chunk);            // deterministic shard for the Actions matrix
  units = units.filter(c => !fs.existsSync(path.join(OCRDIR, sha1(c.representative) + '.json')));
  units = units.slice(0, limit === Infinity ? units.length : limit);

  console.log(`shard ${chunk + 1}/${of}: ${units.length} units to OCR`);
  let ok = 0, empty = 0, failed = 0, pagesDone = 0;

  for (const [n, c] of units.entries()) {
    const outPath = path.join(OCRDIR, sha1(c.representative) + '.json');
    const { fetchUrl } = resolve(c.representative);
    if (!fetchUrl) { failed++; continue; }
    KEEP_PDFS = true;                                          // we need the file on disk to rasterise
    const meta = await getPdf(fetchUrl, { needFile: true });
    const pdfPath = path.join(PDFDIR, sha1(fetchUrl) + '.pdf');
    if (meta.error || !fs.existsSync(pdfPath)) {
      fs.writeFileSync(outPath, JSON.stringify({ url: c.representative, error: meta.error || 'no-pdf' }));
      failed++; continue;
    }

    const heightPts = meta.pageHeightPts || 842;               // A4 default
    const found = [];
    const residue = [];
    const nPages = Math.min(meta.numPages || 0, 120);          // sanity cap
    for (let p = 1; p <= nPages; p++) {
      const prefix = path.join(PAGEDIR, `${sha1(c.representative)}_p${p}`);
      let img = null;
      try { img = renderPage(pdfPath, p, heightPts, prefix); } catch { img = null; }
      if (!img) continue;
      let qs = [];
      try { qs = questionsFromOcr(tesseractText(img), p); } catch { qs = []; }
      try { fs.unlinkSync(img); } catch {}
      pagesDone++;
      const good = qs.filter(q => questionConfidence(q) >= 3);
      if (good.length) found.push(...good.map(q => ({ ...q, page: p, via: 'tesseract' })));
      else residue.push(p);                                    // nothing convincing — Gemini pass may retry
    }
    try { fs.unlinkSync(pdfPath); } catch {}

    fs.writeFileSync(outPath, JSON.stringify({
      url: c.representative, key: c.key, source: c.source, numPages: meta.numPages || null,
      questions: found, residuePages: residue, engine: 'tesseract'
    }));
    if (found.length) ok++; else empty++;
    if ((n + 1) % 10 === 0 || n === units.length - 1) {
      console.log(`  ${n + 1}/${units.length} · ${ok} with questions · ${empty} empty · ${failed} failed · ${pagesDone} pages`);
    }
  }
  console.log(`\ndone. ${ok} units yielded questions, ${empty} empty, ${failed} failed. Results in .ocr/ocr/`);
  process.exit(0);
}

if (cmd === 'gemini') {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) { console.error('set GEMINI_API_KEY'); process.exit(1); }
  const MODEL = getArg('model') || 'gemini-2.5-flash-lite';
  const maxReq = getArg('requests') ? +getArg('requests') : 900;     // stay under the free daily cap
  const perReq = 6;                                                  // page images per request
  const clPath = path.join(CACHE, 'clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const byUrl = new Map(clusters.map(c => [c.representative, c]));

  // collect residue pages recorded by the tesseract pass
  const jobs = [];
  for (const f of fs.readdirSync(OCRDIR)) {
    const r = JSON.parse(fs.readFileSync(path.join(OCRDIR, f), 'utf8'));
    if (!r.residuePages || !r.residuePages.length || r.geminiDone) continue;
    jobs.push({ file: f, rec: r });
  }
  console.log(`${jobs.length} units have residue pages; budget ${maxReq} requests`);

  const PROMPT = [
    'Each image is the top strip of a page from a UPSC Mains answer booklet.',
    'The printed/typed text at the top is the exam QUESTION. Everything handwritten is the candidate\'s answer — ignore it completely.',
    'For each image in order, return the printed question verbatim.',
    'If an image shows several numbered questions (a question-paper page), return them all, separated by " || ".',
    'If an image has no printed question (pure handwriting, or only a header/logo), return exactly: NONE',
    'Reply as a JSON array of strings, one entry per image, no other text.'
  ].join(' ');

  let used = 0;
  for (const job of jobs) {
    if (used >= maxReq) break;
    const c = byUrl.get(job.rec.url);
    if (!c) continue;
    const { fetchUrl } = resolve(job.rec.url);
    KEEP_PDFS = true;
    const meta = await getPdf(fetchUrl, { needFile: true });
    const pdfPath = path.join(PDFDIR, sha1(fetchUrl) + '.pdf');
    if (!fs.existsSync(pdfPath)) continue;
    const heightPts = meta.pageHeightPts || 842;

    const pages = job.rec.residuePages.slice(0, 60);
    const newQs = [];
    for (let i = 0; i < pages.length && used < maxReq; i += perReq) {
      const slice = pages.slice(i, i + perReq);
      const parts = [{ text: PROMPT }];
      const rendered = [];
      for (const p of slice) {
        const prefix = path.join(PAGEDIR, `g_${sha1(job.rec.url)}_p${p}`);
        let img = null;
        try { img = renderPage(pdfPath, p, heightPts, prefix); } catch {}
        if (!img) continue;
        parts.push({ inline_data: { mime_type: 'image/png', data: fs.readFileSync(img).toString('base64') } });
        rendered.push({ p, img });
      }
      if (!rendered.length) continue;

      let texts = [];
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 2048 } })
        });
        used++;
        if (res.status === 429) { console.log('  rate limited — stopping for today'); used = maxReq; }
        else {
          const j = await res.json();
          const out = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const m = out.match(/\[[\s\S]*\]/);
          if (m) texts = JSON.parse(m[0]);
        }
      } catch (e) { console.log('  request failed:', e.message); }

      rendered.forEach((r, idx) => {
        try { fs.unlinkSync(r.img); } catch {}
        const t = String(texts[idx] || '').trim();
        if (!t || /^none$/i.test(t)) return;
        for (const piece of t.split('||')) {
          const qs = questionsFromOcr(piece.trim(), r.p);
          for (const q of qs) if (questionConfidence(q) >= 3) newQs.push({ ...q, page: r.p, via: 'gemini' });
        }
      });
      await new Promise(r => setTimeout(r, 4200));              // ~14 req/min, under the 15 RPM free cap
    }
    try { fs.unlinkSync(pdfPath); } catch {}

    job.rec.questions = [...(job.rec.questions || []), ...newQs];
    job.rec.geminiDone = true;
    fs.writeFileSync(path.join(OCRDIR, job.file), JSON.stringify(job.rec));
    console.log(`  ${job.rec.key || job.rec.url.slice(-40)} · +${newQs.length} questions · ${used}/${maxReq} requests used`);
  }
  console.log(`\ndone. ${used} requests used.`);
  process.exit(0);
}

if (cmd === 'validate') {
  // Booklets from the same test should yield the same questions. Compare members of a
  // cluster where more than one was OCR'd; agreement raises confidence, disagreement flags.
  const clPath = path.join(CACHE, 'clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const results = new Map();
  for (const f of fs.readdirSync(OCRDIR)) {
    const r = JSON.parse(fs.readFileSync(path.join(OCRDIR, f), 'utf8'));
    if (r.url) results.set(r.url, r);
  }
  const key = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60);
  let agree = 0, disagree = 0, single = 0;
  const flags = [];
  for (const c of clusters) {
    const got = c.members.map(m => results.get(m.url)).filter(Boolean);
    if (got.length < 2) { if (got.length === 1) single++; continue; }
    const sets = got.map(g => new Set((g.questions || []).map(q => key(q.question))));
    const base = sets[0];
    const overlap = sets.slice(1).map(s => {
      const inter = [...s].filter(x => base.has(x)).length;
      return inter / Math.max(1, Math.min(s.size, base.size));
    });
    const worst = Math.min(...overlap);
    if (worst >= 0.6) agree++;
    else { disagree++; flags.push({ key: c.key, source: c.source, overlap: +worst.toFixed(2), urls: got.map(g => g.url) }); }
  }
  fs.writeFileSync(path.join(CACHE, 'validation.json'), JSON.stringify({ agree, disagree, single, flags }, null, 2));
  console.log(`clusters cross-checked: ${agree} agree · ${disagree} disagree · ${single} had only one OCR'd member`);
  if (disagree) console.log(`review .ocr/validation.json — flagged clusters are NOT published`);
  process.exit(0);
}

if (cmd === 'emit') {
  // Write data/ocr-questions.csv. Page anchors come ONLY from the document actually read —
  // never copied to another topper, because booklet pagination differs per candidate.
  const clPath = path.join(CACHE, 'clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const flagged = new Set();
  const vPath = path.join(CACHE, 'validation.json');
  if (fs.existsSync(vPath)) for (const f of JSON.parse(fs.readFileSync(vPath, 'utf8')).flags || []) flagged.add(f.key);

  const memberOf = new Map();
  for (const c of clusters) for (const m of c.members) memberOf.set(m.url, { c, m });

  const rows = [];
  let units = 0, skippedFlagged = 0;
  for (const f of fs.readdirSync(OCRDIR)) {
    const r = JSON.parse(fs.readFileSync(path.join(OCRDIR, f), 'utf8'));
    if (!r.questions || !r.questions.length) continue;
    const hit = memberOf.get(r.url);
    if (!hit) continue;
    if (flagged.has(hit.c.key)) { skippedFlagged++; continue; }
    const m = hit.m;
    const meta = { topper: m.topper, coaching: m.source, subject: m.kind === 'opt' ? (m.subject || 'Other') : m.paper, url: m.url };
    for (const row of toCsvRows(r.questions, meta)) rows.push(row);
    units++;
  }
  // free-pass hits too (text-layer PDFs)
  for (const c of clusters) {
    if (!c.freepassHit) continue;
    const mp = path.join(METADIR, sha1(resolve(c.representative).fetchUrl || c.representative) + '.json');
    if (!fs.existsSync(mp)) continue;
    const qs = JSON.parse(fs.readFileSync(mp, 'utf8')).freepass?.questions;
    if (!qs || !qs.length) continue;
    const m = c.members.find(x => x.url === c.representative) || c.members[0];
    const meta = { topper: m.topper, coaching: m.source, subject: m.kind === 'opt' ? (m.subject || 'Other') : m.paper, url: m.url };
    for (const row of toCsvRows(qs, meta)) rows.push(row);
  }

  const HEADER = 'topper,coaching,subject,page_number,question,metadata,url\n';
  fs.writeFileSync(path.join(DATA, 'ocr-questions.csv'), HEADER + rows.join('\n') + (rows.length ? '\n' : ''));
  console.log(`wrote data/ocr-questions.csv · ${rows.length} rows from ${units} OCR'd units (${skippedFlagged} units held back by validation)`);
  console.log('next: node build.js');
  process.exit(0);
}

if (cmd === 'audit-paper') {
  // Cross-check that each question sits in the right paper (GS1-4 / Essay).
  // Four independent signals; a question is flagged only when they agree it's wrong.
  const qs = JSON.parse(fs.readFileSync(path.join(DATA, 'questions.json'), 'utf8')).questions;
  const syl = JSON.parse(fs.readFileSync(path.join(DATA, 'syllabus.json'), 'utf8'));
  const nodesByPaper = {};
  for (const [p, def] of Object.entries(syl.papers || {})) nodesByPaper[p] = (def.nodes || []).map(n => ({ id: n.id, kw: (n.kw || []).map(k => k.toLowerCase()) }));

  const scoreAgainst = (text, paper) => {
    const t = String(text).toLowerCase();
    let best = 0;
    for (const n of nodesByPaper[paper] || []) {
      let s = 0;
      for (const kw of n.kw) if (t.indexOf(kw) >= 0) s += Math.min(kw.length, 24);
      best = Math.max(best, s);
    }
    return best;
  };
  const GS4 = /\b(ethic|ethical|integrity|probity|conscience|moral|dilemma|whistle ?blow|corrupt|values?|emotional intelligence|case study|civil servant)\b/i;
  const ESSAY = t => !/\?/.test(t) && t.length < 160 && !/\b(discuss|examine|analyse|analyze|elucidate|comment|evaluate)\b/i.test(t);

  const papers = ['GS1', 'GS2', 'GS3', 'GS4'];
  const flags = [];
  for (const q of qs) {
    if (!q.p || q.p === 'Other') continue;
    const t = q.q || '';
    const votes = {};
    // 1 — syllabus keyword score across every paper, not just its own
    if (papers.includes(q.p)) {
      const scores = papers.map(p => [p, scoreAgainst(t, p)]).sort((a, b) => b[1] - a[1]);
      const [topP, topS] = scores[0];
      const own = scores.find(s => s[0] === q.p)[1];
      if (topS >= 16 && topS > own * 2) votes.syllabus = topP;
    }
    // 2 — ethics vocabulary is a strong GS4 tell
    if (GS4.test(t) && q.p !== 'GS4' && q.p !== 'Essay') votes.ethics = 'GS4';
    if (!GS4.test(t) && q.p === 'GS4' && t.length > 120) votes.ethics = 'not-GS4';
    // 3 — essay topics are short, declarative, no directive verb
    if (ESSAY(t) && q.p !== 'Essay' && t.length > 20) votes.shape = 'Essay';
    const agreeing = Object.values(votes).filter(v => v && v !== 'not-GS4');
    const suggestion = agreeing.length >= 2 ? agreeing[0] : null;
    if (Object.keys(votes).length) flags.push({ i: q.i, paper: q.p, suggest: suggestion, votes, answers: (q.a || []).length, q: t.slice(0, 160) });
  }
  flags.sort((a, b) => (b.suggest ? 1 : 0) - (a.suggest ? 1 : 0) || b.answers - a.answers);
  fs.writeFileSync(path.join(CACHE, 'paper-audit.json'), JSON.stringify(flags, null, 2));
  const strong = flags.filter(f => f.suggest).length;
  console.log(`${flags.length} questions raised at least one signal · ${strong} where two or more signals agree`);
  console.log('wrote .ocr/paper-audit.json — review the `suggest` ones first');
  process.exit(0);
}

console.error(`usage: node ocr-pipeline.mjs <command> [options]

  plan                      cluster the corpus by test paper           (free, offline)
  freepass [--all]          download reps, harvest existing text layers (free)
  ocr [--chunk N --of M]    pdftoppm + tesseract on the printed strip   (free)
  gemini [--requests N]     second pass on residue pages, needs GEMINI_API_KEY
  validate                  cross-check clusters, flag disagreements
  emit                      write data/ocr-questions.csv
  audit-paper               check GS1-4/Essay classification
  status                    progress + remaining work`);
process.exit(1);
