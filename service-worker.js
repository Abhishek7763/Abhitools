// AbhiTools Phase 17 hardened service worker
// SECURITY RULE: /api/* responses and authenticated financial data are never cached.
const CACHE_NAME = 'abhi-tools-shell-p17-v1';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/public_script.js',
  '/pwa.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/advanced_admin_login_panel.html',
  '/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('abhi-tools-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API/auth/financial responses.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // Network-first static assets: online users always get the newest deploy; cache is offline fallback only.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});


self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/admin.html';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(targetUrl);
          return;
        }
      } catch {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
