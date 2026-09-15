/* Offline cache. Every same-origin GET is stale-while-revalidate: serve what is cached, refresh
   it in the background. The shell and data/copies.json are precached on install. A question
   shard refers to copies by URL, so a copies.json and a shard from different builds still agree —
   a ref to a URL the cached copies.json does not know is simply skipped.
   Bump VERSION on any shell change to force a full refresh. */
var VERSION = 'tc-v27';
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
  if (url.origin !== location.origin) return;              // never touch PDF / GA / CDN requests
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
      return hit || net;
    })
  );
});
