import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, NOINDEX_SOURCES, ROBOTS_DISALLOW, securityHeaders, type HeaderRule } from "@/lib/security-headers";

const header = (rule: HeaderRule | undefined, key: string) => rule?.headers.find((h) => h.key === key)?.value;

describe("contentSecurityPolicy", () => {
  it("is strict in production and forbids framing", () => {
    const csp = contentSecurityPolicy(false, true);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("lets Pay online reach PayMongo checkout even from a form posted before the page loaded", () => {
    // form-action also governs where a form submission may redirect; the checkout lives on PayMongo.
    expect(contentSecurityPolicy(false, true)).toContain("form-action 'self' https://checkout.paymongo.com;");
  });

  it("allows eval only for next dev, and upgrades requests only over https", () => {
    expect(contentSecurityPolicy(true, false)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false, false)).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  it("sends the security headers on every path, with HSTS only on Vercel", () => {
    const [all] = securityHeaders({ dev: false, https: true });
    expect(all.source).toBe("/:path*");
    expect(header(all, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(all, "X-Frame-Options")).toBe("DENY");
    expect(header(all, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(all, "Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(header(all, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    const [local] = securityHeaders({ dev: false, https: false });
    expect(header(local, "Strict-Transport-Security")).toBeUndefined();
  });

  it("marks every private area noindex", () => {
    const rules = securityHeaders({ dev: false, https: true });
    for (const source of NOINDEX_SOURCES) {
      expect(header(rules.find((r) => r.source === source), "X-Robots-Tag")).toBe("noindex, nofollow");
    }
    expect(NOINDEX_SOURCES).toEqual([
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
    ]);
  });

  it("serves the service worker uncached with its own CSP, as the last rule", () => {
    const rules = securityHeaders({ dev: false, https: true });
    const sw = rules.at(-1);
    expect(sw?.source).toBe("/sw.js");
    expect(header(sw, "Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(header(sw, "Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    expect(header(sw, "Content-Security-Policy")).toBe("default-src 'self'; script-src 'self'");
  });
});

describe("ROBOTS_DISALLOW", () => {
  const blocked = (path: string) => ROBOTS_DISALLOW.some((prefix) => path.startsWith(prefix));

  it("keeps crawlers out of the private areas", () => {
    for (const path of ["/app/requests", "/a/AbCdEfGhIjKl", "/onboarding/", "/auth/confirm", "/api/cron/daily"]) {
      expect(blocked(path)).toBe(true);
    }
  });

  it("never catches a booking link or a public page", () => {
    for (const path of ["/", "/demo", "/apple-dental", "/apple-icon.png", "/aura-smile", "/privacy", "/terms", "/manifest.webmanifest", "/login-dental", "/forgot-me-not-dental", "/signupsmile", "/onboarding-clinic", "/reset-password-care"]) {
      expect(blocked(path)).toBe(false);
    }
  });
});
