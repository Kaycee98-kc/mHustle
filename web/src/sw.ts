/// <reference lib="webworker" />
// mHustle service worker: offline app shell + Web Push notifications.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => { void self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()) })

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; tag?: string; url?: string } = {}
  try { data = event.data?.json() ?? {} } catch { data = { body: event.data?.text() } }
  event.waitUntil(self.registration.showNotification(data.title ?? 'mHustle', {
    body: data.body ?? '',
    tag: data.tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url ?? '/?section=followup' },
  }))
})

// Where a tapped notification should take the app. iOS sometimes drops
// postMessage/focus for Home Screen apps, so the target is also left in a
// small cache entry that the app reads whenever it comes to the front.
const NAV_CACHE = 'mh-nav'
const NAV_KEY = '/__mh_pending_nav'

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rel = (event.notification.data?.url as string) ?? '/?section=followup'
  const url = new URL(rel, self.location.origin).href
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(NAV_CACHE)
      await cache.put(NAV_KEY, new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'Content-Type': 'application/json' } }))
    } catch { /* cache unavailable — fall back to the steps below */ }

    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = all.find((c) => new URL(c.url).origin === self.location.origin) as WindowClient | undefined
    if (client) {
      client.postMessage({ type: 'navigate', url })
      try { await client.focus() } catch { /* iOS may refuse; the app reads the cache when it becomes visible */ }
      return
    }
    await self.clients.openWindow(url)
  })())
})
