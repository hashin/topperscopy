/* Toppers Copy — invariant checks.
 *
 * These are the rules from docs/INVARIANTS.md, made executable. Every check cites the
 * INTENT-n or DECISION-n it enforces, so a future session can see WHY the rule exists,
 * not just that it failed.
 *
 * Two statuses:
 *   enforced — must pass. A failure exits non-zero.
 *   tracked  — known-failing, tied to an open audit item. Reported, does not fail the run.
 *              Flip it to `enforced` in the same commit that makes it pass.
 *
 * Run:  npm run check          (static checks only — fast, no browser)
 *       npm run check:all      (also runs the browser checks)
 *
 * Requires `node build.js` to have been run, because it measures the real output.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WITH_BROWSER = process.argv.includes('--browser') || process.argv.includes('--all');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const gzKb = f => zlib.gzipSync(fs.readFileSync(path.join(ROOT, f)), { level: 9 }).length / 1024;

const results = [];
/** @param {string} id @param {string} status @param {string} cites @param {string} title */
function check(id, status, cites, title, fn) {
  let ok, detail = '';
  try { const r = fn(); ok = r === true || (r && r.ok); detail = (r && r.detail) || ''; }
  catch (e) { ok = false; detail = 'threw: ' + (e && e.message || e); }
  results.push({ id, status, cites, title, ok, detail });
}

/* ------------------------------------------------------------------ *
 * Ethics & data integrity — the things that must never break
 * ------------------------------------------------------------------ */

