/* Does "Show more" keep the reader's place? Audit P4.
 *
 * MEASUREMENT NOTE — read before changing this file. An earlier version scrolled with
 * more.scrollIntoView({block:'end'}) and then clicked that same button. The click removes the
 * button, and the browser's scroll anchoring around the removed element produced a ~785px
 * "drift" REGARDLESS of implementation — it reported the identical number before and after the
 * fix, and nearly caused working code to be "fixed". Measure instead:
 *   1. node identity: do the original cards survive, or were they rebuilt?
 *   2. document-space position of a stable anchor card, which append must not change.
 *   3. window.scrollY, which append must not change.
 */
import { serve, openPage, waitForApp } from './_lib.mjs';

/* Wait until scrollY has stopped changing — the page animates scrolls. */
async function settle(page, quietMs = 250, maxMs = 4000) {
  await page.evaluate(async ([quiet, max]) => {
    let last = -1, stableSince = performance.now();
    const end = performance.now() + max;
    while (performance.now() < end) {
      const y = Math.round(window.scrollY);
      if (y !== last) { last = y; stableSince = performance.now(); }
      else if (performance.now() - stableSince > quiet) return;
      await new Promise(r => setTimeout(r, 40));
    }
  }, [quietMs, maxMs]);
}
const srv = await serve('gzip');
const { browser, page } = await openPage(process.argv[2] || '4g');
await page.goto(srv.url + '/', { waitUntil: 'load' });
await waitForApp(page);
await page.waitForFunction(() => document.querySelectorAll('#results .copy').length > 5, { timeout: 30000 });
await page.waitForTimeout(3500);

console.log('=== "Show more": are cards appended, and does the page stay put? ===\n');
let worstPos = 0, rebuilt = false;
for (let i = 1; i <= 3; i++) {
  // Scroll the way a user does: down to where the button actually is, so it is ON SCREEN when
  // clicked. (Clicking an off-screen button, or using scrollIntoView on the button that is about
  // to be removed, both produce large fake "drift" numbers.)
  // behavior:'instant' matters: the page sets `html { scroll-behavior: smooth }`, so a plain
  // scrollTo ANIMATES. Measuring mid-animation reported drift of thousands of pixels that had
  // nothing to do with the code under test. Scroll instantly, then wait for it to settle.
  await page.evaluate(() => {
    const b = document.querySelector('#results .more');
    const target = b.getBoundingClientRect().top + window.scrollY - (window.innerHeight - 120);
    window.scrollTo({ top: Math.max(0, Math.round(target)), behavior: 'instant' });
  });
  await settle(page);
  const before = await page.evaluate(() => {
    const box = document.querySelector('#results');
    const cards = [...box.querySelectorAll('.copy')];
    cards.forEach((c, i) => { c.dataset.tcTag = 'gen' + i; });
    // anchor on a card the user can actually SEE — that is whose position must not move
    const vh = window.innerHeight;
    const visible = cards.filter(c => { const r = c.getBoundingClientRect(); return r.top < vh && r.bottom > 0; });
    const anchor = visible[0] || cards[cards.length - 1];
    return { n: cards.length, y: Math.round(window.scrollY),
             anchorDocY: Math.round(anchor.getBoundingClientRect().top + window.scrollY),
             anchorViewY: Math.round(anchor.getBoundingClientRect().top),
             anchorTag: anchor.dataset.tcTag, nVisible: visible.length };
  });
  await page.evaluate(() => { const b = document.querySelector('#results .more'); if (b) b.click(); });
  await settle(page);
  const after = await page.evaluate(tag => {
    const box = document.querySelector('#results');
    const cards = [...box.querySelectorAll('.copy')];
    const anchor = cards.find(c => c.dataset.tcTag === tag);
    const survived = cards.filter(c => c.dataset.tcTag !== undefined).length;
    return { n: cards.length, y: Math.round(window.scrollY), survived,
             anchorDocY: anchor ? Math.round(anchor.getBoundingClientRect().top + window.scrollY) : null,
             anchorViewY: anchor ? Math.round(anchor.getBoundingClientRect().top) : null };
  }, before.anchorTag);
  const posDrift = after.anchorDocY === null ? Infinity : Math.abs(after.anchorDocY - before.anchorDocY);
  const viewDrift = after.anchorViewY === null ? Infinity : Math.abs(after.anchorViewY - before.anchorViewY);
  if (after.survived !== before.n) rebuilt = true;
  worstPos = Math.max(worstPos, viewDrift);
  console.log(`  click ${i}: cards ${before.n} -> ${after.n} · originals kept ${after.survived}/${before.n}` +
    ` · the card you were looking at moved ${viewDrift}px on screen (${posDrift}px in the document)`);
}
console.log(`\n  rebuilt instead of appended: ${rebuilt ? 'YES ❌' : 'no ✅'}`);
console.log(`  worst anchor drift: ${worstPos}px  ${worstPos < 8 ? '✅' : '❌ (target < 8px — see audit P4)'}`);
await browser.close(); await srv.close();
