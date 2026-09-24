import "server-only";
import { randomUUID } from "node:crypto";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { parseBookingInput, type BookingPayload, type PublicClinic } from "@/lib/booking-input";
import { checkCode, hashCode, newCode, newToken, OTP } from "@/lib/codes";
import { alertClinic } from "@/lib/notify";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";

type Finalized = { status: "sent"; token: string } | { status: "taken"; starts: string[] };
type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };

export type BookingOutcome =
  | Finalized
  | CodeIssued
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unavailable" };

export type VerifyOutcome =
  | Finalized
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "locked" }
  | { status: "used" }
  | { status: "unavailable" };

export type ResendOutcome =
  | CodeIssued
  | { status: "wait"; seconds: number }
  | { status: "gone" }
  | { status: "unavailable" };

type Ctx = { ip: string; now: Date };
type OtpRow = {
  id: string;
  mobile: string;
  code_hash: string;
  booking: BookingPayload;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Logs the error message only: never codes or patient details (spec 12). */
function logFailure(where: string, e: unknown) {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}

/** Null while the payload's start is still open; otherwise that dentist's fresh open starts on that date (spec 13). */
async function takenStarts(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<string[] | null> {
  const dentist = clinic.dentists.find((d) => d.id === p.dentistId);
  const start = new Date(p.startsAt);
  const duration = (new Date(p.endsAt).getTime() - start.getTime()) / 60_000;
  const starts = dentist ? await dayOpenStarts(clinic, dentist, duration, manilaDate(start), now) : [];
  return starts.some((s) => s.getTime() === start.getTime()) ? null : starts.map((s) => s.toISOString());
}

/** Spec 9.1 steps 5 and 6: one transaction creates the request, then the clinic is alerted. */
async function finalize(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<Finalized> {
  const fresh = await takenStarts(clinic, p, now);
  if (fresh) return { status: "taken", starts: fresh };

  const token = newToken();
  const { data: appointmentId, error } = await adminClient().rpc("create_booking", {
    p_clinic_id: clinic.id,
    p_dentist_id: p.dentistId,
    p_starts_at: p.startsAt,
    p_ends_at: p.endsAt,
    p_procedure_names: p.procedureNames,
    p_source: "online",
    p_status: "pending",
    p_manage_token: token,
    p_patient_id: null,
    p_first_name: p.first,
    p_last_name: p.last,
    p_mobile: p.mobile,
    p_birthday: p.birthday,
    p_hmo: p.hmo,
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
  });
  // 23P01: the overlap guard caught a booking that landed between the check above and this insert.
  if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, p, now)) ?? [] };
  if (error) throw error;

  const dentist = clinic.dentists.find((d) => d.id === p.dentistId)!;
  await alertClinic({
    kind: "request_alert",
    clinicId: clinic.id,
    appointmentId: appointmentId as string,
    first: p.first,
    last: p.last,
    startsAt: new Date(p.startsAt),
    dentist: clinic.dentists.length > 1 ? dentist.smsName : null,
  });
  return { status: "sent", token };
}

type IssueResult =
  | { status: "ok" }
  | { status: "limited" }
  | { status: "wait"; seconds: number }
  | { status: "gone" };

/**
 * Calls the issue_otp SQL function (spec 10.3), which locks per mobile then per IP and does the
 * rolling-hour count, the resend wait check, and the insert inside one transaction: a burst of
 * parallel calls can no longer all read the same stale count/row and all send a paid text.
 * resendOf null means a brand-new request, so the function can only answer "ok" or "limited".
 */
async function callIssueOtp(
  mobile: string,
  ip: string,
  id: string,
  codeHash: string,
  booking: BookingPayload,
  now: Date,
  resendOf: string | null,
): Promise<IssueResult> {
  const { data, error } = await adminClient().rpc("issue_otp", {
    p_id: id,
    p_mobile: mobile,
    p_ip: ip,
    p_code_hash: codeHash,
    // Stamped with the app's clock, not the database default, so the resend wait and the
    // rolling-hour limits compare times from one clock even if server clocks drift.
    p_now: now.toISOString(),
    p_expires_at: new Date(now.getTime() + OTP.ttlMs).toISOString(),
    p_booking: booking,
    p_resend_of: resendOf,
  });
  if (error) throw error;
  const result = data as { status: "ok" | "limited" | "wait" | "gone"; wait_seconds?: number };
  return result.status === "wait" ? { status: "wait", seconds: result.wait_seconds ?? OTP.resendMs / 1000 } : (result as IssueResult);
}

async function sendCode(clinic: PublicClinic, mobile: string, code: string, id: string): Promise<CodeIssued> {
  const sent = await sendSms({ kind: "otp", to: mobile, vars: { clinic: clinic.smsName, code }, clinicId: clinic.id });
  return sent === "failed" ? { status: "sms_failed" } : { status: "code", requestId: id };
}

