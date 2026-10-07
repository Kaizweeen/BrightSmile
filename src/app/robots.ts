import type { MetadataRoute } from "next";

/** Only the clinic's landing page is for search engines; the rest of DentaSync is private. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/$", disallow: "/" } };
}