check('INV-1', 'enforced', 'INTENT-4', 'No answer copy is re-hosted on our own domain', () => {
  if (!exists('data/copies.json')) return { ok: false, detail: 'run `node build.js` first' };
  const { copies } = JSON.parse(read('data/copies.json'));
  const bad = copies.filter(c => /topperscopy\.hashin\.me|(^|\/)\/?data\//i.test(String(c.u || '')));
  return { ok: bad.length === 0, detail: bad.length ? `${bad.length} copies point at our own domain, e.g. ${bad[0].u}` : `${copies.length} copies, all third-party` };
});

check('INV-2', 'enforced', 'INTENT-4', 'upsckata.com credit is in the docs', () => {
  const missing = ['README.md', 'CLAUDE.md'].filter(f => !exists(f) || !/upsckata/i.test(read(f)));
  return { ok: missing.length === 0, detail: missing.length ? 'credit missing from: ' + missing.join(', ') : 'present in README + CLAUDE.md' };
});

check('INV-2b', 'enforced', 'INTENT-4 · AUDIT P11', 'upsckata.com credit is in llms.txt', () => {
  if (!exists('llms.txt')) return { ok: false, detail: 'run `node build.js` first' };
  const ok = /upsckata/i.test(read('llms.txt'));
  return { ok, detail: ok ? 'present' : 'absent — CLAUDE.md conventions require credit in llms.txt' };
});

check('INV-3', 'enforced', 'DECISION-5', 'Copy ids and question ids are unique', () => {
  if (!exists('data/copies.json')) return { ok: false, detail: 'run `node build.js` first' };
  const { copies } = JSON.parse(read('data/copies.json'));
  const ids = new Set(copies.map(c => c.i));
  const out = [`copies ${ids.size}/${copies.length}`];
  let ok = ids.size === copies.length;
  if (exists('data/qmeta.json')) {
    const { questions } = JSON.parse(read('data/qmeta.json'));
    const qids = new Set(questions.map(q => q.i));
    out.push(`questions ${qids.size}/${questions.length}`);
    ok = ok && qids.size === questions.length;
  }
  return { ok, detail: out.join(' · ') };
});

check('INV-4', 'enforced', 'INTENT-5', 'No copy link uses a script-capable URL scheme', () => {
  if (!exists('data/copies.json')) return { ok: false, detail: 'run `node build.js` first' };
  const { copies } = JSON.parse(read('data/copies.json'));
  const bad = copies.filter(c => !/^https?:\/\//i.test(String(c.u || '')));
  return { ok: bad.length === 0, detail: bad.length ? `${bad.length} non-http(s) URLs, e.g. ${String(bad[0].u).slice(0, 60)}` : 'all https/http' };
});

/* ------------------------------------------------------------------ *
 * Architecture — the constraints that keep this free and static
 * ------------------------------------------------------------------ */

check('INV-5', 'enforced', 'DECISION-2', 'No framework or bundler reaches the browser', () => {
  const js = read('assets/app.js');
  const banned = [/\bimport\s+[\w{*]/, /\brequire\s*\(/, /\bfrom\s+['"]react/, /webpack|rollup|esbuild|vite/i];
  const hit = banned.filter(r => r.test(js));
  return { ok: hit.length === 0, detail: hit.length ? 'app.js contains module/bundler syntax' : 'plain script, no module syntax' };
});

check('INV-6', 'enforced', 'DECISION-3', 'No third-party script loads during first paint', () => {
  const html = read('index.html');
  // Everything in <head> before </head>: only GA may be external, and only async.
  const head = html.slice(0, html.indexOf('</head>'));
  const ext = [...head.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/g)];
  const bad = ext.filter(m => /^https?:\/\//.test(m[1]) && !(/googletagmanager/.test(m[1]) && /\basync\b/.test(m[0])));
  return { ok: bad.length === 0, detail: bad.length ? 'blocking third-party script: ' + bad[0][1] : `${ext.length} external head script(s), all async GA` };
});

check('INV-7', 'enforced', 'DECISION-4', 'Every generated artefact is gitignored', () => {
  const ig = read('.gitignore');
  const generated = ['/data/copies.json', '/data/index.json',
    '/data/qmeta.json', '/data/qtext.json',
    '/data/toppers.json', '/toppers.html', '/sitemap.xml', '/llms.txt', '/robots.txt',
    '/topper/', '/question/', '/paper/', '/optional/', '/dataset/'];
  const missing = generated.filter(g => !ig.includes(g));
  return { ok: missing.length === 0, detail: missing.length ? 'not ignored: ' + missing.join(' ') : `${generated.length} paths ignored` };
});

check('INV-8', 'enforced', 'DECISION-4', 'No generated artefact is tracked by git', () => {
  // Cheap proxy: these must not be in the index. Requires git; skip gracefully if absent.
  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', 'data/copies.json',
      'data/qmeta.json', 'data/qtext.json',
      'toppers.html', 'sitemap.xml', 'llms.txt', 'dataset'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { return { ok: true, detail: 'git unavailable — skipped' }; }
  return { ok: !tracked, detail: tracked ? 'TRACKED (must not be): ' + tracked.split('\n').join(' ') : 'none tracked' };
});

check('INV-9', 'enforced', 'DECISION-8', 'tools/ is excluded from the deployed site', () => {
  const dep = read('.github/workflows/deploy.yml');
  return { ok: /--exclude='\/tools'/.test(dep), detail: /--exclude='\/tools'/.test(dep) ? 'excluded' : 'tools/ would be published to the live site' };
});

/* ------------------------------------------------------------------ *
 * Performance budgets — INTENT-2: speed IS the product
 * ------------------------------------------------------------------ */

const budget = JSON.parse(read('tools/check/budget.json'));
for (const [name, b] of Object.entries(budget.budgets)) {
  const present = b.files.filter(exists);
  check(`BUDGET-${name}`, 'enforced', 'INTENT-2', `${name} payload within ${b.ceiling_kb} KB gzip`, () => {
    if (!present.length) return { ok: false, detail: 'no files found — run `node build.js`' };
    const kb = present.reduce((s, f) => s + gzKb(f), 0);
    const arrow = kb <= b.target_kb ? '✅ at target' : `target ${b.target_kb} KB`;
    return { ok: kb <= b.ceiling_kb, detail: `${kb.toFixed(1)} KB / ceiling ${b.ceiling_kb} KB · ${arrow}` };
  });
}

/* ------------------------------------------------------------------ *
 * UX invariants — INTENT-3: it must feel smooth, on a cheap phone
 * These are TRACKED until the audit phases land, then flip to enforced.
 * ------------------------------------------------------------------ */

check('INV-10', 'enforced', 'INTENT-3 · AUDIT P7', '#resultmeta is a live region', () => {
  const html = read('index.html');
  const m = html.match(/<p[^>]*id="resultmeta"[^>]*>/);
  return { ok: !!(m && /aria-live/.test(m[0])), detail: m ? m[0] : 'element not found' };
});

check('INV-11', 'enforced', 'INTENT-3 · AUDIT P3', '#statline and #papers reserve their height', () => {
  const css = read('assets/style.css');
  const ok = /\.statline\s*\{[^}]*min-height/.test(css) && /#papers\s*\{[^}]*min-height/.test(css);
  return { ok, detail: ok ? 'both reserved' : 'no min-height — causes the measured CLS 0.193' };
});

check('INV-12', 'enforced', 'INTENT-3 · AUDIT P8', 'extract.js is not on the critical path', () => {
  const html = read('index.html');
  const ok = !/<script[^>]*assets\/extract\.js/.test(html);
  return { ok, detail: ok ? 'lazy-loaded' : 'still eagerly loaded in index.html for every visitor' };
});

check('INV-13', 'enforced', 'INTENT-2 · AUDIT D1', 'data/questions.csv is not deployed', () => {
  const dep = read('.github/workflows/deploy.yml');
  const ok = /--exclude='data\/questions\.csv'/.test(dep);
  return { ok, detail: ok ? 'excluded' : '8.94 MB shipped to the live site, fetched by nothing' };
});

check('INV-14', 'tracked', 'INTENT-3 · AUDIT R3', 'A search is reflected in the URL', () => {
  const js = read('assets/app.js');
  // history.replaceState alone is not enough - it is already used for TAB routing (#browse,
  // #submit). The query specifically must reach the URL.
  const ok = /searchParams\.(set|delete)\(\s*['"]q['"]/.test(js);
  return { ok, detail: ok ? 'the query reaches the URL' : 'searches are not shareable and Back does not undo them (the existing replaceState is tab routing only)' };
});

check('INV-14b', 'enforced', 'INTENT-6 · AUDIT D1', 'Nothing we serve links to a file we do not deploy', () => {
  const dep = read('.github/workflows/deploy.yml');
  const excluded = p => new RegExp("--exclude='/?" + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(dep);
  const broken = [];
  // llms.txt uses absolute URLs; index.html uses relative/absolute hrefs. Check both — the
  // About tab linked to data/questions.csv and would have 404'd the moment D1 landed.
  if (exists('llms.txt')) {
    for (const m of read('llms.txt').matchAll(/https:\/\/topperscopy\.hashin\.me\/([^\s)]+)/g))
      if (excluded(m[1])) broken.push('llms.txt -> ' + m[1]);
  }
  for (const m of read('index.html').matchAll(/(?:href|src|contentUrl)="\/?((?:data|dataset)\/[^"]+)"/g))
    if (excluded(m[1])) broken.push('index.html -> ' + m[1]);
  return { ok: broken.length === 0, detail: broken.length ? 'links to un-deployed file(s): ' + broken.join(', ') : 'every linked data path is deployed' };
});

check('INV-18', 'enforced', 'INTENT-3 · AUDIT P2', 'boot() adopts a query already in the search box', () => {
  // Static guard only. The real test is tools/perf/lost-keystroke.mjs, which holds app.js in
  // flight to reproduce the window — you cannot reach it by waiting for #q, because deferred
  // scripts run before DOMContentLoaded and the app has already booted by then.
  const js = read('assets/app.js');
  const ok = /if \(!qp && qi && qi\.value\) qp = qi\.value;/.test(js);
  return { ok, detail: ok ? 'adopted (full check: node tools/perf/lost-keystroke.mjs)'
                          : 'a query typed before app.js boots would be shown but never run' };
});

check('INV-15', 'enforced', 'INTENT-6 · AUDIT P9', 'Docs do not claim optimisations that are absent', () => {
  if (!exists('README.md')) return { ok: true, detail: 'no README' };
  const css = read('assets/style.css');
  const html = read('index.html');
  // A README may legitimately DISCUSS an optimisation it does not have (to say it is absent, or
  // why it was rejected). Only an affirmative claim counts as a lie: a non-blockquote line that
  // names the technique with no negation in it.
  const NEGATION = /\b(not|never|no |none|absent|without|rejected|claimed|does not|do not|deliberately|instead of|would)\b/i;
  const claimLines = read('README.md').split('\n')
    .filter(l => !/^\s*>/.test(l))          // blockquotes are commentary, not claims
    .filter(l => !NEGATION.test(l));
  const claims = t => claimLines.some(l => t.test(l));
  const lies = [];
  if (claims(/content-visibility/i) && !/content-visibility/.test(css))
    lies.push('README claims content-visibility; assets/style.css has none');
  if (claims(/\bprefetch/i) && !/prefetch/.test(html))
    lies.push('README claims a prefetch; index.html has none');
  if (claims(/both .{0,20}preload/i) && !/fraunces/i.test(html))
    lies.push('README claims both fonts are preloaded; only Inter is');
  return { ok: lies.length === 0, detail: lies.length ? lies.join(' | ') : 'README claims match the code' };
});

/* ------------------------------------------------------------------ *
 * Browser checks (opt-in — needs Chromium)
 * ------------------------------------------------------------------ */

if (WITH_BROWSER) {
  const { serve, openPage, waitForApp } = await import('../perf/_lib.mjs');
  const srv = await serve('gzip');
  // Slow 3G on purpose: the layout shift and the false-zero only appear when the data takes
  // long enough to arrive. On 4G both measure clean and the check would pass falsely.
  const { browser, page } = await openPage('3g');
  await page.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  });
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await waitForApp(page);
  const probe = await page.evaluate(async () => {
    const q = document.querySelector('#q');
    q.focus(); q.value = 'federalism'; q.dispatchEvent(new Event('input', { bubbles: true }));
    let sawZero = false;
    const end = performance.now() + 60000;
    while (performance.now() < end) {
      const m = document.querySelector('#resultmeta');
      if (m) {
        if (/(^|\s)0 (copies|copy)/.test(m.textContent)) sawZero = true;
        if (m.textContent.includes('federalism') && !/scanning|loading|Searching inside/i.test(m.textContent)) break;
      }
      await new Promise(r => setTimeout(r, 30));
    }
    await new Promise(r => setTimeout(r, 1200));
    return { sawZero, cls: +window.__cls.toFixed(4) };
  });
  // P4: Show-more must append, not rebuild. Node identity is the reliable signal — scroll
  // measurements here are dominated by `html { scroll-behavior: smooth }` unless you scroll
  // with behavior:'instant' and wait for it to settle (see tools/perf/showmore.mjs).
  const more = await page.evaluate(async () => {
    const box = document.querySelector('#results');
    const b = box.querySelector('.more');
    if (!b) return { skip: true };
    [...box.querySelectorAll('.copy')].forEach((c, i) => { c.dataset.tcTag = 'g' + i; });
    const n0 = box.querySelectorAll('.copy').length;
    b.click();
    await new Promise(r => setTimeout(r, 900));
    const cards = [...box.querySelectorAll('.copy')];
    return { n0, n1: cards.length, kept: cards.filter(c => c.dataset.tcTag !== undefined).length };
  });
  check('INV-19', 'enforced', 'INTENT-3 · AUDIT P4', 'Show more appends instead of rebuilding the list', () =>
    more.skip ? { ok: true, detail: 'no Show-more button to test' }
              : { ok: more.kept === more.n0 && more.n1 > more.n0,
                  detail: `${more.n0} -> ${more.n1} cards, ${more.kept}/${more.n0} originals kept` });

  check('INV-16', 'enforced', 'INTENT-3 · AUDIT P1', 'Never shows "0 copies" while the index is loading', () =>
    ({ ok: !probe.sawZero, detail: probe.sawZero ? 'showed "0 copies" mid-load — reads as "not here" and the student leaves' : 'never showed a false zero' }));
  check('INV-17', 'enforced', 'INTENT-3 · AUDIT P3', 'CLS within Google\'s "good" threshold (<= 0.1) on slow 3G', () =>
    ({ ok: probe.cls <= 0.1, detail: `CLS ${probe.cls}` }));
  await browser.close(); await srv.close();
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const enforced = results.filter(r => r.status === 'enforced');
const tracked = results.filter(r => r.status === 'tracked');
const failedEnforced = enforced.filter(r => !r.ok);

const line = r => `  ${r.ok ? '✅' : (r.status === 'enforced' ? '❌' : '⏳')} ${r.id.padEnd(14)} ${r.title}\n     ${r.cites.padEnd(22)} ${r.detail}`;
console.log('Toppers Copy — invariant check\n');
console.log('ENFORCED (a failure here is a bug, and fails this command)');
enforced.forEach(r => console.log(line(r)));
if (tracked.length) {
  console.log('\nTRACKED (known-failing, tied to an open audit item — flip to `enforced` when fixed)');
  tracked.forEach(r => console.log(line(r)));
}
const done = tracked.filter(r => r.ok).length;
console.log(`\n${enforced.length - failedEnforced.length}/${enforced.length} enforced passing · ${done}/${tracked.length} tracked now passing`);
if (done) console.log(`\n${done} tracked invariant(s) now pass — promote them to 'enforced' in tools/check/invariants.mjs and tick the item in PERF-UX-AUDIT-2026-09-14.md.`);
if (!WITH_BROWSER) console.log('\n(browser checks skipped — run `npm run check:all` for those)');
if (failedEnforced.length) { console.log(`\nFAILED: ${failedEnforced.map(r => r.id).join(', ')}`); process.exit(1); }
