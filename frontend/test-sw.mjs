import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const handlers = new globalThis.Map();
const shell = new Response("<html>offline shell</html>", {
  headers: { "Content-Type": "text/html" },
});
const context = {
  self: {
    PUDI_PRECACHE: { version: "test", urls: ["/index.html", "/assets/app.js"] },
    location: { origin: "https://pudi.test" },
    clients: { claim: async () => {} },
    addEventListener: (event, fn) => handlers.set(event, fn),
  },
  importScripts: () => {},
  caches: {
    match: async (key) => (key === "/index.html" ? shell.clone() : undefined),
    open: async () => ({
      match: async () => undefined,
      put: async () => {},
      addAll: async () => {},
    }),
    keys: async () => [],
  },
  fetch: async () => {
    throw new Error("offline");
  },
  URL,
  Request,
  Response,
  AbortController,
  setTimeout,
  clearTimeout,
};
vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), context);
const fetchHandler = handlers.get("fetch");
function ignored(url, method = "GET", headers = {}) {
  let intercepted = false;
  fetchHandler({
    request: new Request(url, { method, headers }),
    respondWith: () => {
      intercepted = true;
    },
  });
  return !intercepted;
}
assert.ok(ignored("https://pudi.test/api/listings/nearby"));
assert.ok(ignored("https://pudi.test/api/conversations", "POST"));
assert.ok(ignored("https://api.mapbox.com/styles/v1/mapbox/dark-v11"));
assert.ok(
  ignored("https://pudi.test/assets/app.js", "GET", {
    authorization: "Bearer test",
  }),
);
let promise;
fetchHandler({
  request: {
    url: "https://pudi.test/marketplace",
    method: "GET",
    mode: "navigate",
    headers: new Headers(),
  },
  respondWith: (p) => {
    promise = p;
  },
});
assert.equal(await (await promise).text(), "<html>offline shell</html>");
console.log(
  "PASS: API/POST/Mapbox/auth exclusions and offline navigation fallback.",
);
