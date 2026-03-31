// Service Worker — minimal offline shell
const CACHE = 'quiz-v1';
const SHELL = ['/quiz/play', '/quiz/static/play.css', '/quiz/static/play.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Network-first for API/WS, cache-first for shell assets
  if (e.request.url.includes('/quiz-ws') || e.request.url.includes('/quiz/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
