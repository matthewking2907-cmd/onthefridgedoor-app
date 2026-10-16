// Minimal offline cache for On the FridgeDoor — caches the app shell on install so
// it still opens (with whatever data localStorage already has) with no
// signal, and always tries the network first for a fresh copy when online.
const CACHE_NAME = 'family-hub-onboarding-v44';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

// Reminders: the server sends { title, body, tag, url }; show it, and open (or focus) the app when tapped.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  // nudges come with quick-reply buttons (shown on Android, Windows and Mac; iPhone shows none and just opens the app)
  const actions = d.reply ? [{ action: 'r:OK \ud83d\udc4d', title: 'OK \ud83d\udc4d' }, { action: 'r:On my way', title: 'On my way' }] : [];
  event.waitUntil(self.registration.showNotification(d.title || 'On the FridgeDoor', {
    body: d.body || '', tag: d.tag || undefined, icon: 'icon-192.png', badge: 'icon-192.png', actions: actions,
    data: { url: d.url || './', reply: d.reply || null }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (event.action && event.action.indexOf('r:') === 0 && data.reply) {
    event.waitUntil(self.registration.pushManager.getSubscription().then((sub) => fetch(data.reply.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reply', token: data.reply.token, reply: event.action.slice(2), endpoint: sub ? sub.endpoint : '' })
    })).catch(() => {}));
    return;
  }
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
