// VisionIAS re-hosted every answer booklet under a new, content-hashed URL (2026-11). This pairs each old
// cdn.visionias.in/toppersanswerbooklet/… link we hold with its new visionias.in/_public/assets/<sha256>.pdf
// and writes data/visionias-urls.json — the map build.js applies at load time (DECISION-31).
//
//   node tools/visionias-urls.mjs            # fetch the listing, pair, write the map + print a report
//   node tools/visionias-urls.mjs --file tac.json   # use a saved copy of the listing
//
// The listing is what VisionIAS's own "Toppers Answer Copy" page loads: https://visionias.in/_public/resources/tac.json
// (public, no login; rows with download_available=false have no file at all). It carries no old URL, so pairing is by
// who + rank + subject: the old filename's test id (…-<student>_<TEST>_…) and the new resource_id both ascend in the
// order a topper's booklets were added, so within one (name, rank, subject) group the i-th old pairs with the i-th new.
// A group is paired only when old and new counts are equal and (where the old year is known) the years agree;
// every other group is reported, never guessed. Re-running keeps earlier pairs and adds new ones.
import fs from 'node:fs';

const MAP = 'data/visionias-urls.json';
const OLD_HOST = 'cdn.visionias.in';
const nk = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const GS = { GS1: 'General Studies', GS2: 'General Studies - II', GS3: 'General Studies - III', GS4: 'Ethics', Essay: 'Essay' };
// "PSIR I"/"PSIR II", "History II", "Mathematics II" are separate listing subjects but one optional in our data.
const baseSubject = s => /^General Studies/.test(s) ? String(s) : String(s || '').replace(/\s+(?:I|II)$/, '');

