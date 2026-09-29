import { defineConfig } from "@playwright/test";
import { E2E } from "./tests/e2e/env";

const origin = `http://localhost:${E2E.port}`;

/** Spec 14: one end-to-end run, against its own development server and database. */
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: origin,
    // PLAYWRIGHT_CHANNEL=chrome (or msedge) uses an installed browser instead of Playwright's own Chromium.
    channel: process.env.PLAYWRIGHT_CHANNEL,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${origin}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PORT: String(E2E.port),
      DATABASE_URL: "pglite:.data/e2e",
      APP_URL: origin,
      BETTER_AUTH_SECRET: E2E.secret,
      SETUP_TOKEN: E2E.setupCode,
    },
  },
});
