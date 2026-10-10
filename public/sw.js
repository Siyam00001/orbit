// Offline support for the phone app: network first (so updates land), cached copy when offline.
// Only the app's own files are cached — user data lives in IndexedDB, not here.
const CACHE = 'orbit-v2';
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));

// precache the app shell on install — the first page load happens before this worker exists,
// so without this the app wouldn't open offline until the second visit
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const html = await (await fetch('./', { cache: 'no-store' })).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map(m => m[1]);
  await cache.addAll(['./', ...new Set(assets)]);
  await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
        return res;
      })
      // ignoreVary: module scripts carry an Origin header the precache request didn't, so a Vary: Origin entry would miss.
      // Only page navigations fall back to the app shell; a missing script must fail, not get HTML.
      .catch(() => caches.match(request, { ignoreVary: true })
        .then(hit => hit || (request.mode === 'navigate' ? caches.match('./', { ignoreVary: true }) : Response.error()))),
  );
});
