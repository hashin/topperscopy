#!/usr/bin/env node
/*
 * missing-air.mjs — issue #2: list the toppers whose AIR (or exam year) we do not know, and feed corrections back.
 *
 *   node build.js
 *   node tools/missing-air.mjs dump [file.csv]    # default: stdout. One row per topper missing an AIR (year too with --year)
 *   node tools/missing-air.mjs apply file.csv      # read the filled-in CSV, write air/year into data/toppers.overrides.json
 *
 * Workflow: dump -> fill the empty `air` / `year` cells from a source you trust (UPSC result PDF, the coaching page the
 * copy came from) and put where you saw it in `evidence` -> apply -> `node build.js && npm run check`.
 * `apply` never touches a cell you left empty, never overwrites an override that is already `verified`, and refuses an AIR
 * outside 1..1100 or a year outside 2013..2030. Every applied entry gets `verified: true` and the evidence as a `sources` entry —
 * so only apply numbers you checked. (AIRs that build.js already reads from a file name — `AIR-12` or a unanimous `rank_12` — never appear here.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERRIDES = path.join(ROOT, 'data/toppers.overrides.json');
const [cmd, arg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const withYear = process.argv.includes('--year');

const csvEsc = v => { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

if (cmd === 'dump') {
  const file = path.join(ROOT, 'data/copies.json');
  if (!fs.existsSync(file)) { console.error('data/copies.json is missing — run `node build.js` first.'); process.exit(1); }
  const toppers = JSON.parse(fs.readFileSync(file, 'utf8')).toppers;
  const lines = [['topper', 'air', 'year', 'known_year', 'copies', 'sources', 'sample_url', 'evidence'].join(',')];
  let n = 0;
  for (const [name, t] of Object.entries(toppers).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (t.air && !(withYear && !t.year)) continue;
    const sources = [...new Set(t.copies.map(c => c[1]).filter(Boolean))].join('; ');
    lines.push([name, t.air || '', '', t.year || '', t.copies.length, sources, t.copies[0][2], ''].map(csvEsc).join(','));
    n++;
  }
  const out = lines.join('\n') + '\n';
  if (arg) { fs.writeFileSync(arg, out); console.error(`${n} toppers written to ${arg}`); } else process.stdout.write(out);
} else if (cmd === 'apply' && arg) {
  const rows = parseCsv(fs.readFileSync(arg, 'utf8'));
  const head = rows[0].map(h => h.trim().toLowerCase()), ix = k => head.indexOf(k);
  if (ix('topper') < 0 || ix('air') < 0) { console.error('The CSV needs the `topper` and `air` columns (use the dump as the template).'); process.exit(1); }
  const ov = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
  let applied = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const name = (r[ix('topper')] || '').trim();
    const air = parseInt(r[ix('air')], 10), year = ix('year') >= 0 ? parseInt(r[ix('year')], 10) : NaN;
    const evidence = ix('evidence') >= 0 ? (r[ix('evidence')] || '').trim() : '';
    if (!name || (!Number.isFinite(air) && !Number.isFinite(year))) continue;
    const bad = (Number.isFinite(air) && (air < 1 || air > 1100)) || (Number.isFinite(year) && (year < 2013 || year > 2030));
    if (bad) { console.error(`skip ${name}: AIR ${r[ix('air')]} / year ${r[ix('year')]} out of range`); skipped++; continue; }
    if (ov[name] && ov[name].verified) { console.error(`skip ${name}: already has a verified override`); skipped++; continue; }
    const cur = ov[name] || {};
    ov[name] = { ...cur, ...(Number.isFinite(air) ? { air } : {}), ...(Number.isFinite(year) ? { year } : {}), verified: true };
    if (evidence) ov[name].sources = [...new Set([...(cur.sources || []), evidence])];
    applied++;
  }
  fs.writeFileSync(OVERRIDES, JSON.stringify(ov, null, 2) + '\n');
  console.log(`${applied} applied, ${skipped} skipped. Now: node build.js && npm run check`);
} else {
  console.error('usage: node tools/missing-air.mjs dump [file.csv] [--year] | apply file.csv');
  process.exit(2);
}
