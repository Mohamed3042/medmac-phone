// The shell's service worker: the page's own files, cache-first, so it opens with no network.
// It never touches GitHub's API or the hub: the snapshot, photos and papers live in IndexedDB (keyed by path), not here.
// VERSION is stamped by scripts/publish-phone-page.mjs (a hash of the shell); a new value replaces the old cache.
const VERSION = 'vd7da586c95fe';
const CACHE = `mmis-shell-${VERSION}`;
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './js/app.mjs', './js/config.mjs', './js/core.mjs', './js/dom.mjs', './js/gh.mjs', './js/hoop.mjs', './js/hub.mjs', './js/hubui.mjs', './js/media.mjs', './js/store.mjs', './js/views.mjs',
  './fonts/Sora-wght.ttf', './fonts/PlexArabic-400.woff2', './fonts/PlexArabic-600.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // only this page's old shells: other pages on the same github.io origin keep their caches
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('mmis-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
