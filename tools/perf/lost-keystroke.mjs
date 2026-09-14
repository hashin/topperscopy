/* Is a query typed before app.js boots adopted, or silently dropped? Audit P2.
 *
 * MEASUREMENT NOTE. You cannot reproduce this by waiting for #q and then typing: deferred
 * scripts run BEFORE DOMContentLoaded, and Playwright's waitForSelector resolves later than
 * that against a local server — app.js has already booted, so the bug never shows and the test
 * reports a false PASS/FAIL depending on timing. The window only exists while app.js is still
 * in flight, so we hold its response open, type into the box, and then release it.
 */
import { serve, openPage } from './_lib.mjs';

const srv = await serve('gzip');
const { browser, page } = await openPage('3g');

let release;
const held = new Promise(r => { release = r; });
await page.route('**/assets/app.js', async route => {
  await held;                       // keep app.js in flight until we have typed
  await route.continue();
});

await page.goto(srv.url + '/', { waitUntil: 'commit' });
await page.waitForSelector('#q', { timeout: 30000 });
await page.waitForTimeout(500);

const pre = await page.evaluate(() => {
  const q = document.querySelector('#q');
  q.focus();
  q.value = 'federalism';           // typed while app.js has not executed yet
  return { booted: typeof window.__tcBooted !== 'undefined',
           meta: (document.querySelector('#resultmeta') || {}).textContent || '' };
});
release();                          // now let app.js load and boot

await page.waitForFunction(() => {
  const m = document.querySelector('#resultmeta');
  return m && m.textContent.trim().length > 0;
}, { timeout: 60000 });
await page.waitForTimeout(9000);

const r = await page.evaluate(() => ({
  box: document.querySelector('#q').value,
  meta: (document.querySelector('#resultmeta') || {}).textContent || '',
  cards: document.querySelectorAll('#results .copy').length
}));
const adopted = r.meta.includes('federalism') || /Searching inside/.test(r.meta);
console.log('=== query typed while app.js was still in flight ===');
console.log('  result meta at type time :', JSON.stringify(pre.meta));
console.log('  search box now           :', JSON.stringify(r.box));
console.log('  result meta now          :', JSON.stringify(r.meta.slice(0, 90)));
console.log('  cards                    :', r.cards);
console.log('\n  adopted =', adopted, adopted ? '✅' : '❌ the query was shown but never run — see audit P2');
await browser.close(); await srv.close();
