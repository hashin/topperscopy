/*
 * apply-submission.mjs — turn an approved submission issue into a data change.
 *
 *   node .github/scripts/apply-submission.mjs <issue-body-file>
 *
 * Reads the issue body (produced by the Submit form or the issue templates),
 * and applies it:
 *   - "Optional — <Subject>"  -> appends an entry to data/optionals.json
 *   - GS1..GS4 / Essay        -> appends question rows to data/submissions.csv
 *   - marks / AIR / year      -> patched into data/toppers.overrides.json
 *
 * Prints a human summary to stdout. Exits non-zero (message on stderr) if it
 * can't safely apply — the workflow then comments the error and drops the label.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data');

const bodyFile = process.argv[2];
if (!bodyFile || !fs.existsSync(bodyFile)) { console.error('usage: apply-submission.mjs <issue-body-file>'); process.exit(2); }
const body = fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n');

/* ---------- parse the issue body ---------- */
const fields = {};
// markdown table rows:  | Field | value |
for (const m of body.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)) {
  const k = m[1].trim().toLowerCase();
  const v = m[2].trim();
  if (k === 'field' || /^-+$/.test(k)) continue;
  fields[k] = v;
}
// issue-form style:  ### Field\n\nvalue
for (const m of body.matchAll(/^###\s+(.+?)\s*\n+([^\n#][^\n]*)/gm)) {
  const k = m[1].trim().toLowerCase();
  if (!(k in fields)) fields[k] = m[1] && m[2].trim();
}

const pick = (...keys) => { for (const k of keys) { const v = fields[k]; if (v && v !== '—' && v !== '_No response_') return v; } return ''; };
const num = v => { const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : undefined; };

const topper = pick('topper', 'topper name', 'topper name (exactly as shown on the site)');
const air = num(pick('air', 'air (rank)', 'air / rank'));
const year = num(pick('year', 'exam year'));
const paperRaw = pick('paper / subject', 'paper', 'subject');
const url = pick('copy link', 'link to the answer copy', 'url').replace(/[)\s]+$/, '');
const source = pick('source / coaching', 'source', 'coaching');
const marksRaw = pick('marks in this paper', 'marks');
const by = pick('submitted by', 'your name / handle (for credit)', 'your name or handle').replace(/^anonymous$/i, '');

if (!topper) { console.error('No topper name in the issue body.'); process.exit(1); }
if (!paperRaw) { console.error('No "Paper / subject" in the issue body.'); process.exit(1); }

// fenced blocks
const csvBlock = (body.match(/```csv\n([\s\S]*?)```/i) || body.match(/```\n(topper,coaching,subject[\s\S]*?)```/i) || [])[1] || '';
const jsonBlock = (body.match(/```json\n([\s\S]*?)```/i) || [])[1] || '';

/* ---------- helpers ---------- */
const csvEsc = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

