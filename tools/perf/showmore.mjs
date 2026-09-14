/* Does "Show more" keep the reader's place? Audit P4. */
import { serve, openPage, waitForApp } from './_lib.mjs';
const srv = await serve('gzip');
const { browser, page } = await openPage(process.argv[2] || '4g');
await page.goto(srv.url + '/', { waitUntil: 'load' });
await waitForApp(page);
await page.waitForFunction(() => document.querySelectorAll('#results .copy').length > 0, { timeout: 30000 });
await page.waitForTimeout(4000);
console.log('=== "Show more": does the page stay put? ===');
let worst = 0;
for (let i = 1; i <= 3; i++) {
  await page.evaluate(() => { const b = document.querySelector('#results .more'); if (b) b.scrollIntoView({ block: 'end' }); });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const cs = document.querySelectorAll('#results .copy'); const last = cs[cs.length - 1];
    return { y: Math.round(window.scrollY), anchor: last ? Math.round(last.getBoundingClientRect().top) : null, n: cs.length };
  });
  await page.evaluate(() => { const b = document.querySelector('#results .more'); if (b) b.click(); });
  await page.waitForTimeout(800);
  const after = await page.evaluate(n => {
    const cs = document.querySelectorAll('#results .copy'); const el = cs[n - 1];
    return { y: Math.round(window.scrollY), anchor: el ? Math.round(el.getBoundingClientRect().top) : null, n: cs.length };
  }, before.n);
  const drift = Math.abs((after.anchor ?? 0) - (before.anchor ?? 0));
  worst = Math.max(worst, drift);
  console.log(`  click ${i}: cards ${before.n}->${after.n} | scrollY ${before.y}->${after.y} | the card you were reading moved ${drift}px`);
}
console.log(`\nworst drift: ${worst}px  ${worst < 8 ? '✅' : '❌ (target < 8px — see audit P4)'}`);
await browser.close(); await srv.close();
