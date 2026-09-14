/* Does the search reach the URL, and does it coexist with setView()'s own hash routing?
   Audit R3. */
import { serve, openPage, waitForApp } from './_lib.mjs';

const srv = await serve('gzip');
const { browser, page } = await openPage('4g');
await page.goto(srv.url + '/', { waitUntil: 'load' });
await waitForApp(page);
await page.waitForTimeout(3000);

function urlOf(page) { return page.evaluate(() => location.href); }
function qOf(page) { return page.evaluate(() => document.querySelector('#q').value); }

console.log('=== R3: search state in the URL ===\n');

// 1. Typing a query updates the URL with ?q=, without touching the (absent) hash.
await page.evaluate(() => {
  const q = document.querySelector('#q');
  q.value = 'federalism';
  q.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
let url = await urlOf(page);
const gotQ = /[?&]q=federalism/.test(url);
console.log(`1. type "federalism" -> URL: ${url}`);
console.log(`   URL gained ?q=federalism: ${gotQ ? '✅' : '❌'}`);

// 2. Switch to the About tab (setView()'s own hash-only replaceState) — ?q= must survive, hash must change.
await page.evaluate(() => document.querySelector('nav.tabs button[data-view="about"]').click());
await page.waitForTimeout(200);
url = await urlOf(page);
const hashIsAbout = /#about\b/.test(url);
const qSurvivedTabSwitch = /[?&]q=federalism/.test(url);
console.log(`\n2. switch to About tab -> URL: ${url}`);
console.log(`   hash changed to #about: ${hashIsAbout ? '✅' : '❌'}`);
console.log(`   ?q= survived the tab switch: ${qSurvivedTabSwitch ? '✅' : '❌'}`);

// 3. Switch back to Browse — hash changes again, ?q= (and the search box's own value) still there.
await page.evaluate(() => document.querySelector('nav.tabs button[data-view="browse"]').click());
await page.waitForTimeout(200);
url = await urlOf(page);
console.log(`\n3. switch back to Browse -> URL: ${url}`);
console.log(`   ?q= still present: ${/[?&]q=federalism/.test(url) ? '✅' : '❌'}`);

// 4. One pushState for the empty->non-empty transition: Back must undo the search (query clears,
//    URL loses ?q=) without leaving the site — not walk back through tab-switch history entries,
//    since those used replaceState, not pushState.
await page.goBack();
await page.waitForTimeout(400);
url = await urlOf(page);
const qBox = await qOf(page);
const stillOnSite = url.startsWith(srv.url);
const queryCleared = !/[?&]q=/.test(url) && qBox === '';
console.log(`\n4. press Back -> URL: ${url}`);
console.log(`   still on the site: ${stillOnSite ? '✅' : '❌'}`);
console.log(`   query cleared (URL and search box): ${queryCleared ? '✅' : '❌'} (box: "${qBox}")`);

// 5. Typing character-by-character only replaceState's — confirm no history pileup: after N
//    keystrokes, exactly one Back (from the state above, non-empty->empty already covered) — here
//    check that retyping a second query and pressing Back once returns to the FIRST search's
//    empty state, not to some intermediate partial query (i.e., not one entry per keystroke).
await page.evaluate(() => {
  const q = document.querySelector('#q');
  q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(300);
for (const ch of 'ethics') {
  await page.evaluate((c) => {
    const q = document.querySelector('#q');
    q.value += c;
    q.dispatchEvent(new Event('input', { bubbles: true }));
  }, ch);
  await page.waitForTimeout(200);
}
url = await urlOf(page);
console.log(`\n5. typed "ethics" letter-by-letter -> URL: ${url}`);
console.log(`   ends with the full word (no partial-query state): ${/[?&]q=ethics/.test(url) ? '✅' : '❌'}`);
await page.goBack();
await page.waitForTimeout(400);
url = await urlOf(page);
const oneEntryPerQuery = !/[?&]q=/.test(url);
console.log(`   one Back (not six) clears it: ${oneEntryPerQuery ? '✅' : '❌'} (URL now: ${url})`);

// 6. ?paper= and ?syl= write paths (paper only here — syl needs syllabus.json to have loaded a
//    real option; exercised by clicking a paper filter chip, which is always available).
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#papers button')].find(b => b.dataset.paper === 'GS2');
  if (btn) btn.click();
});
await page.waitForTimeout(300);
url = await urlOf(page);
console.log(`\n6. click the GS2 paper filter -> URL: ${url}`);
console.log(`   URL gained ?paper=GS2: ${/[?&]paper=GS2/.test(url) ? '✅' : '❌'}`);

await browser.close(); await srv.close();
