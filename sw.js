/* Service Worker: App offline verfügbar machen.
   Bei Änderungen an den App-Dateien VERSION erhöhen, damit Nutzer die neue Version bekommen. */
const VERSION = "sk-v2.2.0";
const APP = ["./", "index.html", "style.css", "config.js", "js/core.js", "js/features.js", "js/views.js", "js/main.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];
const CDN = /^(https:\/\/cdnjs\.cloudflare\.com|https:\/\/cdn\.jsdelivr\.net|https:\/\/fonts\.(googleapis|gstatic)\.com)/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Bibliotheken und Schriften: zuerst Cache
  if (CDN.test(req.url)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Eigene Dateien: Netz zuerst (immer aktuell), offline aus dem Cache
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch:true}).then(r => r || caches.match("index.html"))));
  }
  // Alles andere (Claude, Supabase, YouTube) geht direkt ins Netz
});
