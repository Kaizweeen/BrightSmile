import { createHash, timingSafeEqual } from "node:crypto";
import { needsReminder, type Status } from "@/lib/appointments";
import { billingStatus, NOTICE_DAYS } from "@/lib/billing";
import { addDays, formatTime, manilaDate, manilaInstant } from "@/lib/time";

/**
 * Spec 11: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`. Both sides are hashed first, so the
 * timing-safe compare works on equal lengths and leaks nothing about the secret's length.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || secret.length < 16) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** Tomorrow in Manila as instants, from its 00:00 up to (not including) the next day's 00:00. */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  const tomorrow = addDays(manilaDate(now), 1);
  return { from: manilaInstant(tomorrow, 0), to: manilaInstant(addDays(tomorrow, 1), 0) };
}

/** An appointments row as the daily job reads it, with the patient, dentist, and clinic joined. */
export type ReminderRow = {
  id: string;
  clinic_id: string;
  status: Status;
  starts_at: string;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
  manage_token: string;
  patient: { first_name: string; mobile: string | null; anonymized_at: string | null } | null;
  dentist: { sms_name: string } | null;
  clinic: { sms_name: string } | null;
};

export type Reminder = {
  appointmentId: string;
  clinicId: string;
  to: string;
  token: string;
  clinic: string;
  first: string;
  time: string;
  dentist: string | null;
};

const date = (value: string | null) => (value ? new Date(value) : null);

/**
 * Spec 11 step 1: needsReminder decides which visits are due; a patient without a mobile (or deleted)
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1).
 * A clinic whose booking is paused gets no reminders (billing spec 7.5).
 */
export function reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date, paused: Set<string> = new Set()): Reminder[] {
  return rows.flatMap((r) => {
    if (paused.has(r.clinic_id)) return [];
    const startsAt = new Date(r.starts_at);
    const due = needsReminder(
      { status: r.status, starts_at: startsAt, confirmed_at: date(r.confirmed_at), reminder_sent_at: date(r.reminder_sent_at) },
      now,
    );
    const patient = r.patient;
    if (!due || !patient || patient.anonymized_at || !patient.mobile || !r.clinic) return [];
    const named = (activeDentists.get(r.clinic_id) ?? 0) > 1 && r.dentist;
    return [
      {
        appointmentId: r.id,
        clinicId: r.clinic_id,
        to: patient.mobile,
        token: r.manage_token,
        clinic: r.clinic.sms_name,
        first: patient.first_name,
        time: formatTime(startsAt),
        dentist: named ? r.dentist!.sms_name : null,
      },
    ];
  });
}

/** The operator gets at most one low credit text per 20 hours, so a rerun of the job stays quiet. */
export const LOW_CREDIT_GAP_MS = 20 * 60 * 60 * 1000;

/** SMS_LOW_CREDIT_THRESHOLD as a whole number of credits, 500 when unset or not a whole number (spec 11). */
export function lowCreditThreshold(value: string | undefined = process.env.SMS_LOW_CREDIT_THRESHOLD): number {
  const text = value?.trim() ?? "";
  return /^\d+$/.test(text) ? Number(text) : 500;
}

/** A clinic_billing row as the heads-up step reads it. */
export type RenewalRow = { clinic_id: string; trial_ends_at: string; paid_through: string | null; renewal_notice_for: string | null };
export type Renewal = { clinicId: string; endsAt: Date };

/**
 * Billing spec 7.4: clinics whose plan (trial or paid) ends after now and at most 3 days from now, and that
 * have not had a heads-up for this end yet. Dates compare at millisecond precision, the precision the job
 * writes renewal_notice_for with.
 */
export function renewalNotices(rows: RenewalRow[], now: Date): Renewal[] {
  return rows.flatMap((r) => {
    const paidThrough = r.paid_through ? new Date(r.paid_through) : null;
    const { endsAt } = billingStatus({ trialEndsAt: new Date(r.trial_ends_at), paidThrough }, now);
    const left = endsAt.getTime() - now.getTime();
    const noticed = r.renewal_notice_for !== null && new Date(r.renewal_notice_for).getTime() === endsAt.getTime();
    return left > 0 && left <= NOTICE_DAYS * 24 * 60 * 60 * 1000 && !noticed ? [{ clinicId: r.clinic_id, endsAt }] : [];
  });
}
