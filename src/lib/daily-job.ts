import "server-only";
import { appUrl } from "@/lib/app-url";
import { billingStatus } from "@/lib/billing";
import { loadBillings } from "@/lib/billing-data";
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, renewalNotices, type ReminderRow, type RenewalRow } from "@/lib/daily";
import { logError } from "@/lib/log";
import { alertPlanEnding } from "@/lib/notify";
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

  const clinicIds = [...new Set(rows.map((r) => r.clinic_id))];
  const { data: dentists, error: dentistError } = await db.from("dentists").select("clinic_id").eq("active", true).in("clinic_id", clinicIds);
  if (dentistError) throw dentistError;
  const active = new Map<string, number>();
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);
  // Billing spec 7.5: a lapsed clinic's patients get no reminders.
  const paused = new Set([...(await loadBillings(db, clinicIds))].filter(([, billing]) => !billingStatus(billing, now).open).map(([id]) => id));

  const app = appUrl();
  let sent = 0;
  for (const r of reminders(rows, active, now, paused)) {
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
    // Claimed either way (a failed text is never retried, so nobody is texted twice); count only real sends.
    const status = await sendSms({
      kind: "reminder",
      to: r.to,
      clinicId: r.clinicId,
      appointmentId: r.appointmentId,
      vars: { clinic: r.clinic, first: r.first, time: r.time, dentist: r.dentist ?? undefined, link: `${app}/a/${r.token}` },
    });
    if (status !== "failed") sent++;
  }
  return sent;
}

/**
 * Billing spec 7.4: one heads-up per plan end, 3 days or less before it. Each clinic's notice first claims
 * renewal_notice_for with a compare-and-set, so a rerun never alerts twice. Returns how many alerts went out.
 * A failed claim or alert is not retried (the claim may already be set), so after trying every clinic it throws,
 * which marks the run failed and puts the counts in the log.
 * ponytail: reads every clinic_billing row (the API returns at most 1000); page through when clinics near that.
 */
export async function sendRenewalNotices(now: Date): Promise<number> {
  const db = adminClient();
  const { data, error } = await db.from("clinic_billing").select("clinic_id, trial_ends_at, paid_through, renewal_notice_for");
  if (error) throw error;
  let sent = 0;
  const failed: string[] = [];
  for (const { clinicId, endsAt } of renewalNotices((data ?? []) as RenewalRow[], now)) {
    const endsIso = endsAt.toISOString();
    const { data: claimed, error: claimError } = await db
      .from("clinic_billing")
      .update({ renewal_notice_for: endsIso })
      .eq("clinic_id", clinicId)
      .or(`renewal_notice_for.is.null,renewal_notice_for.neq."${endsIso}"`)
      .select("clinic_id");
    if (claimError) {
      logError("sendRenewalNotices claim", claimError);
      failed.push(clinicId);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    if ((await alertPlanEnding(clinicId, endsAt)) === "failed") failed.push(clinicId);
    else sent++;
  }
  // A failed claim or alert is not retried, so name the clinics (ids only) for Kai to tell by hand.
  if (failed.length > 0) throw new Error(`${failed.length} heads-ups failed, ${sent} sent (clinics ${failed.join(", ")})`);
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
  renewals: number | Failed;
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
  // Database steps first: a slow SMS gateway can use up the time limit, and these must still run.
  const expired = await step("expiry", () => expirePending());
  const cleaned = await step("cleanup", () => cleanup(now));
  const sent = await step("reminders", () => sendReminders(now));
  const renewals = await step("renewal notices", () => sendRenewalNotices(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, renewals, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, renewals, expired, cleaned, credit };
}
