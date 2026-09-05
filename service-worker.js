// AbhiTools Public UI Cleanup Build 1 hardened service worker
// SECURITY RULE: /api/* responses and authenticated financial data are never cached.
const CACHE_NAME = 'abhi-tools-shell-v2-4-stable-v15';
const API_GET_TIMEOUT_MS = 8000;
const API_GET_RETRY_DELAY_MS = 350;
const API_GET_RETRY_STATUSES = new Set([408, 502, 503, 504]);
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/public_script.js',
  '/pwa.js',
  '/ui_smoothness.css',
  '/ui_performance.js',
  '/ui_shell.css',
  '/ui_shell.js',
  '/ui_loans.css',
  '/ui_loans.js',
  '/ui_home_collections.css',
  '/ui_home_collections.js',
  '/ui_forms_secondary.css',
  '/ui_forms_secondary.js',
  '/ui_public_compact.js',
  '/ui_upi_payments.js',
  '/version.json',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/advanced_admin_login_panel.html',
  '/offline.html'
];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchApiGetWithRetry(request) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (request.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');

    const controller = new AbortController();
    const abortFromClient = () => controller.abort();
    request.signal?.addEventListener?.('abort', abortFromClient, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), API_GET_TIMEOUT_MS);

    try {
      const response = await fetch(request.clone(), { signal: controller.signal });
      clearTimeout(timeoutId);
      request.signal?.removeEventListener?.('abort', abortFromClient);

      if (!API_GET_RETRY_STATUSES.has(response.status) || attempt === 1) return response;
      try { await response.body?.cancel(); } catch {}
    } catch (error) {
      clearTimeout(timeoutId);
      request.signal?.removeEventListener?.('abort', abortFromClient);
      lastError = error;
      if (request.signal?.aborted || attempt === 1) throw error;
    }

    await wait(API_GET_RETRY_DELAY_MS);
  }

  throw lastError || new Error('API GET failed');
}

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

  // Never cache API/auth/financial responses. GET reads get one safe transient retry only.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetchApiGetWithRetry(request));
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
