const CACHE_NAME = 'nora-v4';
const BASE = self.registration.scope.replace(/\/?$/, '/');
const ASSETS = [
  'index.html',
  'styles.css',
  'app.js',
  'db.js',
  'manifest.json',
  'icons/icon-192.svg',
  'icons/icon-512.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/home.svg',
  'icons/clock.svg',
  'icons/credit-card.svg',
  'icons/settings.svg',
  'icons/plus.svg',
  'icons/search.svg',
  'icons/edit.svg',
  'icons/trash.svg',
  'icons/download.svg',
  'icons/upload.svg',
  'icons/alert-triangle.svg',
  'icons/cat-alimentacion.svg',
  'icons/cat-transporte.svg',
  'icons/cat-entretenimiento.svg',
  'icons/cat-salud.svg',
  'icons/cat-servicios.svg',
  'icons/cat-ropa.svg',
  'icons/cat-general.svg',
  'icons/cat-otro.svg',
  'icons/filter.svg',
  'icons/calendar.svg',
  'icons/shield.svg',
  'icons/close.svg',
  'icons/check.svg'
].map(a => new URL(a, BASE).href);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(ASSETS.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
