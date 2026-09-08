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
 *   node ocr-pipeline.mjs gemini [--requests N] [--source X] [--limit N]
 *       PRIMARY vision OCR. Renders the top strip of every page of every
 *       not-yet-searchable booklet and asks gemini-3.5-flash-lite for the
 *       printed English question. Free tier → $0. Page-by-page resumable, stops
 *       clean on HTTP 429. Runs unattended via .github/workflows/ocr-gemini.yml
 *       (nightly, gated on the OCR_GEMINI_ENABLED repo variable).
 *       Tesseract (`ocr`) is kept as an offline fallback but yields little on
 *       this bilingual + watermarked + handwriting-over-print corpus.
 *
 *   node ocr-pipeline.mjs status
 *       Prints where things stand: free-pass hits, booklets still needing OCR,
 *       page count and estimated nightly-run days for the Gemini step.
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

/* ---- shared: rasterise + OCR + question extraction (defined before the command
 * dispatch because `freepass` runs its filter during top-level await) ---- */
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
const RAWDIR = path.join(CACHE, 'raw');   // raw per-page tesseract text — lets `reclean` re-run the filter offline
for (const d of [PAGEDIR, OCRDIR, RAWDIR]) fs.mkdirSync(d, { recursive: true });

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

/* ----------------------------------------------------------------------------
 * Bilingual-booklet cleanup.
 *
 * Almost every VisionIAS / NextIAS / Drishti test copy prints the question
 * TWICE at the top of the page — Hindi first, then English. Tesseract runs
 * `-l eng`, so the Devanagari half comes back as a slab of short-token garble
 * ("| der aa WH Gara ¢ wafh witaae ... 10 sia Constitution is a mere skeleton
 * whereas constitutionalism is the soul of democracy. Discuss.").
 *
 * So questionsFromOcr() first drops every OCR line that isn't mostly real
 * English words (englishishLine) — that removes the Devanagari half outright —
 * then cleanOcrQuestion() trims what's left to a proper end (a '?', a
 * "(… words)" limit, or a final sentence stop) and rejects anything that still
 * starts lowercase, ends "..., and discuss" (a lost clause), carries a run of
 * OCR garble, or isn't >=82% English. Rejects are left in residuePages for the
 * Gemini pass — "a wrong question is worse than a missing one" (runbook §9).
 * ------------------------------------------------------------------------- */
/* An English word set big enough to tell a real UPSC sentence from
 * romanised-Devanagari garble: ~1000 highest-frequency English words plus
 * civil-services vocabulary. A line/question is "Englishish" when enough of its
 * tokens land here (after light suffix stripping). */
const EN_RAW = (
  // ~1000 most common English words
  'the of to and a in is it you that he was for on are with as i his they be at one have this from or had ' +
  'by hot but some what there we can out other were all your when up use word how said an each she which do ' +
  'their time if will way about many then them write would like so these her long make thing see him two has ' +
  'look more day could go come did number sound no most people my over know water than call first who may ' +
  'down side been now find any new work part take get place made live where after back little only round man ' +
  'year came show every good me give our under name very through just form sentence great think say help low ' +
  'line differ turn cause much mean before move right boy old too same tell does set three want air well also ' +
  'play small end put home read hand port large spell add even land here must big high such follow act why ' +
  'ask men change went light kind off need house picture try us again animal point mother world near build ' +
  'self earth father head stand own page should country found answer school grow study still learn plant ' +
  'cover food sun four thought let keep eye never last door between city tree cross since hard start might ' +
  'story saw far sea draw left late run dont while press close night real life few north open seem together ' +
  'next white children begin got walk example ease paper often always music those both mark book letter ' +
  'until mile river car feet care second group carry took rain eat room friend began idea fish mountain stop ' +
  'once base hear horse cut sure watch color face wood main enough plain girl usual young ready above ever ' +
  'red list though feel talk bird soon body dog family direct pose leave song measure state product black ' +
  'short numeral class wind question happen complete ship area half rock order fire south problem piece told ' +
  'knew pass farm top whole king size heard best hour better true during hundred am remember step early hold ' +
  'west ground interest reach fast five sing listen six table travel less morning ten simple several vowel ' +
  'toward war lay against pattern slow center love person money serve appear road map science rule govern ' +
  'pull cold notice voice fall power town fine certain fly unit lead cry dark machine note wait plan figure ' +
  'star box noun field rest correct able pound done beauty drive stood contain front teach week final gave ' +
  'green oh quick develop sleep warm free minute strong special mind behind clear tail produce fact street ' +
  'inch lot nothing course stay wheel full force blue object decide surface deep moon island foot yet busy ' +
  'test record boat common gold possible plane age dry wonder laugh thousand ago ran check game shape ' +
  'yes hot miss brought heat snow bed bring sit perhaps fill east weight language among ' +
  // civil-services / current-affairs vocabulary
  'india indian bharat government governance state states central union centre federal federalism ' +
  'constitution constitutional parliament parliamentary judiciary judicial executive legislature legislative ' +
  'supreme court courts law laws legal rights fundamental directive principle principles duties citizen ' +
  'citizens democracy democratic election elections electoral vote voting party parties politics political ' +
  'policy policies scheme schemes programme programmes mission act bill amendment amendments reform reforms ' +
  'economy economic economies growth development developmental sustainable sustainability poverty inequality ' +
  'inclusive inclusion exclusion employment unemployment livelihood labour wages agriculture agricultural ' +
  'farmer farmers farming crop crops irrigation industry industrial manufacturing infrastructure logistics ' +
  'services sector sectors market markets trade tariff export exports import imports investment finance ' +
  'financial fiscal monetary budget tax taxation revenue subsidy subsidies inflation deficit debt banking ' +
  'bank banks credit lending transport transportation railway highway aviation port ports energy renewable ' +
  'solar coal electricity grid water sanitation housing urban urbanisation rural migration urbanization ' +
  'population demographic demographics health healthcare nutrition mortality education literacy learning ' +
  'school schools college university universities skilling skill skills employment technology technological ' +
  'digital digitalisation innovation research development scientific science satellite space nuclear ' +
  'artificial intelligence data privacy cyber cybersecurity security defence military strategic border ' +
  'borders maritime terrorism extremism radicalisation insurgency naxalism diplomacy foreign relations ' +
  'bilateral multilateral plurilateral regional global international cooperation organisation organization ' +
  'treaty convention protocol summit dialogue partnership alliance neighbourhood connectivity ' +
  'china pakistan nepal bhutan bangladesh myanmar afghanistan russia america american europe european ' +
  'african quad brics asean saarc bimstec united nations world bank climate change environment ' +
  'environmental ecology ecological biodiversity ecosystem ecosystems forest forests wildlife conservation ' +
  'pollution emission emissions carbon greenhouse renewable warming disaster disasters management mitigation ' +
  'adaptation resilience vulnerability pandemic epidemic disease outbreak drought flood floods cyclone ' +
  'earthquake landslide society social societal community communities cultural culture heritage tradition ' +
  'history historical historiography ancient medieval modern colonial precolonial postcolonial ' +
  'nationalism nationalist national movement movements freedom struggle independence partition revolution ' +
  'revolt rebellion reformist renaissance gender women woman men child children marriage family caste ' +
  'tribal tribe tribes adivasi dalit backward reservation religion religious secular secularism communal ' +
  'communalism pluralism diversity identity language linguistic regionalism federal corruption transparency ' +
  'accountability ethics ethical integrity probity morality moral values conscience empathy compassion ' +
  'objectivity impartiality dedication administration administrative bureaucracy bureaucratic civil servant ' +
  'servants service services welfare beneficiary beneficiaries entitlement empowerment participation ' +
  'grievance panchayat panchayati municipality municipal local decentralisation decentralization devolution ' +
  'cooperative federalism institution institutions institutional autonomy accountability mechanism mechanisms ' +
  'framework frameworks role significance implication implications challenge challenges issue issues concern ' +
  'concerns measure measures step steps initiative initiatives strategy strategies approach need needed ' +
  'important critical crucial essential necessary vital various major minor key recent recently emerging ' +
  'context light extent perspective dimension dimensions aspect aspects feature features increasing growing ' +
  'rising declining shrinking widening changing evolving present current ongoing potential effective ' +
  'efficient inefficient adequate inadequate across towards regarding despite although though however ' +
  'therefore moreover furthermore further additionally consequently nevertheless meanwhile nature scope ' +
  'factor factors reason reasons cause causes effect effects consequence consequences outcome outcomes ' +
  'benefit benefits drawback limitation limitations problem problems prospect prospects opportunity threat ' +
  'strength weakness solution solutions recommendation recommendations way ways manner methods method ' +
  'system systems process processes structure structures function functions relationship relationships ' +
  'balance imbalance tension conflict crisis stability instability transition transformation ' +
  'evolution emergence expansion contraction shift decline revival recovery ' +
  'analyse analyze examine discuss evaluate elucidate substantiate illustrate justify explain describe ' +
  'elaborate assess highlight enumerate trace clarify comment critically account bring suggest argue ' +
  'argument statement given whether agree extent light view point terms regard respect example ' +
  'battle war victory defeat foundation empire emperor kingdom dynasty ruler rule reign conquest colonial ' +
  'nationalism drain wealth exploitation agitation education congress league viceroy governor'
);
const suffixes = ['s', 'es', 'ed', 'd', 'ing', 'ly', 'er', 'or', 'ion', 'tion', 'sion', 'ment', 'ness', 'ity', 'al', 'ial', 'ic', 'ical', 'ive', 'ation', 'isation', 'ization'];
const EN = new Set(EN_RAW.split(/\s+/).filter(Boolean));

