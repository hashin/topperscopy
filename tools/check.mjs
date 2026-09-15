/* Toppers Copy — the invariant check. `npm run check` (after `node build.js`).
 *
 * Every rule here exists because of something in docs/INTENT.md or docs/DECISIONS.md, and
 * docs/INVARIANTS.md lists them with the reason. Prints a table; exits non-zero on any failure.
 * Plain Node, no dependencies, no browser, ~2 seconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Gzip budgets in KB, as GitHub Pages serves them. Ceiling = measured on 2026-09-15 + ~10 %
// headroom, so nothing regresses quietly. When the corpus grows past a ceiling (OCR adds
// questions), raise it deliberately in the same commit and say why.
const BUDGETS = {
  boot: { ceiling: 450, files: ['index.html', 'assets/style.css', 'assets/app.js', 'assets/fonts/inter-latin.woff2', 'assets/fonts/fraunces-latin.woff2', 'data/copies.json'], why: 'everything before the first 25 cards paint — and every topper name is searchable (INTENT-2)' },
  'app.js': { ceiling: 23, files: ['assets/app.js'], why: 'DECISION-2: no framework, no bundler; growth here means machinery crept back' },
  'shard gs1': { ceiling: 200, files: ['data/questions-gs1.json'], why: 'the largest download a GS1 text query waits on (INTENT-2)' },
  'shard gs2': { ceiling: 180, files: ['data/questions-gs2.json'], why: '' },
  'shard gs3': { ceiling: 120, files: ['data/questions-gs3.json'], why: '' },
  'shard gs4': { ceiling: 690, files: ['data/questions-gs4.json'], why: 'GS4 case studies are long — this is the one to watch' },
  'shard essay': { ceiling: 25, files: ['data/questions-essay.json'], why: '' },
  'shard other': { ceiling: 30, files: ['data/questions-other.json'], why: '' },
  'shard optional': { ceiling: 20, files: ['data/questions-optional.json'], why: 'grows with the optional-subject OCR pass' }
};
// Every path build.js writes. Must be gitignored and never tracked (DECISION-4).
const GENERATED = ['/data/copies.json', '/data/questions-*.json', '/toppers.html', '/toppers-*.html', '/sitemap.xml',
  '/sitemap-main.xml', '/sitemap-toppers.xml', '/sitemap-questions.xml', '/sitemap-hubs.xml', '/llms.txt', '/robots.txt',
  '/topper/', '/question/', '/paper/', '/optional/', '/dataset/'];
const SHARDS = ['gs1', 'gs2', 'gs3', 'gs4', 'essay', 'other', 'optional'];

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const gzKb = f => zlib.gzipSync(fs.readFileSync(path.join(ROOT, f)), { level: 9 }).length / 1024;
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
  const urls = new Set(copies.map(c => c.u));
  let refs = 0, bad = 0, questions = 0;
  for (const s of SHARDS) {
    if (!exists(`data/questions-${s}.json`)) return { ok: false, detail: `data/questions-${s}.json missing` };
    const d = JSON.parse(read(`data/questions-${s}.json`));
    for (const q of d.questions.concat(d.fragments)) { questions++; for (const [i] of q[1]) { refs++; if (!urls.has(d.urls[i])) bad++; } }
  }
  return { ok: !bad, detail: `${refs} refs across ${questions} questions${bad ? ', ' + bad + ' point at no copy' : ', all resolve'}` };
});

/* ---- credit and honesty ---- */
check('INV-5', 'INTENT-4', 'upsckata.com is credited in index.html, README.md and llms.txt', () => {
  const missing = ['index.html', 'README.md', 'llms.txt'].filter(f => !exists(f) || !/upsckata/i.test(read(f)));
  return { ok: !missing.length, detail: missing.length ? 'missing from: ' + missing.join(', ') : 'present in all three' };
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
  if (exists('llms.txt')) for (const m of read('llms.txt').matchAll(/https:\/\/topperscopy\.hashin\.me\/([^\s)]+)/g)) if (excluded(m[1])) broken.push('llms.txt -> ' + m[1]);
  for (const m of read('index.html').matchAll(/(?:href|src|contentUrl)="\/?((?:data|dataset)\/[^"]+)"/g)) if (excluded(m[1])) broken.push('index.html -> ' + m[1]);
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
  return { ok: !bad.length, detail: bad.length ? 'blocking: ' + bad[0][1] : `${ext.length} external head script(s), all async GA` };
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
  const missing = ['/tools', 'data/questions.csv', 'data/optionals.json', 'data/link-copies.json'].filter(p => !dep.includes(`--exclude='${p}'`));
  return { ok: !missing.length, detail: missing.length ? 'deploy.yml would publish: ' + missing.join(', ') : 'excluded' };
});
check('INV-12', 'INTENT-3', '#resultmeta is a live region', () => {
  const m = read('index.html').match(/<p[^>]*id="resultmeta"[^>]*>/);
  return { ok: !!(m && /aria-live/.test(m[0])), detail: m ? m[0] : 'element not found' };
});

/* ---- budgets ---- */
for (const [name, b] of Object.entries(BUDGETS)) {
  check('BUDGET ' + name, 'INTENT-2', `${name} within ${b.ceiling} KB gzip`, () => {
    const missing = b.files.filter(f => !exists(f));
    if (missing.length) return { ok: false, detail: 'missing: ' + missing.join(', ') };
    const kb = b.files.reduce((s, f) => s + gzKb(f), 0);
    return { ok: kb <= b.ceiling, detail: `${kb.toFixed(1)} KB` + (b.why ? ' — ' + b.why : '') };
  });
}

/* ---- report ---- */
const failed = results.filter(r => !r.ok);
console.log('Toppers Copy — invariant check\n');
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(16)} ${r.title}\n       ${r.cites.padEnd(12)} ${r.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passing`);
if (failed.length) { console.log('FAILED: ' + failed.map(r => r.id).join(', ')); process.exit(1); }
