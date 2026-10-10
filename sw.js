// Network first so plan updates show straight away; the cache is only the offline fallback.
const CACHE = 'hyrox-v17';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'store.js', 'muscles.js', 'plan.json', 'manifest.webmanifest', 'icon-192.png', ...['arnold', 'ronnie', 'lou', 'cbum', 'zane', 'cutler'].map(h => `heads/${h}.jpg`)];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.status === 200) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
