// Solo para poder instalarla como app: la página se pide siempre a la red y no se cachean datos
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.method === 'GET' && new URL(e.request.url).origin === location.origin) e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
