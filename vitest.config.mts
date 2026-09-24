process.env.TZ = "UTC";

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests need the Supabase keys. Earlier files win, as in Next.js.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Optional file.
  }
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next.js handles "server-only" itself. Outside Next, point it at Next's own empty module.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
