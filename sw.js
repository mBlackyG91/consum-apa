/* Service worker: aplicația pornește și fără internet.
 * Fișierele aplicației se servesc din cache și se actualizează în fundal
 * (la următoarea deschidere apare versiunea nouă). Cererile către Google
 * (autentificare, Drive) nu trec niciodată prin cache. */
const CACHE = 'consum-apa-v4';
const ASSETS = [
  './', './index.html', './styles.css', './config.js', './drive.js', './pdf.js', './app.js', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google: direct la rețea
  const scope = new URL(self.registration.scope);
  const isAppPage = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
  if (req.mode === 'navigate' && !isAppPage) return; // alte pagini (ex. teste): direct la rețea
  const key = isAppPage ? './index.html' : req;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
