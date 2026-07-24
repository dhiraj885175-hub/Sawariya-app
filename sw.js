// ===== Sawariya Exclusive — Service Worker =====
// GOAL: App-shell (yeh HTML/JS/CSS file khud) turant, cache se, khule —
// chahe internet bilkul slow ho ya na ho — bilkul native app jaisa.
// Products/orders/wallet jaisa REAL-TIME data hamesha seedha Firebase se
// hi aata hai (never cached here) — index.html apna alag localStorage
// cache (sw_cache_prods_v1 etc.) already sambhalta hai us data ke liye.
//
// STRATEGY: "Stale-While-Revalidate" —
//   1) Jo bhi cache mein pehle se hai, USE TURANT (bina network ka
//      intezaar kiye) — ye instant-open ka asli secret hai.
//   2) Background mein (silently) network se latest version bhi mangwa
//      lo aur cache update kar do — taaki AGLI baar aur bhi latest mile.
//   3) index.html (main file) mein pehle se hi ek "controllerchange" par
//      auto-reload wala logic hai — jab bhi ye sw.js file khud badalti
//      hai (naya deploy), naya SW turant activate hoke page ko ek baar
//      refresh kar dega, taaki updates kabhi stuck na rahein.
//
// VERSION BUMP: jab bhi is file mein koi BADA caching-logic change karo
// (sirf index.html content update ke liye bump karne ki zaroorat NAHI —
// wo already stale-while-revalidate se apne aap fresh ho jata hai),
// niche wala number badha dena — isse purane caches clean ho jayenge.
const SW_VERSION   = 'v3';
const SHELL_CACHE   = 'sawariya-shell-' + SW_VERSION;
const RUNTIME_CACHE = 'sawariya-runtime-' + SW_VERSION;

// App-shell mein bas ye page khud hai — koi separate build ki CSS/JS
// files nahi hain (sab kuch is single HTML file ke andar hi hai).
const SHELL_URLS = [
  './',
  './index.html'
];

// Ye domains "static/rarely-changing" assets hain (fonts, Firebase SDK
// libraries, OneSignal SDK, banner/product images hosted par ibb.co) —
// inhe bhi cache karna safe hai, isse repeat visits par ye bhi turant
// load hote hain, network ka wait nahi karna padta.
const RUNTIME_CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',
  'cdn.onesignal.com',
  'i.ibb.co'
];

// Ye domains kabhi bhi cache NAHI karne — ye real-time/dynamic data hai
// (Firestore reads/writes, Auth, push notifications). Inhe hamesha
// seedha network se hi jaana chahiye taaki data hamesha latest ho.
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'onesignal.com'  // OneSignal ke API calls (SDK file khud upar cacheable list mein hai)
];

