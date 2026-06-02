// Minimal offline service worker for the served PWA (SPEC-hopper-collector §6).
// Precache the shell on install; cache-first for GET. Bump CACHE on each release.
// (The ggwave WASM fallback, when added, is precached here too — §5.5: a
// no-network fallback can't depend on a network fetch.)

const CACHE = 'hopper-v0';
const SHELL = './collector.html';
const ASSETS = [SHELL, './manifest.webmanifest', './icon.svg', './icon-maskable.svg'];

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
  const req = e.request;
  if (req.method !== 'GET') return;
  // Navigations (the bare origin "/", "/collector.html", "/#<capsule>", …) all
  // resolve to the one shell — serve it from cache so offline load works whatever
  // path the host serves it at, not just the exact precached URL. (The earlier
  // exact-match handler missed "/", since only "./collector.html" was cached.)
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(SHELL).then((shell) => shell || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