const DIRECTIVE_RX = /\b(discuss|examine|analyse|analyze|elucidate|evaluate|comment|critically|substantiate|illustrate|justify|explain|describe|elaborate|assess|highlight|enumerate|trace|clarify|suggest|comment upon|do you agree|to what extent|account for|bring out)\b/i;
/** end of a question: a '?', a "(… words)" limit, or a bare directive verb + optional period. */
const Q_END_RX = /(\?|\([^)]*\b\d{2,4}\s*words?\b[^)]*\)|\b(?:discuss|examine|analyse|analyze|elucidate|evaluate|comment(?:\s+upon)?|explain|describe|substantiate|illustrate|justify|elaborate|assess|clarify|highlight|enumerate|trace)\b\.?)(?!\w)/gi;
/** ", and discuss" / "also examine" tails mean a clause was lost to OCR — the question is truncated. */
const TRUNC_TAIL_RX = /(?:,\s*|\b(?:and|also|further|then|additionally|hence|thereby)\s+)(discuss|examine|analyse|analyze|explain|evaluate|comment|elaborate|assess|highlight|describe|elucidate|substantiate|illustrate)\b\.?\s*$/i;

const bare = w => w.replace(/[^A-Za-z]/g, '').toLowerCase();
function isEnglishWord(w) {
  let a = bare(w);
  if (a.length < 2) return false;
  if (EN.has(a)) return true;
  for (const suf of suffixes) {
    if (a.length > suf.length + 2 && a.endsWith(suf)) {
      const stem = a.slice(0, -suf.length);
      if (EN.has(stem) || EN.has(stem + 'e') || EN.has(stem.replace(/i$/, 'y'))) return true;
    }
  }
  return false;
}

/** enough real English in a line to keep it? (drops the romanised-Hindi lines) */
function englishishLine(line) {
  const long = line.split(/\s+/).filter(w => bare(w).length >= 3);
  if (long.length < 3) return false;
  return long.filter(isEnglishWord).length / long.length >= 0.5;
}

/** true when the string has a run of >=3 back-to-back non-English lowercase tokens (OCR garble). */
function hasGarbleRun(s) {
  let run = 0;
  for (const w of s.split(/\s+/)) {
    const a = bare(w);
    if (a && a.length <= 7 && !EN.has(a) && !/^\d+$/.test(a) && !/^[A-Z]/.test(w)) { if (++run >= 3) return true; }
    else run = 0;
  }
  return false;
}

/* The rotated "Candidates must not write on this margin" watermark and the
 * handwriting under it come back from Tesseract as a handful of recurring junk
 * fragments scattered mid-line and at line ends. */
const WATERMARK_RX = /\b(?:candidat\w*|cantidet\w*|ca[ao]d\w*|caadd\w*|grusense|imag?[nt]{2,}\w*|mu[rs]t\s*n[eo]t\w*|must\s*not\w*|murtnot|mstn?et|msttst|o?asis|osis|baaiee|peabie|\bbea\b|\bace\b|gori\s+wnat\s+eck|(?:on\s+)?this\s+margin)\b/gi;

