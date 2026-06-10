/**
 * Service Worker for Tickr PWA.
 *
 * Handles offline caching of the app shell. RxDB manages all data
 * sync, so this SW only caches static assets and the HTML shell.
 * Vite-built assets use content hashes, so they are cache-safe.
 */

const CACHE_NAME = "tickr-v__APP_VERSION__";

// Install event - pre-cache the app shell.
// Deliberately no skipWaiting() here: a new worker stays in "waiting" until the
// user accepts the in-app update prompt (SKIP_WAITING message). Auto-activating
// here would, combined with clients.claim(), fire controllerchange on every
// fresh load and trap the page in a reload loop.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/", "/manifest.json"])),
  );
});

// Activate event - clean up old caches.
// Deliberately no clients.claim(): claiming an uncontrolled page fires
// controllerchange, which the client turns into a reload — that is the loop we
// must avoid. The new worker takes control on the next navigation instead.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

// Fetch event - caching strategy per resource type
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests - network only (RxDB handles offline data)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch((error) => {
        if (error.name === "AbortError") {
          throw error;
        }
        return new Response(JSON.stringify({ error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return;
  }

  // HTML pages - network first, fall back to cache
  if (
    request.headers.get("accept")?.includes("text/html") ||
    url.pathname === "/"
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful shells; never persist a 429/503 as "/".
          if (response.ok) {
            const responseToCache = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, responseToCache));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ||
              new Response("Offline - no cached version available", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              }),
          ),
        ),
    );
    return;
  }

  // Static assets (Vite hashed files) - cache first, update in background
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const responseToCache = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, responseToCache));
        return response;
      });
      return cachedResponse || fetchPromise;
    }),
  );
});

// Listen for skip waiting message from client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
