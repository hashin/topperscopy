/* Verifies audit T2 (extended for T3): copies.json, qmeta.json and qtext.json must all start
   downloading together, not in series. T3 split what T2 originally checked as a single
   "questions.json" into two files (qmeta.json + qtext.json); both still need to start alongside
   copies.json for T2's win to hold. Records the wall-clock moment each request is sent
   (Playwright's 'request' event, which fires as the request is dispatched) and reports the gap.
   Usage: node tools/perf/waterfall.mjs [4g|3g] */
import { serve, openPage, PROFILES } from './_lib.mjs';

const profile = process.argv[2] || '3g';
const P = PROFILES[profile];
if (!P) { console.error('unknown profile: ' + profile); process.exit(1); }

const FILES = ['/data/copies.json', '/data/qmeta.json', '/data/qtext.json'];

const srv = await serve('gzip');
const { browser, page } = await openPage(profile);

const starts = {};
page.on('request', r => {
  const u = r.url();
  if (u.startsWith(srv.url)) {
    const p = u.replace(srv.url, '').split('?')[0];
    if (FILES.includes(p) && !(p in starts)) starts[p] = Date.now();
  }
});

await page.goto(srv.url + '/', { waitUntil: 'commit' });

// Warm both: focus the search box (ensureFull) and type (ensureQI, which now also triggers
// ensureQText) so all three fetches fire, same as a real cold-search visitor.
await page.waitForSelector('#q', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#q').focus());
await page.waitForFunction(() => document.readyState === 'complete');
await page.evaluate(async () => {
  const q = document.querySelector('#q');
  q.value = 'federalism';
  q.dispatchEvent(new Event('input', { bubbles: true }));
});

const deadline = Date.now() + 20000;
while (Date.now() < deadline && FILES.some(f => !(f in starts))) {
  await new Promise(r => setTimeout(r, 25));
}

await browser.close();
await srv.close();

console.log(`=== waterfall (${profile}) ===`);
const missing = FILES.filter(f => !(f in starts));
if (missing.length) {
  console.log('never started: ' + missing.join(', '));
  console.log(starts);
  process.exit(1);
}
const t0 = Math.min(...FILES.map(f => starts[f]));
FILES.forEach(f => console.log(`${f} request start: +${starts[f] - t0}ms (abs ${starts[f]})`));
const gap = Math.max(...FILES.map(f => starts[f])) - t0;
console.log(`max gap: ${gap}ms  ${gap <= 50 ? '✅ parallel (<= 50ms)' : '❌ serialised (> 50ms — see audit T2/T3)'}`);
if (gap > 50) process.exit(1);
