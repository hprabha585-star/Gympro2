const CACHE_NAME = 'gympro-app-v2';
const DATA_CACHE = 'gympro-data-v2';

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
  // 2. If it is App Code (HTML/CSS/JS) -> Cache First, Fallback to Network
  else if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  }
});