/** Spec 10.3: rolling-hour limits, then a stored request holding the payload and the code hash, then the text. */
async function issueCode(clinic: PublicClinic, booking: BookingPayload, { ip, now }: Ctx): Promise<CodeIssued> {
  const id = randomUUID();
  const code = newCode();
  const result = await callIssueOtp(booking.mobile, ip, id, hashCode(id, code), booking, now, null);
  if (result.status === "limited") return { status: "limited" };
  if (result.status !== "ok") throw new Error(`unexpected issue_otp status for a new request: ${result.status}`);
  return sendCode(clinic, booking.mobile, code, id);
}

/** Spec 9.1 step 3: validate, then book straight away for a verified device, or send a code. */
export async function requestBooking(
  slug: string,
  input: unknown,
  ctx: Ctx & { verifiedMobiles: string[] },
): Promise<BookingOutcome> {
  try {
    const clinic = await loadClinic({ slug });
    if (!clinic) return { status: "invalid", errors: { slot: "This booking link doesn't exist." } };
    const parsed = parseBookingInput(clinic, input, manilaDate(ctx.now));
    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    if (ctx.verifiedMobiles.includes(parsed.payload.mobile)) return await finalize(clinic, parsed.payload, ctx.now);
    const starts = await takenStarts(clinic, parsed.payload, ctx.now);
    if (starts) return { status: "taken", starts };
    return await issueCode(clinic, parsed.payload, ctx);
  } catch (e) {
    logFailure("requestBooking", e);
    return { status: "unavailable" };
  }
}

/** Spec 9.1 step 4: check the code, mark it verified, then book the payload stored with it. */
export async function verifyCode(
  requestId: string,
  code: string,
  now: Date,
): Promise<{ outcome: VerifyOutcome; verifiedMobile: string | null }> {
  let verifiedMobile: string | null = null;
  const done = (outcome: VerifyOutcome) => ({ outcome, verifiedMobile });
  if (!UUID.test(requestId)) return done({ status: "expired" });
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("otp_requests")
      .select("id, mobile, code_hash, booking, attempts, expires_at, verified_at")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return done({ status: "expired" });
    const row = data as OtpRow;

    const status = checkCode(
      {
        id: row.id,
        code_hash: row.code_hash,
        attempts: row.attempts,
        expires_at: new Date(row.expires_at),
        verified_at: row.verified_at ? new Date(row.verified_at) : null,
      },
      code,
      now,
    );
    if (status === "used" || status === "expired" || status === "locked") return done({ status });

    // Spend an attempt before acting on the comparison. The update only matches while attempts is
    // unchanged, so parallel guesses share the same 5 attempts instead of each getting their own.
    const { data: claimed } = await db
      .from("otp_requests")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .is("verified_at", null)
      .select("id")
      .throwOnError();
    const attemptsLeft = Math.max(0, OTP.maxAttempts - row.attempts - 1);
    if (claimed.length === 0 || status === "wrong") return done({ status: "wrong", attemptsLeft });

    const { data: marked } = await db
      .from("otp_requests")
      .update({ verified_at: now.toISOString() })
      .eq("id", row.id)
      .is("verified_at", null)
      .select("id")
      .throwOnError();
    if (marked.length === 0) return done({ status: "used" });
    verifiedMobile = row.mobile;

    const clinic = await loadClinic({ id: row.booking.clinicId });
    if (!clinic) return done({ status: "unavailable" });
    return done(await finalize(clinic, row.booking, now));
  } catch (e) {
    logFailure("verifyCode", e);
    return done({ status: "unavailable" });
  }
}

/** Spec 10.3: a new code after 60 seconds, for the same stored payload. The old code stops working. */
export async function resendCode(requestId: string, ctx: Ctx): Promise<ResendOutcome> {
  if (!UUID.test(requestId)) return { status: "gone" };
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("otp_requests")
      .select("id, mobile, booking, verified_at")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    const row = data as Pick<OtpRow, "id" | "mobile" | "booking" | "verified_at"> | null;
    if (!row || row.verified_at) return { status: "gone" };

    const id = randomUUID();
    const code = newCode();
    // issue_otp checks the old row is still usable, enforces the 60 second wait from the newest
    // code for this mobile, and retires the old row, all inside its own lock (spec 10.3).
    const result = await callIssueOtp(row.mobile, ctx.ip, id, hashCode(id, code), row.booking, ctx.now, row.id);
    if (result.status === "wait") return { status: "wait", seconds: result.seconds };
    if (result.status === "limited") return { status: "limited" };
    if (result.status === "gone") return { status: "gone" };

    const clinic = await loadClinic({ id: row.booking.clinicId });
    if (!clinic) return { status: "gone" };
    return sendCode(clinic, row.mobile, code, id);
  } catch (e) {
    logFailure("resendCode", e);
    return { status: "unavailable" };
  }
}
