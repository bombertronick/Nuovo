/* Service worker dell'Agent Office: cache-first, scope limitato a /ufficio/. */
const CACHE = 'agent-office-v1';
const ASSETS = [
  './', './index.html', './assets/ui.css', './icona.svg', './manifest.webmanifest',
  './src/main.js', './src/config.js', './src/store.js', './src/orchestrator.js', './src/backends.js', './src/ui.js',
  './src/three/world.js', './src/three/office.js', './src/three/character.js', './src/three/utils.js',
  './vendor/three.module.min.js', './vendor/three.core.min.js', './vendor/controls/OrbitControls.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;
  ev.respondWith(caches.match(ev.request).then((hit) => hit || fetch(ev.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(ev.request, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match('./index.html'))));
});
