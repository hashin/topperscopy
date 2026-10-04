// DECISION-29 test: does the service worker end up holding every shard file, with nothing downloaded twice?
// Needs tools/perf/shaped-server.cjs serving a built site:  ROOT=$PWD PORT=8772 [BPS=200000 RTT=150] node tools/perf/shaped-server.cjs
// then:  npm i --no-save playwright-core && node tools/perf/claim.cjs http://localhost:8772/ label
// Pre-claim cache gap test. No page.route (it would disable Chrome's HTTP cache). Server counts every 200 it sends.
const { chromium } = require('playwright-core');
const BASE = process.argv[2], LABEL = process.argv[3];
const stats = async () => (await fetch(BASE + '__stats')).json();
const done = () => { const t = document.getElementById('resultmeta').textContent; return /\d/.test(t) && !/Searching|still scanning/.test(t); };
(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const errs = [];
  async function visit(ctx, path, opts = {}) {
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p);
    if (opts.clearHttp) await cdp.send('Network.clearBrowserCache');   // HTTP cache only; Cache Storage (the worker's) survives
    await stats();
    await p.goto(BASE + path, { waitUntil: 'load' });
    if (opts.search) await p.waitForFunction(done, null, { timeout: 30000 });
    await p.waitForTimeout(12000);
    const s = await stats();
    const sent = s.files.filter(f => /questions-/.test(f));
    const dup = sent.filter((f, i) => sent.indexOf(f) !== i);
    const cache = await p.evaluate(async () => { let parts = 0, deep = 0; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) { if (/questions-.*-deep/.test(r.url)) deep++; else if (/questions-/.test(r.url)) parts++; } return { parts, deep, keys: await caches.keys() }; });
    const meta = await p.$eval('#resultmeta', e => e.textContent.slice(0, 45));
    await p.close();
    return `sent: ${sent.filter(f => !/deep/.test(f)).length} parts + ${sent.filter(f => /deep/.test(f)).length} deep${dup.length ? ' (DUPLICATES: ' + dup.join(' ') + ')' : ''} · worker cache: ${cache.parts} parts + ${cache.deep} deep [${cache.keys}] · ${meta}`;
  }
  let ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  console.log(LABEL, 'A1 first visit /            ', await visit(ctx, ''));
  console.log(LABEL, 'A2 return / (HTTP cache gone)', await visit(ctx, '', { clearHttp: true }));
  console.log(LABEL, 'A3 ?q=ethics (HTTP cache gone)', await visit(ctx, '?q=ethics', { clearHttp: true, search: true }));
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  console.log(LABEL, 'D1 first visit ?q=ethics    ', await visit(ctx, '?q=ethics', { search: true }));
  console.log(LABEL, 'D2 return ?q=federalism (HTTP cache gone)', await visit(ctx, '?q=federalism', { clearHttp: true, search: true }));
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
  console.log(LABEL, 'U1 first visit /            ', await visit(ctx, ''));
  await fetch(BASE + '__swbump');
  console.log(LABEL, 'U2 / with a new sw.js       ', await visit(ctx, ''));
  console.log(LABEL, 'U3 return / (HTTP cache gone)', await visit(ctx, '', { clearHttp: true }));
  await ctx.close();
  console.log(LABEL, 'page errors:', errs.length ? errs : 'none'); await b.close();
})();