/** Strip watermark fragments and page cruft that bleed into a scanned line. */
function stripLineJunk(l) {
  l = l
    .replace(/\s*\([^)]*$/, '')                                  // an unclosed trailing "(" = watermark bleed
    .replace(WATERMARK_RX, ' ')
    .replace(/\s+\d{1,2}\s*[|)\]]+\s*$/, '')                     // trailing "10 |", "15]"
    .replace(/^[\s|~=—–<>*.'"‘’]+/, '')                          // leading OCR speckle
    .replace(/\s*[|~=—–<>*]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // chop a trailing run of >=2 obvious-garble tokens (no vowel, triple letter, or mid-word caps)
  const t = l.split(' ');
  const garbly = w => { const a = bare(w); return a.length >= 2 && a.length <= 7 && !EN.has(a) && (!/[aeiou]/i.test(a) || /(.)\1\1/i.test(a) || /[a-z][A-Z]/.test(w) || a.length <= 3); };
  while (t.length > 6 && garbly(t[t.length - 1]) && garbly(t[t.length - 2])) t.pop();
  return t.join(' ').trim();
}

/** A span that opens with a bare directive + "in the context/light of…" is
 *  sentence 2 of a two-sentence question — sentence 1 was lost to OCR. */
const TRUNC_LEAD_RX = /^(?:discuss|examine|analyse|analyze|evaluate|comment|elucidate|explain|elaborate|assess|substantiate|illustrate|critically)\b\s+(?:in |with (?:reference|regard)|critically|it |this |the (?:above|statement|context|light|backdrop))/i;

/** rubric / instruction lines that sit on an essay question-paper page but aren't topics */
const RUBRIC_RX = /^\s*(?:write|answer|attempt|section|instructions?|note|choose|candidates?|time allowed|maximum marks|word limit|marks?\b|q\.?\s*no\b|\d+\s*[x×]\s*\d+)/i;

/** Backstop maths detector for a mislabelled subject — the real guard is the
 *  Mathematics/Statistics subject exclusion in `emit`. Only unambiguous maths
 *  terms here: common English words ("integral part", "policy convergence",
 *  "decision matrix", "derivative of") must NOT trigger it. */
const MATHS_RX = /\b(polynomial|eigen(?:value|vector)s?|homomorphism|isomorphism|abelian|coset|maclaurin|riemann integral|contour integral|residue theorem|cauchy'?s? (?:integral|theorem|residue)|fourier (?:series|transform)|laplace transform|characteristic (?:root|equation)|simplex method|transportation problem|assignment problem|null space of|cyclic group|normal subgroup|prove that (?:every|the group|G is)|show that (?:the (?:set|group|ring|map)|G|H is))\b|\bf\s*\(\s*x\s*\)\s*=|\b(?:∫|∑|√|∂)/i;

/** Validate + tidy one candidate question span. Returns the clean string or null.
 *  `essay` mode relaxes the "must contain a directive verb or ?" rule — essay
 *  topics are bare declarative statements — but keeps every noise guard. */
function validateQ(q, essay) {
  q = q.replace(/^[^A-Za-z"“]+/, '').replace(/\s+[''‘’|-]+\s*$/, '').replace(/\s*[-—–|]\s*$/, '').trim();
  // drop up to two leading non-English tokens ("Fifa The recently concluded…")
  let lead = q.split(' ');
  let dropped = 0;
  while (lead.length > 10 && dropped < 2 && !isEnglishWord(lead[0]) && !/^["“]/.test(lead[0]) &&
         (isEnglishWord(lead[1]) || /^[A-Z]/.test(lead[1]))) { lead.shift(); dropped++; }
  q = lead.join(' ').replace(/^[^A-Za-z"“]+/, '');
  q = q.replace(/\s+([,.;:?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  if (q.length < (essay ? 25 : 45) || q.length > 550) return null;
  if (!/^[A-Z"“]/.test(q)) return null;                          // real questions open with a capital
  if (/^[A-Za-z][A-Za-z-]*[),]/.test(q)) return null;            // "EAC-PM), there is…" — mid-sentence fragment
  if (/^[^("]{0,35}\)/.test(q)) return null;                     // an early ")" with no "(" — spillover from a garbled clause
  if (/\d\s+[A-Za-z]\s+[A-Za-z]{1,3}\s+[A-Za-z]{1,4}\)/.test(q.slice(0, 40))) return null;
  if (RUBRIC_RX.test(q)) return null;                            // "Write two essays…", "Section A", "Maximum Marks"
  if (TRUNC_LEAD_RX.test(q)) return null;                        // "Discuss in the context of…" — a clause was lost
  if (!essay && !DIRECTIVE_RX.test(q) && !/\?/.test(q)) return null;
  if (TRUNC_TAIL_RX.test(q)) return null;                        // "..., and discuss" → a clause was lost
  if (hasGarbleRun(q)) return null;                              // mid-sentence OCR garble
  const toks = q.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (toks.length < (essay ? 5 : 9)) return null;
  // proper nouns (Capitalised, not sentence-initial) count as good — Plassey, Bengal, MGNREGA…
  const good = toks.filter((w, i) => bare(w).length < 3 || isEnglishWord(w) || (i > 0 && /^[A-Z]/.test(w)));
  if (good.length / toks.length < (essay ? 0.88 : 0.84)) return null;
  return q;
}

/** Pull the best-formed English question out of a (de-junked) blob of OCR text. */
function cleanOcrQuestion(blob, essay) {
  const s = String(blob || '').replace(WATERMARK_RX, ' ')
    // drop parentheticals that are not real English (romanised-Hindi "(iso weal F oer aifery)"),
    // but keep "(Answer in 150 words)", "(IMF)", "(150 words)", "(1757)"
    .replace(/\(([^)]{2,40})\)/g, (mm, inner) => {
      if (/^\s*(?:answer\s+in\s+)?\d{2,4}\s*(?:words?|marks?)\s*$/i.test(inner)) return mm; // "(150 words)"
      if (/^\s*(?:1[6-9]|20)\d\d\s*$/.test(inner)) return mm;                               // a year "(1757)"
      if (/^[A-Za-z][A-Za-z.&-]{1,7}$/.test(inner.trim())) return mm;                       // acronym "(IMF)"
      const w = inner.split(/\s+/).filter(x => bare(x).length >= 2);
      if (w.length >= 2 && w.filter(isEnglishWord).length / w.length >= 0.6) return mm;
      return ' ';
    })
    .replace(/\s+/g, ' ').replace(/\s[''‘’;]\s/g, ' ').replace(/\s{2,}/g, ' ').trim();
  Q_END_RX.lastIndex = 0;
  const ends = [];
  let m;
  while ((m = Q_END_RX.exec(s))) ends.push(m.index + m[0].length);
  ends.sort((a, b) => b - a);                        // try the longest anchored span first
  ends.push(s.length);                               // …then the whole blob (clean Gemini output with no anchor)
  // sentence starts: string start, or a capital following ". " / "? " / a quote
  const starts = [0];
  for (const sm of s.matchAll(/(?:[.?!]\s+|["“]\s*)([A-Z])/g)) starts.push(sm.index + sm[0].length - 1);
  for (const end of ends) {
    let st = 0;
    for (const cand of starts) if (cand < end && end - cand >= 40) st = cand;
    const q = validateQ(s.slice(st, end), essay);
    if (q) return q;
  }
  return null;
}

/** Gemini already did the OCR *and* the cleanup — its output is clean English
 *  prose. So we trust it: split on " || ", strip any leaked Devanagari and a
 *  trailing marks number, sanity-check, keep. No span surgery. */
function cleanGeminiQuestion(s, essay) {
  s = String(s || '')
    .replace(/\\n/g, ' ')                                    // literal escaped newline that slipped through JSON
    .replace(/[ऀ-ॿ]+/g, ' ')                                // any leaked Devanagari
    .replace(/```(?:json)?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^Q\.?\s*\d{1,2}[.)]?\s*/i, '')                 // leading "Q.15 "
    .replace(/^\s*\d{1,2}[.)]\s*/, '')                       // leading "15. "
    .replace(/\(([^)]*)\)/g, (m, inr) =>                     // drop empty / "(250 )" parens, keep "(150 words)" & years
      /[A-Za-z]/.test(inr) || /^\s*(?:1[6-9]|20)\d\d\s*$/.test(inr) ? m : ' ')
    .replace(/^\s*[-–—?]+\s*/, '')
    .replace(/^\s*\d{1,2}\s+(?=["“'A-Z])/, '')               // leading stray "15 " before the real start
    .replace(/[\s(]*\d{1,2}\s*marks?\.?\)?\s*$/i, '')        // trailing "10 marks." / "(15 marks)"
    .replace(/\s*\|\s*\d{1,2}\s*$/, '')                      // trailing "| 15"
    .replace(/\s+\d{1,2}\s*$/, '')                           // trailing " 10"
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^none\b/i.test(s) || s.length < 20 || s.length > 700) return null;
  if (RUBRIC_RX.test(s)) return null;                        // "Write two essays…", "Section A", "Maximum Marks"
  if (!/^["“'']?[A-Z]/.test(s)) return null;
  if ((s.match(/[A-Za-z]/g) || []).length / s.length < 0.55) return null;
  const words = s.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (words.length < (essay ? 5 : 6)) return null;
  if (!essay && !DIRECTIVE_RX.test(s) && !/\?/.test(s) &&
      !/^["“'']?(?:how|why|what|which|do you|to what extent|should|can|is|are|in what)\b/i.test(s)) return null;
  return s;
}

/** Second-chance pass for a Gemini chunk that `cleanGeminiQuestion` threw out.
 *  Gemini was told to return ONLY printed question text (or "NONE"), so a
 *  non-NONE chunk is its judgement that this IS a question — most rejects are a
 *  light OCR wound we can dress, not garbage. Repair the recoverable ones,
 *  still hard-drop instructions / rubric / notation / true letter-soup.
 *  Anything this returns is tagged `salvaged` downstream. */
function salvageGeminiQuestion(raw, essay) {
  let s = String(raw || '')
    .replace(/\\n/g, ' ').replace(/[ऀ-ॿ]+/g, ' ').replace(/```(?:json)?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:Q\.?\s*)?\d{1,2}\s*[.)]\s*/i, '')          // "Q.15 " / "12. "
    .replace(/^\s*\(\s*[a-e]\s*\)\s*/i, '').replace(/^\s*[a-e]\)\s*/i, '')   // "(a) " / "b) "
    .replace(/^\s*\(\s*[ivx]{1,3}\s*\)\s*/i, '')                // "(ii) "
    .replace(/\(([^)]*)\)/g, (m, inr) =>                        // drop non-English parens, keep "(150 words)"/years/acronyms
      /[A-Za-z]/.test(inr) || /^\s*(?:1[6-9]|20)\d\d\s*$/.test(inr) ? m : ' ')
    .replace(/[\s(]*\d{1,3}\s*marks?\.?\)?\s*$/i, '')           // trailing "10 marks."
    .replace(/\s*\|\s*\d{1,3}\s*$/, '').replace(/\s+\d{1,2}\s*$/, '')
    .replace(/^["“'\s.,;:–—\-*)\]]+/, '')                       // strip leading speckle / stray bracket
    .replace(/\s+([,.;:?])/g, '$1').replace(/\s{2,}/g, ' ').trim();

  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1);   // OCR ate the opening capital
  s = s.replace(/[\s,;:–—-]+(?:and|or|but|the|a|an|of|in|to|with|for|which|that|as|by|on|from)\s*$/i, '').trim();

  if (!s || s.length < 30 || s.length > 700) return null;
  if (/^none\b/i.test(s)) return null;
  if (RUBRIC_RX.test(s) || INSTRUCTION_RX.test(s) || TRUNC_LEAD_RX.test(s)) return null;
  if (MATHS_RX.test(s)) return null;
  if (/[ऀ-ॿ]/.test(String(raw))) return null;                  // a still-bilingual line → preamble, not the question
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.6) return null;                   // digit / symbol soup
  if (/[\\{}^|]|∫|∑|√|\bdxdy\b/.test(s)) return null;           // notation
  const toks = s.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (toks.length < (essay ? 4 : 6)) return null;
  if (hasGarbleRun(s)) return null;                            // 3+ consecutive non-word tokens
  if (toks.filter(w => /[bcdfghjklmnpqrstvwxz]{5}/i.test(w)).length >= 1) return null;   // "itreducible", "cnd"
  if (toks.filter(w => /[a-z][A-Z]/.test(w) && !/^["“'']?[A-Z]/.test(w)).length >= 1) return null;   // "prOVIded" intercaps
  if (toks.filter(w => /^[b-df-hj-np-tv-wyz]$/i.test(w)).length >= 2) return null;       // split-word fragments
  // real-English density — proper nouns (Capitalised, not sentence-initial) and short words count as good
  const good = toks.filter((w, i) => bare(w).length < 3 || isEnglishWord(w) || (i > 0 && /^[A-Z0-9]/.test(w)));
  if (good.length / toks.length < 0.82) return null;
  // it has to read like a prompt: a directive verb, a question mark, an interrogative opener,
  // or a self-contained statement that ends in a full stop (essay topic / "The role of X ..." stem)
  const prompt = essay || DIRECTIVE_RX.test(s) || /\?/.test(s)
    || /^["“'']?(?:how|why|what|which|whether|do you|to what extent|should|could|can|is|are|in what|in the light of|in the context of|given that)\b/i.test(s)
    || /[.?]["'’”]?$/.test(s);
  if (!prompt) return null;
  if (/\b(?:i think|in my opinion|firstly,|secondly,|to conclude|as per me|according to me|the candidate (?:has|should|must|needs)|good attempt|well written)\b/i.test(s)) return null;
  return s;
}

/** `freepass` reads whatever pdf.js finds in a PDF text layer and runs the old
 *  extractQuestions() heuristic — no quality gate. That is fine for GS/Essay
 *  booklets but on optional-subject copies (Mathematics especially) and on
 *  evaluation-rubric pages it emits notation dumps and score grids. This gate
 *  drops those before they reach data/ocr-questions.csv. */
/** standard UPSC question-paper preamble / portal chrome that pdf.js hands back as "questions" */
const INSTRUCTION_RX = /^(?:there (?:are|is)\b|candidates?\s*(?:has|have|should|must|are|will|may)\b|questions?\s+no|the number of marks|word li?\s?mit in|any page or portion|answers?\s+must be wr|please\s+(?:do\s+)?furnish|do furnish|write your name|write the appropriate|write \w+ essays?\b|choosing one topic|note\s*:|the (?:above\s+)?question[_ -]?paper|this (?:question[_ -]?)?paper|.{0,20}\bmust be returned\b|the medium (?:specified|authorized)|the candidate should|all questions carry|symbols?\s+\w+\s+carry|attempt (?:any |only )?\w+ questions?|one question in|maximum marks|time allowed|a consolidated question|question[_ -]?paper[_ -]?cum|legible scanning|please write|upload your|support\s*:|call \d{6}|evaluator code|s\s*&\s*f\s*=|marks? ?obtained|do not write|for office use|evaluation indicator|content competence|structure competence|language competence|immediately on receipt|evaluate the following integral|find the (?:unique )?polynomial)/i;

const TYPOGRAPHIC_OK = /[‘’“”–—… °•é−×]/g;  // curly quotes, dashes, ellipsis, °, é…

function cleanTextLayerQuestion(text, essay) {
  let s = String(text || '').replace(/\s+/g, ' ')
    .replace(/^\s*[IVX]{1,4}\s*[.)]?\s+(?=\(?[a-e]\)|\(?[ivx]+\)|\d|[A-Z])/, '')  // "I (d) …", "II. …", "IV a) …"
    .replace(/^\s*(?:Q\.?\s*)?\d{1,2}\s*[.)]\s*/i, '')       // "Q.5 " / "12. " / "5 ) "
    .replace(/^\s*\(\s*[a-e]\s*\)\s*/i, '')                  // "(a) " / "( a ) " sub-part marker
    .replace(/^\s*[a-e]\)\s*/i, '')                          // "a) "
    .replace(/^\s*\(\s*[ivx]{1,3}\s*\)\s*/i, '')             // "(i) " roman sub-part
    .replace(/^(short note)s?\s*[:-]\s*/i, '$1 on ')         // "Short Note: X" → "Short note on X"
    .replace(/\b([A-Za-z]{2,})\s+['’]\s+s\b/g, "$1's")       // "India ' s" → "India's" (OCR split the apostrophe)
    .replace(/\s+[^\x00-\x7F][^\x00-\x7F\s]*(?:\s+[^\x00-\x7F][^\x00-\x7F\s]*)*\s*$/, '')  // trailing romanised-Hindi garble
    .replace(/\s{2,}/g, ' ').trim();
  if (s.length < 35 || s.length > 900) return null;
  if (!/^["“'']?[A-Z]/.test(s)) return null;
  if (INSTRUCTION_RX.test(s)) return null;
  if (MATHS_RX.test(s)) return null;                                        // Maths / Statistics — notation, not searchable text
  // examiner feedback written in the margin, not a question
  if (/^(?:points?\b|you (?:need|should|could|can|must|have)|good (?:attempt|effort|answer|point)|well (?:done|attempted|written|structured)|nice\b|try to\b|kindly\b|please (?:elaborate|add|include|improve|write|structure|mention|explain|note)|more (?:examples?|content|analysis|data|dimensions?)|introduction (?:is|needs|can|should)|conclusion (?:is|needs|can|should)|body (?:is|needs|can|should)|(?:add|use|draw) (?:a |more |diagram|fl?ow ?chart|map)|underline\b|handwriting\b|refer\b|see (?:the |above)|as (?:discussed|per (?:the )?(?:demand|rubric|guideline)))/i.test(s)) return null;
  if (/\bmarker\b|\bmerit\s*\d\b|destinations?\s+d\d|switching circuit|newton'?s?\s+(?:forward|backward) formula|orthogonal trajector/i.test(s)) return null;
  if (/^\W*\d[\d.\s<>+×x/-]{6,}/.test(s)) return null;                       // "0- 3.5 < 3.0 10 Marker …" score grid
  if (/[ऀ-ॿ]/.test(String(text))) return null;                              // bilingual line — usually preamble
  if (s.replace(TYPOGRAPHIC_OK, '').match(/[^\x00-\x7F]/)) return null;      // leftover non-Latin → transliteration junk
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.62) return null;                                // digit / symbol soup
  if (/[\\{}^|]|T\([a-z],|\bmod\s+\d\b|=\s*[a-z(]|∫|∑|√|\[1[0-9]\]|\bdxdy\b|\bflow chart\b/i.test(s)) return null;   // maths notation
  const toks = s.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (toks.length < 7) return null;
  if (toks.filter(w => w.replace(/[^A-Za-z]/g, '').length <= 2).length / toks.length > 0.4) return null;   // garble = many tiny tokens
  if (toks.filter(w => /[bcdfghjklmnpqrstvwxz]{5}/i.test(w)).length >= 1) return null;   // "srn.r", "itreducible", "cnd", "Hunman"
  var lone = toks.filter(w => /^[b-df-hj-np-tv-wyz]$/.test(w)).length;       // split-word fragments ("rul g", "Block s", "w as")
  if (lone >= 2 || (lone >= 1 && s.length <= 130)) return null;
  if (toks.filter(w => /[a-z][A-Z]/.test(w) && !/^["“'']?[A-Z]/.test(w)).length >= 1) return null;  // "prOVIded", "cJusess" intercaps garble
  if (/[a-z]\([a-z]/i.test(s)) return null;                                  // "a(vook" — a paren jammed inside a word
  if (/[A-Za-z]_|_[A-Za-z]/.test(s)) return null;                            // "the_ international" — underscores aren't in real questions
  if (/[a-z][.,][a-z]{2,}/.test(s.replace(/\b(?:e\.g|i\.e|etc|viz|vs|govt|dept)\./gi, ''))) return null;  // "Ad.yham" — punctuation jammed inside a word
  // text-layer questions get no benefit of the doubt: needs a directive verb, a '?', or the essay/short-note shape
  if (!essay && !DIRECTIVE_RX.test(s) && !/\?/.test(s) && !/^short note on\b/i.test(s)) return null;
  if (essay && !/[.?][""'']?$/.test(s)) return null;                         // essay topic must be a complete sentence
  return s;
}
function filterFreepassQuestions(qs, paper) {
  const essay = /essay/i.test(paper || '');
  const out = [];
  for (const q of qs || []) {
    const clean = cleanTextLayerQuestion(q.question, essay);
    if (clean) out.push({ ...q, question: clean });
  }
  return out;
}

/** Turn one page's OCR text (tesseract raw, or one Gemini response entry) into
 *  question rows. Tesseract path: bilingual booklets wrap the English question
 *  over 2–3 lines with the Hindi version and a margin watermark around it, so we
 *  de-junk each line, keep the English, glue it back, split multi-question
 *  pages, and extract each span. Gemini path: trust it, light cleanup only.
 *  `opts.paper` drives essay-mode leniency; `opts.engine` picks the path. */
function questionsFromOcr(text, pageNo, opts = {}) {
  const essay = /essay/i.test(opts.paper || '');
  if (opts.engine === 'gemini') {
    const out = [];
    for (const chunk of String(text || '').split(/\s*\|\|\s*|\n(?=\s*\d{1,2}[.)]\s)/)) {
      let q = cleanGeminiQuestion(chunk, essay), salvaged = false;
      if (!q && opts.salvage !== false) { q = salvageGeminiQuestion(chunk, essay); salvaged = !!q; }
      if (q) out.push({ page: pageNo, question: q, salvaged, marks: (chunk.match(/\b(\d{1,3})\s*marks?\b/i) || [])[1] || '', words: (chunk.match(/\b(\d{2,3})\s*words?\b/i) || [])[1] || '' });
    }
    return out;
  }
  const chunks = String(text || '').split(/\s*\|\|\s*|\n(?=\s*\d{1,2}[.)]\s)/);  // tesseract path below
  const out = [];
  for (const chunk of chunks) {
    let lines = chunk.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    lines = lines.map(stripLineJunk).filter(Boolean).filter(englishishLine);
    if (!lines.length) continue;
    const blob = lines.join(' ');
    // still a multi-question blob? split on the numbering
    const pieces = (blob.match(/\b\d{1,2}[.)]\s+["“A-Z]/g) || []).length >= 2
      ? blob.split(/\s(?=\d{1,2}[.)]\s+["“A-Z])/)
      : [blob];
    for (const piece of pieces) {
      const q = cleanOcrQuestion(piece, essay);
      if (q) out.push({ page: pageNo, question: q, marks: (piece.match(/\b(\d{1,3})\s*marks?\b/i) || [])[1] || '', words: (piece.match(/\b(\d{2,3})\s*words?\b/i) || [])[1] || '' });
    }
  }
  return out;
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
      // Only count it a free-pass hit if the text layer yields *clean* questions.
      // A garbled text layer (scanned ForumIAS etc.) must fall through to the
      // Gemini vision pass, not lock the booklet in with junk.
      const fp = meta.freepass || { count: 0 };
      const clean = filterFreepassQuestions(fp.questions, c.paper);
      c.freepassHit = clean.length > 0;
      c.freepassClean = clean.length;
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
    const qs = filterFreepassQuestions(meta.freepass && meta.freepass.questions, c.paper);
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
  const reqs = Math.ceil(pages / 6);
  console.log(`\nvision step: ~${pages.toLocaleString()} pages · ~${reqs.toLocaleString()} Gemini requests (6 pages/request)`);
  console.log(`  gemini-3.5-flash-lite, free tier — $0. At ~800 requests/day that is ~${Math.ceil(reqs / 800)} days of the nightly ocr-gemini.yml run.`);
  process.exit(0);
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
      let raw = '';
      try { raw = tesseractText(img); } catch { raw = ''; }
      try { fs.writeFileSync(path.join(RAWDIR, `${sha1(c.representative)}_p${p}.txt`), raw); } catch {}
      let qs = [];
      try { qs = questionsFromOcr(raw, p, { paper: c.paper }); } catch { qs = []; }
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

if (cmd === 'reclean') {
  // Re-run questionsFromOcr()/questionConfidence() over cached raw OCR text
  // (.ocr/raw/ from tesseract, or .ocr/graw/ from gemini with --gemini) without
  // any download or rasterisation — so the extraction filter can be tuned in
  // seconds instead of a full OCR cycle. Rewrites .ocr/ocr/*.json.
  const dir = args.includes('--gemini') ? path.join(CACHE, 'graw') : RAWDIR;
  const engine = args.includes('--gemini') ? 'gemini' : 'tesseract';
  const clusters = JSON.parse(fs.readFileSync(path.join(CACHE, 'clusters.json'), 'utf8'));
  const bySha = new Map(clusters.map(c => [sha1(c.representative), c]));
  const byUnit = new Map();
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^([0-9a-f]{40})_p(\d+)\.txt$/);
    if (!m) continue;
    if (!byUnit.has(m[1])) byUnit.set(m[1], []);
    byUnit.get(m[1]).push({ page: +m[2], file: f });
  }
  const verbose = args.includes('--verbose');
  let units = 0, totalQ = 0, totalRej = 0;
  for (const [sha, pages] of byUnit) {
    const c = bySha.get(sha);
    if (!c) continue;
    if (getArg('source') && c.source !== getArg('source')) continue;
    pages.sort((a, b) => a.page - b.page);
    const found = [], residue = [];
    const essay = /essay/i.test(c.paper || '');
    for (const { page, file } of pages) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      let qs = questionsFromOcr(raw, page, { paper: c.paper, engine });
      if (engine !== 'gemini') qs = qs.filter(q => questionConfidence(q) >= 3 || essay);
      if (qs.length) { found.push(...qs.map(q => ({ ...q, page, via: engine }))); totalQ += qs.length; }
      else residue.push(page);
    }
    fs.writeFileSync(path.join(OCRDIR, sha + '.json'), JSON.stringify({
      url: c.representative, key: c.key, source: c.source, numPages: c.numPages || null,
      questions: found, residuePages: residue, engine
    }));
    units++;
    if (verbose) {
      console.log(`\n${c.source} · ${c.representative.slice(-48)} · ${found.length}q / ${residue.length} residue`);
      for (const q of found) console.log(`   p${q.page} [${q.marks || '-'}/${q.words || '-'}] ${JSON.stringify(q.question)}`);
    }
  }
  console.log(`\nreclean: ${units} units · ${totalQ} questions kept`);
  process.exit(0);
}

if (cmd === 'gemini') {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) { console.error('set GEMINI_API_KEY'); process.exit(1); }
  const MODEL = getArg('model') || 'gemini-3.5-flash-lite';          // 2.5-* is 404 for keys created after ~2025
  const maxReq = getArg('requests') ? +getArg('requests') : 900;     // stay under the free daily cap
  const perReq = 6;                                                  // page images per request
  const only = getArg('source');
  const unitLimit = getArg('limit') ? +getArg('limit') : Infinity;
  const chunk = getArg('chunk') ? +getArg('chunk') : 0;
  const of = getArg('of') ? +getArg('of') : 1;
  const clPath = path.join(CACHE, 'clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));

  /* Gemini is the PRIMARY OCR engine for this corpus — Tesseract can't cope with
   * the bilingual two-column header + rotated margin watermark + handwriting.
   * A unit's page list is: the residue from a prior `ocr` (tesseract) pass if
   * one ran, otherwise every page. Progress is recorded page-by-page so a killed
   * run resumes where it stopped and never re-charges a page against the quota. */
  let units = unitsNeedingOcr(clusters);
  if (only) units = units.filter(c => c.source === only);
  units = units.filter((_, i) => i % of === chunk);
  const jobs = [];
  for (const c of units) {
    const sha = sha1(c.representative);
    const outPath = path.join(OCRDIR, sha + '.json');
    let rec = { url: c.representative, key: c.key, source: c.source, paper: c.paper || null, numPages: c.numPages || null, questions: [], residuePages: [], geminiPages: [], engine: "gemini" };
    let pages = null;                                              // null → decide from numPages after download
    if (fs.existsSync(outPath)) {
      rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (rec.geminiDone || rec.error) continue;
      if (rec.engine === 'tesseract' && rec.residuePages && rec.residuePages.length) pages = rec.residuePages.slice();
      else if (rec.engine === 'tesseract') { pages = null; }       // tesseract found everything? still let gemini sweep
    }
    rec.geminiPages = rec.geminiPages || [];
    jobs.push({ sha, c, rec, outPath, pages });
    if (jobs.length >= unitLimit) break;
  }
  console.log(`gemini(${MODEL}) · ${jobs.length} units · budget ${maxReq} requests · shard ${chunk + 1}/${of}`);

  const PROMPT = [
    'Each image is the top strip of a page from a UPSC Mains answer booklet.',
    'The printed/typed text at the top is the exam QUESTION. Everything handwritten is the candidate\'s answer — ignore it completely.',
    'The question is usually printed in BOTH Hindi (Devanagari) and English. Return ONLY the English text. Do NOT include any Hindi/Devanagari characters. Keep any "(Answer in 150/250 words)" part.',
    'If the image shows several numbered questions (a question-paper page), join them with " || " into one string.',
    'If the image has no printed question (pure handwriting, a cover page, an instructions or marks page, evaluation indicators, or only a header/logo), use exactly: NONE',
    'Output ONLY a raw JSON array of strings — one entry per image, in order. No markdown, no code fence, no commentary.'
  ].join(' ');

  const GRAW = path.join(CACHE, 'graw');
  fs.mkdirSync(GRAW, { recursive: true });
  let used = 0, unitsDone = 0;
  for (const job of jobs) {
    if (used >= maxReq) break;
    const { fetchUrl } = resolve(job.c.representative);
    if (!fetchUrl) { continue; }
    KEEP_PDFS = true;
    const meta = await getPdf(fetchUrl, { needFile: true });
    const pdfPath = path.join(PDFDIR, sha1(fetchUrl) + '.pdf');
    if (meta.error || !fs.existsSync(pdfPath)) {
      fs.writeFileSync(job.outPath, JSON.stringify({ ...job.rec, error: meta.error || 'no-pdf' }));
      continue;
    }
    const heightPts = meta.pageHeightPts || 842;
    job.rec.numPages = meta.numPages || job.rec.numPages;
    let pages = job.pages || Array.from({ length: Math.min(meta.numPages || 0, 120) }, (_, i) => i + 1);
    const doneSet = new Set(job.rec.geminiPages);
    pages = pages.filter(p => !doneSet.has(p));
    const qKey = t => t.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);
    const seenQ = new Set((job.rec.questions || []).map(q => qKey(q.question)));

    for (let i = 0; i < pages.length && used < maxReq; i += perReq) {
      const slice = pages.slice(i, i + perReq);
      const parts = [{ text: PROMPT }];
      const rendered = [];
      for (const p of slice) {
        const prefix = path.join(PAGEDIR, `g_${job.sha}_p${p}`);
        let img = null;
        try { img = renderPage(pdfPath, p, heightPts, prefix); } catch {}
        if (!img) continue;
        parts.push({ inline_data: { mime_type: 'image/png', data: fs.readFileSync(img).toString('base64') } });
        rendered.push({ p, img });
      }
      if (!rendered.length) continue;

      let texts = null, rateLimited = false;
      for (let attempt = 0; attempt < 4 && texts === null && !rateLimited; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 3000 * attempt));   // 0, 3s, 6s, 9s
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 8192 } })
          });
          if (res.status === 429) { rateLimited = true; break; }
          if (res.status >= 500) { console.log(`  HTTP ${res.status}, retrying`); continue; }
          if (!res.ok) { console.log(`  HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`); texts = []; break; }
          const j = await res.json();
          let out = (j?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```(?:json)?/gi, '').trim();
          const mm = out.match(/\[[\s\S]*\]/);
          let parsed = [];
          if (mm) { try { parsed = JSON.parse(mm[0]); } catch {} }
          if (!parsed.length && out) parsed = rendered.map((_, k) => k === 0 ? out : '');
          texts = parsed;
        } catch (e) { console.log(`  request failed (${attempt + 1}/4): ${e.message}`); }
      }
      if (rateLimited) { console.log('  rate limited — stopping for today'); used = maxReq; break; }
      used++;
      if (texts === null) { console.log('  giving up on this batch, will retry next run'); continue; }  // pages stay unmarked

      rendered.forEach((r, idx) => {
        try { fs.unlinkSync(r.img); } catch {}
        const t = String(texts[idx] || '').trim();
        try { fs.writeFileSync(path.join(GRAW, `${job.sha}_p${r.p}.txt`), t); } catch {}
        job.rec.geminiPages.push(r.p);
        if (!t || /^none$/i.test(t)) { return; }
        for (const q of questionsFromOcr(t, r.p, { paper: job.c.paper, engine: 'gemini' })) {
          const k = qKey(q.question);
          if (seenQ.has(k)) continue;                          // same topic already caught on an earlier page
          seenQ.add(k);
          job.rec.questions.push({ ...q, page: r.p, via: 'gemini' });
        }
      });
      job.rec.engine = 'gemini';
      fs.writeFileSync(job.outPath, JSON.stringify(job.rec));       // checkpoint after every request
      if (used < maxReq) await new Promise(r => setTimeout(r, 4200)); // ~14 req/min, under the 15 RPM free cap
    }
    try { fs.unlinkSync(pdfPath); } catch {}
    if (!pages.length || used < maxReq) { job.rec.geminiDone = true; unitsDone++; }
    fs.writeFileSync(job.outPath, JSON.stringify(job.rec));
    console.log(`  ${(job.c.key || job.c.representative.slice(-42))} · ${job.rec.questions.length} q · ${used}/${maxReq} req`);
  }
  console.log(`\ndone. ${used} requests used · ${unitsDone} units completed.`);
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

if (cmd === 'salvage') {
  // Recover Gemini transcriptions that the extraction filter rejected. Re-walks
  // every cached .ocr/graw/*.txt, re-runs questionsFromOcr() (which now falls
  // back to salvageGeminiQuestion() on a reject) and merges anything new into
  // the unit's .ocr/ocr/<sha>.json — geminiPages / geminiDone are left intact,
  // so it is idempotent and safe to run every night before `emit`.
  //   --dry      print what would be salvaged, write nothing
  //   --verbose  also print the still-rejected chunks
  const dry = args.includes('--dry'), verbose = args.includes('--verbose');
  const GRAW = path.join(CACHE, 'graw');
  if (!fs.existsSync(GRAW)) { console.log('no .ocr/graw cache — run `gemini` first'); process.exit(0); }
  const clusters = JSON.parse(fs.readFileSync(path.join(CACHE, 'clusters.json'), 'utf8'));
  const bySha = new Map(clusters.map(c => [sha1(c.representative), c]));
  const qKey = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64);

  const byUnit = new Map();
  for (const f of fs.readdirSync(GRAW)) {
    const m = f.match(/^([0-9a-f]{40})_p(\d+)\.txt$/);
    if (!m) continue;
    if (!byUnit.has(m[1])) byUnit.set(m[1], []);
    byUnit.get(m[1]).push({ page: +m[2], file: f });
  }

  let units = 0, salvagedTotal = 0, stillRejected = 0;
  for (const [sha, pages] of byUnit) {
    const c = bySha.get(sha);
    if (!c) continue;
    if (getArg('source') && c.source !== getArg('source')) continue;
    const outPath = path.join(OCRDIR, sha + '.json');
    if (!fs.existsSync(outPath)) continue;
    const rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const essay = /essay/i.test(c.paper || rec.paper || '');
    const seen = new Set((rec.questions || []).map(q => qKey(q.question)));
    const added = [];
    pages.sort((a, b) => a.page - b.page);
    for (const { page, file } of pages) {
      const raw = fs.readFileSync(path.join(GRAW, file), 'utf8').trim();
      if (!raw || /^none$/i.test(raw)) continue;
      for (const chunk of raw.split(/\s*\|\|\s*|\n(?=\s*\d{1,2}[.)]\s)/)) {
        if (cleanGeminiQuestion(chunk, essay)) continue;             // already extracted on the main pass
        const q = salvageGeminiQuestion(chunk, essay);
        if (q) {
          const k = qKey(q);
          if (k && !seen.has(k)) {
            seen.add(k);
            added.push({ page, question: q, salvaged: true, via: 'salvage',
              marks: (chunk.match(/\b(\d{1,3})\s*marks?\b/i) || [])[1] || '',
              words: (chunk.match(/\b(\d{2,3})\s*words?\b/i) || [])[1] || '' });
          }
        } else if (chunk.trim().length > 25) {
          stillRejected++;
          if (verbose) console.log(`  ✗ ${c.source} p${page}: ${JSON.stringify(chunk.trim().slice(0, 140))}`);
        }
      }
    }
    if (added.length) {
      salvagedTotal += added.length;
      units++;
      if (dry || verbose) {
        console.log(`\n${c.source} · ${(c.key || c.representative.slice(-46))} · +${added.length} salvaged`);
        for (const q of added) console.log(`   p${q.page} ${JSON.stringify(q.question)}`);
      }
      if (!dry) {
        rec.questions = (rec.questions || []).concat(added);
        fs.writeFileSync(outPath, JSON.stringify(rec));
      }
    }
  }
  console.log(`\nsalvage${dry ? ' (dry)' : ''}: +${salvagedTotal} questions across ${units} units · ${stillRejected} chunks still rejected`);
  process.exit(0);
}

if (cmd === 'emit') {
  // GS/Essay questions → data/ocr-questions.csv. Optional-subject questions are folded
  // into their entry's `questions[]` in data/optionals.json instead, so an optional copy
  // shows once (in the Optionals section + Practice) and never as a parallel bare copy.
  // Page anchors come ONLY from the document actually read — never copied to another topper.
  const clPath = path.join(CACHE, 'clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8'));
  const flagged = new Set();
  const vPath = path.join(CACHE, 'validation.json');
  if (fs.existsSync(vPath)) for (const f of JSON.parse(fs.readFileSync(vPath, 'utf8')).flags || []) flagged.add(f.key);

  const memberOf = new Map();
  for (const c of clusters) for (const m of c.members) memberOf.set(m.url, { c, m });

  const opDoc = JSON.parse(fs.readFileSync(path.join(DATA, 'optionals.json'), 'utf8'));
  const opByBase = new Map(opDoc.entries.map(e => [norm(e.url), e]));
  const optQ = new Map();                          // base url -> [{page,question,marks,words}]
  const rows = [];
  let units = 0, skippedFlagged = 0, optUnits = 0, optOrphans = 0, skippedMaths = 0, salvagedRows = 0;

  // Mathematics / Statistics answer copies are pure notation — no useful searchable
  // question text comes out of them by any OCR route. Don't extract questions for them.
  const NO_QUESTION_SUBJECTS = new Set(['Mathematics', 'Statistics']);

  const take = (m, questions) => {
    if (m.kind === 'opt' && NO_QUESTION_SUBJECTS.has(m.subject)) { skippedMaths++; return; }
    if (m.kind === 'opt') {
      const base = norm(m.url);
      if (!opByBase.has(base)) { optOrphans++; }   // not in optionals.json — fall through to CSV
      else {
        const arr = optQ.get(base) || [];
        for (const q of questions) arr.push({ page: q.page || null, question: q.question, marks: q.marks || '', words: q.words || '', salvaged: !!q.salvaged });
        optQ.set(base, arr);
        optUnits++;
        return;
      }
    }
    const meta = { topper: m.topper, coaching: m.source, subject: m.kind === 'opt' ? (m.subject || 'Other') : m.paper, url: m.url };
    for (const q of questions) if (q.salvaged) salvagedRows++;
    for (const row of toCsvRows(questions, meta)) rows.push(row);
  };

  for (const f of fs.readdirSync(OCRDIR)) {
    const r = JSON.parse(fs.readFileSync(path.join(OCRDIR, f), 'utf8'));
    if (!r.questions || !r.questions.length) continue;
    const hit = memberOf.get(r.url);
    if (!hit) continue;
    if (flagged.has(hit.c.key)) { skippedFlagged++; continue; }
    take(hit.m, r.questions);
    units++;
  }
  for (const c of clusters) {
    if (!c.freepassHit) continue;
    const mp = path.join(METADIR, sha1(resolve(c.representative).fetchUrl || c.representative) + '.json');
    if (!fs.existsSync(mp)) continue;
    const qs = filterFreepassQuestions(JSON.parse(fs.readFileSync(mp, 'utf8')).freepass?.questions, c.paper);
    if (!qs || !qs.length) continue;
    take(c.members.find(x => x.url === c.representative) || c.members[0], qs);
  }

  // merge optional questions into optionals.json — UNION with what's already
  // committed (dedupe by text, sort by page), so a cold or partial .ocr cache
  // can only add optional questions, never drop a previously-published set.
  // `emit --force` replaces instead.
  const qk = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 64);
  let optMerged = 0;
  for (const [base, list] of optQ) {
    const entry = opByBase.get(base);
    if (!entry) continue;
    const prior = (!args.includes('--force') && Array.isArray(entry.questions)) ? entry.questions : [];
    const seen = new Set();
    entry.questions = prior.concat(list)
      .sort((a, b) => (a.page || 0) - (b.page || 0))
      .filter(q => { const k = qk(q.question); if (!k || seen.has(k)) return false; seen.add(k); return true; });
    optMerged++;
  }
  // strip any stale questions[] off subjects we no longer extract for
  let optCleared = 0;
  for (const e of opDoc.entries) {
    if (NO_QUESTION_SUBJECTS.has(e.subject) && Array.isArray(e.questions) && e.questions.length) { delete e.questions; optCleared++; }
  }
  const HEADER = 'topper,coaching,subject,page_number,question,metadata,url\n';
  const csvPath = path.join(DATA, 'ocr-questions.csv');
  const rowBase = line => { const u = line.slice(line.lastIndexOf(',') + 1); return u.split('#')[0]; };

  // Merge, never replace. The GH Actions .ocr cache can come back cold
  // (eviction / key miss) and re-OCR only a slice of the corpus that night —
  // a straight overwrite would drop every copy not in this run's cache. So:
  // this run's rows win for the copies it actually read; every other copy
  // keeps the rows already committed. `emit --force` writes only the fresh set
  // (use it after a genuine corpus prune).
  let finalRows = rows;
  if (!args.includes('--force') && fs.existsSync(csvPath)) {
    const freshBases = new Set(rows.map(rowBase));
    const prev = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1).filter(Boolean);
    const kept = prev.filter(l => !freshBases.has(rowBase(l)));
    const keptUnits = new Set(kept.map(rowBase)).size;
    finalRows = rows.concat(kept);
    if (kept.length) console.log(`merge: kept ${kept.length} committed rows from ${keptUnits} copies not re-read this run`);
  }

  fs.writeFileSync(path.join(DATA, 'optionals.json'), JSON.stringify(opDoc, null, 2) + '\n');
  fs.writeFileSync(csvPath, HEADER + finalRows.join('\n') + (finalRows.length ? '\n' : ''));
  console.log(`wrote data/ocr-questions.csv · ${finalRows.length} rows (${rows.length} fresh from ${units} units, ${skippedFlagged} held back` + (salvagedRows ? `, ${salvagedRows} salvaged` : '') + `)`);
  console.log(`optionals.json · folded questions into ${optMerged} entries from ${optUnits} OCR'd units` + (optOrphans ? ` (${optOrphans} not in optionals.json → CSV)` : '') + (skippedMaths ? ` · ${skippedMaths} Maths/Statistics units skipped` : '') + (optCleared ? ` · cleared ${optCleared} stale Maths entries` : ''));
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

  plan                          cluster the corpus by test paper           (free, offline)
  freepass [--all]              download reps, harvest existing text layers (free)
  gemini [--requests N]         PRIMARY vision OCR — every page, needs GEMINI_API_KEY (free tier)
         [--source X --limit N --chunk N --of M --model M]
  ocr [--chunk N --of M]        optional tesseract pass on the printed strip (free, low yield here)
  reclean [--gemini] [--verbose] re-run the extraction filter over cached OCR text, no network
  validate                      cross-check clusters, flag disagreements
  emit                          write data/ocr-questions.csv
  audit-paper                   check GS1-4/Essay classification
  status                        progress + remaining work`);
process.exit(1);
