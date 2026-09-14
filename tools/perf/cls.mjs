/* Attribute every layout shift to the DOM nodes that moved. Audit P3. */
import { serve, openPage } from './_lib.mjs';
const profile = process.argv[2] || '3g';
const srv = await serve('gzip');
const { browser, page } = await openPage(profile);
await page.addInitScript(() => {
  window.__shifts = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) {
    if (e.hadRecentInput) continue;
    window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4),
      nodes: (e.sources || []).map(s => { const n = s.node; if (!n) return '(detached)';
        const id = n.id ? '#' + n.id : '';
        const cl = (n.className && typeof n.className === 'string')
          ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        return `${(n.tagName || '?').toLowerCase()}${id}${cl}  y ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)}  h ${Math.round(s.previousRect.height)}->${Math.round(s.currentRect.height)}`; }) });
  } }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
});
await page.goto(srv.url + '/', { waitUntil: 'load' });
await page.waitForTimeout(7000);
const shifts = await page.evaluate(() => window.__shifts);
const total = shifts.reduce((s, x) => s + x.v, 0);
console.log(`=== layout shifts (${profile}, mobile) — total CLS ${total.toFixed(4)} ${total <= 0.05 ? '✅' : total <= 0.1 ? '⚠️ ' : '❌ (Google "good" is <= 0.1)'} ===`);
shifts.sort((a, b) => b.v - a.v).forEach(s => {
  console.log(`  t=${s.t}ms  value=${s.v}`);
  s.nodes.forEach(n => console.log('      ' + n));
});
if (!shifts.length) console.log('  (none)');
await browser.close(); await srv.close();
