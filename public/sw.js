/* HART Communicator service worker: offline app shell with user-confirmed updates.
   Bump VERSION whenever any app file changes so installed copies pick up the update. */
const VERSION = 'hart-3.0.0';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate'){
    // Pages: try the network first so a fresh deploy shows up, fall back to the cached shell offline
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  // Assets: cached copy first, refreshed in the background
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
