const CACHE_NAME = 'sawariya-v2'; // Version badhaya — purana cache auto-clear ho jayega
const FILES_TO_CACHE = [
  '/Sawariya-app/',
  '/Sawariya-app/index.html'
];

// Install — App shell ko turant cache karo
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate — Purana cache hatao
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

// Fetch — Smart strategy: request type ke hisaab se decide karo
self.addEventListener('fetch', event => {
  const url = event.request.url;

  if (event.request.method !== 'GET') return;

  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebaseio.com') ||
      url.includes('identitytoolkit') ||
      url.includes('securetoken.googleapis.com') ||
      url.includes('onesignal.com')) {
    return;
  }

  if (url.includes('fonts.gstatic.com') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('gstatic.com/firebasejs') ||
      url.includes('i.ibb.co') ||
      event.request.destination === 'image' ||
      event.request.destination === 'font' ||
      event.request.destination === 'style' ||
      event.request.destination === 'script') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          return cached || caches.match('/Sawariya-app/index.html');
        });
      })
  );
});  
