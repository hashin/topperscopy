/* Real long-task cost per keystroke in the search box. Audit R1.
 *
 * MEASUREMENT NOTE (DECISION-9). A throwaway, uncommitted check last session (typing "state"
 * letter-by-letter into an empty box) found ~0ms long tasks on steady-state keystrokes and one
 * ~52ms task only on the very first empty->query transition — but that check was a single run,
 * single query, and never committed, so it proves nothing on its own. This script is the real,
 * repeatable instrument: it installs a PerformanceObserver for `longtask` entries BEFORE
 * navigation (page.addInitScript, same reason lost-keystroke.mjs holds app.js in flight — by the
 * time a script running after load could attach an observer, early long tasks are already gone),
 * then times each individual keystroke's window on the PAGE's own performance.now() clock (not
 * Node's), so a long task is correctly attributed to the keystroke that caused it even under
 * network/CPU throttling.
 *
 * Tests two things per DECISION-9 ("a single query isn't enough"):
 *   1. The empty->query transition (first keystroke into an empty box) — this is the one the
 *      audit's own addendum flagged as still possibly slow even if steady-state typing is fine.
 *   2. Steady-state typing into an already-large, keystroke-varying result set, with a common
 *      term chosen to produce a big result set that changes size on every keystroke (the
 *      scenario a naive keyed-reconciliation skip could get wrong, and the one a rebuild-every-
 *      keystroke design pays for most).
 */
import { serve, openPage, waitForApp } from './_lib.mjs';

const QUERIES = ['state', 'commission'];   // two terms: one from last session's check, one new

const srv = await serve('gzip');
const { browser, page } = await openPage(process.argv[2] || '4g');

await page.addInitScript(() => {
  window.__tcLongtasks = [];
  try {
    new PerformanceObserver(list => {
      list.getEntries().forEach(e => window.__tcLongtasks.push({ start: e.startTime, dur: e.duration }));
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { window.__tcLongtasksUnsupported = String(e); }
});

await page.goto(srv.url + '/', { waitUntil: 'load' });
await waitForApp(page);
// let the initial boot (index.json render, idle-time full/index fetches) settle before measuring,
// so its own long tasks don't get misattributed to the first keystroke we type.
await page.waitForTimeout(4000);

async function clearBox() {
  await page.click('#q');
  await page.evaluate(() => { document.querySelector('#q').select(); });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(400);   // let the empty-query render settle before the next run
}

async function typeAndMeasure(text) {
  const perKey = [];
  for (let i = 0; i < text.length; i++) {
    const before = await page.evaluate(() => performance.now());
    await page.keyboard.type(text[i]);
    await page.waitForTimeout(400);   // 160ms debounce + render + generous settle margin
    const after = await page.evaluate(() => performance.now());
    const tasks = await page.evaluate(([a, b]) =>
      window.__tcLongtasks.filter(t => t.start >= a - 1 && t.start <= b), [before, after]);
    const worst = tasks.reduce((m, t) => Math.max(m, t.dur), 0);
    perKey.push({ key: text[i], upTo: text.slice(0, i + 1), worst, n: tasks.length });
  }
  return perKey;
}

console.log('=== long task per keystroke (audit R1) ===\n');
if (await page.evaluate(() => window.__tcLongtasksUnsupported)) {
  console.log('PerformanceObserver longtask unsupported in this browser — cannot measure.');
  await browser.close(); await srv.close();
  process.exit(1);
}

let worstEmpty = 0, worstSteady = 0;
for (const q of QUERIES) {
  await clearBox();
  const perKey = await typeAndMeasure(q);
  console.log(`query "${q}":`);
  perKey.forEach((k, i) => {
    const label = i === 0 ? 'empty->query' : 'steady-state ';
    console.log(`  ${label}  +"${k.key}" -> "${k.upTo}"   worst long task ${k.worst.toFixed(1)}ms` +
      (k.n > 1 ? ` (${k.n} tasks)` : ''));
    if (i === 0) worstEmpty = Math.max(worstEmpty, k.worst);
    else worstSteady = Math.max(worstSteady, k.worst);
  });
  const meta = await page.evaluate(() => (document.querySelector('#resultmeta') || {}).textContent || '');
  console.log(`  final: ${meta}\n`);
}

console.log(`worst empty->query transition : ${worstEmpty.toFixed(1)}ms`);
console.log(`worst steady-state keystroke  : ${worstSteady.toFixed(1)}ms`);
const threshold = 50;
const ok = worstEmpty < threshold && worstSteady < threshold;
console.log(`\n${ok ? '✅' : '❌'} both under ${threshold}ms at 25 cards` + (ok ? '' : ' — see audit R1'));

await browser.close(); await srv.close();
process.exit(ok ? 0 : 1);
