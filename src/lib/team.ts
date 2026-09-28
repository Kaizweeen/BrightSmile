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

/** A join link works for 7 days (teams spec 1): the database sets expires_at, and the join cookie lasts as long. */
export const INVITE_DAYS = 7;

/** The HttpOnly cookie that carries a join link through sign-up or log-in (teams spec 6.2). */
export const JOIN_COOKIE = "bs_join";

export type JoinView = "gone" | "signed_out" | "join" | "member";

/**
 * What /join/{token} shows (teams spec 6.2): a link that no longer works (whoever opens it); a visitor who must sign up
 * or log in first; a signed-in account without a clinic, which may join; or an account that already has a clinic.
 */
export function joinView(clinicName: string | null, visitor: { hasClinic: boolean } | null): JoinView {
  if (clinicName === null) return "gone";
  if (!visitor) return "signed_out";
  return visitor.hasClinic ? "member" : "join";
}

/** accept_invite's refusals (supabase/migrations/20260926000100_teams.sql) as join page states; null for anything else. */
export function joinRefusal(code: string | undefined): "gone" | "member" | null {
  if (code === "BSUNK" || code === "BSREV" || code === "BSUSD" || code === "BSEXP") return "gone";
  if (code === "23505") return "member";
  return null;
}
