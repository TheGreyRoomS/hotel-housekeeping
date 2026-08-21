/* TGHHousekeeping APP — service worker
 * Bump CACHE_VERSION whenever index.html or the icons change so every
 * installed device picks up the new version on next launch.
 */
const CACHE_VERSION = 'tgh-hk-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/logo.png',
  '/icons/logo-white.png',
];

// ── INSTALL: pre-cache the app shell ─────────────────────
self.addEventListener('install', (event) => {
  // NOTE: deliberately no skipWaiting() here. A new worker waits until the
  // user taps "Update now", so a deploy can never reload the app out from
  // under someone who is mid-form.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('SW precache incomplete:', err))
  );
});

// ── ACTIVATE: drop old caches, take control immediately ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── FETCH ────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever touch GETs on our own origin.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Photos are immutable and served with a long cache lifetime, so treat them
  // like any other static asset rather than refetching them with the API.
  if (url.pathname.startsWith('/api/photos/')) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Everything else under /api/ must always hit the network — never serve stale
  // room data.
  if (url.pathname.startsWith('/api/')) return;

  // Page loads: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a genuinely good page. Caching a 500 or a maintenance
          // page here would strand every device on it.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: serve from cache, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
