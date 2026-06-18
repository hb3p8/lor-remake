// __BUILD_HASH__ is replaced with the short git SHA at deploy time (see
// .github/workflows/deploy-pages.yml). Locally it stays literal, which is a
// perfectly valid constant cache name for development.
const CACHE_VERSION = '__BUILD_HASH__';
const CACHE_NAME = 'lor-remake-' + CACHE_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './mosaic.json',
  './MosaicSlopes.woff2',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => {
        if (key === CACHE_NAME) return null;
        return caches.delete(key);
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache-FIRST for navigations / the app document: serve the cached shell
  // instantly so the app launches reliably offline (network-first navigations
  // are flaky on iOS standalone PWAs — they can hang or blank instead of
  // failing cleanly). Revalidate in the background so the cache stays current,
  // but only store a genuinely OK response — never let a transient error page
  // (5xx, captive portal) poison the app shell. A fresh deploy is still picked
  // up promptly: the updated SW reloads the page once it activates (see the
  // install/activate handlers and the page's controllerchange listener).
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => {
        const network = fetch(request)
          .then(response => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
            }
            return response;
          })
          .catch(() => cached || caches.match('./index.html'));
        return cached || network;
      })
    );
    return;
  }

  // Cache-first for other static assets, refreshing the cache in the
  // background (stale-while-revalidate) so icons/manifest stay current.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
