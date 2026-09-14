/* Prototype the Phase-5 inverted index and report its real size. Audit E1.
   Fixed to read data/qmeta.json + data/qtext.json — Phase 4 (I1) deleted the
   data/questions.json this tool used to read.

   Builds BOTH postings encodings so the addendum's finding is reproducible from this
   tool's own output, not just asserted in prose (DECISION-9 — measure, don't assume):
     Version A — naive: delta-encode postings over the RAW stable id, sorted by id
                 ascending. This is what the audit's original estimate (328 KB raw /
                 256 KB gzip) assumed implicitly, back when ids were small and sequential
                 (0..8101). Phase 4 made them ~32-bit content hashes (up to ~4.29 billion,
                 high-entropy) — sorting/delta-ing over THAT should balloon the postings.
     Version B — the fix: postings reference a local dense position (0..n-1, build
                 order) into a small translation table (local position -> stable id)
                 shipped in the same binary file. Deltas over local positions compress
                 like the old small-id case; the translation table costs one incompressible
                 uint32 per question.
   Canonical questions only (qmeta.json's order) — matches the scope of the addendum's own
   one-off measurement (954.8 KB naive / 327.7 KB fixed). Production's data/qindex.bin
   additionally indexes variant text (a copy's own divergent wording, ~3.1k more documents
   in the current corpus) for search parity with today's substring scan, which also matches
   against QVARLC — see build.js's writeQIndex() and its own size log for that fuller number. */
import fs from 'node:fs';
import { need, gzip, brotli, KB } from './_lib.mjs';

const qmeta = JSON.parse(fs.readFileSync(need('data/qmeta.json'), 'utf8'));
const qtext = JSON.parse(fs.readFileSync(need('data/qtext.json'), 'utf8'));
const QL = qmeta.questions;   // build order = local position order (0..n-1)
const N = QL.length;
const ids = QL.map(q => q.i);

const tok = s => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const varint = a => {
  const o = [];
  for (let v of a) { while (v >= 128) { o.push((v & 127) | 128); v >>>= 7; } o.push(v); }
  return o;
};
function frontCode(tokens) {
  let dict = '', prev = '';
  for (const t of tokens) {
    let p = 0; while (p < prev.length && p < t.length && prev[p] === t[p] && p < 15) p++;
    dict += String.fromCharCode(48 + p) + t.slice(p) + '\n'; prev = t;
  }
  return Buffer.from(dict, 'utf8');
}

const post = new Map(); let pairs = 0;
QL.forEach((q, i) => {
  const text = qtext.text[q.i] || '';
  for (const t of new Set(tok(text))) { pairs++; if (!post.has(t)) post.set(t, []); post.get(t).push(i); }
});
const tokens = [...post.keys()].sort();
const dictB = frontCode(tokens);

function encodeA() {   // naive: delta over the RAW STABLE ID, postings sorted by id ascending
  const lens = [], pb = [];
  for (const t of tokens) {
    const rawIds = post.get(t).map(p => ids[p]).sort((a, b) => a - b);
    const d = []; let last = 0;
    for (const id of rawIds) { d.push(id - last); last = id; }
    const v = varint(d); lens.push(v.length); pb.push(...v);
  }
  return { lenB: Buffer.from(varint(lens)), postB: Buffer.from(pb) };
}

function encodeB() {   // local dense position (0..N-1) + translation table
  const lens = [], pb = [];
  for (const t of tokens) {
    const localPositions = post.get(t).slice().sort((a, b) => a - b);
    const d = []; let last = 0;
    for (const p of localPositions) { d.push(p - last); last = p; }
    const v = varint(d); lens.push(v.length); pb.push(...v);
  }
  const transB = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) transB.writeUInt32LE(ids[i] >>> 0, i * 4);
  return { lenB: Buffer.from(varint(lens)), postB: Buffer.from(pb), transB };
}

const A = encodeA();
const B = encodeB();
const hapax = [...post.values()].filter(v => v.length === 1).length;

console.log(`questions: ${N}  ·  distinct tokens: ${tokens.length}  ·  (question,token) pairs: ${pairs}`);
console.log(`tokens in exactly one question: ${hapax} (${(hapax / tokens.length * 100).toFixed(0)}%)`);

const row = (l, b) => console.log('  ' + l.padEnd(40), KB(b.length).padStart(10), KB(gzip(b)).padStart(10), KB(brotli(b)).padStart(10));
const hdr = () => console.log('  component'.padEnd(42) + '      raw       gzip     brotli');

console.log('\n  VERSION A — naive: delta over the RAW stable id, sorted by id (what the audit\n  originally estimated, before Phase 4 made ids large sparse hashes)');
hdr();
row('token dictionary (front-coded)', dictB);
row('postings length table (varint)', A.lenB);
row('postings (delta+varint over raw id)', A.postB);
const totalA = Buffer.concat([dictB, A.lenB, A.postB]);
row('TOTAL (Version A)', totalA);

console.log('\n  VERSION B — local dense position (0..n-1) + translation table (the fix)');
hdr();
row('token dictionary (front-coded)', dictB);
row('postings length table (varint)', B.lenB);
row('postings (delta+varint over local position)', B.postB);
row('translation table (uint32 local->id)', B.transB);
const totalB = Buffer.concat([dictB, B.lenB, B.postB, B.transB]);
row('TOTAL (Version B)', totalB);

console.log(`\n  => Version A is ${(gzip(totalA) / gzip(totalB) * 100 - 100).toFixed(0)}% LARGER than Version B, gzipped.`);
console.log(`  => Version B is ${Math.abs(gzip(totalB) / 1024 - 292).toFixed(1)} KB away from the audit's original 292 KB gzip estimate` +
  ` (${(Math.abs(gzip(totalB) / 1024 / 292 - 1) * 100).toFixed(0)}% off), and` +
  ` ${Math.abs(gzip(totalB) / 1024 - 327.7).toFixed(1)} KB away from the addendum's 327.7 KB re-measurement.`);

const qtextB = fs.readFileSync(need('data/qtext.json'));
console.log('');
row('qtext.json today (for comparison)', qtextB);
console.log(`\n  => the index (Version B, canonical questions only) answers the same queries for ` +
  `${(gzip(totalB) / gzip(qtextB) * 100).toFixed(0)}% of qtext.json's bytes.`);
