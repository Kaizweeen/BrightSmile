import { defineConfig, devices } from "@playwright/test";

// The test seeds data with the Supabase keys, and PLAYWRIGHT_BROWSERS_PATH may live here too. Earlier files win.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Optional file.
  }
}
// The test reads the verification code from sms_log, which only log mode stores (spec 10.6).
process.env.SMS_MODE = "log";

/** Spec 14: one end-to-end test against the dev server on port 3600 (started if it isn't running). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3600", trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3600",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
