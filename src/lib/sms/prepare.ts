import { renderSms, smsCredits, type SmsKind, type SmsVars } from "@/lib/sms/templates";

export type SmsMode = "log" | "live";
/** `message` goes to the gateway, `stored` goes to sms_log. They differ only for codes. */
export type PreparedSms = { message: string; stored: string; code: string | null; credits: number };
export type SemaphoreReply = { ok: true; id: string } | { ok: false; error: string };

/** Anything but exactly "live" logs instead of sending, so a typo never sends real texts. */
export function smsMode(value: string | undefined = process.env.SMS_MODE): SmsMode {
  return value === "live" ? "live" : "log";
}

/** In production, texts must go out live: a misconfigured SMS_MODE would otherwise silently log real patient texts. */
export function productionModeError(vercelEnv: string | undefined, mode: SmsMode): string | null {
  return vercelEnv === "production" && mode !== "live" ? "SMS_MODE is not live in production" : null;
}

/**
 * Spec 10.3 and 10.6: codes go out through Semaphore's OTP route with the {otp} placeholder and the
 * code as a separate field. The stored body keeps the real code in log mode (tests read it) and
 * shows ****** in live mode, so a code never reaches a log in production.
 */
export function prepareSms(kind: SmsKind, vars: SmsVars, mode: SmsMode): PreparedSms {
  const real = renderSms(kind, vars);
  const credits = smsCredits(kind, real);
  if (kind !== "otp") return { message: real, stored: real, code: null, credits };
  return {
    message: renderSms("otp", { ...vars, code: "{otp}" }),
    stored: mode === "log" ? real : renderSms("otp", { ...vars, code: "******" }),
    code: vars.code ?? "",
    credits,
  };
}

/** A Semaphore success is a JSON array of messages with a message_id; anything else is an error. */
export function readSemaphoreReply(status: number, body: unknown): SemaphoreReply {
  const first: unknown = Array.isArray(body) ? body[0] : body;
  if (status >= 200 && status < 300 && typeof first === "object" && first !== null && "message_id" in first) {
    return { ok: true, id: String((first as { message_id: unknown }).message_id) };
  }
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: false, error: `Semaphore ${status}: ${detail}`.slice(0, 300) };
}

/** Semaphore's GET /account reply: credit_balance as a number or a numeric string, or null for anything else. */
export function readBalance(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const value = (body as { credit_balance?: unknown }).credit_balance;
  const credits = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(credits) ? credits : null;
}
