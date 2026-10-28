/* Service worker — tiene in cache i file dell'interfaccia per l'uso offline.
   Gestisce SOLO i file dentro la propria cartella: le API (/api/v1/...), il
   WebSocket e /health del sensing-server passano sempre dalla rete, anche
   quando l'app è servita dallo stesso server RuView (--ui-path). */
const CACHE = 'ruview-monitor-v1';
const ASSETS = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/store.js',
  './assets/client.js',
  './assets/charts.js',
  './assets/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ruview-monitor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const path = new URL(req.url).pathname;
  if (/\/(api|ws|health)(\/|$)/.test(path)) return;

  // Pagine: prima la rete (aggiornamenti immediati), poi la cache se offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // File statici: dalla cache, aggiornati in background.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// Tocco su una notifica: riporta in primo piano l'app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    const c = list.find((x) => x.url.startsWith(self.registration.scope));
    return c ? c.focus() : self.clients.openWindow('./index.html#eventi');
  }));
});
