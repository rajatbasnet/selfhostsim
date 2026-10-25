/* Sendline service worker.
 * Just enough for the URL to install to a home screen and open while the
 * network blinks. Pages are network-first; static assets are cache-first.
 * API calls are never cached: a stale "phone online" is worse than none. */
const VERSION = 'sendline-v1'
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon.svg', '/offline.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // never touch the API
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined)
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html'))),
    )
    return
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => undefined)
            return res
          }),
      ),
    )
  }
})
