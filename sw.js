/* ============================================================================
   FBI — Service Worker (version web / PWA)
   ----------------------------------------------------------------------------
   Rôle : rendre la version web installable et utilisable hors ligne.

   Séparation des responsabilités (cf. FBI_WEB_PLAN.md) :
     - Le SW cache la COQUE : index.html + manifest + icônes. Rien d'autre.
     - Le JSON de la base n'est PAS géré ici. Il est fetché par checkForOtaUpdate()
       dans le HTML et persisté en IndexedDB (fbi-online/kv). Pas de double cache.

   Stratégies :
     - index.html (navigation)  : networkFirst → réseau d'abord (dernière version
       du code), fallback cache si hors ligne.
     - manifest + icônes (assets statiques versionnés) : cacheFirst.

   Mise à jour : quand tu modifies index.html, INCRÉMENTE CACHE_VERSION ci-dessous.
   L'ancien cache est purgé à l'activation du nouveau SW.
   ========================================================================== */

const CACHE_VERSION = 'fbi-web-v1';
const CACHE_NAME = CACHE_VERSION;

// Coquille pré-cachée à l'installation. Chemins relatifs à la racine du scope (/fbi-web/).
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/app-icon-any-192.png',
  './icons/app-icon-any-512.png',
  './icons/app-icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

// ─── Install : pré-cache la coquille, puis prend la main immédiatement ───────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate : purge les caches d'anciennes versions ────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // On ne gère que le GET. Le reste passe au réseau sans interception.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // On ne touche QUE notre propre origine et notre scope.
  // Le JSON de fbi-data (autre origine) n'est jamais intercepté : il reste
  // géré par l'OTA + IndexedDB dans le HTML.
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // networkFirst pour le HTML : on tente le réseau, fallback cache hors ligne.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
    );
    return;
  }

  // cacheFirst pour les assets statiques (manifest, icônes).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Ne cache que les réponses valides de même origine.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
