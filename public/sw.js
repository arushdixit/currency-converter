const CACHE_NAME = 'converter-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png'
];

// Install Event - Pre-cache core static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME, 'converter-flags-cache'];
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!cacheWhitelist.includes(key)) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Dynamic caching strategy
self.addEventListener('fetch', (event) => {
  // Only handle standard GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = event.request.url;
  const isSelfOrigin = requestUrl.startsWith(self.location.origin);
  const isFlagCDN = requestUrl.startsWith('https://flagcdn.com');

  if (!isSelfOrigin && !isFlagCDN) {
    return;
  }

  // Identify uniquely hashed Vite production bundles (which are completely immutable)
  const isImmutableAsset = isSelfOrigin && requestUrl.includes('/assets/') && (requestUrl.endsWith('.js') || requestUrl.endsWith('.css'));

  // Cache-First strategy for Flag CDN images and immutable production assets
  if (isFlagCDN || isImmutableAsset) {
    const cacheName = isFlagCDN ? 'converter-flags-cache' : CACHE_NAME;
    event.respondWith(
      caches.open(cacheName).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            if (isFlagCDN) {
              return new Response('', { status: 408, statusText: 'Network Error' });
            }
          });
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate caching strategy for static application assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in the background to update cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {/* Ignore network errors offline */});
        
        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }

        // Cache dynamically fetched CSS/JS assets from origin
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });

        return networkResponse;
      }).catch(() => {
        // Fallback for document requests when offline
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
