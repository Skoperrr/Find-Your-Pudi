/* Generated precache manifest lists the build's real JS/CSS/font assets. */
importScripts("/precache-manifest.js");
const PREFIX = "pudi-shell-";
const CACHE = PREFIX + self.PUDI_PRECACHE.version;
const SHELL = self.PUDI_PRECACHE.urls;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(
        SHELL.map((url) => new Request(url, { cache: "reload" })),
      );
    })(),
  );
  // Do not force activation while a user is negotiating or using an older bundle.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Never cache API responses, chat, credentials, third-party Mapbox tiles or POSTs.
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    req.headers.has("authorization")
  )
    return;
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        try {
          return await fetch(req, { signal: controller.signal });
        } catch {
          return (
            (await caches.match("/index.html", { cacheName: CACHE })) ||
            (await caches.match("/offline.html", { cacheName: CACHE })) ||
            new Response("You are offline. Reconnect to load Pudi Local.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
          );
        } finally {
          clearTimeout(timeout);
        }
      })(),
    );
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        const response = await fetch(req);
        if (response.ok) await cache.put(url.pathname, response.clone());
        return response;
      })(),
    );
  }
});
