import { describe, expect, it } from "vitest";
import { assertEnv, envProblems } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "https://dentasync.example.com",
  SETUP_TOKEN: "y".repeat(32),
};

describe("environment check", () => {
  it("accepts a complete production environment", () => {
    expect(envProblems(good)).toEqual([]);
  });

  it("names each missing production variable", () => {
    expect(envProblems({ NODE_ENV: "production" })).toEqual([
      "DATABASE_URL is not set",
      "BETTER_AUTH_SECRET is not set",
      "APP_URL is not set",
      "SETUP_TOKEN is not set",
    ]);
  });

  it("refuses PGlite, short secrets, and an APP_URL that is not an origin", () => {
    const problems = envProblems({
      ...good,
      DATABASE_URL: "pglite:.data/dev",
      BETTER_AUTH_SECRET: "short",
      APP_URL: "https://dentasync.example.com/",
    });
    expect(problems).toContain("DATABASE_URL must be a Postgres URL in production");
    expect(problems).toContain("BETTER_AUTH_SECRET must be at least 32 characters");
    expect(problems.some((p) => p.startsWith("APP_URL must be an origin"))).toBe(true);
  });

  it("needs nothing in development", () => {
    expect(envProblems({ NODE_ENV: "development" })).toEqual([]);
  });

  it("throws with the problems listed", () => {
    expect(() => assertEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is not set/);
  });
});
