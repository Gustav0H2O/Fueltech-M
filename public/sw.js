/* FuelTech Master — Service Worker (PWA)
   Estrategia NETWORK-FIRST: siempre intenta la red primero (nunca sirve código viejo);
   si no hay conexión, responde desde caché. Así el mecánico puede consultar en el taller
   aunque la señal sea mala, sin arriesgar servir una versión desactualizada de la app. */
const CACHE = 'fueltech-v1';
const SHELL = [
  '/', '/app.js', '/fx.js', '/three3d.js', '/manifest.webmanifest', '/icon.svg',
  '/vendor/react.production.min.js', '/vendor/react-dom.production.min.js',
  '/vendor/htm.js', '/vendor/lucide.js', '/vendor/three.module.js'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // no tocar terceros (fuentes, etc.)
  if (url.pathname.startsWith('/api/')) return;     // el API nunca se cachea

  e.respondWith((async () => {
    try {
      const net = await fetch(req);
      if (net && net.ok && net.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, net.clone());
      }
      return net;
    } catch (err) {
      const cached = await caches.match(req);
      return cached || caches.match('/');
    }
  })());
});