// Tiny CSV reader (quoted fields, embedded commas/newlines) — only the topper, subject and url columns are needed.
function csvRows(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const fileArg = process.argv.indexOf('--file');
const tac = fileArg > 0
  ? JSON.parse(fs.readFileSync(process.argv[fileArg + 1], 'utf8'))
  : await (await fetch('https://visionias.in/_public/resources/tac.json')).json();
const listing = tac.result || [];
if (!listing.length) throw new Error('empty listing — VisionIAS changed the file; read tac.json before trusting anything here');

// ---- the old side: every cdn.visionias.in copy we hold (identity = URL without #page)
const old = new Map();                                    // url -> {topper, subject, air, year}
const add = (url, o) => {
  const u = (url || '').split('#')[0];
  if (!u.includes(OLD_HOST)) return;
  const prev = old.get(u) || {};
  old.set(u, { topper: o.topper || prev.topper, subject: o.subject || prev.subject, air: o.air || prev.air, year: o.year || prev.year });
};
for (const e of JSON.parse(fs.readFileSync('data/link-copies.json', 'utf8')).entries || [])
  add(e.url, { topper: e.topper, subject: GS[e.paper] || e.paper, air: e.air, year: e.year });
for (const e of JSON.parse(fs.readFileSync('data/optionals.json', 'utf8')).entries || [])
  add(e.url, { topper: e.topper, subject: e.subject, air: e.air, year: e.year });
for (const f of ['data/questions.csv', 'data/ocr-questions.csv', 'data/submissions.csv']) {
  if (!fs.existsSync(f)) continue;
  for (const r of csvRows(fs.readFileSync(f, 'utf8'))) {
    const u = (r[6] || '').split('#')[0];
    if (u.includes(OLD_HOST)) add(u, { topper: r[0], subject: GS[r[2]] || r[2] });
  }
}
// What the filename itself says: …/<hex>-<student>_<TEST>_<name…>[_rank]_<N>[junk].pdf (a few have junk like "87ermark")
const fromName = url => {
  const fn = decodeURIComponent(url.split('/').pop());
  const m = fn.match(/^(?:[0-9a-f]+-)?\d+[_-](\d+)[_-]?(.*?)\.pdf$/i);
  if (!m) {                                                          // odd names ("rank_12_11747_771_ashima_mittal"): the last number is the test
    const runs = fn.replace(/\.pdf$/i, '').match(/\d+/g) || [];
    return runs.length >= 2 ? { test: +runs[runs.length - 1], name: '', rank: null } : null;
  }
  const name = m[2].replace(/[_-]+(?:rank.*|\d.*)$/i, '');          // may be '' — the entry's own topper is used then
  const rank = (m[2].match(/(\d{1,3})(?!\d)/) || [])[1];
  return { test: +m[1], name, rank: rank ? +rank : null };
};

// ---- group both sides by who + rank + subject
const groups = new Map();
const g = k => groups.get(k) || (groups.set(k, { old: [], neu: [] }), groups.get(k));
const unparsed = [];
for (const [url, o] of old) {
  const f = fromName(url);
  if (!f) { unparsed.push(url); continue; }
  const subj = baseSubject(o.subject);
  if (!subj || !o.subject) { unparsed.push(url); continue; }
  if (!(o.air || f.rank) || !(o.topper || f.name)) { unparsed.push(url); continue; }
  g([nk(o.topper || f.name), o.air || f.rank, subj].join('|')).old.push({ url, test: f.test, year: o.year });
}
for (const r of listing) g([nk(r.name), +r.rank, baseSubject(r.subject_name)].join('|')).neu.push(r);

// ---- pair
const prior = fs.existsSync(MAP) ? JSON.parse(fs.readFileSync(MAP, 'utf8')) : {};
const moves = {};
for (const [k, v] of Object.entries(prior)) if (!k.startsWith('_')) moves[k] = v;
const orphans = [];                                      // available new files in a group where we hold no old copy at all
const stat = { paired: 0, unique: 0, byOrder: 0, noFile: 0, countMismatch: 0, yearMismatch: 0, noNewRows: 0 };
const skipped = [];
for (const [k, { old: os, neu }] of groups) {
  if (!os.length) { for (const n of neu) if (n.download_available) orphans.push(n); continue; }
  if (!neu.length) { stat.noNewRows += os.length; skipped.push(['not in listing', k, os.length, 0]); continue; }
  if (os.length !== neu.length) { stat.countMismatch += os.length; skipped.push(['count differs', k, os.length, neu.length]); continue; }
  os.sort((a, b) => a.test - b.test || a.url.localeCompare(b.url));
  neu.sort((a, b) => +a.resource_id - +b.resource_id);
  os.forEach((o, i) => {
    const n = neu[i];
    if (o.year && +n.year !== +o.year) { stat.yearMismatch++; skipped.push(['year differs', k, o.year, n.year]); return; }
    if (!n.download_available || !/^https:\/\/visionias\.in\/_public\/assets\/[0-9a-f]{64}\.pdf$/.test(n.public_url)) { stat.noFile++; return; }
    moves[o.url] = n.public_url;
    stat.paired++; os.length === 1 ? stat.unique++ : stat.byOrder++;
  });
}

// Available new files with no old counterpart: copies we do not hold yet (or hold under a spelling the pairing missed).
const used = new Set(Object.values(moves));
const fresh = listing.filter(r => r.download_available && r.public_url && !used.has(r.public_url));
stat.freshFiles = fresh.length;

stat.newCopies = orphans.length;

// --add-fresh: file the orphans as new link-only copies so they join the OCR list (ocr-pipeline.mjs plans from
// link-copies.json / optionals.json). Only orphans — a group whose counts differ is left for a human, because adding
// its extra files could duplicate a copy we already hold under a dead URL. Idempotent: skips URLs already present.
if (process.argv.includes('--add-fresh')) {
  const lcDoc = JSON.parse(fs.readFileSync('data/link-copies.json', 'utf8')), opDoc = JSON.parse(fs.readFileSync('data/optionals.json', 'utf8'));
  const have = new Set([...lcDoc.entries, ...opDoc.entries].map(e => (e.url || '').split('#')[0]));
  const paperOf = Object.fromEntries(Object.entries(GS).map(([k, v]) => [v, k]));
  let nLc = 0, nOp = 0;
  for (const n of orphans) {
    if (have.has(n.public_url)) continue;
    const base = { topper: n.name.trim(), url: n.public_url, air: +n.rank, year: +n.year, source: 'VisionIAS' };
    const paper = paperOf[n.subject_name];
    if (paper) { lcDoc.entries.push({ ...base, paper, by: 'visionias.in', note: 'VisionIAS answer booklet — ' + paper, verified: true }); nLc++; }
    else { opDoc.entries.push({ ...base, subject: baseSubject(n.subject_name), note: 'VisionIAS answer booklet — ' + baseSubject(n.subject_name) + ' optional', by: 'visionias.in', verified: true }); nOp++; }
  }
  const dump = (f, doc) => fs.writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
  if (nLc) dump('data/link-copies.json', lcDoc);
  if (nOp) dump('data/optionals.json', opDoc);
  console.log(`added ${nLc} GS/Essay link copies and ${nOp} optional copies`);
}

const out = { _note: 'Old cdn.visionias.in answer-booklet URL -> new visionias.in/_public/assets URL. Written by tools/visionias-urls.mjs; applied by build.js (DECISION-31). Do not edit by hand.' };
for (const k of Object.keys(moves).sort()) out[k] = moves[k];
fs.writeFileSync(MAP, JSON.stringify(out, null, 1) + '\n');
console.log(`old copies ${old.size} (${unparsed.length} unparsed) · listing ${listing.length} rows, ${listing.filter(r => r.download_available).length} with a file`);
console.log(stat);
console.log(`map: ${Object.keys(moves).length} pairs -> ${MAP}`);
if (process.argv.includes('--fresh')) fs.writeFileSync(process.argv[process.argv.indexOf('--fresh') + 1], JSON.stringify(fresh, null, 1));
if (process.argv.includes('--verbose')) for (const s of skipped.slice(0, 40)) console.log(' skip', ...s);
if (unparsed.length) console.log('unparsed sample:', unparsed.slice(0, 3));
