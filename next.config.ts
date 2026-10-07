import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite loads its WebAssembly build from node_modules at run time, so it stays out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // The landing page used to live at /clinic; it is the site's front page now.
  async redirects() {
    return [{ source: "/clinic", destination: "/", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
