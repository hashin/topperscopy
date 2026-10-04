/* Topper's Copy by Hashin — what a visitor downloads, by stage. `node build.js && node tools/perf/sizes.mjs`
 *
 * Plain Node, no browser, ~1 s. Prints raw / gzip / brotli for the boot path, the idle prefetch and the lazy files,
 * so a corpus-growth regression is visible as a number before it is felt as a wait. GitHub Pages serves gzip only
 * (brotli is what a CDN in front would add — PERF-AUDIT-2026-10-03 F3). The same sums are enforced as budgets by
 * `npm run check` (BUDGET boot / prefetch total / interview list); this is the readable version.
 * Append `--json` for one machine-readable line (e.g. to log the growth curve per commit).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const kb = n => (n / 1024).toFixed(1).padStart(8);
const size = f => {
  const b = fs.readFileSync(path.join(ROOT, f));
  return { f, raw: b.length, gz: zlib.gzipSync(b, { level: 6 }).length, br: zlib.brotliCompressSync(b).length };
};
const data = fs.readdirSync(path.join(ROOT, 'data'));
const stages = {
  'boot (blocks the first 25 cards)': ['index.html', 'assets/style.css', 'assets/app.js', 'assets/fonts/inter-latin.woff2', 'data/copies.json'],
  'idle prefetch (fast connections only)': data.filter(f => /^questions-.*\.json$/.test(f)).sort().map(f => 'data/' + f).concat('data/syllabus.json'),
  'later, on demand': ['assets/fonts/fraunces-latin.woff2', 'data/interview-list.json']
};
const out = {};
for (const [stage, files] of Object.entries(stages)) {
  const rows = files.map(size);
  const t = rows.reduce((a, r) => ({ raw: a.raw + r.raw, gz: a.gz + r.gz, br: a.br + r.br }), { raw: 0, gz: 0, br: 0 });
  out[stage] = t;
  if (process.argv.includes('--json')) continue;
  console.log(`\n${stage}\n${'file'.padEnd(40)}${'raw KB'.padStart(9)}${'gzip KB'.padStart(9)}${'brotli KB'.padStart(11)}`);
  for (const r of rows) console.log(`${r.f.padEnd(40)}${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
  console.log(`${'TOTAL'.padEnd(40)}${kb(t.raw)} ${kb(t.gz)} ${kb(t.br)}`);
}
// One transcript costs one small file, not a year shard (DECISION-25).
const iv = fs.existsSync(path.join(ROOT, 'data/iv')) ? fs.readdirSync(path.join(ROOT, 'data/iv')) : [];
const ivAvg = iv.length ? iv.reduce((t, f) => t + size('data/iv/' + f).gz, 0) / iv.length : 0;
if (process.argv.includes('--json')) console.log(JSON.stringify({ ...out, interviewTranscriptAvgGz: Math.round(ivAvg) }));
else console.log(`\nopening one interview transcript: ${iv.length} files, avg ${(ivAvg / 1024).toFixed(2)} KB gzip each`);
