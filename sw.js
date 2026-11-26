// Replaces the old phone page's service worker on this address: drops its caches, unregisters, and hands every
// open window over to the new origin. (The old sw.js lived at this same path, so browsers pick this one up.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mmis-shell-')) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
  })());
});
self.addEventListener('fetch', () => { /* no cache: every request goes to the network, so the old shell is never served again */ });
