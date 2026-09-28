import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite loads its WebAssembly build from node_modules at run time, so it stays out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
