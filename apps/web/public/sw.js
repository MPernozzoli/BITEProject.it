const STATIC_CACHE = "bite-static-v2";
const RUNTIME_CACHE = "bite-runtime-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.ico", "/icons/icon-192.png"];

function isCacheableAsset(request, url) {
  if (url.pathname.startsWith("/node_modules/") || url.pathname.startsWith("/src/") || url.pathname.includes("/@vite")) {
    return false;
  }

  if (["script", "style"].includes(request.destination)) {
    return false;
  }

  return ["image", "font"].includes(request.destination)
    || url.pathname.endsWith(".webmanifest")
    || url.pathname.endsWith(".svg")
    || url.pathname.endsWith(".png")
    || url.pathname.endsWith(".jpg")
    || url.pathname.endsWith(".jpeg")
    || url.pathname.endsWith(".webp")
    || url.pathname.endsWith(".woff2");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/")).then((response) => response || Response.error()),
    );
    return;
  }

  if (!isCacheableAsset(request, url)) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseClone = response.clone();
        void caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseClone));
        return response;
      });
    }),
  );
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {};

  if (payload.closeTag) {
    event.waitUntil(
      self.registration.getNotifications({ tag: payload.closeTag }).then((notifications) => {
        notifications.forEach((notification) => notification.close());
      }),
    );
    return;
  }

  const title = payload.title || "BITE";
  const options = {
    body: payload.body || "New update available.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag,
    data: {
      url: payload.url || "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
