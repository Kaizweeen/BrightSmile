/** The end-to-end server's port and its test-only secrets (playwright.config.ts and visit.spec.ts). */
export const E2E = {
  port: 3701,
  setupCode: "e2e-only-setup-code-that-is-at-least-32-characters",
  secret: "e2e-only-auth-secret-that-is-at-least-32-characters",
};
