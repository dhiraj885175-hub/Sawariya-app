const CACHE_NAME = 'sawariya-v1';
const FILES_TO_CACHE = [
  '/Sawariya-app/',
  '/Sawariya-app/index.html'
];

// Install - App ko cache karo
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate - Purana cache hatao
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch - Net nahi to cache se do
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Net hai - response cache karo aur do
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Net nahi - cache se do
        return caches.match(event.request).then(cached => {
          return cached || caches.match('/Sawariya-app/index.html');
        });
      })
  );
});
