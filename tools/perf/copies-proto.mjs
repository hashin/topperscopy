/* Would interning copies.json's repeated strings be worth it? Audit T4. */
import fs from 'node:fs';
import { need, gzip, brotli, KB } from './_lib.mjs';
const C = JSON.parse(fs.readFileSync(need('data/copies.json'), 'utf8')).copies;
const size = k => C.reduce((s, c) => s + (c[k] === undefined ? 0 : JSON.stringify(c[k]).length), 0);
const keys = new Set(); C.forEach(c => Object.keys(c).forEach(k => keys.add(k)));
console.log(`${C.length} copies — raw bytes per field:`);
[...keys].map(k => [k, size(k)]).sort((a, b) => b[1] - a[1])
  .forEach(([k, b]) => console.log('  ' + k.padEnd(6), KB(b).padStart(10)));
const origins = new Map();
C.forEach(c => { try { const o = new URL(c.u).origin; origins.set(o, (origins.get(o) || 0) + 1); } catch (e) {} });
const tList = [...new Set(C.map(c => c.t))], cList = [...new Set(C.map(c => c.c))];
console.log(`\ndistinct URL origins: ${origins.size} · topper names: ${tList.length} · sources: ${cList.length}`);
const oList = [...origins.keys()], oIdx = new Map(oList.map((h, i) => [h, i]));
const tIdx = new Map(tList.map((t, i) => [t, i])), cIdx = new Map(cList.map((t, i) => [t, i]));
const packed = JSON.stringify({ o: oList, t: tList, c: cList, copies: C.map(c => {
  let oi = -1, rest = c.u;
  try { const u = new URL(c.u); oi = oIdx.get(u.origin); rest = c.u.slice(u.origin.length); } catch (e) {}
  return [c.i, tIdx.get(c.t), cIdx.get(c.c), c.p, c.y || 0, c.r || 0, oi, rest, c.q || [], c.link ? 1 : 0]; }) });
const orig = fs.readFileSync('data/copies.json');
console.log('\n                      raw        gzip     brotli');
console.log('  today         ', KB(orig.length).padStart(10), KB(gzip(orig)).padStart(10), KB(brotli(orig)).padStart(10));
console.log('  interned      ', KB(packed.length).padStart(10), KB(gzip(packed)).padStart(10), KB(brotli(packed)).padStart(10));
console.log(`\n  gzip saving: ${KB(gzip(orig) - gzip(packed))} — small. raw saving: ${KB(orig.length - packed.length)} (parse time + memory).`);
console.log('  Only worth doing if profiling shows parse/memory actually hurts. See audit T4.');
