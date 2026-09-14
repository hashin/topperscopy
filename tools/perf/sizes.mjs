/* Bytes on the wire for every served asset, gzip (what GitHub Pages sends) and brotli. */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, gzip, brotli, KB } from './_lib.mjs';

const FILES = [
  'index.html', 'assets/style.css', 'assets/app.js', 'assets/extract.js', 'assets/analyse.js',
  'sw.js', 'assets/fonts/inter-latin.woff2', 'assets/fonts/fraunces-latin.woff2',
  'data/index.json', 'data/toppers.json', 'data/optionals.json', 'data/syllabus.json',
  'data/copies.json', 'data/questions.json', 'data/qmeta.json', 'data/qtext.json',
  'data/qindex.bin', 'toppers.html'
];
// Files the browser must have before it can answer a text query.
const SEARCH_GATING = ['data/index.json', 'data/copies.json', 'data/questions.json',
                       'data/qmeta.json', 'data/qindex.bin'];

let totG = 0, totB = 0, gateG = 0, gateB = 0;
console.log('file                              raw        gzip      brotli');
for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p);
  const g = gzip(b), r = brotli(b);
  totG += g; totB += r;
  if (SEARCH_GATING.includes(f)) { gateG += g; gateB += r; }
  console.log(f.padEnd(30), KB(b.length).padStart(10), KB(g).padStart(11), KB(r).padStart(11));
}
console.log('-'.repeat(64));
console.log('ALL LISTED'.padEnd(30), ''.padStart(10), KB(totG).padStart(11), KB(totB).padStart(11));
console.log('SEARCH-GATING ONLY'.padEnd(30), ''.padStart(10), KB(gateG).padStart(11), KB(gateB).padStart(11));
console.log('\n(search-gating = what must land before a text query can be answered)');
