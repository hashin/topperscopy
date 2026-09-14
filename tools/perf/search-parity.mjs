/* Search parity — old substring scan vs the Phase-5 inverted index. Audit E1 / DECISION-7.
   Written BEFORE the new engine (assets/app.js still does the old linear scan when this file
   was first committed) so the test is not designed around the implementation it is meant to
   catch regressions in.

   OLD engine = today's matchQ()/matchingQids() in assets/app.js, reimplemented here against
   data/qtext.json: for mode 'all', every term must appear as a SUBSTRING anywhere in the
   (lowercased, unsegmented) question text; for mode 'exact', the whole phrase must appear as
   one literal substring.

   NEW engine = the token-prefix inverted index (data/qindex.bin): a term matches a document
   only if some real token in that document STARTS WITH the term. Read as its own binary parser
   here, mirroring (not importing — app.js is browser vanilla JS, this is a Node tool) the
   reader in assets/app.js.

   THE MATH, checked here rather than assumed (DECISION-9):
   Because every token that starts with prefix P also *contains* P as a substring, the set of
   documents NEW matches for a single term is always a SUBSET of what OLD matches for that same
   term (OLD additionally catches mid-token occurrences, e.g. "eral" inside "several", which NEW
   correctly excludes — DECISION-7's accepted trade-off). This composes under AND, so for mode
   'all' at any number of terms: NEW ⊆ OLD, always, for the token-matching step. Equality holds
   exactly when the term never occurs as a substring anywhere except at a real token's start.
   For mode 'exact', once qtext.json has landed, NEW's phrase-verification step makes it
   *exactly equal* to OLD (both end up testing the identical literal-substring predicate — the
   index only narrows the candidate set first); before qtext.json lands, NEW's unverified
   AND-candidate set is a superset of the final (verified) answer, which is the one place
   "superset" is the mathematically correct word for this feature.

   NOTE ON THE AUDIT'S OWN WORDING: PERF-UX-AUDIT-2026-09-14.md's Verify section says the new
   engine must return "a superset for prefix queries". Measured here, that is backwards for mode
   'all': NEW is a subset of OLD there (OLD is the noisier, substring-superset engine — see the
   proof above and DECISION-7's own "eral matches nothing" example, which is a subset relationship
   too). This script reports the true relationship rather than forcing the assertion to match the
   prose — see docs/DECISIONS.md DECISION-12 and the final report for this phase. */
import fs from 'node:fs';
import { need } from './_lib.mjs';

const qtext = JSON.parse(fs.readFileSync(need('data/qtext.json'), 'utf8'));
const qmeta = JSON.parse(fs.readFileSync(need('data/qmeta.json'), 'utf8'));

const tok = s => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];

/* ---------- OLD engine: substring scan, exactly matchQ()/matchingQids() in app.js ---------- */
const QTEXTLC = new Map(), QVARLC = new Map();
for (const id in qtext.text) QTEXTLC.set(Number(id), String(qtext.text[id] || '').toLowerCase());
for (const id in (qtext.variants || {})) QVARLC.set(Number(id), String(qtext.variants[id] || '').toLowerCase());

function oldMatch(terms, mode) {
  const joined = terms.join(' ');
  const scan = src => {
    const hit = new Set();
    src.forEach((t, id) => {
      if (!t) return;
      const ok = mode === 'exact' ? t.indexOf(joined) >= 0 : terms.every(w => t.indexOf(w) >= 0);
      if (ok) hit.add(id);
    });
    return hit;
  };
  const q = scan(QTEXTLC), v = scan(QVARLC);
  const signed = new Set([...q]);
  for (const id of v) signed.add(-id);
  return signed;
}

