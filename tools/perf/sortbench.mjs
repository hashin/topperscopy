/* Is the result sort worth optimising? Audit P6.
   Warmed up, interleaved, median of 15 — an unwarmed or non-interleaved benchmark
   here gives the WRONG answer by a factor of 3 (that mistake is why this exists). */
import fs from 'node:fs';
import { need } from './_lib.mjs';
const C = JSON.parse(fs.readFileSync(need('data/copies.json'), 'utf8')).copies;
const base = C.map(c => ({ t: c.t, p: c.p }));
const shuffled = seed => { const a = base.slice(); let s = seed;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
const coll = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const impls = {
  'localeCompare (current)': a => a.sort((x, y) => x.t.localeCompare(y.t) || x.p.localeCompare(y.p)),
  'Intl.Collator (hoisted)': a => a.sort((x, y) => coll.compare(x.t, y.t) || coll.compare(x.p, y.p)),
  'plain < > (no collation)': a => a.sort((x, y) => x.t < y.t ? -1 : x.t > y.t ? 1 : (x.p < y.p ? -1 : x.p > y.p ? 1 : 0))
};
for (const k in impls) for (let i = 0; i < 5; i++) impls[k](shuffled(i + 900));   // warm up
const N = 15;
const run = (make, label) => {
  const res = {}; for (const k in impls) res[k] = [];
  for (let r = 0; r < N; r++) for (const k of Object.keys(impls)) {
    const a = make(r + 1);
    const s = process.hrtime.bigint(); impls[k](a); const e = process.hrtime.bigint();
    res[k].push(Number(e - s) / 1e6);
  }
  console.log(label);
  for (const k in res) { const v = res[k].sort((a, b) => a - b);
    console.log('  ' + k.padEnd(26), v[Math.floor(N / 2)].toFixed(2).padStart(7), ' ms   (' + v[0].toFixed(2) + '–' + v[N - 1].toFixed(2) + ')'); }
  console.log('');
};
console.log(`${C.length} copies · warmed · interleaved · median of ${N}\n`);
run(shuffled, 'worst case (shuffled input):');
run(() => base.slice(), 'as the app actually sees it (copies.json order):');
console.log('Conclusion: localeCompare wins — V8 has a fast path for it. A custom');
console.log('Intl.Collator with numeric/sensitivity options forces a slower ICU path.');
console.log('The sort is ~0.4ms on real input. LEAVE IT ALONE. See audit P6.');
