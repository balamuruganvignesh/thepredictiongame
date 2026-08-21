/*
 * The offline app shell.
 *
 * Hand-written rather than generated, because the one thing a generated
 * precache manifest buys -- knowing Vite's content-hashed filenames at build
 * time -- this app doesn't need. Its assets are already immutable by URL and
 * already served `Cache-Control: immutable`, so caching them on first use is
 * as good as precaching them, without a build step that has to stay in sync.
 *
 * THE RULE THIS MUST NOT BREAK: index.html is served `no-cache` on purpose --
 * a returning player who keeps loading a stale bundle after a deploy
 * reconnects into a protocol they no longer speak. So navigations are
 * network-FIRST here, and the cached shell is only ever reached for when the
 * network genuinely isn't there. Being online always gets you the real,
 * current index.html.
 */

const VERSION = 'v1'
const SHELL_CACHE = `shell-${VERSION}`
const ASSET_CACHE = `assets-${VERSION}`

self.addEventListener('install', (event) => {
  // Just the shell entry point. Everything else lands in the cache the first
  // time it's actually fetched.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add('/'))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/**
 * Anything the game actually plays through. A service worker sitting in front
 * of the socket handshake or a live API read can only ever get in the way, so
 * these are not intercepted at all -- not cached, not retried, not touched.
 */
function isLiveTraffic(url) {
  return url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')
}

/** Content-hashed bundles and the card sprites: immutable by URL. */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/cards/') ||
    url.pathname.startsWith('/cards-classic/') ||
    url.pathname.startsWith('/icon-')
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isLiveTraffic(url)) return

  // Navigations: network first, shell as the offline fallback. Every table
  // code (/ABCD) is a navigation to the same SPA entry point, so one cached
  // shell answers all of them.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/').then((cached) => cached ?? Response.error())),
    )
    return
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            // Only cache a real success -- a 404 or an opaque error cached
            // under an immutable URL would never be retried.
            if (response.ok) {
              const copy = response.clone()
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
  }
})
