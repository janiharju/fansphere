const CACHE_NAME = 'fansphere-cache-v2';
const PRECACHE_ASSETS = [
  '/',
  '/static/index.html',
  '/static/app.js',
  '/static/style.css',
  '/manifest.json',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/icon.svg',
  '/favicon.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest'
];

// Install: precache core shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Precache what we can; don't fail completely if external CDN is slow
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[PWA SW] Precache failed for:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: purge obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass non-GET, WebSocket, and chrome-extension
  if (req.method !== 'GET' || url.protocol.startsWith('ws') || url.protocol === 'chrome-extension:') {
    return;
  }

  // API Requests: Network-first with Cache fallback for read-only routes
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok && (url.pathname === '/api/posts' || url.pathname === '/api/realms' || url.pathname === '/api/matches' || url.pathname === '/api/teams')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ error: 'offline', offline: true }), {
              headers: { 'Content-Type': 'application/json' },
              status: 503
            });
          });
        })
    );
    return;
  }

  // Navigation requests (HTML pages): Network-first with index.html fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(req).then((cached) => {
            if (cached) return cached;
            return caches.match('/') || caches.match('/static/index.html');
          });
        })
    );
    return;
  }

  // Static Assets (Images, scripts, CSS, fonts): Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});

// Skip waiting message handler
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
