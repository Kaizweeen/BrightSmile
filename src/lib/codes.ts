import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Spec section 10.3.
export const OTP = {
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendMs: 60_000,
  perMobilePerHour: 3,
  perIpPerHour: 10,
} as const;

// Spec: caps how many pending online requests one mobile can hold at once, so one number can't
// flood a clinic's (or the whole platform's) pending queue with unconfirmed requests.
export const BOOKING_CAPS = {
  perClinic: 3,
  total: 5,
} as const;

export const DEVICE_COOKIE = "bs_verified";
const DEVICE_DAYS = 180;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type CodeCheck = "ok" | "wrong" | "expired" | "locked" | "used";

function hmac(data: string): string {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newCode(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

export function hashCode(requestId: string, code: string): string {
  return hmac(`otp:${requestId}:${code}`);
}

export function checkCode(
  req: { id: string; code_hash: string; attempts: number; expires_at: Date; verified_at: Date | null },
  code: string,
  now: Date,
): CodeCheck {
  if (req.verified_at) return "used";
  if (req.expires_at <= now) return "expired";
  if (req.attempts >= OTP.maxAttempts) return "locked";
  return sameText(req.code_hash, hashCode(req.id, code.trim())) ? "ok" : "wrong";
}

export function isRateLimited(sentToMobileLastHour: number, sentFromIpLastHour: number): boolean {
  return sentToMobileLastHour >= OTP.perMobilePerHour || sentFromIpLastHour >= OTP.perIpPerHour;
}

/** About 71 bits: unguessable for a view/cancel link. */
export function newToken(): string {
  return Array.from({ length: 12 }, () => BASE62[randomInt(62)]).join("");
}

/** Signed cookie value remembering up to 5 verified mobiles for 180 days. */
export function signDevice(mobiles: string[], now: Date): string {
  const body = { m: [...new Set(mobiles)].slice(-5), exp: now.getTime() + DEVICE_DAYS * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${hmac(`device:${payload}`)}`;
}

export function readDevice(value: string | undefined, now: Date): string[] {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature || !sameText(signature, hmac(`device:${payload}`))) return [];
  try {
    const { m, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp <= now.getTime() || !Array.isArray(m)) return [];
    return m.filter((x: unknown): x is string => typeof x === "string");
  } catch {
    return [];
  }
}
