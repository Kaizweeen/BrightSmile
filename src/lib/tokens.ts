import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A random URL-safe token: 16 bytes make 22 characters, 24 bytes make 32. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares two secrets in constant time, whatever their lengths. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}
