import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW } from "@/lib/security-headers";

/** Booking pages, the landing page, and the legal pages are public; the private areas are not. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW } };
}
