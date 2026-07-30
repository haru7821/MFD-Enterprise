/*
 * Service worker — the app shell, and nothing else.
 *
 * Owner decision: the product is web-native, and a Progressive Web App is a target platform.
 * Installability needs a service worker, so this is the smallest one that is honest.
 *
 * ## What it caches, and what it deliberately does not
 *
 * | | |
 * | --- | --- |
 * | Hashed build assets (`/assets/*`) | **Cache first.** Their names are content hashes, so a cached copy can never be the wrong version. |
 * | Navigations (the HTML) | **Network first**, cache as a fallback. |
 * | Everything else | Straight to the network. |
 * | **Project files** | **Never.** They are not fetched — a `.mfd.json` arrives through a file input and leaves as a download. |
 *
 * Offline capability for recently opened *projects* is a future sprint, per the owner. This
 * caches the application, not the work: a second visit loads the editor with no network, and an
 * engineer still opens their own file from disk.
 *
 * ## Why navigations are network-first, which matters more than it looks
 *
 * A stale application is a real hazard in this product, not an inconvenience. An old build
 * carries an old rule set and an old document version, and it would generate a report that
 * looks current and is not — the exact class of quiet wrongness the whole codebase is arranged
 * to prevent.
 *
 * Network-first HTML means a new deploy is picked up on the next load. Cache-first hashed
 * assets are safe *because* they are hashed: a new deploy references new filenames, so a cached
 * old asset is never served to a new HTML.
 *
 * ## No precache manifest
 *
 * Nothing is cached until it is used, which is why this file needs no build-time asset list and
 * no plugin. The cost is that the first visit must be online — which it must be anyway, since
 * that is when the application arrives.
 */

// Bump to evict everything. Tied to the app version, so a release cannot silently inherit a
// previous release's cache.
const CACHE = 'mfd-e-shell-v0.5.0';

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close. Combined with
  // network-first navigation, this is what keeps an engineer from working in a stale build.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET, and only this origin. A POST is never idempotent enough to replay from a cache,
  // and a cross-origin response is not ours to store.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
          return response;
        } catch {
          // Offline. The cached shell is the right answer here — the alternative is a browser
          // error page for an application the engineer has already installed.
          const cached = await caches.match(request);
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed assets: cache first. Safe because the filename *is* the version.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});
