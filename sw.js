import { makeRangeResponse } from "./helpers/rangeresponse.js";

// Both are filled in by build.mjs: VERSION is a hash of the built files and
// PRECACHE lists them, relative to this worker's scope
const CACHE_NAME = `lunar-lander-${VERSION}`;

// The built files keep the same names from one release to the next, so every
// file is served from a single versioned cache rather than a mix of network
// and cache, which could pair a new index.html with an old index.js. A new
// release is fetched in the background and takes over on the next launch.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Skip the HTTP cache so a fresh release isn't stored with stale files
        cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("lunar-lander-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Analytics and anything else off-site goes straight to the network
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Any navigation, including ?sensor-sim, gets the cached page
      const cached =
        request.mode === "navigate"
          ? await cache.match("index.html")
          : await cache.match(request);
      if (!cached) return fetch(request);

      const range = request.headers.get("Range");
      return range ? makeRangeResponse(range, cached) : cached;
    })()
  );
});