/* ---------- NEW engine: read data/qindex.bin, mirrors the planned assets/app.js reader ---------- */
function loadQIndex() {
  const p = 'data/qindex.bin';
  if (!fs.existsSync(p)) return null;
  const buf = fs.readFileSync(p);
  let o = 0;
  const magic = buf.toString('ascii', 0, 4); o = 4;
  const version = buf.readUInt8(o); o += 1;
  const tokenCount = buf.readUInt32LE(o); o += 4;
  const qCount = buf.readUInt32LE(o); o += 4;
  const vCount = buf.readUInt32LE(o); o += 4;
  const dictBytes = buf.readUInt32LE(o); o += 4;
  const lenTableBytes = buf.readUInt32LE(o); o += 4;
  const postingsBytes = buf.readUInt32LE(o); o += 4;
  const translationBytes = buf.readUInt32LE(o); o += 4;
  if (magic !== 'TCIX') throw new Error('bad magic: ' + magic);
  const dictStart = o, lenStart = dictStart + dictBytes, postStart = lenStart + lenTableBytes,
    transStart = postStart + postingsBytes;
  // decode front-coded dictionary into a plain sorted string array — 14.5k entries, trivial cost,
  // and keeps the query-side binary search a plain array comparison (no re-decoding per keystroke)
  const dict = buf.toString('utf8', dictStart, dictStart + dictBytes);
  const tokens = new Array(tokenCount);
  let prev = '', line = 0, i = 0;
  while (i < dict.length && line < tokenCount) {
    const nl = dict.indexOf('\n', i);
    const rec = dict.slice(i, nl);
    const shared = rec.charCodeAt(0) - 48;
    const t = prev.slice(0, shared) + rec.slice(1);
    tokens[line++] = t; prev = t; i = nl + 1;
  }
  // varint decode helper over a [start,end) slice, returns {values, bytesRead}
  function readVarints(start, end, count) {
    const out = new Array(count); let p = start, n = 0;
    for (let k = 0; k < count; k++) {
      let v = 0, shift = 0, b;
      do { b = buf[p++]; v |= (b & 127) << shift; shift += 7; } while (b & 128);
      out[n++] = v >>> 0;
    }
    return { values: out, end: p };
  }
  const { values: lens } = readVarints(lenStart, lenStart + lenTableBytes, tokenCount);
  const postOffset = new Array(tokenCount + 1); postOffset[0] = postStart;
  for (let k = 0; k < tokenCount; k++) postOffset[k + 1] = postOffset[k] + lens[k];
  const translate = new Uint32Array(qCount + vCount);
  for (let k = 0; k < qCount + vCount; k++) translate[k] = buf.readUInt32LE(transStart + k * 4);

  function postingsOf(tokenIdx) {
    const start = postOffset[tokenIdx], end = postOffset[tokenIdx + 1];
    const out = []; let p = start, last = 0;
    while (p < end) {
      let v = 0, shift = 0, b;
      do { b = buf[p++]; v |= (b & 127) << shift; shift += 7; } while (b & 128);
      last += (v >>> 0); out.push(last);
    }
    return out;
  }
  function lowerBound(w) {
    let lo = 0, hi = tokens.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tokens[mid] < w) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function prefixRange(term) { return [lowerBound(term), lowerBound(term + '￿')]; }

  return { tokens, qCount, vCount, translate, postingsOf, prefixRange, version, dictBytes, lenTableBytes, postingsBytes, translationBytes };
}

function newMatch(idx, terms, mode) {
  // term -> Set of local positions whose union covers every dictionary token starting with it
  const perTerm = terms.map(term => {
    const [lo, hi] = idx.prefixRange(term);
    const s = new Set();
    for (let ti = lo; ti < hi; ti++) for (const p of idx.postingsOf(ti)) s.add(p);
    return s;
  });
  if (perTerm.some(s => s.size === 0)) return new Set();
  perTerm.sort((a, b) => a.size - b.size);
  let acc = perTerm[0];
  for (let k = 1; k < perTerm.length; k++) acc = new Set([...acc].filter(x => perTerm[k].has(x)));
  const candidateIds = new Set([...acc].map(p => (p < idx.qCount ? idx.translate[p] : -idx.translate[p])));
  if (mode !== 'exact') return candidateIds;
  // phrase verification against qtext (always available in this Node tool)
  const joined = terms.join(' ');
  const verified = new Set();
  for (const id of candidateIds) {
    const t = id < 0 ? QVARLC.get(-id) : QTEXTLC.get(id);
    if (t && t.indexOf(joined) >= 0) verified.add(id);
  }
  return verified;
}

/* ---------- build a real, fixed query list from the actual corpus ---------- */
const vocab = new Set();
const df = new Map();       // token -> document frequency (canonical questions only)
const bigramDf = new Map(); // "w1 w2" -> document frequency
for (const q of qmeta.questions) {
  const text = qtext.text[q.i] || '';
  const words = tok(text);
  const seen = new Set(words);
  seen.forEach(w => { vocab.add(w); df.set(w, (df.get(w) || 0) + 1); });
  const seenBigram = new Set();
  for (let k = 0; k + 1 < words.length; k++) {
    const bg = words[k] + ' ' + words[k + 1];
    if (!seenBigram.has(bg)) { seenBigram.add(bg); bigramDf.set(bg, (bigramDf.get(bg) || 0) + 1); }
  }
}
const topTokens = [...df.entries()].filter(([w]) => w.length >= 4 && !/^\d+$/.test(w))
  .sort((a, b) => b[1] - a[1]).slice(0, 130).map(([w]) => w);
