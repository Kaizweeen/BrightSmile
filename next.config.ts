import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // web-push signs VAPID tokens and encrypts payloads with Node's crypto; load it with require, unbundled.
  serverExternalPackages: ["web-push"],
  async headers() {
    // VERCEL is "1" during Vercel builds, where the site is always served over https.
    return securityHeaders({ dev: process.env.NODE_ENV === "development", https: process.env.VERCEL === "1" });
  },
};

export default nextConfig;
