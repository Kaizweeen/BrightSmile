import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    env: {
      DATABASE_URL: "pglite:memory",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
      APP_URL: "http://localhost:3700",
      SETUP_TOKEN: "test-setup-token-that-is-at-least-32-chars",
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts", "tests/api/**/*.test.ts"],
          // Each file runs its own in-memory Postgres; more than two at once can crash the workers on Windows.
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
          setupFiles: ["tests/setup-db.ts"],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
