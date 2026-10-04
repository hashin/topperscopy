// DECISION-28 amendment test (PERF-AUDIT-2026-10-04 §6c): repeat visits with the service worker live — first visit browse-only,
// return-then-search, return via a ?q= link, third visit, and Save-Data (faked via navigator.connection). Link shaping comes from
// tools/perf/shaped-server.cjs (CDP throttling skips worker fetches); CPU 4x via CDP. Note: it uses page.route() to block GA,
// which disables Chrome's HTTP cache — that models a return after the 10-minute max-age, which is the case being measured.
//   ROOT=$PWD PORT=8763 BPS=1125000 RTT=60 node tools/perf/shaped-server.cjs &   then   node tools/perf/repeat.cjs http://localhost:8763/ new 2
const { chromium } = require('playwright-core');
const BASE = process.argv[2], LABEL = process.argv[3], RUNS = +process.argv[4] || 2;
const stats = async () => (await fetch(BASE + '__stats')).json();
const done = () => { const t = document.getElementById('resultmeta').textContent; return /\d/.test(t) && !/Searching|still scanning/.test(t) && location.search.indexOf('q=') >= 0; };
async function visit(ctx, path, act) {
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.route(/googletagmanager/, r => r.abort());
  await stats();
  await page.goto(BASE + path, { waitUntil: 'load' });
  const r = await act(page);
  await page.waitForTimeout(500);
  const s = await stats(); r.KB = Math.round(s.bytes / 1024); r.deep = s.files.filter(f => /deep/.test(f)).length; r.parts = s.files.filter(f => /questions-/.test(f) && !/deep/.test(f)).length;
  r.sw = await page.evaluate(() => !!navigator.serviceWorker.controller);
  await page.close(); return r;
}
const settle = async p => { await p.waitForTimeout(12000); return {}; };
const typeAfter = ms => async p => {
  await p.waitForTimeout(ms);
  await p.evaluate(() => document.getElementById('q').focus()); const t0 = Date.now();
  await p.keyboard.type('ethics', { delay: 120 });
  await p.waitForFunction(done, null, { timeout: 60000 });
  const r = { completeFromFocus: Date.now() - t0, meta: await p.$eval('#resultmeta', e => e.textContent.slice(0, 50)) };
  await p.waitForTimeout(6000); return r;
};
const deepLink = async p => { await p.waitForFunction(done, null, { timeout: 60000 }); const r = { complete: Math.round(await p.evaluate(() => performance.now())) }; await p.waitForTimeout(6000); return r; };
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const rows = [];
  for (let i = 0; i < RUNS; i++) {
    let ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
    rows.push(['A1 first visit, browse only', await visit(ctx, '', settle)]);
    rows.push(['A2 return: land, type after 4s', await visit(ctx, '', typeAfter(4000))]);
    rows.push(['A3 third visit, ?q=ethics', await visit(ctx, '?q=ethics', deepLink)]);
    await ctx.close();
    ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
    await visit(ctx, '', settle);
    rows.push(['B2 return via ?q=ethics link', await visit(ctx, '?q=ethics', deepLink)]);
    await ctx.close();
    ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }));
    rows.push(['C1 Save-Data first visit', await visit(ctx, '', settle)]);
    rows.push(['C2 Save-Data return, idle', await visit(ctx, '', settle)]);
    await ctx.close();
  }
  const by = {}; rows.forEach(([k, r]) => (by[k] = by[k] || []).push(r));
  for (const [k, rs] of Object.entries(by)) console.log(LABEL.padEnd(5), k.padEnd(32), rs.map(r => JSON.stringify(r)).join('  '));
  await b.close();
})();
