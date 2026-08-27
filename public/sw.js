// Minimal offline shell for the SatCom page so the messaging console and cached
// node status remain viewable with no connection. Registered from
// src/app/dashboard/satcom/page.tsx; safe to ignore if registration fails.
const CACHE_NAME = 'satcom-shell-v1';
const SHELL_URLS = ['/dashboard/satcom'];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).catch(() => undefined)
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || !request.url.includes('/dashboard/satcom')) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => undefined);
                return response;
            })
            .catch(() => caches.match(request))
    );
});
