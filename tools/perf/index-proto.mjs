/* Prototype the Phase-5 inverted index and report its real size. Audit E1. */
import fs from 'node:fs';
import { need, gzip, brotli, KB } from './_lib.mjs';
const QI = JSON.parse(fs.readFileSync(need('data/questions.json'), 'utf8')).questions;
const tok = s => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const post = new Map(); let pairs = 0;
for (const q of QI) for (const t of new Set(tok(q.q))) { pairs++; if (!post.has(t)) post.set(t, []); post.get(t).push(q.i); }
const tokens = [...post.keys()].sort();
let dict = '', prev = '';
for (const t of tokens) { let p = 0; while (p < prev.length && p < t.length && prev[p] === t[p] && p < 15) p++;
  dict += String.fromCharCode(48 + p) + t.slice(p) + '\n'; prev = t; }
const varint = a => { const o = []; for (let v of a) { while (v >= 128) { o.push((v & 127) | 128); v >>>= 7; } o.push(v); } return o; };
const pb = [], lens = [];
for (const t of tokens) { const ids = post.get(t).slice().sort((a, b) => a - b);
  const d = []; let last = 0; for (const id of ids) { d.push(id - last); last = id; }
  const v = varint(d); lens.push(v.length); pb.push(...v); }
const dictB = Buffer.from(dict, 'utf8'), lenB = Buffer.from(varint(lens)), postB = Buffer.from(pb);
const all = Buffer.concat([dictB, lenB, postB]);
const hapax = [...post.values()].filter(v => v.length === 1).length;
console.log(`questions: ${QI.length}  ·  distinct tokens: ${tokens.length}  ·  (question,token) pairs: ${pairs}`);
console.log(`tokens in exactly one question: ${hapax} (${(hapax / tokens.length * 100).toFixed(0)}%)\n`);
const row = (l, b) => console.log('  ' + l.padEnd(32), KB(b.length).padStart(10), KB(gzip(b)).padStart(10), KB(brotli(b)).padStart(10));
console.log('  component'.padEnd(34) + '      raw       gzip     brotli');
row('token dictionary (front-coded)', dictB);
row('postings length table (varint)', lenB);
row('postings (delta + varint)', postB);
console.log('  ' + '-'.repeat(64));
row('INVERTED INDEX TOTAL', all);
const cur = fs.readFileSync('data/questions.json');
console.log('');
row('questions.json today', cur);
console.log(`\n  => the index answers the same queries for ${(gzip(all) / gzip(cur) * 100).toFixed(0)}% of the bytes.`);
