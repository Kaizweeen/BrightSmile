import { createHash } from "node:crypto";

/** newToken's shape (12 letters and digits). Anything else is not a join link. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{12}$/.test(value);
}

/**
 * How clinic_invites stores a join token (teams spec 5): its SHA-256 in hex, the same digest accept_invite computes in
 * SQL, so a leaked table holds no working links.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The link the owner sends by Messenger or text (teams spec 6.1): {APP_URL}/join/{token}. */
export function joinLink(appUrl: string, token: string): string {
  return `${appUrl}/join/${token}`;
}