function parseCsvRows(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

function patchOverrides(name, patch) {
  const p = path.join(DATA, 'toppers.overrides.json');
  const ov = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  const cur = ov[name] || {};
  ov[name] = { ...cur, ...patch, verified: true, marks: { ...(cur.marks || {}), ...(patch.marks || {}) } };
  if (!Object.keys(ov[name].marks).length) delete ov[name].marks;
  fs.writeFileSync(p, JSON.stringify(ov, null, 2) + '\n');
}

/* ---------- optional-subject copy ---------- */
if (/^optional/i.test(paperRaw)) {
  const subject = paperRaw.replace(/^optional\s*[—:-]\s*/i, '').trim() || 'Other';
  if (!url) { console.error('Optional-subject copies need a "Copy link".'); process.exit(1); }

  let questions;
  if (jsonBlock) {
    try { const j = JSON.parse(jsonBlock); questions = Array.isArray(j) ? j : j.questions; } catch (e) { /* ignore */ }
  }
  if (!questions && csvBlock) {
    const rows = parseCsvRows(csvBlock);
    const head = rows[0].map(s => s.trim().toLowerCase());
    const ci = n => head.indexOf(n);
    questions = rows.slice(1).map(r => {
      const md = r[ci('metadata')] || '';
      return {
        page: parseInt(r[ci('page_number')], 10) || null,
        question: (r[ci('question')] || '').trim(),
        marks: (md.match(/Marks:\s*([^,]*)/i) || [])[1]?.trim() || undefined,
        words: (md.match(/Word limit:\s*([^,]*)/i) || [])[1]?.trim() || undefined
      };
    }).filter(q => q.question);
  }

  const p = path.join(DATA, 'optionals.json');
  const db = JSON.parse(fs.readFileSync(p, 'utf8'));
  const base = url.split('#')[0];
  if ((db.entries || []).some(e => (e.url || '').split('#')[0] === base)) {
    console.log(`Already present: an entry for ${base} exists. Nothing to do.`);
    process.exit(0);
  }
  const entry = { topper, subject, url: base };
  if (air) entry.air = air;
  if (year) entry.year = year;
  if (num(marksRaw)) entry.marks = num(marksRaw);
  if (source) entry.source = source;
  if (by) entry.by = by;
  entry.verified = true;
  if (questions && questions.length) entry.questions = questions;
  db.entries.push(entry);
  db.entries.sort((a, b) => (a.air || 1e9) - (b.air || 1e9) || String(a.topper).localeCompare(String(b.topper)));
  fs.writeFileSync(p, JSON.stringify(db, null, 2) + '\n');

  if (air || year) patchOverrides(topper, { ...(air ? { air } : {}), ...(year ? { year } : {}), ...(num(marksRaw) ? { marks: { Optional: num(marksRaw) } } : {}) });

  console.log(`Added optional-subject copy: ${topper} — ${subject}${air ? ` (AIR ${air})` : ''}${questions?.length ? ` · ${questions.length} questions` : ' · no question text'}\n${base}`);
  process.exit(0);
}

/* ---------- GS / Essay copy ---------- */
const paper = paperRaw.toUpperCase().replace(/\s+/g, '');
const validPaper = ['GS1', 'GS2', 'GS3', 'GS4', 'ESSAY'].includes(paper);
if (!validPaper) { console.error(`Unrecognised paper "${paperRaw}".`); process.exit(1); }
const paperName = paper === 'ESSAY' ? 'Essay' : paper;

if (!csvBlock) {
  console.error(
    `This is a ${paperName} copy but the issue has no extracted-questions CSV block.\n` +
    `A maintainer needs to run:\n` +
    `  node extract.js "${url || '<pdf-url>'}" --topper "${topper}" --paper ${paperName}` +
    (source ? ` --coaching "${source}"` : '') + ` --append\n` +
    `then re-add the "approved" label.`
  );
  process.exit(1);
}

const rows = parseCsvRows(csvBlock);
const dataRows = rows[0] && /^topper$/i.test(rows[0][0].trim()) ? rows.slice(1) : rows;
if (!dataRows.length) { console.error('The CSV block has no data rows.'); process.exit(1); }

const subPath = path.join(DATA, 'submissions.csv');
const HEADER = 'topper,coaching,subject,page_number,question,metadata,url\n';
let sub = fs.existsSync(subPath) ? fs.readFileSync(subPath, 'utf8') : HEADER;
if (!sub.trim()) sub = HEADER;
if (!sub.endsWith('\n')) sub += '\n';
sub += dataRows.map(r => r.map(csvEsc).join(',')).join('\n') + '\n';
fs.writeFileSync(subPath, sub);

const patch = {};
if (air) patch.air = air;
if (year) patch.year = year;
if (num(marksRaw)) patch.marks = { [paperName]: num(marksRaw) };
if (Object.keys(patch).length) patchOverrides(topper, patch);

console.log(`Added ${paperName} copy: ${topper}${air ? ` (AIR ${air})` : ''} · ${dataRows.length} question rows appended to data/submissions.csv`);
