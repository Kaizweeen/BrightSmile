import type { MetadataRoute } from "next";

/** Spec 10.4: the dashboard installs as an app that opens on the requests page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/requests",
    name: "BrightSmile",
    short_name: "BrightSmile",
    description: "Booking requests and schedule for your dental clinic.",
    start_url: "/app/requests",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#12727e",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
