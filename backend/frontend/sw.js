// This service worker is retired. It previously used a Cache-First
// strategy for HTML/CSS/JS with a version string that never changed
// between deploys, which caused browsers to keep serving an old,
// inconsistent mix of cached files indefinitely — a real production bug.
//
// script.js now actively unregisters any service worker on load, but a
// browser that still has an old worker installed will fetch THIS file
// directly (bypassing its own fetch handler) to check for updates — so
// this file self-unregisters too, as a second line of defense.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Drop every cache this worker (or an earlier version of it) made.
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
      // Unregister self and force every open tab to reload once, straight
      // from the network, so nobody is left on stale cached content.
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(client => client.navigate(client.url));
    })()
  );
});