const topBigrams = [...bigramDf.entries()].filter(([, n]) => n >= 3)
  .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w);

const queries = [];
topTokens.forEach(w => queries.push({ terms: [w], mode: 'all', label: w }));
for (let k = 0; k + 1 < topTokens.length; k += 5) queries.push({ terms: [topTokens[k], topTokens[k + 1]], mode: 'all', label: topTokens[k] + ' ' + topTokens[k + 1] });
topBigrams.forEach(bg => queries.push({ terms: bg.split(' '), mode: 'exact', label: '"' + bg + '"' }));
// curated fragments/prefixes — deliberately mid-word or genuinely a word-start
const CURATED = ['eral', 'ent', 'ment', 'tion', 'ecti', 'fed', 'polic', 'govern', 'democra', 'consti', 'ration', 'anti', 'sub', 'inter'];
CURATED.forEach(w => queries.push({ terms: [w], mode: 'all', label: w + ' (curated fragment/prefix)' }));

const idx = loadQIndex();
console.log(`search-parity — ${queries.length} queries (${topTokens.length} frequent words, ` +
  `${(queries.length - topTokens.length - CURATED.length - topBigrams.length)} word-pairs, ${topBigrams.length} phrases, ${CURATED.length} curated)`);
console.log(idx ? `data/qindex.bin found — v${idx.version}, ${idx.tokens.length} tokens, ${idx.qCount} questions + ${idx.vCount} variants`
                : 'data/qindex.bin NOT built yet — reporting the OLD-engine baseline only. Re-run once writeQIndex() lands.');
console.log('');

let wholeWordExact = 0, wholeWordMismatch = 0, subsetOk = 0, newOnlyBug = 0;
const mismatches = [];
for (const q of queries) {
  const oldSet = oldMatch(q.terms, q.mode);
  if (!idx) continue;
  const newSet = newMatch(idx, q.terms, q.mode);
  const newOnly = [...newSet].filter(id => !oldSet.has(id));
  const oldOnly = [...oldSet].filter(id => !newSet.has(id));
  const isWholeWord = q.mode === 'all' && q.terms.every(t => vocab.has(t));
  if (newOnly.length) { newOnlyBug++; mismatches.push({ q, kind: 'NEW-ONLY (should be impossible)', ids: newOnly.slice(0, 3) }); continue; }
  if (q.mode === 'exact') {
    if (oldOnly.length) mismatches.push({ q, kind: 'exact-phrase lost a match', ids: oldOnly.slice(0, 3) });
    else wholeWordExact++;
    continue;
  }
  if (isWholeWord) {
    if (oldOnly.length) { wholeWordMismatch++; mismatches.push({ q, kind: 'whole-word query lost matches (compound-token edge case)', ids: oldOnly.slice(0, 3) }); }
    else wholeWordExact++;
  } else {
    subsetOk++; // fragment/prefix: NEW ⊆ OLD expected, difference is the accepted DECISION-7 trade-off
  }
}

if (idx) {
  console.log(`whole-word / phrase queries with NEW === OLD:        ${wholeWordExact}`);
  console.log(`whole-word queries where NEW lost a match (bug?):    ${wholeWordMismatch}`);
  console.log(`fragment/prefix queries, NEW ⊆ OLD as expected:      ${subsetOk}`);
  console.log(`queries where NEW found something OLD did not:       ${newOnlyBug}  (should always be 0 — see the proof at the top of this file)`);
  if (mismatches.length) {
    console.log('\nDetails (every unexplained regression, per the audit\'s Verify step):');
    for (const m of mismatches) {
      const exampleTexts = m.ids.map(id => (id < 0 ? QVARLC.get(-id) : QTEXTLC.get(id)) || '').map(t => t.slice(0, 70));
      console.log(`  [${m.kind}] query ${JSON.stringify(m.q.label)} (mode=${m.q.mode}) — ${m.ids.length} example id(s):`);
      exampleTexts.forEach(t => console.log('      ' + JSON.stringify(t) + '…'));
    }
  }
  const exitBad = newOnlyBug > 0 || mismatches.some(m => m.kind.indexOf('bug') >= 0 || m.kind.indexOf('lost a match') >= 0);
  if (exitBad) { console.log('\nFAIL — an unexplained regression was found.'); process.exitCode = 1; }
  else console.log('\nOK — every difference is the accepted substring→prefix trade-off (DECISION-7), nothing unexplained.');
}
