// Service worker: cachea la carcasa de la app (para abrir sin cobertura) y recibe los avisos Web Push.
// Nunca cachea las llamadas al gateway (datos de clientes).
const CACHE = 'agente-v9';
const SHELL = ['./', 'index.html', 'app.js', 'followups.js', 'templates.js', 'supervisor.js', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png'];
const PUSH_API = 'https://n8n.alchimedia.co.uk/webhook/agent-push';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // red primero (para recibir actualizaciones), caché como respaldo
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./')))
  );
});

// ---------- Web Push ----------
// El servidor manda un push SIN texto; aquí se piden los mensajes pendientes del agente (push_pull) con la clave guardada en IndexedDB
// (el service worker no ve localStorage). En iOS todo push debe acabar en una notificación visible, por eso siempre hay un texto de respaldo.
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('agente', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbGet = async (k) => { const db = await idb(); return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); };
const idbSet = async (k, v) => { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
const show = (m, quiet) => self.registration.showNotification(m.title || 'Seguimiento pendiente', {
  body: m.body || 'Tienes clientes por seguir.', tag: m.tag || 'fu', renotify: !quiet, requireInteraction: true,
  icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './#seguimiento' } });

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let shown = 0;
    try {
      const key = await idbGet('agent_key');
      if (key) {
        const lastId = (await idbGet('last_msg')) || 0;
        const res = await fetch(PUSH_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key },
          body: JSON.stringify({ action: 'push_pull', since_id: lastId, since: Math.floor(Date.now() / 1000) - 900 }) });
        const msgs = ((await res.json()).messages || []);
        for (const m of msgs) { await show(m); shown++; }
        if (msgs.length) await idbSet('last_msg', Math.max(lastId, ...msgs.map((m) => m.id)));
      }
    } catch (err) { /* sin red o clave inválida: se muestra el aviso genérico */ }
    if (!shown) await show({ title: 'Seguimiento pendiente', body: 'Abre la app para ver tus clientes por seguir.', tag: 'fu-fallback' }, true);
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './#seguimiento', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
