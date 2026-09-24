import "server-only";
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { sendSms, type SmsStatus } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { cleanText, isUuid, LIMITS } from "@/lib/validate";

export type StaffTarget = "confirmed" | "declined" | "cancelled" | "completed" | "no_show";
/** `text` is what happened to the patient's text: "none" when no text was due or there is no mobile. */
export type ActionResult = { ok: true; text: SmsStatus | "none" } | { ok: false; error: string };

export const MESSAGES = {
  generic: "Something went wrong. Please try again.",
  gone: "This appointment no longer exists.",
  changed: "This appointment changed a moment ago. Reload to see it.",
  notNow: "That change isn't possible for this appointment.",
  overlap: "That time overlaps another visit for this dentist. Pick another time.",
} as const;

export type Row = {
  id: string;
  status: Status;
  starts_at: string;
  ends_at: string;
  dentist_id: string;
  manage_token: string;
  patient: { first_name: string; mobile: string | null; anonymized_at: string | null };
  dentist: { sms_name: string };
  clinic: { sms_name: string; slug: string };
};

const ROW =
  "id, status, starts_at, ends_at, dentist_id, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name, slug)";

/** Logs the error message only, never patient details (spec 12). */
export function logFailure(where: string, e: unknown) {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}

/** One appointment of this clinic, or null for a malformed id, another clinic's row, or a deleted one. */
export async function loadRow(staff: Staff, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await staff.db
    .from("appointments")
    .select(ROW)
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Row | null;
}

/** Spec 10.1: texts name the dentist only when the clinic has 2 or more active dentists. */
export async function showsDentist(staff: Staff): Promise<boolean> {
  const { count, error } = await staff.db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", staff.clinicId)
    .eq("active", true);
  if (error) throw error;
  return (count ?? 0) > 1;
}

export type PatientText = {
  kind: "confirmed" | "declined" | "moved" | "cancelled";
  appointmentId: string;
  token: string;
  first: string;
  mobile: string | null;
  clinicSmsName: string;
  slug: string;
  dentist: string | null;
  startsAt: Date;
  reason: string;
};

/** One patient text (spec 10.1). No mobile means no text. sendSms never throws, so a text never fails the action. */
export async function textPatient(staff: Staff, t: PatientText): Promise<SmsStatus | "none"> {
  if (!t.mobile) return "none";
  const app = process.env.APP_URL ?? "http://localhost:3600";
  return sendSms({
    kind: t.kind,
    to: t.mobile,
    clinicId: staff.clinicId,
    appointmentId: t.appointmentId,
    vars: {
      clinic: t.clinicSmsName,
      first: t.first,
      dentist: t.dentist ?? undefined,
      date: formatDate(t.startsAt),
      time: formatTime(t.startsAt),
      reason: t.reason || undefined,
      link: `${app}/a/${t.token}`,
      bookLink: `${app}/${t.slug}`,
    },
  });
}

/** The text for an existing appointment. A deleted (anonymized) patient has no mobile, so gets no text. */
export function rowText(row: Row, kind: PatientText["kind"], dentist: string | null, startsAt: Date, reason = ""): PatientText {
  return {
    kind,
    appointmentId: row.id,
    token: row.manage_token,
    first: row.patient.first_name,
    mobile: row.patient.anonymized_at ? null : row.patient.mobile,
    clinicSmsName: row.clinic.sms_name,
    slug: row.clinic.slug,
    dentist,
    startsAt,
    reason,
  };
}

const TEXT_OF: Partial<Record<StaffTarget, PatientText["kind"]>> = {
  confirmed: "confirmed",
  declined: "declined",
  cancelled: "cancelled",
};

/**
 * Approve, decline, cancel, or record attendance (spec 9.2), then text the patient (spec 10.1).
 * p_from makes the SQL function a compare-and-set, so a double tap or a second device changes it once.
 */
export async function changeStatus(staff: Staff, id: string, to: StaffTarget, reasonInput: string, now: Date): Promise<ActionResult> {
  const reason = cleanText(reasonInput, LIMITS.reason, true);
  if (reason === null) return { ok: false, error: `Keep the reason to ${LIMITS.reason} characters or fewer.` };
  try {
    const [row, dentistShown] = await Promise.all([loadRow(staff, id), showsDentist(staff)]);
    if (!row) return { ok: false, error: MESSAGES.gone };
    const startsAt = new Date(row.starts_at);
    if (row.status === to || !canTransition(row.status, to, "staff")) return { ok: false, error: MESSAGES.notNow };
    const attendance = to === "completed" || to === "no_show";
    if (attendance && !canMarkAttendance({ status: row.status, starts_at: startsAt }, now)) {
      return { ok: false, error: "You can mark this once the visit has started." };
    }
    if (to === "confirmed" && startsAt <= now) {
      return { ok: false, error: "This request's time has passed. Decline it, or add a new appointment." };
    }

    const { data: changed, error } = await staff.db.rpc("set_appointment_status", {
      p_id: row.id,
      p_from: row.status,
      p_to: to,
      p_actor: "staff",
      p_user_id: staff.userId,
      p_reason: attendance ? null : reason || null,
    });
    if (error) throw error;
    if (!changed) return { ok: false, error: MESSAGES.changed };

    const kind = TEXT_OF[to];
    const text = kind
      ? await textPatient(staff, rowText(row, kind, dentistShown ? row.dentist.sms_name : null, startsAt, reason))
      : "none";
    return { ok: true, text };
  } catch (e) {
    logFailure("changeStatus", e);
    return { ok: false, error: MESSAGES.generic };
  }
}
