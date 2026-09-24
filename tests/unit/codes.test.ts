import { beforeAll, describe, expect, it } from "vitest";
import { checkCode, hashCode, isRateLimited, newCode, newToken, OTP, readDevice, signDevice } from "@/lib/codes";

beforeAll(() => {
  process.env.APP_SECRET ??= "unit-test-secret";
});

const now = new Date("2026-09-22T01:00:00Z");

describe("verification codes", () => {
  it("makes 6 digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  const request = () => ({
    id: "r1",
    code_hash: hashCode("r1", "123456"),
    attempts: 0,
    expires_at: new Date(now.getTime() + OTP.ttlMs),
    verified_at: null as Date | null,
  });

  it("accepts the right code and rejects a wrong one", () => {
    expect(checkCode(request(), "123456", now)).toBe("ok");
    expect(checkCode(request(), " 123456 ", now)).toBe("ok");
    expect(checkCode(request(), "654321", now)).toBe("wrong");
  });

  it("refuses used, expired, and locked requests", () => {
    expect(checkCode({ ...request(), verified_at: now }, "123456", now)).toBe("used");
    expect(checkCode(request(), "123456", new Date(now.getTime() + OTP.ttlMs))).toBe("expired");
    expect(checkCode({ ...request(), attempts: OTP.maxAttempts }, "123456", now)).toBe("locked");
  });

  it("binds the hash to its request", () => {
    expect(hashCode("r1", "123456")).not.toBe(hashCode("r2", "123456"));
  });

  it("rate limits at 3 per mobile and 10 per IP address", () => {
    expect(isRateLimited(2, 9)).toBe(false);
    expect(isRateLimited(3, 0)).toBe(true);
    expect(isRateLimited(0, 10)).toBe(true);
  });
});

describe("manage tokens", () => {
  it("are 12 base62 characters and unique", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(newToken()).not.toBe(token);
  });
});

describe("verified-device cookie", () => {
  it("round-trips", () => {
    expect(readDevice(signDevice(["+639171234567"], now), now)).toEqual(["+639171234567"]);
  });

  it("keeps the last 5 distinct mobiles", () => {
    const mobiles = ["+639000000001", "+639000000002", "+639000000003", "+639000000004", "+639000000005", "+639000000006"];
    expect(readDevice(signDevice(mobiles, now), now)).toEqual(mobiles.slice(1));
  });

  it("rejects tampered, expired, and malformed cookies", () => {
    const value = signDevice(["+639171234567"], now);
    const signature = value.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ m: ["+639999999999"], exp: now.getTime() + 1e9 })).toString("base64url");
    expect(readDevice(`${forged}.${signature}`, now)).toEqual([]);
    expect(readDevice(value, new Date(now.getTime() + 181 * 86_400_000))).toEqual([]);
    expect(readDevice("garbage", now)).toEqual([]);
    expect(readDevice(undefined, now)).toEqual([]);
  });
});
