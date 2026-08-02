// v3: bumped from v2 to force every existing install to drop its old,
// possibly-stale cached HTML/CSS/JS (see fetch handler below for why that
// mattered) and re-cache fresh copies from the network.
const CACHE_NAME = 'gympro-app-v3';
const DATA_CACHE = 'gympro-data-v3';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/admin.html',
  '/superadmin.html',
  '/gym-qr.html',
  '/member-checkin.html',
  '/scan-stats.html',
  '/script.js',
  '/style.css',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install & Cache App Files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME && key !== DATA_CACHE) return caches.delete(key);
      })
    ))
  );
  self.clients.claim();
});

// Smart Fetch: Intercept requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. If it is an API request (Data) -> Network First, Fallback to Cache
  if (url.pathname.startsWith('/api/') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Save a copy of the fresh data for offline use
          const clone = response.clone();
          caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // If completely offline, return the last saved data!
          return caches.match(event.request);
        })
    );
  }
  // 2. If it is App Code (HTML/CSS/JS) -> Network First, Fallback to Cache.
  // IMPORTANT: this used to be Cache First, which meant once a file was
  // cached it was served forever — even after a new version was deployed —
  // because CACHE_NAME never changed between deploys. Different files
  // could end up cached at different points in time, so the browser could
  // end up running an inconsistent mix of old HTML with newer JS (or vice
  // versa), causing exactly the kind of "element from the wrong page is
  // showing up" bugs this was meant to prevent. Network First means anyone
  // online always gets the latest deployed files; the cache is now purely
  // an offline fallback, not the default source of truth.
  else if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
