// Service Worker — network-first with auto-update
const CACHE = 'quiz-v3';
const SHELL = ['/quiz/play', '/quiz/static/play.css', '/quiz/static/play.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  self.skipWaiting(); // activate immediately
});

self.addEventListener('activate', (e) => {
  // Delete old caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Skip WebSocket and API requests
  if (e.request.url.includes('/quiz-ws') || e.request.url.includes('/quiz/api/')) return;
  // Network-first: always try fresh, fall back to cache
  e.respondWith(
    fetch(e.request).then(res => {
      // Update cache with fresh response
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

// Listen for skip-waiting message from client
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
