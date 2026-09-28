import { createHash, timingSafeEqual } from "node:crypto";
import { needsReminder, type Status } from "@/lib/appointments";
import { smsClinicName } from "@/lib/branches";
import { addDays, formatTime, manilaDate, manilaInstant, weekday } from "@/lib/time";

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
  branch: { sms_name: string } | null;
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
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1), and the
 * branch after the clinic's name only when it has 2 or more active branches (booking flow spec 4).
 */
export function reminders(
  rows: ReminderRow[],
  activeDentists: Map<string, number>,
  now: Date,
  activeBranches: Map<string, number> = new Map(),
): Reminder[] {
  return rows.flatMap((r) => {
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
        clinic: smsClinicName(r.clinic.sms_name, r.branch?.sms_name, activeBranches.get(r.clinic_id) ?? 1),
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

/** A clinic as the Monday summary reads it. */
export type WeeklyRow = { id: string; name: string; weekly_report_for: string | null };

/** Today's Manila date when it is a Monday, the day the weekly summary goes out (teams spec 6.4), otherwise null. */
export function reportMonday(now: Date): string | null {
  const today = manilaDate(now);
  return weekday(today) === 1 ? today : null;
}

/**
 * Teams spec 6.4: the clinics due this Monday's summary: not yet claimed for this Monday. The daily job checks the
 * day with reportMonday and skips clinics without an appointment last week.
 */
export function weeklyCandidates(clinics: WeeklyRow[], now: Date): WeeklyRow[] {
  const today = manilaDate(now);
  return clinics.filter((c) => c.weekly_report_for === null || c.weekly_report_for < today);
}
