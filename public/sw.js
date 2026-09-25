// BrightSmile service worker (spec 10.4): shows clinic alerts and opens the requests page on tap.
// It caches nothing: the dashboard always needs live data.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: show the defaults below.
  }
  event.waitUntil(
    self.registration.showNotification(typeof data.title === "string" ? data.title : "BrightSmile", {
      body: typeof data.body === "string" ? data.body : "Open BrightSmile to see what changed.",
      icon: "/brand/icon-192.png",
      lang: "en",
    }),
  );
});

// Always the requests page, whatever the payload says, so a push can never open another site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/app/requests", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === target);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
