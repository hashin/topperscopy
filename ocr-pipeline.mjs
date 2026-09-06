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
async function getPdf(url) {
  const key = sha1(url);
  const pdfPath = path.join(PDFDIR, key + '.pdf');
  const metaPath = path.join(METADIR, key + '.json');
  if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf8'));

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
  } catch (e) {
    meta.error = (e && e.message) || String(e);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  return meta;
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
  let clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const only = getArg('source');
  const limit = getArg('limit') ? +getArg('limit') : Infinity;
  if (only) clusters = clusters.filter(c => c.source === only);

  const rows = [];
  let done = 0, hits = 0, hitDocs = 0, errs = 0, needVision = 0;
  for (const c of clusters) {
    if (done >= limit) break;
    if (c.freepassDone) { if (c.freepassHit) { hits++; hitDocs += c.members.length; } else needVision++; continue; }
    const rep = c.representative;
    const { fetchUrl, note } = resolve(rep);
    if (!fetchUrl) { c.resolveNote = note; c.needsManual = true; continue; }
    process.stdout.write(`[${done + 1}] ${c.source} ${c.key.slice(0, 40)} … `);
    const meta = await getPdf(fetchUrl);
    done++;
    c.freepassDone = true;
    c.numPages = meta.numPages || null;
    c.sizeKB = meta.sizeKB || null;
    if (meta.error) { c.error = meta.error; errs++; console.log('ERR ' + meta.error); continue; }
    const fp = meta.freepass || { count: 0 };
    if (fp.count > 0) {
      c.freepassHit = true; hits++; hitDocs += c.members.length;
      // emit a row-set for every member of the cluster (same printed test → same questions),
      // anchored to each member's own url + page number
      for (const mem of c.members) {
        const meta2 = { topper: mem.topper, coaching: mem.source, subject: mem.kind === 'opt' ? (mem.subject || 'Other') : mem.paper, url: mem.url };
        for (const r of toCsvRows(fp.questions, meta2)) rows.push(r);
      }
      console.log(`FREE ${fp.count}q → ${c.members.length} members`);
    } else {
      c.freepassHit = false; needVision++;
      console.log(`no text (${meta.textChars || 0} chars, ${meta.numPages || '?'}p) → vision`);
    }
    fs.writeFileSync(clPath, JSON.stringify(clusters, null, 2));
  }

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

  console.log(`\nprocessed ${done} units · free-pass hits ${hits} (covering ${hitDocs} docs) · need vision ${needVision} · errors ${errs}`);
  console.log(`wrote data/ocr-questions.csv (${allRows.length} rows). next: node build.js, then review.`);
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

console.error('usage: node ocr-pipeline.mjs <plan|freepass|status> [--source X] [--limit N]');
process.exit(1);
