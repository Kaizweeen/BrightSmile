import "server-only";
import { localMobile } from "@/lib/phone";
import { prepareSms, productionModeError, readSemaphoreReply, smsMode, type SemaphoreReply } from "@/lib/sms/prepare";
import type { SmsKind, SmsVars } from "@/lib/sms/templates";
import { adminClient } from "@/lib/supabase/admin";

export type SmsStatus = "logged" | "sent" | "failed";
export type SendSmsInput = {
  kind: SmsKind;
  to: string;
  vars: SmsVars;
  clinicId: string | null;
  appointmentId?: string | null;
};

const SEMAPHORE = "https://api.semaphore.co/api/v4";

/** The one place that talks to Semaphore. Form-encoded POST; the OTP route also takes `code`. */
async function semaphore(route: "messages" | "otp", fields: Record<string, string>): Promise<SemaphoreReply> {
  try {
    const res = await fetch(`${SEMAPHORE}/${route}`, {
      method: "POST",
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: keep the raw text for the error.
    }
    return readSemaphoreReply(res.status, body);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Sends (live) or logs (log) one text and records it in sms_log. Never throws (spec 13):
 * a failed text is recorded with status "failed" and its error, and the caller's action goes on.
 */
export async function sendSms({ kind, to, vars, clinicId, appointmentId = null }: SendSmsInput): Promise<SmsStatus> {
  const mode = smsMode();
  const sms = prepareSms(kind, vars, mode);
  let status: SmsStatus = "logged";
  let providerId: string | null = null;
  let error: string | null = productionModeError(process.env.VERCEL_ENV, mode);
  if (error) console.error(error);

  if (error) {
    status = "failed";
  } else if (mode === "log") {
    // Never the destination mobile: this line is a log-mode convenience, not a delivery record.
    // On Vercel (previews may hold real data) print only the kind and length: bodies carry names and links.
    console.log(process.env.VERCEL_ENV ? `[sms ${kind}] ${sms.stored.length} chars` : `[sms ${kind}] ${sms.stored}`);
  } else {
    const key = process.env.SEMAPHORE_API_KEY;
    if (!key) {
      status = "failed";
      error = "SEMAPHORE_API_KEY is not set";
    } else {
      const fields: Record<string, string> = { apikey: key, number: localMobile(to), message: sms.message };
      const sender = process.env.SEMAPHORE_SENDER_NAME;
      if (sender) fields.sendername = sender;
      if (sms.code) fields.code = sms.code;
      const reply = await semaphore(sms.code ? "otp" : "messages", fields);
      if (reply.ok) {
        status = "sent";
        providerId = reply.id;
      } else {
        status = "failed";
        error = reply.error;
      }
    }
  }

  try {
    const { error: dbError } = await adminClient()
      .from("sms_log")
      .insert({
        clinic_id: clinicId,
        appointment_id: appointmentId,
        to_mobile: to,
        kind,
        body: sms.stored,
        credits: status === "failed" ? 0 : sms.credits,
        status,
        provider_message_id: providerId,
        error,
      });
    if (dbError) console.error("sms_log insert failed", dbError.message);
  } catch (e) {
    console.error("sms_log insert failed", e instanceof Error ? e.message : e);
  }
  return status;
}
