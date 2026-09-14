/* Measure the real collapsed card height, for content-visibility's contain-intrinsic-size.
   A wrong value trades paint cost for scrollbar jitter, which is worse. Audit P9(a). */
import { serve, openPage, waitForApp } from './_lib.mjs';
const srv = await serve('gzip');
for (const prof of ['4g', 'desktop']) {
  const { browser, page, P } = await openPage(prof);
  await page.goto(srv.url + '/', { waitUntil: 'load' });
  await waitForApp(page);
  await page.waitForFunction(() => document.querySelectorAll('#results .copy').length > 5, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('#results .copy')]
      .filter(c => !c.open).map(c => Math.round(c.getBoundingClientRect().height)).sort((a, b) => a - b);
    const p = q => hs[Math.floor(hs.length * q)];
    return { n: hs.length, min: hs[0], p50: p(0.5), p90: p(0.9), max: hs[hs.length - 1] };
  });
  console.log(`${prof.padEnd(8)} (${P.vw}px)  n=${r.n}  min ${r.min}  median ${r.p50}  p90 ${r.p90}  max ${r.max}`);
  await browser.close();
}
console.log('\nUse the MEDIAN for contain-intrinsic-size (per breakpoint if they differ much).');
await srv.close();
