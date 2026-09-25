import { describe, expect, it } from "vitest";
import { hasRecentRecoverySession } from "@/lib/reset-session";

const now = new Date("2026-09-25T12:00:00Z");
const secondsAgo = (s: number) => Math.floor(now.getTime() / 1000) - s;

describe("hasRecentRecoverySession", () => {
  it("accepts a recent otp method", () => {
    expect(hasRecentRecoverySession({ amr: [{ method: "otp", timestamp: secondsAgo(60) }] }, now)).toBe(true);
  });

  it("accepts a recent recovery method", () => {
    expect(hasRecentRecoverySession({ amr: [{ method: "recovery", timestamp: secondsAgo(60) }] }, now)).toBe(true);
  });

  it("refuses a recovery method older than an hour", () => {
    expect(hasRecentRecoverySession({ amr: [{ method: "recovery", timestamp: secondsAgo(3601) }] }, now)).toBe(false);
  });

  it("refuses an unrelated method like password or email", () => {
    expect(hasRecentRecoverySession({ amr: [{ method: "password", timestamp: secondsAgo(10) }] }, now)).toBe(false);
  });

  it("refuses missing or malformed claims", () => {
    expect(hasRecentRecoverySession(null, now)).toBe(false);
    expect(hasRecentRecoverySession({}, now)).toBe(false);
    expect(hasRecentRecoverySession({ amr: "nope" }, now)).toBe(false);
  });
});
