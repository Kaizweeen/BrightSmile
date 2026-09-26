type Header = { key: string; value: string };
export type HeaderRule = { source: string; headers: Header[] };

/**
 * Next's CSP guide, "Without Nonces": inline scripts stay allowed because Next's bootstrap scripts are
 * inline and nonces would make every page dynamic. 'unsafe-eval' is only for next dev (React's debugging).
 * upgrade-insecure-requests only where the site is served over https.
 */
export function contentSecurityPolicy(dev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Pay online: a form posted before hydration follows a redirect to PayMongo's hosted checkout.
    "form-action 'self' https://checkout.paymongo.com",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Pages no search engine should list (Global Constraints): X-Robots-Tag on each. */
export const NOINDEX_SOURCES = [
  "/app/:path*",
  "/a/:path*",
  "/onboarding/:path*",
  "/login",
  "/signup",
  "/forgot",
  "/reset-password",
  "/auth/:path*",
  "/api/:path*",
  "/admin/:path*",
];

/**
 * The same areas for robots.txt, which matches by prefix: the trailing slashes on /app/, /a/, /auth/, and
 * /api/ keep booking links like /apple-dental crawlable. /app itself is covered by its noindex header.
 */
// Folder prefixes only. robots.txt matches by prefix, so a page like /login would also hide a clinic whose
// booking link is /login-dental; the single auth pages rely on their X-Robots-Tag noindex header instead.
export const ROBOTS_DISALLOW = ["/app/", "/a/", "/onboarding/", "/auth/", "/api/"];

/** Everything next.config.ts sends. Later rules override earlier ones with the same key, so /sw.js goes last. */
export function securityHeaders({ dev, https }: { dev: boolean; https: boolean }): HeaderRule[] {
  const everywhere: Header[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev, https) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
  return [
    { source: "/:path*", headers: everywhere },
    ...NOINDEX_SOURCES.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ];
}
