// Simple service worker for offline support
// Cache app shell and assets for offline use

const CACHE_NAME = 'local-visualizer-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/audio/context.js',
  '/js/audio/analyser.js',
  '/js/audio/playback.js',
  '/js/vis/canvasBars.js',
  '/js/vis/bars.js',
  '/js/vis/circle.js',
  '/js/vis/visApi.js',
  // vendor libraries
  '/js/vendor/jsmediatags.min.js',
  '/js/vendor/three.module.js',
  '/js/vendor/postprocessing.js',
];

// Install event: pre-cache static resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
});

// Fetch event: serve cached content when available
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});

