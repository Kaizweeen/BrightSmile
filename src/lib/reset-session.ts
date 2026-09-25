const RECOVERY_METHODS = new Set(["otp", "recovery"]);
const RECENT_MS = 60 * 60_000;

export type Claims = { amr?: unknown } | null | undefined;

/**
 * A password reset link only works right after the recovery email link is opened (spec: reset
 * password). We accept it as a genuine reset session only when the JWT's amr claim shows an "otp"
 * or "recovery" factor used within the last hour, never an older or unrelated sign-in.
 */
export function hasRecentRecoverySession(claims: Claims, now: Date): boolean {
  const amr = claims?.amr;
  if (!Array.isArray(amr)) return false;
  const cutoff = now.getTime() / 1000 - RECENT_MS / 1000;
  return amr.some(
    (e): e is { method: string; timestamp: number } =>
      typeof e === "object" &&
      e !== null &&
      "method" in e &&
      "timestamp" in e &&
      RECOVERY_METHODS.has(String((e as { method: unknown }).method)) &&
      Number((e as { timestamp: unknown }).timestamp) >= cutoff,
  );
}
