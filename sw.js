/* Offline cache. Every same-origin GET is stale-while-revalidate: serve what is cached, refresh
   it in the background. The shell and data/copies.json are precached on install. A question
   shard refers to copies by cid(url) — a hash of the URL — so a copies.json and a shard from different
   builds still agree; a ref to a copy the cached copies.json does not know is simply skipped.
   Exception (DECISION-27): a question-shard part is requested as questions-<paper>[-N].json?v=<content hash>, where the
   hash comes from copies.json. The URL changes iff the bytes do, so those are cache-first — an unchanged part is never
   fetched again, not even to revalidate (GitHub Pages' ETag changes on every deploy, so revalidating re-downloads it).
   When a part's hash changes, the superseded copy is deleted from the cache.
   Bump VERSION on any shell change to force a full refresh. */
var VERSION = 'tc-v30';
var SHELL = [
  './', './index.html',
  './assets/style.css', './assets/app.js',
  './assets/fonts/inter-latin.woff2',
  './manifest.webmanifest', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png',
  './data/copies.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // cache:'reload' — precache what the server has now, not whatever the HTTP cache (max-age=600) still holds.
    return Promise.all(SHELL.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // One-time migration (DECISION-26): a tab still running the pre-DECISION-25 app.js reads the new data in the old
    // format and shows a false "0 copies". tc-v27 is how we know this worker is replacing the one that served it.
    var fromV27 = keys.indexOf('tc-v27') >= 0;
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }))
      .then(function () { return self.clients.claim(); })
      .then(function () {
        if (!fromV27) return;
        return self.clients.matchAll({ type: 'window' }).then(function (cs) {
          return Promise.all(cs.map(function (c) { return c.navigate(c.url).catch(function () {}); }));
        });
      });
  }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;              // never touch PDF / GA / CDN requests
  if (url.pathname.indexOf('/gtag/') !== -1) return;
  if (/\/data\/questions-[a-z0-9-]+\.json$/.test(url.pathname) && /^\?v=[0-9a-f]+$/.test(url.search)) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (res) {
          if (res && res.ok) {
            c.put(e.request, res.clone());
            c.keys().then(function (ks) {
              ks.forEach(function (k) { var u = new URL(k.url); if (u.pathname === url.pathname && u.search !== url.search) c.delete(k); });
            });
          }
          return res;
        });
      });
    }));
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
      return hit || net;
    })
  );
});
