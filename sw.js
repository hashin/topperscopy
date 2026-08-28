/* Offline cache. Shell is precached; big data files are cached at runtime
   (stale-while-revalidate). Bump VERSION to force a refresh. */
var VERSION = 'tc-v2';
var SHELL = [
  './', './index.html', './toppers.html',
  './assets/style.css', './assets/app.js',
  './assets/fonts/inter-latin.woff2', './assets/fonts/fraunces-latin.woff2',
  './data/toppers.json', './data/optionals.json'
];

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
