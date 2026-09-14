/* The headline measurement: first paint, CLS, transfer, and cold-search latency.
   Usage: node tools/perf/measure.mjs [4g|3g|desktop] [gzip|br]              */
import { serve, openPage, PROFILES } from './_lib.mjs';

const profile = process.argv[2] || '4g';
const mode = process.argv[3] || 'gzip';
const P = PROFILES[profile];
if (!P) { console.error('unknown profile: ' + profile); process.exit(1); }

const srv = await serve(mode);
const { browser, page } = await openPage(profile);

const xfer = [];
page.on('response', r => {
  const len = +(r.headers()['content-length'] || 0);
  if (r.url().startsWith(srv.url) && len > 0) {
    xfer.push({ u: r.url().replace(srv.url, ''), enc: r.headers()['content-encoding'] || '-', bytes: len });
  }
});

await page.addInitScript(() => {
  window.__cls = 0;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
});

await page.goto(srv.url + '/', { waitUntil: 'commit' });
await page.waitForLoadState('load');

const vitals = await page.evaluate(() => new Promise(res => {
  const out = {};
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    out.ttfb = Math.round(nav.responseStart);
    out.load = Math.round(nav.loadEventEnd);
  } catch (e) {}
  try { performance.getEntriesByType('paint').forEach(e => {
    if (e.name === 'first-contentful-paint') out.fcp = Math.round(e.startTime); }); } catch (e) {}
  try { new PerformanceObserver(l => {
    const es = l.getEntries(); out.lcp = Math.round(es[es.length - 1].startTime);
  }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  setTimeout(() => { out.cls = +window.__cls.toFixed(4); res(out); }, 2500);
}));

const cards = await page.evaluate(() => document.querySelectorAll('#results .copy').length);

/* --- cold search: type as soon as the app is wired, and watch what the user is told --- */
const search = await page.evaluate(async () => {
  const q = document.querySelector('#q');
  q.focus();
  const t0 = performance.now();
  q.value = 'federalism';
  q.dispatchEvent(new Event('input', { bubbles: true }));
  let zeroAt = null, longest = 0;
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration); })
    .observe({ type: 'longtask', buffered: false }); } catch (e) {}
  const deadline = t0 + 90000;
  while (performance.now() < deadline) {
    const m = document.querySelector('#resultmeta');
    if (m) {
      const tx = m.textContent;
      if (zeroAt === null && /(^|\s)0 (copies|copy)/.test(tx)) zeroAt = Math.round(performance.now() - t0);
      if (tx.includes('federalism') && !/scanning|loading|Searching inside/i.test(tx)) {
        return { wait: Math.round(performance.now() - t0), zeroAt,
                 cards: document.querySelectorAll('#results .copy').length,
                 longest: Math.round(longest), meta: tx.slice(0, 120) };
      }
    }
    await new Promise(r => setTimeout(r, 30));
  }
  return { wait: -1, zeroAt, meta: 'TIMED OUT' };
});

const total = xfer.reduce((s, x) => s + x.bytes, 0);

console.log(`=== ${profile} / ${mode} · ${P.vw}x${P.vh} · CPU x${P.cpu} · ${(P.down * 8 / 1e6).toFixed(1)} Mbps · ${P.lat}ms RTT ===`);
console.log(`TTFB ${vitals.ttfb}ms   FCP ${vitals.fcp}ms   LCP ${vitals.lcp}ms   load ${vitals.load}ms   CLS ${vitals.cls}`);
console.log(`cards painted at load: ${cards}`);
console.log('');
console.log(`COLD SEARCH "federalism": usable results after ${search.wait}ms  (${search.cards} cards)`);
console.log(`  longest long task during search: ${search.longest}ms`);
console.log(`  showed "0 copies" at: ${search.zeroAt === null ? 'never  ✅' : '+' + search.zeroAt + 'ms  ❌ (see audit P1)'}`);
console.log(`  final meta: ${search.meta}`);
console.log('');
console.log('=== transfer (first-party) ===');
xfer.sort((a, b) => b.bytes - a.bytes).slice(0, 18)
  .forEach(x => console.log('  ' + (x.bytes / 1024).toFixed(1).padStart(8) + ' KB  ' + x.enc.padEnd(6) + x.u.slice(0, 60)));
console.log(`  TOTAL ${(total / 1024).toFixed(0)} KB across ${xfer.length} requests`);

await browser.close();
await srv.close();
