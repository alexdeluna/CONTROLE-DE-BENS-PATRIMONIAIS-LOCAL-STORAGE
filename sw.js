const CACHE_NAME = "delunatech-patrimonial-local-v1";
const APP_SHELL = [
  "./", "./index.html", "./css/style.css", "./js/app.js", "./js/db.js",
  "./js/schema.js", "./js/importacao.js", "./manifest.json",
  "./assets/delunatech-emblema.png", "./assets/icone-gestao-patrimonial.png",
  "./assets/icone-gestao-patrimonial.svg"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match("./index.html"))));
});
