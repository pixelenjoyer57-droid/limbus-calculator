// Offline cache: pages and un-hashed files (icons, manifest) are network-first (so updates
// arrive), built assets under assets/ are cache-first (their file names change on every build),
// game data (gamedata/*.json) is stale-while-revalidate: instant from the cache, refreshed in
// the background. Only same-origin, successful ("ok", basic) responses are ever cached, so an
// error page or an opaque cross-origin response can't be stored and served later.
// Bump CACHE when this logic changes; old caches are deleted on activate.
const CACHE = "sinners-workshop-v3";
const cacheable = (res) => res && res.ok && res.type === "basic";
const put = (req, res) => {
  if (cacheable(res)) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
  }
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          put(req, res);
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./") || caches.match("./index.html"))),
    );
    return;
  }
  if (url.pathname.includes("/gamedata/")) {
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((cached) => {
          const net = fetch(req)
            .then((res) => {
              if (cacheable(res)) c.put(req, res.clone());
              return res;
            })
            .catch(() => cached || Response.error());
          return cached || net;
        }),
      ),
    );
    return;
  }
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            put(req, res);
            return res;
          }),
      ),
    );
    return;
  }
  // Everything else (icons, manifest): network-first, cache as the offline fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        put(req, res);
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});