self.addEventListener('install', (event) => {
  // Naya SW turant activate ho jaye, purane ka activate hone tak wait na kare —
  // taaki naya deploy customer tak jaldi pahunche.
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // addAll fail ho sakta hai agar koi ek bhi URL fetch na ho paye
      // (jaise pehli install hi offline par ho rahi ho) — is case mein
      // poora install fail hone se behtar hai chup-chaap ignore kar dena,
      // agli successful visit par cache apne aap ban jayega.
      return Promise.allSettled(SHELL_URLS.map((u) => cache.add(u)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Network-first helper (app-shell ke liye): PEHLE seedha network se fresh
// copy mangwao aur cache update kar do — taaki naya deploy pehli hi baar
// dikhe (bina dusri baar reload kiye). Sirf jab network fail ho (offline /
// bahut slow) tab purana cached version fallback ke roop mein use hota hai.
//
// BUG FIX (notification deep-link net::ERR_FAILED + ANR on slow net):
// Pehle iska catch() sirf `cache.match(request)` return karta tha — jo
// EXACT URL match dhoondta hai. Notification se aane wale URL mein
// `?product=xxx` query-string hoti hai, jo cache mein kabhi save hi
// nahi hui (sirf './' aur './index.html' cache hote hain). Isliye match
// nahi milta tha, `undefined` resolve ho jaata tha, aur SW `undefined`
// ke saath respond kar deta tha -- browser isko net::ERR_FAILED dikhata
// hai. Ab do fixes: (1) `ignoreSearch:true` se query-string ignore karke
// match dhoondte hain, (2) agar phir bhi kuch na mile toh './index.html'
// pe hard-fallback karte hain -- ab kabhi `undefined` return nahi hota,
// hamesha ek valid Response milegi.
//
// BUG FIX (ANR "isn't responding"): fetch() ka pehle koi timeout nahi
// tha -- bahut slow (2G jaisi) network par fetch() minute tak latka reh
// sakta hai, jiske wajah se navigation khud atki rehti hai aur Android
// WebView ko ANR dikhana padta hai. Ab NETWORK_TIMEOUT_MS (5 second) se
// zyada wait nahi karte -- turant cached shell dikha dete hain, aur agar
// network baad mein aa bhi jaye toh wo sirf background cache update kar
// degi, user ko wait nahi karna padega.
const NETWORK_TIMEOUT_MS = 5000;

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw-network-timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function networkFirst(request, cacheName) {
  return caches.open(cacheName).then((cache) => {
    return fetchWithTimeout(request, NETWORK_TIMEOUT_MS)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          // Query-string wali alag-alag copies cache mein mat banao (jaise
          // ?product=abc, ?product=xyz) -- hamesha './index.html' key ke
          // niche hi latest shell save karo. Isse aage ignoreSearch match
          // hamesha kaam karega, chahe koi bhi product/promo link ho.
          cache.put('./index.html', networkResponse.clone());
        }
        return networkResponse;
      })
      .catch(() => {
        // Network fail / slow / timeout -- cache se do. Query-string
        // (?product=xxx) ignore karke dhoondo, warna seedha index.html.
        return cache.match(request, { ignoreSearch: true })
          .then((cached) => cached || cache.match('./index.html'))
          .then((cached) => cached || caches.match('./index.html'))
          .then((cached) => cached || new Response(
            'Aap offline hain aur ye page pehle kabhi load nahi hua. Internet on karke dobara try karo.',
            { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
          ));
      });
  });
}

// Stale-while-revalidate helper: cache se turant jawab do (agar hai),
// aur saath hi background mein network se fresh copy mangwa kar cache
// update kar do — agli baar ke liye.
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then((cache) => {
    return cache.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          // Sirf successful, basic/cors response hi cache karo.
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cached); // Network fail (offline/slow) — purana cached jawab hi sahi.
      // Agar cache mein pehle se kuch hai, turant WAHI return karo (instant!),
      // network update chup-chaap background mein chalta rahega.
      // Agar cache khaali hai (pehli baar), tab hi network ka wait karna padega.
      return cached || networkFetch;
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Sirf GET requests handle karo — POST/PUT waghera (jaise Firestore
  // writes) ko seedha browser ke default network behaviour par chhod do.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Real-time/dynamic data — KABHI cache mat karo, hamesha network se.
  if (NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h))) {
    return; // Handle hi mat karo — browser apna normal network fetch karega.
  }

  // App-shell: yehi page (navigation request, ya seedha index.html/root).
  const scopePath = new URL(self.registration.scope).pathname; // e.g. '/Sawariya-app/'
  const isNavigation = req.mode === 'navigate';
  const isShellUrl = url.origin === self.location.origin &&
    (url.pathname === scopePath || url.pathname.endsWith('/index.html'));

  if (isNavigation || isShellUrl) {
    event.respondWith(
      networkFirst(req, SHELL_CACHE).catch(() =>
        // Bilkul offline + kabhi cache hi nahi hua — koi bhi cached shell
        // mil jaye to wahi de do, warna jo bhi ho paaye.
        caches.match('./index.html')
      )
    );
    return;
  }

  // Static/rarely-changing external assets (fonts, Firebase/OneSignal SDK,
  // ibb.co images) — stale-while-revalidate se turant + background-fresh.
  if (RUNTIME_CACHEABLE_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
    return;
  }

  // Baaki sab kuch (jo upar kisi list mein nahi aaya) — default network
  // behaviour, koi interference nahi.
});
