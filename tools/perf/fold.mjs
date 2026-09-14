/* What is visible without scrolling? Audit R2. */
import { serve, openPage, waitForApp } from './_lib.mjs';
const srv = await serve('gzip');
for (const prof of ['4g', 'desktop']) {
  const { browser, page, P } = await openPage(prof);
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await waitForApp(page);
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => {
    const vh = window.innerHeight;
    const vis = el => { if (!el) return false; const b = el.getBoundingClientRect(); return b.top < vh && b.bottom > 0; };
    let n = 0; document.querySelectorAll('#results .copy').forEach(c => { if (vis(c)) n++; });
    const q = document.querySelector('#q');
    return { vh, searchVisible: vis(q), searchTop: q ? Math.round(q.getBoundingClientRect().top) : -1,
             cardsAboveFold: n, resultsTop: Math.round((document.querySelector('#results') || {}).getBoundingClientRect?.().top ?? -1) };
  });
  console.log(`=== ${prof} (${P.vw}x${P.vh}) ===`);
  console.log(`  search box visible: ${r.searchVisible ? '✅' : '❌'} (top at ${r.searchTop}px of ${r.vh}px)`);
  console.log(`  result cards above the fold: ${r.cardsAboveFold} ${r.cardsAboveFold >= 1 ? '✅' : '❌ — see audit R2'}`);
  await browser.close();
}
await srv.close();
