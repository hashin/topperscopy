/* Topper's Copy by Hashin — the invariant check. `npm run check` (after `node build.js`).
 *
 * Every rule here exists because of something in docs/INTENT.md or docs/DECISIONS.md, and
 * docs/INVARIANTS.md lists them with the reason. Prints a table; exits non-zero on any failure.
 * Plain Node, no dependencies, no browser, ~2 seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Gzip budgets in KB, as GitHub Pages serves them. Ceiling = measured on 2026-09-15 + ~10 %
// headroom, so nothing regresses quietly. When the corpus grows past a ceiling (OCR adds
// questions), raise it deliberately in the same commit and say why.
const BUDGETS = {
  boot: { ceiling: 450, files: ['index.html', 'assets/style.css', 'assets/app.js', 'assets/fonts/inter-latin.woff2', 'assets/fonts/fraunces-latin.woff2', 'data/copies.json'], why: 'everything before the first 25 cards paint — and every topper name is searchable (INTENT-2)' },
  // Raised 23 -> 24 KB 2026-09-19 for the shard-splitting logic (DECISION-23) — real feature
  // code, not a dependency, so it's a deliberate raise, not the "machinery crept back" DECISION-2 warns about.
  // Raised 24 -> 25 KB 2026-10-03 for the stale-shard self-heal (DECISION-26, ~0.8 KB) after trimming it to the bone —
  // a correctness guard (no false "0 copies" under cache skew), not machinery creeping back.
  // Raised 25 -> 26 KB 2026-10-04 for DECISION-28: the download queue, the -deep loader and the render throttle (~1.1 KB
  // after cutting the comments down) — feature code that took ~500 KB off the idle prefetch.
  'app.js': { ceiling: 26, files: ['assets/app.js'], why: 'DECISION-2: no framework, no bundler; growth here means machinery crept back' },
  'shard gs1': { ceiling: 200, shard: 'gs1', why: 'the largest single download a GS1 text query waits on (INTENT-2) — split into parts once it outgrows one file, DECISION-23' },
  'shard gs2': { ceiling: 180, shard: 'gs2', why: '' },
  'shard gs3': { ceiling: 120, shard: 'gs3', why: '' },
  'shard gs4': { ceiling: 690, shard: 'gs4', why: 'GS4 case studies are long — this is the one to watch' },
  // essay 25 -> 30, optional 20 -> 55 KB 2026-10-04: both were stale, failing since the OCR passes grew them (essay 25.1, optional
  // 46.4 KB measured). Optional is the one that keeps growing; a part auto-splits at SHARD_PART_TARGET_KB (150) in build.js, so
  // these ceilings are early-warning thresholds well under that, not the point where a download becomes a problem.
  'shard essay': { ceiling: 30, shard: 'essay', why: '' },
  'shard other': { ceiling: 30, shard: 'other', why: '' },
  'shard optional': { ceiling: 55, shard: 'optional', why: 'grows with the optional-subject OCR pass' },
  // Everything a visitor on a fast connection downloads in the background after boot: all shard parts + syllabus.
  // Measured 1,458 KB on 2026-10-03 (DECISION-25); 969 KB on 2026-10-04 once long questions moved to -deep files and
  // near-duplicates merged (DECISION-28). This is the number that grows with the corpus (~12 KB/day at the 2026-10 OCR pace).
  // Raise it deliberately, with the corpus growth that forced it, never to silence a red check.
  'prefetch total': { ceiling: 1100, files: [], prefetch: true, why: 'sum of every question-shard part + syllabus.json, fetched on idle on 4G (DECISION-25)' },
  // What a first-visit search with no paper filter waits for before its result is complete: every part, every -deep file,
  // syllabus. 1,358 KB on 2026-10-04 (DECISION-28). On a 1.6 Mbps phone each 100 KB here is ~0.5 s (PERF-AUDIT-2026-10-04).
  'search total': { ceiling: 1500, files: [], prefetch: true, deep: true, why: 'every part + every -deep file + syllabus.json — a cold all-papers search (DECISION-28)' },
  // A -deep file is fetched on its own (two papers at a time), so the ceiling is per file, like the part budgets.
  'deep part': { ceiling: 160, files: [], deepPart: true, why: 'largest single questions-*-deep.json (GS4 case studies)' },
  'interview list': { ceiling: 220, files: ['data/interview-list.json'], why: 'lazy-loaded only when the Interviews tab opens — never part of boot (INTENT-2)' }
};
// Every path build.js writes. Must be gitignored and never tracked (DECISION-4).
const GENERATED = ['/data/copies.json', '/data/questions-*.json', '/data/interview-list.json', '/data/iv/',
  '/toppers.html', '/toppers-*.html', '/sitemap.xml',
  '/sitemap-main.xml', '/sitemap-toppers.xml', '/sitemap-questions.xml', '/sitemap-hubs.xml', '/llms.txt', '/robots.txt',
  '/topper/', '/question/', '/paper/', '/optional/', '/dataset/'];
const SHARDS = ['gs1', 'gs2', 'gs3', 'gs4', 'essay', 'other', 'optional'];
// Largest single data/iv/<id>.json transcript. Opening a card downloads exactly one of these, so the
// ceiling is on the biggest one (a normal transcript is ~1 KB gzip; the longest are a few tens of KB).
const INTERVIEW_TEXT_CEILING = 60;

// The browser's copy-id and question-id functions, lifted verbatim out of assets/app.js, so the check proves the code
// that ships (not a second copy of it) agrees with what build.js wrote into the shards.
const lift = (name, rx) => {
  const m = fs.readFileSync(path.join(ROOT, 'assets/app.js'), 'utf8').match(rx);
  if (!m) throw new Error(`function ${name} not found in assets/app.js`);
  return new Function(m[0] + '; return ' + name + ';')();
};
const cid = lift('cid', /function cid\(u\) \{[\s\S]*?\n  \}\n/);
const fnv = lift('fnv', /function fnv\(s\) \{.*\}\n/);
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const gzKb = f => zlib.gzipSync(fs.readFileSync(path.join(ROOT, f)), { level: 9 }).length / 1024;
// A shard is data/questions-<name>.json, or (once it outgrows one file, DECISION-23) numbered
// parts data/questions-<name>-1.json, -2.json, … — never both at once, build.js clears the old
// naming on every run. Returns paths relative to ROOT, sorted, or [] if the shard is missing.
const shardFiles = name => {
  const dir = path.join(ROOT, 'data');
  if (!fs.existsSync(dir)) return [];
  const rx = new RegExp(`^questions-${name}(-\\d+)?\\.json$`);
  return fs.readdirSync(dir).filter(f => rx.test(f)).sort().map(f => 'data/' + f);
};
// A part's long-question companion (DECISION-28): data/questions-<name>[-N]-deep.json, or null when the part has none.
const deepFile = part => (exists(part.replace(/\.json$/, '-deep.json')) ? part.replace(/\.json$/, '-deep.json') : null);
const results = [];
function check(id, cites, title, fn) {
  let ok, detail = '';
  try { const r = fn(); ok = r === true || (r && r.ok); detail = (r && r.detail) || ''; }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message || e); }
  results.push({ id, cites, title, ok, detail });
}

if (!exists('data/copies.json')) { console.error('run `node build.js` first — the checks measure real output'); process.exit(1); }
const DB = JSON.parse(read('data/copies.json'));
const copies = [];
for (const name in DB.toppers) for (const r of DB.toppers[name].copies) copies.push({ t: name, p: r[0], u: r[2] });

/* ---- data integrity ---- */
check('INV-1', 'INTENT-4', 'No answer copy is re-hosted on our own domain', () => {
  const bad = copies.filter(c => /topperscopy\.hashin\.me|(^|\/)\/?data\//i.test(String(c.u || '')));
  return { ok: !bad.length, detail: bad.length ? `${bad.length} copies point at our own domain, e.g. ${bad[0].u}` : `${copies.length} copies, all third-party` };
});
check('INV-2', 'INTENT-5', 'Every copy link is http(s) — no javascript:/data: from a submission', () => {
  const bad = copies.filter(c => !/^https?:\/\//i.test(String(c.u || '')));
  return { ok: !bad.length, detail: bad.length ? `${bad.length} non-http(s) URLs, e.g. ${String(bad[0].u).slice(0, 60)}` : 'all https/http' };
});
check('INV-3', 'DECISION-17', 'A PDF URL appears in exactly one copy', () => {
  const urls = new Set(copies.map(c => c.u));
  return { ok: urls.size === copies.length, detail: `${urls.size}/${copies.length}` };
});
check('INV-4', 'DECISION-17', 'Every question ref in every shard resolves to a copy in copies.json', () => {
  const ids = new Set(copies.map(c => cid(c.u)));
  let refs = 0, bad = 0, questions = 0;
  for (const s of SHARDS) {
    // A shard is one file, or (DECISION-23) several numbered parts once it outgrows one.
    const files = shardFiles(s);
    if (!files.length) return { ok: false, detail: `data/questions-${s}*.json missing` };
    for (const f of files) {
      const d = JSON.parse(read(f));
      for (const q of d.questions.concat(d.fragments)) { questions++; for (const [i] of q[1]) { refs++; if (!ids.has(d.ids[i])) bad++; } }
    }
  }
  return { ok: !bad, detail: `${refs} refs across ${questions} questions${bad ? ', ' + bad + ' point at no copy' : ', all resolve'}` };
});

check('INV-18', 'DECISION-28', 'Merging questions never loses an answer: shard refs = question rows counted per copy in copies.json', () => {
  let rows = 0, refs = 0;
  for (const name in DB.toppers) for (const r of DB.toppers[name].copies) rows += r[3];
  for (const f of SHARDS.flatMap(shardFiles)) { const d = JSON.parse(read(f)); for (const q of d.questions.concat(d.fragments)) refs += q[1].length; }
  return { ok: rows === refs, detail: `${refs} refs in the shards, ${rows} question rows in copies.json` };
});

/* ---- credit and honesty ---- */
check('INV-14', 'DECISION-17', 'cid(url) — the browser\'s copy id — is collision-free over every copy', () => {
  const seen = new Map();
  for (const c of copies) { const id = cid(c.u); if (seen.has(id) && seen.get(id) !== c.u) return { ok: false, detail: `${id} is both ${seen.get(id)} and ${c.u}` }; seen.set(id, c.u); }
  return { ok: true, detail: `${seen.size} distinct ids over ${copies.length} copies` };
});
check('INV-15', 'DECISION-27', 'copies.json\'s shardV / shardDV name every part and -deep file and match their bytes — the ?v= the service worker caches by', () => {
  let parts = 0, deeps = 0;
  const sha = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex').slice(0, 8);
  for (const s of SHARDS) {
    const files = shardFiles(s), v = (DB.shardV || {})[s], dv = (DB.shardDV || {})[s];
    if (!v || v.length !== files.length) return { ok: false, detail: `${s}: ${files.length} files but shardV has ${v ? v.length : 'none'}` };
    if (!dv || dv.length !== files.length) return { ok: false, detail: `${s}: ${files.length} parts but shardDV has ${dv ? dv.length : 'none'}` };
    for (let i = 0; i < files.length; i++) {
      if (sha(files[i]) !== v[i]) return { ok: false, detail: `${files[i]} hashes to ${sha(files[i])}, copies.json says ${v[i]}` };
      const d = deepFile(files[i]);   // '' in shardDV <=> no -deep file for that part
      if (!d !== !dv[i] || (d && sha(d) !== dv[i])) return { ok: false, detail: `${files[i]}: -deep ${d ? 'hashes to ' + sha(d) : 'missing'}, shardDV says '${dv[i]}'` };
      parts++; if (d) deeps++;
    }
  }
  return { ok: true, detail: `${parts} parts + ${deeps} -deep files, every hash matches` };
});
check('INV-17', 'DECISION-28', 'Every cut question has exactly one rest, keyed by app.js\'s own fnv(paper|full text) — its practice id', () => {
  let cut = 0;
  for (const s of SHARDS) for (const f of shardFiles(s)) {
    const d = JSON.parse(read(f)), df = deepFile(f), tails = new Map(df ? JSON.parse(read(df)).tails : []);
    const rows = d.questions.concat(d.fragments).filter(r => r[5]);
    if (rows.length !== tails.size) return { ok: false, detail: `${f}: ${rows.length} cut rows, ${tails.size} rests` };
    for (const r of rows) {
      const rest = tails.get(r[5]);
      if (rest == null) return { ok: false, detail: `${f}: no rest for key ${r[5]}` };
      // the optional shard holds every subject; build.js keys a row by its own subject, which is its first copy's paper
      const paper = s === 'optional' ? copies.find(c => cid(c.u) === d.ids[r[1][0][0]]).p : { gs1: 'GS1', gs2: 'GS2', gs3: 'GS3', gs4: 'GS4', essay: 'Essay', other: 'Other' }[s];
      if (fnv(paper + '|' + r[0] + rest).toString(36) !== r[5]) return { ok: false, detail: `${f}: key ${r[5]} is not fnv(${paper}|full text)` };
      cut++;
    }
  }
  return { ok: true, detail: `${cut} long questions cut, every rest present and keyed by its practice id` };
});
check('INV-16', 'DECISION-27', 'A shard part carries no build date — its bytes change only when one of its questions does', () => {
  const bad = SHARDS.flatMap(shardFiles).filter(f => /"generated"/.test(read(f).slice(0, 200)));
  return { ok: !bad.length, detail: bad.length ? `${bad[0]} still has a generated stamp` : 'none do' };
});
check('INV-5', 'DECISION-20', 'upsckata.com is credited in README.md (repo-level provenance record only, per DECISION-20)', () => {
  const missing = ['README.md'].filter(f => !exists(f) || !/upsckata/i.test(read(f)));
  return { ok: !missing.length, detail: missing.length ? 'missing from: ' + missing.join(', ') : 'present' };
});
check('INV-6', 'INTENT-6', 'README does not claim optimisations the code does not have', () => {
  const css = read('assets/style.css'), html = read('index.html');
  const NEGATION = /\b(not|never|no |none|absent|without|rejected|claimed|does not|do not|deliberately|instead of|would)\b/i;
  const lines = read('README.md').split('\n').filter(l => !/^\s*>/.test(l) && !NEGATION.test(l));
  const claims = rx => lines.some(l => rx.test(l));
  const lies = [];
  if (claims(/content-visibility/i) && !/content-visibility/.test(css)) lies.push('content-visibility');
  if (claims(/\bprefetch/i) && !/prefetch/.test(html)) lies.push('a prefetch');
  if (claims(/both .{0,20}preload/i) && !/fraunces/i.test(html)) lies.push('both fonts preloaded');
  if (claims(/inverted index|qindex|index\.json|toppers\.json|qmeta|qtext/i)) lies.push('a data file or engine that no longer exists');
  return { ok: !lies.length, detail: lies.length ? 'README claims ' + lies.join(', ') : 'claims match the code' };
});
check('INV-7', 'INTENT-6', 'Nothing we serve links to a file we do not deploy', () => {
  const dep = read('.github/workflows/deploy.yml');
  const excluded = p => new RegExp("--exclude='/?" + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(dep);
  const broken = [];
  // Excluded from the deploy OR simply not written by this build (a 404 — llms.txt once linked questions-gs1.json
  // for two weeks after that shard was split into parts).
  const dead = p => /^(data|dataset)\//.test(p) && (excluded(p) || !exists(p.replace(/[?#].*$/, '')));
  if (exists('llms.txt')) for (const m of read('llms.txt').matchAll(/https:\/\/topperscopy\.hashin\.me\/([^\s)]+)/g)) if (dead(m[1]) || excluded(m[1])) broken.push('llms.txt -> ' + m[1]);
  for (const m of read('index.html').matchAll(/(?:href|src|contentUrl)="\/?((?:data|dataset)\/[^"]+)"/g)) if (dead(m[1]) || excluded(m[1])) broken.push('index.html -> ' + m[1]);
  return { ok: !broken.length, detail: broken.length ? broken.join(', ') : 'every linked data path is deployed' };
});

/* ---- architecture ---- */
check('INV-8', 'DECISION-2', 'No framework or bundler reaches the browser', () => {
  const js = read('assets/app.js');
  const hit = [/\bimport\s+[\w{*]/, /\brequire\s*\(/, /\bfrom\s+['"]react/, /webpack|rollup|esbuild|vite/i].some(r => r.test(js));
  return { ok: !hit, detail: hit ? 'app.js contains module/bundler syntax' : 'plain script' };
});
check('INV-9', 'DECISION-3', 'No blocking third-party script in <head>', () => {
  const head = read('index.html').split('</head>')[0];
  const ext = [...head.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/g)];
  const bad = ext.filter(m => /^https?:\/\//.test(m[1]) && !(/googletagmanager/.test(m[1]) && /\basync\b/.test(m[0])));
  // GA is injected after `load` + idle (PERF-AUDIT-2026-10-03 F7), so the head should have no external script at all.
  const lazyGa = /addEventListener\('load'[\s\S]*googletagmanager\.com\/gtag\/js/.test(head);
  return { ok: !bad.length && lazyGa, detail: bad.length ? 'blocking: ' + bad[0][1] : !lazyGa ? 'gtag.js is no longer loaded after the load event' : `${ext.length} external head script(s); gtag.js loads after load + idle` };
});
check('INV-10', 'DECISION-4', 'Every generated path is gitignored and untracked', () => {
  const ig = read('.gitignore');
  const notIgnored = GENERATED.filter(g => !ig.split('\n').includes(g));
  if (notIgnored.length) return { ok: false, detail: 'not in .gitignore: ' + notIgnored.join(' ') };
  let tracked = '';
  try { tracked = execFileSync('git', ['ls-files', '--', ...GENERATED.map(g => g.replace(/^\//, ''))], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return { ok: true, detail: `${GENERATED.length} paths ignored (git unavailable — tracking not checked)` }; }
  return { ok: !tracked, detail: tracked ? 'TRACKED: ' + tracked.split('\n').join(' ') : `${GENERATED.length} paths ignored, none tracked` };
});
check('INV-11', 'DECISION-8', 'tools/ and the source-only data files are excluded from the deployed site', () => {
  const dep = read('.github/workflows/deploy.yml');
  const missing = ['/tools', 'data/questions.csv', 'data/optionals.json', 'data/link-copies.json', 'data/interviews.json'].filter(p => !dep.includes(`--exclude='${p}'`));
  return { ok: !missing.length, detail: missing.length ? 'deploy.yml would publish: ' + missing.join(', ') : 'excluded' };
});
check('INV-12', 'INTENT-3', '#resultmeta is a live region', () => {
  const m = read('index.html').match(/<p[^>]*id="resultmeta"[^>]*>/);
  return { ok: !!(m && /aria-live/.test(m[0])), detail: m ? m[0] : 'element not found' };
});
check('INV-13', 'DECISION-19', 'Every interview in interview-list.json has its own data/iv/<id>.json transcript', () => {
  if (!exists('data/interview-list.json')) return { ok: false, detail: 'data/interview-list.json missing' };
  const L = JSON.parse(read('data/interview-list.json'));
  const bad = L.interviews.filter(x => !/^[A-Za-z0-9_-]+$/.test(x.i) || !exists(`data/iv/${x.i}.json`) || typeof JSON.parse(read(`data/iv/${x.i}.json`)) !== 'string');
  return { ok: !bad.length, detail: bad.length ? `${bad.length}/${L.interviews.length} have no matching text, e.g. ${bad[0].i}` : `${L.interviews.length}/${L.interviews.length} resolve` };
});

/* ---- budgets ---- */
for (const [name, b] of Object.entries(BUDGETS)) {
  check('BUDGET ' + name, 'INTENT-2', `${name} within ${b.ceiling} KB gzip`, () => {
    if (b.shard) {
      // The client fetches all of a paper's parts together, but as separate parallel
      // requests, so the ceiling applies to the LARGEST single part, not their sum.
      const files = shardFiles(b.shard);
      if (!files.length) return { ok: false, detail: `no questions-${b.shard}*.json found` };
      const sizes = files.map(f => [f, gzKb(f)]);
      const max = sizes.reduce((m, s) => (s[1] > m[1] ? s : m), sizes[0]);
      const label = files.length > 1 ? `${files.length} parts, largest ${max[0]}` : max[0];
      return { ok: max[1] <= b.ceiling, detail: `${label} at ${max[1].toFixed(1)} KB` + (b.why ? ' — ' + b.why : '') };
    }
    if (b.deepPart) {
      const sizes = SHARDS.flatMap(shardFiles).map(deepFile).filter(Boolean).map(f => [f, gzKb(f)]);
      const max = sizes.reduce((m, x) => (x[1] > m[1] ? x : m), ['none', 0]);
      return { ok: max[1] <= b.ceiling, detail: `${sizes.length} files, largest ${max[0]} at ${max[1].toFixed(1)} KB` + (b.why ? ' — ' + b.why : '') };
    }
    if (b.prefetch) {
      const parts = SHARDS.flatMap(shardFiles);
      const fl = parts.concat(b.deep ? parts.map(deepFile).filter(Boolean) : [], ['data/syllabus.json']);
      const kb = fl.reduce((t, f) => t + gzKb(f), 0);
      return { ok: kb <= b.ceiling, detail: `${kb.toFixed(1)} KB over ${fl.length} files` + (b.why ? ' — ' + b.why : '') };
    }
    const missing = b.files.filter(f => !exists(f));
    if (missing.length) return { ok: false, detail: 'missing: ' + missing.join(', ') };
    const kb = b.files.reduce((s, f) => s + gzKb(f), 0);
    return { ok: kb <= b.ceiling, detail: `${kb.toFixed(1)} KB` + (b.why ? ' — ' + b.why : '') };
  });
}

check('BUDGET interview text', 'INTENT-2', `every data/iv/<id>.json within ${INTERVIEW_TEXT_CEILING} KB gzip`, () => {
  const dir = path.join(ROOT, 'data/iv');
  if (!fs.existsSync(dir)) return { ok: false, detail: 'no data/iv/ found' };
  const files = fs.readdirSync(dir);
  let max = ['', 0];
  for (const f of files) { const kb = gzKb('data/iv/' + f); if (kb > max[1]) max = [f, kb]; }
  return { ok: max[1] <= INTERVIEW_TEXT_CEILING, detail: `${files.length} files, largest ${max[0]} at ${max[1].toFixed(1)} KB — fetched one at a time, only when that transcript is opened` };
});

/* ---- report ---- */
const failed = results.filter(r => !r.ok);
console.log("Topper's Copy by Hashin — invariant check\n");
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.title}\n       ${r.cites.padEnd(12)} ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passing`);
if (failed.length) { console.log('FAILED: ' + failed.map(r => r.id).join(', ')); process.exit(1); }
