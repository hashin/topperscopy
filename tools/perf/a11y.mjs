/* Status-message and tap-target checks. Audit P7. */
import { serve, openPage, waitForApp } from './_lib.mjs';
const srv = await serve('gzip');
const { browser, page } = await openPage('4g');
await page.goto(srv.url + '/', { waitUntil: 'load' });
await waitForApp(page);
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const m = document.querySelector('#resultmeta');
  const small = [];
  document.querySelectorAll('button,summary,input,select,[role=button]').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width && b.height && (b.height < 24 || b.width < 24))
      small.push((el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '') + ` ${Math.round(b.width)}x${Math.round(b.height)}`);
  });
  const d = document.querySelector('#practice');
  return { live: m && m.getAttribute('aria-live'), atomic: m && m.getAttribute('aria-atomic'),
           role: m && m.getAttribute('role'), small: [...new Set(small)],
           dialogLabel: d && (d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')) };
});
console.log('=== accessibility ===');
console.log('  resultmeta live region =', r.live || 'NONE', r.live ? '✅' : '❌ screen readers hear nothing on search — see audit P7');
console.log('  resultmeta role/atomic =', r.role, '/', r.atomic);
console.log('  practice dialog label  =', r.dialogLabel || 'NONE', r.dialogLabel ? '✅' : '❌');
console.log('  controls under 24px    =', r.small.length ? r.small.join(' | ') : 'none ✅');
await browser.close(); await srv.close();
