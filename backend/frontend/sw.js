// BUG FIX: bumped v2 -> v3. Every asset below (including superadmin.html)
// was served CACHE-FIRST, which means once a browser cached a version it
// would NEVER re-check the network for a newer one — a redeployed fix to
// superadmin.html (or any page) would silently keep failing forever for
// anyone who had already loaded it once, exactly what was happening here.
// Bumping the cache name forces every existing browser to treat the old
// cache as stale and fetch fresh copies of everything on next load.
const CACHE_NAME = 'gympro-app-v5';
const DATA_CACHE = 'gympro-data-v5';

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
    // FIX: cache.addAll() rejects if ANY file 404s (e.g. a missing icon), which
    // silently aborted the whole install. Cache each file independently.
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// Clean up ALL old caches (any name that isn't the current version) —
// this is what actually purges the stale superadmin.html once and for all.
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

// Logout wipes cached API data (member lists etc.) from this device
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_DATA') event.waitUntil(caches.delete(DATA_CACHE));
});

// Smart Fetch: Intercept requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API request (Data) -> Network First, Fallback to Cache (unchanged)
  if (url.pathname.startsWith('/api/') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(DATA_CACHE).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
  // 2. App Code (HTML/CSS/JS) -> NETWORK FIRST, fallback to cache.
  //    BUG FIX: this used to be Cache First (`caches.match(...) || fetch(...)`),
  //    which is exactly why a fixed superadmin.html kept showing the old
  //    broken version — the cached copy was always returned first and the
  //    network was never even asked. Network-first means every deploy is
  //    visible immediately; the cached copy is now only a fallback for
  //    when the device is genuinely offline.
  else if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
