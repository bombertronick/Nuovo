/* Service worker — strategia "network-first" (prima la rete).
   Quando sei ONLINE ricevi sempre l'ultima versione pubblicata; OFFLINE usi
   l'ultima copia salvata. Così gli aggiornamenti si vedono subito, senza restare
   bloccati su una versione vecchia in cache. */
const CACHE = 'gestionale-cantieri-v3';
const ASSETS = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/db.js',
  './assets/app.js',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  // Pre-carica gli asset per l'uso offline, poi attiva subito il nuovo SW.
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Prima la rete: prova a scaricare la versione aggiornata; se fallisce (offline)
  // ripiega sulla cache; per le navigazioni ripiega sull'index.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
