// Minimal offline service worker for the served PWA (SPEC-hopper-collector §6).
// Precache the shell on install; cache-first for GET. Bump CACHE on each release.
// (The ggwave WASM fallback, when added, is precached here too — §5.5: a
// no-network fallback can't depend on a network fetch.)

const CACHE = 'hopper-v0';
const ASSETS = ['./collector.html', './manifest.webmanifest', './icon.svg', './icon-maskable.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
