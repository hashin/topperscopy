/* gzip (GitHub Pages) vs brotli (Cloudflare/Netlify/Vercel), end to end. Audit D2. */
import { serve, openPage } from './_lib.mjs';
const profile = process.argv[2] || '4g';
const out = [];
for (const mode of ['gzip', 'br']) {
  const srv = await serve(mode);
  const { browser, page } = await openPage(profile);
  let bytes = 0;
  page.on('response', r => { if (r.url().startsWith(srv.url)) bytes += +(r.headers()['content-length'] || 0); });
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await page.evaluate(() => { const q = document.querySelector('#q'); if (q) { q.focus(); q.value = 'federalism'; q.dispatchEvent(new Event('input', { bubbles: true })); } });
  await page.waitForFunction(() => { const m = document.querySelector('#resultmeta'); return m && m.textContent.includes('federalism') && !/scanning|loading|Searching inside/i.test(m.textContent); }, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out.push({ mode, bytes });
  await browser.close(); await srv.close();
}
console.log(`=== total first-party transfer to a usable search (${profile}) ===`);
out.forEach(o => console.log(`  ${o.mode.padEnd(5)} ${(o.bytes / 1024).toFixed(0).padStart(6)} KB`));
const saved = out[0].bytes - out[1].bytes;
console.log(`\n  brotli saves ${(saved / 1024).toFixed(0)} KB  (${(saved / out[0].bytes * 100).toFixed(0)}%)`);
console.log('  GitHub Pages serves gzip only. See audit D2 for the hosting options.');
