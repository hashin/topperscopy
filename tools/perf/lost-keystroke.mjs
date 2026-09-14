/* Is a query typed before app.js boots adopted, or silently dropped? Audit P2. */
import { serve, openPage } from './_lib.mjs';
const srv = await serve('gzip');
const { browser, page } = await openPage('3g');
await page.goto(srv.url + '/', { waitUntil: 'commit' });
await page.waitForSelector('#q', { timeout: 30000 });
// type the instant the box exists — before app.js has necessarily wired it
await page.evaluate(() => { const q = document.querySelector('#q'); q.focus(); q.value = 'federalism'; });
await page.waitForTimeout(12000);
const r = await page.evaluate(() => ({
  box: document.querySelector('#q').value,
  meta: (document.querySelector('#resultmeta') || {}).textContent || '',
  cards: document.querySelectorAll('#results .copy').length
}));
const adopted = r.meta.includes('federalism');
console.log('=== query typed before app.js wired up ===');
console.log('  search box shows :', JSON.stringify(r.box));
console.log('  result meta      :', JSON.stringify(r.meta.slice(0, 90)));
console.log('  adopted =', adopted, adopted ? '✅' : '❌ the query was shown but never run — see audit P2');
await browser.close(); await srv.close();
