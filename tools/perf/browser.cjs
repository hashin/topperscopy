// Real-Chrome performance harness for topperscopy — cold / repeat visits under phone throttling (CDP).
// Written for docs/PERF-AUDIT-2026-10-04.md. Not a dependency of the site or of CI.
//   npm i --no-save playwright-core && node tools/perf/browser.cjs [baseUrl] [runsPerProfile]
// Uses the installed Google Chrome (channel 'chrome'). ONLY=<profile> runs one profile; NET=1 adds the request log.
// Cold runs block the service worker on purpose: once it controls the page, its own fetches are NOT
// covered by the page's network throttle, which would make slow-4G look ~3x faster than it is.
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'https://topperscopy.hashin.me/';
const RUNS = +process.argv[3] || 2;

const PROFILES = {
  desktop:  { cpu: 1, net: null },
  'phone-4g':   { cpu: 4, net: { latency: 60,  downloadThroughput: 9e6 / 8,   uploadThroughput: 1.5e6 / 8 } },
  'phone-slow4g': { cpu: 4, net: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8 } },
};

const INIT = `
  window.__p = { lt: [], ev: [], lcp: 0, fcp: 0, cards: 0, final: 0, firstMeta: '' };
  new PerformanceObserver(l => l.getEntries().forEach(e => __p.lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => __p.lcp = Math.round(e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => { if (e.name === 'first-contentful-paint') __p.fcp = Math.round(e.startTime); })).observe({ type: 'paint', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => __p.ev.push([e.name, Math.round(e.startTime), Math.round(e.duration), Math.round(e.processingStart - e.startTime)]))).observe({ type: 'event', durationThreshold: 16, buffered: true });
  (function poll() {
    var r = document.getElementById('results'), m = document.getElementById('resultmeta');
    if (r && !__p.cards && r.querySelector('article, .card, details')) __p.cards = Math.round(performance.now());
    if (m && location.search.indexOf('q=') >= 0 && !__p.final) {
      var t = m.textContent;
      if (/\\d/.test(t) && !/Searching|still scanning/.test(t)) { __p.final = Math.round(performance.now()); __p.finalMeta = t; }
    }
    if (!__p.final || !__p.cards) requestAnimationFrame(poll);
  })();
`;

async function run(browser, profName, path, opts = {}) {
  const prof = PROFILES[profName];
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: process.env.SW ? 'allow' : 'block' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (opts.bypassSW) await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  if (prof.net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...prof.net, connectionType: 'cellular4g' });
  let bytes = 0, reqs = 0, shardBytes = 0, lastShardEnd = 0; const urls = {};
  const t0 = Date.now();
  const net = []; let swBytes = 0;
  const onFin = async req => {
    try {
      const res = await req.response(); if (!res || res.fromServiceWorker()) return;
      const sz = await req.sizes(); const b = sz.responseBodySize + sz.responseHeadersSize;
      bytes += b; reqs++; if (req.serviceWorker()) swBytes += b;
      net.push([req.url().replace(BASE, '').slice(0, 60), Math.round(b / 1024), req.serviceWorker() ? 'sw' : 'page', Date.now() - t0]);
      if (/questions-|syllabus/.test(req.url())) { shardBytes += b; lastShardEnd = Date.now() - t0; }
    } catch (e) {}
  };
  ctx.on('requestfinished', onFin);
  await page.addInitScript(INIT);
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 120000 });
  // let search/prefetch settle: wait until no shard request for 4s (max 60s)
  let quietSince = Date.now(), lastBytes = -1;
  while (!opts.early && Date.now() - t0 < 60000) {
    await page.waitForTimeout(500);
    if (bytes !== lastBytes) { lastBytes = bytes; quietSince = Date.now(); }
    if (Date.now() - quietSince > 4000) break;
  }
  let typed = null;
  if (opts.type) {
    await page.click('#q');
    const ts = await page.evaluate(() => performance.now());
    await page.keyboard.type(opts.type, { delay: 120 });
    await page.waitForFunction(() => { var t = document.getElementById('resultmeta').textContent; return /\d/.test(t) && !/Searching|still scanning/.test(t) && location.search.indexOf('q=') >= 0; }, null, { timeout: 60000 });
    const te = await page.evaluate(() => performance.now());
    typed = { msFromFocusToFinal: Math.round(te - ts), meta: await page.$eval('#resultmeta', e => e.textContent) };
    if (opts.early) { await page.waitForTimeout(8000); }
  }
  const p = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { ...__p, dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), eff: (navigator.connection || {}).effectiveType, sw: !!navigator.serviceWorker.controller };
  });
  const heap = await cdp.send('Runtime.getHeapUsage');
  const tbt = p.lt.reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
  const maxLT = p.lt.reduce((m, [, d]) => Math.max(m, d), 0);
  const evs = p.ev.filter(e => /key|pointer|click|input/.test(e[0])); const worstEv = evs.reduce((m, e) => Math.max(m, e[2]), 0); const worstEvs = evs.sort((a,b)=>b[2]-a[2]).slice(0,3);
  const out = { prof: profName, path, sw: p.sw, eff: p.eff, fcp: p.fcp, lcp: p.lcp, dcl: p.dcl, load: p.load, cards: p.cards,
    final: p.final || null, finalMeta: (p.finalMeta || '').slice(0, 70), kbTotal: Math.round(bytes / 1024), reqs,
    kbShards: Math.round(shardBytes / 1024), shardsDoneMs: lastShardEnd, longTasks: p.lt.length, maxLT, tbt,
    worstInputMs: worstEv, worstEvs, heapMB: +(heap.usedSize / 1048576).toFixed(1), typed };
  ctx.off('requestfinished', onFin);
  out.swKB = Math.round(swBytes / 1024); if (process.env.NET) out.net = net;
  await page.close();
  if (!opts.ctx) await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  await run(browser, 'desktop', '');  // warm Chrome itself, discarded
  const only = process.env.ONLY;
  for (const prof of Object.keys(PROFILES)) {
    if (only && only !== prof) continue;
    for (let i = 0; i < RUNS; i++) {
      results.push(await run(browser, prof, ''));                       // cold home, idle prefetch
      results.push(await run(browser, prof, '?q=ethics'));              // cold deep-link search
      results.push(await run(browser, prof, '?q=federalism'));
      results.push(await run(browser, prof, '', { type: 'judicial activism' })); // cold home, settle, then type
      results.push({ ...(await run(browser, prof, '', { type: 'judicial activism', early: true })), path: '(type at load)' });
      // repeat visit: same context, SW installed by first visit
      const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
      await run(browser, prof, '', { ctx });
      results.push({ ...(await run(browser, prof, '?q=ethics', { ctx })), path: '?q=ethics (repeat)' });
      await ctx.close();
      console.error(prof, 'run', i + 1, 'done');
    }
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
