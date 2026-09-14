/* Offline cache. Shell is precached with stale-while-revalidate. The heavy data files
   (copies/qmeta/qtext/link-copies — multi-hundred-KB to multi-MB) use cache-first-with-TTL
   instead: a repeat visit serves straight from cache with NO network request, revalidating
   in the background at most once every HEAVY_TTL_MS. Bump VERSION to force a full refresh
   of everything. */
var VERSION = 'tc-v26';
var SHELL = [
  './', './index.html',
  './assets/style.css', './assets/app.js',
  './assets/fonts/inter-latin.woff2',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png',
  './data/index.json', './data/toppers.json', './data/optionals.json'
];
// `questions.json` (the pre-Phase-4 compat shim) is gone — deleted along with the buildId
// machinery it existed for once ids became content-derived (Phase 4 / I1, DECISION-5).
// qindex.bin (Phase 5 / E1) joins the heavy set — it's what finds a search match now, so a
// repeat visitor needs it cache-first the same way as the JSON data files, not on the default
// stale-while-revalidate path (which would re-fetch it over the network on every single visit).
var DATA_HEAVY = /\/data\/(copies|qmeta|qtext|link-copies)\.json$|\/data\/qindex\.bin$/;
// Ids can no longer drift (I1), so a stale cached copy is merely missing recent content, never
// wrong — 7 days is fine (was 12h, sized around the old positional-id risk).
var HEAVY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;              // never touch PDF / GA / font CDN
  if (url.pathname.indexOf('/gtag/') !== -1) return;

  if (DATA_HEAVY.test(url.pathname)) {
    e.respondWith(
      caches.open(VERSION).then(function (c) {
        return c.match(e.request).then(function (hit) {
          var age = hit && hit.headers.get('date') ? Date.now() - new Date(hit.headers.get('date')).getTime() : Infinity;
          if (hit && age < HEAVY_TTL_MS) return hit;         // fresh enough — no network call at all
          return fetch(e.request).then(function (res) {
            if (res && res.ok) c.put(e.request, res.clone());
            return res;
          }).catch(function () { return hit; });             // offline / stale-but-usable fallback
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;                                    // stale-while-revalidate
    })
  );
});
