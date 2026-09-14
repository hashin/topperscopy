/* Verifies audit T2: copies.json and questions.json must start downloading together, not in
   series. Records the wall-clock moment each request is sent (Playwright's 'request' event,
   which fires as the request is dispatched) and reports the gap between them.
   Usage: node tools/perf/waterfall.mjs [4g|3g] */
import { serve, openPage, PROFILES } from './_lib.mjs';

const profile = process.argv[2] || '3g';
const P = PROFILES[profile];
if (!P) { console.error('unknown profile: ' + profile); process.exit(1); }

const srv = await serve('gzip');
const { browser, page } = await openPage(profile);

const starts = {};
page.on('request', r => {
  const u = r.url();
  if (u.startsWith(srv.url)) {
    const p = u.replace(srv.url, '').split('?')[0];
    if ((p === '/data/copies.json' || p === '/data/questions.json') && !(p in starts)) {
      starts[p] = Date.now();
    }
  }
});

await page.goto(srv.url + '/', { waitUntil: 'commit' });

// Warm both: focus the search box (ensureFull) and type (ensureQI) so both fetches fire,
// same as a real cold-search visitor.
await page.waitForSelector('#q', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#q').focus());
await page.waitForFunction(() => document.readyState === 'complete');
await page.evaluate(async () => {
  const q = document.querySelector('#q');
  q.value = 'federalism';
  q.dispatchEvent(new Event('input', { bubbles: true }));
});

const deadline = Date.now() + 20000;
while (Date.now() < deadline && !('/data/copies.json' in starts && '/data/questions.json' in starts)) {
  await new Promise(r => setTimeout(r, 25));
}

await browser.close();
await srv.close();

console.log(`=== waterfall (${profile}) ===`);
if (!('/data/copies.json' in starts) || !('/data/questions.json' in starts)) {
  console.log('one or both requests never started — cannot measure gap');
  console.log(starts);
  process.exit(1);
}
const gap = Math.abs(starts['/data/questions.json'] - starts['/data/copies.json']);
console.log(`copies.json request start:    +${starts['/data/copies.json'] - Math.min(...Object.values(starts))}ms (abs ${starts['/data/copies.json']})`);
console.log(`questions.json request start: +${starts['/data/questions.json'] - Math.min(...Object.values(starts))}ms (abs ${starts['/data/questions.json']})`);
console.log(`gap: ${gap}ms  ${gap <= 50 ? '✅ parallel (<= 50ms)' : '❌ serialised (> 50ms — see audit T2)'}`);
