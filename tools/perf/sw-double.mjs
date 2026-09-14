/* Does a build-skew cache-buster leave the result cached, or is it thrown away? Audit D3.
 *
 * app.js's fetchAtBuild() retries as `data/questions.json?b=<id>.<ts>` when two data files
 * disagree on their build id. Before D3, sw.js passed that straight through and cached nothing,
 * so the visitor paid 1.64 MB for the retry and paid it again next visit. This asserts the
 * retry's response is stored under the CLEAN url.
 */
import { serve, openPage } from './_lib.mjs';

const srv = await serve('gzip');
const { browser, page } = await openPage('4g');

let netHits = 0;
page.on('request', r => { if (/\/data\/questions\.json/.test(r.url())) netHits++; });

await page.goto(srv.url + '/', { waitUntil: 'load' });
const swReady = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'no serviceWorker';
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return reg ? 'ready' : 'not ready';
});
console.log('service worker:', swReady);
if (swReady !== 'ready') { console.log('\ncannot test without a service worker — is this a secure context?'); await browser.close(); await srv.close(); process.exit(0); }

const r = await page.evaluate(async () => {
  const clean = new URL('data/questions.json', location.href).href;
  // make sure we start from a clean slate for this url
  for (const k of await caches.keys()) { const c = await caches.open(k); await c.delete(clean); }
  // 1. the cache-buster path, exactly as fetchAtBuild builds it
  const res = await fetch('data/questions.json?b=deadbeef.' + Date.now());
  const ok = res.ok;
  await new Promise(r => setTimeout(r, 800));      // let the SW finish its put()
  // 2. is the result now cached under the CLEAN url?
  let cached = false, cachedIn = null;
  for (const k of await caches.keys()) {
    const hit = await (await caches.open(k)).match(clean);
    if (hit) { cached = true; cachedIn = k; break; }
  }
  return { ok, cached, cachedIn };
});

console.log('cache-buster fetch ok :', r.ok);
console.log('stored under clean url:', r.cached, r.cachedIn ? '(in ' + r.cachedIn + ')' : '');
console.log('network fetches of questions.json this run:', netHits);
console.log('\n  ' + (r.cached
  ? '✅ the retry populates the cache — the next load does not re-download'
  : '❌ the retry is thrown away — a build skew costs 1.64 MB every visit (see audit D3)'));
await browser.close(); await srv.close();
