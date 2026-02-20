const CACHE = "tri-lang-translator-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install: cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))))
    )
  );
  self.clients.claim();
});

function isAPIRequest(url) {
  return (
    url.includes("translation.googleapis.com") ||
    url.includes("/translate") ||
    url.includes("/detect") ||
    url.includes("wiktionary.org/api/")
  );
}

// Fetch strategy:
// - App shell: cache-first
// - API calls: network-only (so the app requires internet for accuracy)
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (isAPIRequest(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});