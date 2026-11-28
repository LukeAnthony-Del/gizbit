const CACHE = "gizbit-v50";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "sign-pen.png",
  "mark-in.png",
  "mark-out.png",
  "fonts/outfit-latin.woff2",
  "success.mp3",
  "ringtone.mp3",
  "tab-dashboard.png",
  "tab-sessions.png",
  "tab-documents.png",
  "session-live.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id ? event.notification.data.id : "";
  const target = new URL(`./?tab=requests&request=${encodeURIComponent(id)}`, self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      const path = new URL(client.url).pathname;
      if (path.includes("/terminal")) continue;
      client.postMessage({ type: "open-request", id });
      if (client.focus) await client.focus();
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const freshUrl = new URL(event.request.url);
  freshUrl.searchParams.set("gv", "50");
  event.respondWith(
    fetch(new Request(freshUrl, { cache: "no-store" }))
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
