import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl } from "@/lib/app-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("appUrl", () => {
  it("strips a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://brightsmile.ph/");
    expect(appUrl()).toBe("https://brightsmile.ph");
  });

  it("falls back to localhost outside production", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(appUrl()).toBe("http://localhost:3600");
  });

  it("throws in production when APP_URL is missing", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => appUrl()).toThrow("APP_URL is not set");
  });
});
