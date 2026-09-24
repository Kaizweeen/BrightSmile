import "server-only";
import { appUrl } from "@/lib/app-url";
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
import { logError } from "@/lib/log";
import { normalizeMobile } from "@/lib/phone";
import { smsMode, type SmsMode } from "@/lib/sms/prepare";
import { semaphoreBalance, sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_ROW =
  "id, clinic_id, status, starts_at, confirmed_at, reminder_sent_at, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name)";

/**
 * Spec 11 step 1. Each reminder claims reminder_sent_at with a compare-and-set before its text goes out,
 * so a rerun or an overlapping run never texts twice. Returns how many reminders this run sent.
 * ponytail: one text at a time; batch with limited concurrency if a run nears maxDuration.
 */
export async function sendReminders(now: Date): Promise<number> {
  const db = adminClient();
  const { from, to } = reminderWindow(now);
  const { data, error } = await db
    .from("appointments")
    .select(REMINDER_ROW)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString());
  if (error) throw error;
  const rows = (data ?? []) as unknown as ReminderRow[];
  if (rows.length === 0) return 0;

  const { data: dentists, error: dentistError } = await db
    .from("dentists")
    .select("clinic_id")
    .eq("active", true)
    .in("clinic_id", [...new Set(rows.map((r) => r.clinic_id))]);
  if (dentistError) throw dentistError;
  const active = new Map<string, number>();
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);

  const app = appUrl();
  let sent = 0;
  for (const r of reminders(rows, active, now)) {
    const { data: claimed, error: claimError } = await db
      .from("appointments")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", r.appointmentId)
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .select("id");
    if (claimError) {
      logError("sendReminders claim", claimError);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    await sendSms({
      kind: "reminder",
      to: r.to,
      clinicId: r.clinicId,
      appointmentId: r.appointmentId,
      vars: { clinic: r.clinic, first: r.first, time: r.time, dentist: r.dentist ?? undefined, link: `${app}/a/${r.token}` },
    });
    sent++;
  }
  return sent;
}

/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
export async function expirePending(): Promise<number> {
  const { data, error } = await adminClient().rpc("expire_pending");
  if (error) throw error;
  return data as number;
}

/** Spec 11 step 3 and spec 12 retention: codes go after 24 hours, text bodies after 90 days (cost records stay). */
export async function cleanup(now: Date): Promise<{ codes: number; bodies: number }> {
  const db = adminClient();
  const { count: codes, error: codeError } = await db
    .from("otp_requests")
    .delete({ count: "exact" })
    .lt("created_at", new Date(now.getTime() - DAY_MS).toISOString());
  if (codeError) throw codeError;
  const { count: bodies, error: bodyError } = await db
    .from("sms_log")
    .update({ body: null }, { count: "exact" })
    .lt("created_at", new Date(now.getTime() - 90 * DAY_MS).toISOString())
    .not("body", "is", null);
  if (bodyError) throw bodyError;
  return { codes: codes ?? 0, bodies: bodies ?? 0 };
}

export type CreditCheck = "skipped" | "ok" | "texted" | "recent" | "unknown";

/**
 * Spec 11 step 4, live mode only: below SMS_LOW_CREDIT_THRESHOLD, text OPERATOR_MOBILE, at most once per
 * 20 hours. "unknown" (balance unreadable or no valid operator mobile) makes the run report a failure.
 */
export async function checkCredit(
  now: Date,
  balance: () => Promise<number | null> = semaphoreBalance,
  mode: SmsMode = smsMode(),
): Promise<{ status: CreditCheck; balance: number | null }> {
  if (mode !== "live") return { status: "skipped", balance: null };
  const credits = await balance();
  if (credits === null) {
    logError("checkCredit", "the Semaphore balance could not be read");
    return { status: "unknown", balance: null };
  }
  if (credits >= lowCreditThreshold()) return { status: "ok", balance: credits };
  const operator = normalizeMobile(process.env.OPERATOR_MOBILE ?? "");
  if (!operator) {
    logError("checkCredit", "OPERATOR_MOBILE is not a Philippine mobile number");
    return { status: "unknown", balance: credits };
  }
  const { data, error } = await adminClient()
    .from("sms_log")
    .select("id")
    .eq("kind", "low_credit")
    .eq("to_mobile", operator)
    .neq("status", "failed")
    .gte("created_at", new Date(now.getTime() - LOW_CREDIT_GAP_MS).toISOString())
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length > 0) return { status: "recent", balance: credits };
  await sendSms({ kind: "low_credit", to: operator, clinicId: null, vars: { credits } });
  return { status: "texted", balance: credits };
}

type Failed = "failed";
export type DailySummary = {
  ok: boolean;
  reminders: number | Failed;
  expired: number | Failed;
  cleaned: { codes: number; bodies: number } | Failed;
  credit: { status: CreditCheck; balance: number | null } | Failed;
};

/** One step's result, or "failed" after logging where and why. A failed step never stops the next one. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T | Failed> {
  try {
    return await run();
  } catch (e) {
    logError(`daily job ${name}`, e);
    return "failed";
  }
}

/** Spec 11, in order. Counts only: the summary carries no patient details. */
export async function runDailyJob(now: Date): Promise<DailySummary> {
  const sent = await step("reminders", () => sendReminders(now));
  const expired = await step("expiry", () => expirePending());
  const cleaned = await step("cleanup", () => cleanup(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, expired, cleaned, credit };
}
