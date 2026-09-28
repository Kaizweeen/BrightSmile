// BrightSmile service worker (spec 10.4): shows clinic alerts. A tap opens Reports for the Monday summary and the
// requests page for everything else. It caches nothing: the dashboard always needs live data.

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
      // Only whether this is the weekly summary reaches the tap, never a URL (teams spec 6.4).
      data: { weekly: data.type === "weekly" },
    }),
  );
});

// A fixed page, whatever the payload says, so a push can never open another site: Reports for the weekly summary,
// the requests page for everything else.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const weekly = Boolean(event.notification.data && event.notification.data.weekly === true);
  const target = new URL(weekly ? "/app/reports" : "/app/requests", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === target);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
