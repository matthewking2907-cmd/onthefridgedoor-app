// Minimal offline cache for On the FridgeDoor — caches the app shell on install so
// it still opens (with whatever data localStorage already has) with no
// signal, and always tries the network first for a fresh copy when online.
const CACHE_NAME = 'family-hub-onboarding-v99';
const APP_SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const SHARE_CACHE = 'fh-share';   // what another app shared, until the app picks it up (src/ob_quickadd.js)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME && n !== SHARE_CACHE).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Share to On the FridgeDoor (manifest share_target): keep the text and picture another app shared, then open the app,
// which picks them up from SHARE_CACHE and opens Quick add with them (or the shopping list / task choice).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || !/\/share-target$/.test(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const fd = await event.request.formData();
      const title = String(fd.get('title') || '').trim(), text = String(fd.get('text') || '').trim(), link = String(fd.get('url') || '').trim();
      const words = [title && text.indexOf(title) < 0 ? title : '', text, link && text.indexOf(link) < 0 ? link : ''].filter(Boolean).join('\n');
      const file = fd.getAll('image').find((f) => f && typeof f !== 'string' && /^image\//.test(f.type || ''));
      const cache = await caches.open(SHARE_CACHE);
      await cache.put('__share-text', new Response(words.slice(0, 6000)));
      if (file && file.size < 25000000) await cache.put('__share-image', new Response(file, { headers: { 'Content-Type': file.type } }));
      else await cache.delete('__share-image');
    } catch (e) {}
    return Response.redirect(new URL('index.html?share=1', self.location.href).href, 303);
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // only the app's own files: never keep copies of sync, calendar or font replies on the device
  if (new URL(event.request.url).origin !== self.location.origin) return;
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
  // nudges come with quick-reply buttons (shown on Android, Windows and Mac; iPhone shows none and just opens the app).
  // An urgent one stays on screen and buzzes again each time it's re-sent, until someone taps Got it.
  const urgent = !!(d.reply && d.urgent);
  const actions = !d.reply ? [] : urgent ? [{ action: 'r:Got it', title: 'Got it ✓' }]
    : [{ action: 'r:OK 👍', title: 'OK 👍' }, { action: 'r:On my way', title: 'On my way' }];
  const opts = { body: d.body || '', tag: d.tag || undefined, icon: 'icon-192.png', badge: 'icon-192.png', actions: actions,
    data: { url: d.url || './', reply: d.reply || null, urgent: urgent } };
  if (urgent) { opts.requireInteraction = true; opts.renotify = !!d.tag; opts.vibrate = [400, 200, 400, 200, 400]; }
  // an open app (the kitchen display, say) shows a nudge full screen too
  const tell = d.reply ? self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => {
    try { c.postMessage({ type: 'fh-nudge', title: d.title || '', body: d.body || '', tag: d.tag || '', urgent: urgent, reply: d.reply }); } catch (e) {}
  })).catch(() => {}) : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(d.title || 'On the FridgeDoor', opts), tell]));
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
