import "server-only";
import { appUrl } from "@/lib/app-url";
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { newToken } from "@/lib/codes";
import { staffOpenStarts } from "@/lib/dashboard";
import { sendSms, type SmsStatus } from "@/lib/sms/send";
import { parseManualBooking, parseSlot, type PatientFields, type SlotChoice } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";
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
  const app = appUrl();
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

const NOT_OPEN = "That time is no longer open. Pick another.";
const PATIENT_GONE = "That patient was deleted or can't be found. Pick another.";
const NO_DENTIST = "Choose an active dentist.";

/** An active dentist of this clinic, or null. */
async function activeDentist(staff: Staff, id: string): Promise<{ id: string; sms_name: string } | null> {
  const { data, error } = await staff.db
    .from("dentists")
    .select("id, sms_name")
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; sms_name: string } | null;
}

/**
 * Null when the time can be saved, otherwise why not. An open time must still be open; a custom time
 * only needs to be today or later, because the database refuses any overlap (spec 5.3). Moving to a
 * custom time additionally requires it to still be ahead of now: manual New appointment keeps allowing
 * an earlier time today (e.g. logging a walk-in), but moving a visit to a time that already passed
 * would silently no-show it.
 */
async function timeProblem(
  staff: Staff,
  slot: SlotChoice,
  duration: number,
  now: Date,
  ignoreId?: string,
  requireFuture = false,
): Promise<string | null> {
  if (manilaDate(slot.startsAt) < manilaDate(now)) return "Pick today or a later date.";
  if (slot.custom) {
    if (requireFuture && slot.startsAt <= now) return "This time has already passed. Pick a later time.";
    return null;
  }
  const open = await staffOpenStarts(staff, { dentistId: slot.dentistId, date: manilaDate(slot.startsAt), duration, ignoreId }, now);
  return open.some((s) => s.getTime() === slot.startsAt.getTime()) ? null : NOT_OPEN;
}

/** Spec 9.2 "moved": a confirmed visit that has not started gets a new time or dentist, keeps its length, and the patient is texted. */
export async function moveAppointment(staff: Staff, id: string, slotInput: unknown, now: Date): Promise<ActionResult> {
  const slot = parseSlot(slotInput);
  if (!slot) return { ok: false, error: "Choose a time." };
  try {
    const [row, dentist, dentistShown] = await Promise.all([loadRow(staff, id), activeDentist(staff, slot.dentistId), showsDentist(staff)]);
    if (!row) return { ok: false, error: MESSAGES.gone };
    const oldStart = new Date(row.starts_at);
    if (row.status !== "confirmed" || !canTransition(row.status, "confirmed", "staff") || oldStart <= now) {
      return { ok: false, error: MESSAGES.notNow };
    }
    if (!dentist) return { ok: false, error: NO_DENTIST };
    if (slot.dentistId === row.dentist_id && slot.startsAt.getTime() === oldStart.getTime()) {
      return { ok: false, error: "That is the current time. Pick a different one." };
    }
    const duration = (new Date(row.ends_at).getTime() - oldStart.getTime()) / 60_000;
    const problem = await timeProblem(staff, slot, duration, now, row.id, true);
    if (problem) return { ok: false, error: problem };

    const { data: moved, error } = await staff.db.rpc("move_appointment", {
      p_id: row.id,
      p_dentist_id: slot.dentistId,
      p_starts_at: slot.startsAt.toISOString(),
      p_ends_at: new Date(slot.startsAt.getTime() + duration * 60_000).toISOString(),
      p_user_id: staff.userId,
    });
    if (error?.code === "23P01") return { ok: false, error: MESSAGES.overlap };
    if (error) throw error;
    if (!moved) return { ok: false, error: MESSAGES.changed };

    const text = await textPatient(staff, rowText(row, "moved", dentistShown ? dentist.sms_name : null, slot.startsAt));
    return { ok: true, text };
  } catch (e) {
    logFailure("moveAppointment", e);
    return { ok: false, error: MESSAGES.generic };
  }
}

type ProcedureRow = { id: string; name: string; duration_minutes: number };

/**
 * Spec 5.3 New appointment: confirmed immediately, source manual. The confirmation text goes out only
 * when sendText is on and the patient has a mobile.
 */
export async function createAppointment(staff: Staff, input: unknown, now: Date): Promise<ActionResult> {
  const parsed = parseManualBooking(input, manilaDate(now));
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] };
  const b = parsed.value;
  try {
    const [dentist, procedures, clinic, dentistShown] = await Promise.all([
      activeDentist(staff, b.slot.dentistId),
      staff.db
        .from("procedures")
        .select("id, name, duration_minutes")
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .in("id", b.procedureIds)
        .throwOnError(),
      staff.db.from("clinics").select("sms_name, slug").eq("id", staff.clinicId).single().throwOnError(),
      showsDentist(staff),
    ]);
    if (!dentist) return { ok: false, error: NO_DENTIST };
    const chosen = b.procedureIds.map((pid) => (procedures.data as ProcedureRow[]).find((p) => p.id === pid));
    if (chosen.some((p) => !p)) return { ok: false, error: "A chosen procedure was archived. Choose again." };
    const picked = chosen as ProcedureRow[];
    const duration = picked.reduce((sum, p) => sum + p.duration_minutes, 0);

    let person: PatientFields;
    if (b.patientId) {
      const { data } = await staff.db
        .from("patients")
        .select("first_name, last_name, mobile")
        .eq("id", b.patientId)
        .eq("clinic_id", staff.clinicId)
        .is("anonymized_at", null)
        .maybeSingle()
        .throwOnError();
      if (!data) return { ok: false, error: PATIENT_GONE };
      person = { first: data.first_name, last: data.last_name, mobile: data.mobile, birthday: null, hmo: "" };
    } else {
      person = b.patient!;
    }

    const problem = await timeProblem(staff, b.slot, duration, now);
    if (problem) return { ok: false, error: problem };

    const token = newToken();
    const startsAt = b.slot.startsAt;
    const { data: appointmentId, error } = await staff.db.rpc("create_booking", {
      p_clinic_id: staff.clinicId,
      p_dentist_id: dentist.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
      p_procedure_names: picked.map((p) => p.name),
      p_source: "manual",
      p_status: "confirmed",
      p_manage_token: token,
      p_patient_id: b.patientId,
      p_first_name: person.first,
      p_last_name: person.last,
      p_mobile: person.mobile,
      p_birthday: person.birthday,
      p_hmo: person.hmo,
      p_consent: false,
      p_actor: "staff",
      p_user_id: staff.userId,
    });
    if (error?.code === "23P01") return { ok: false, error: MESSAGES.overlap };
    if (error?.code === "P0002") return { ok: false, error: PATIENT_GONE };
    if (error) throw error;

    const { sms_name, slug } = clinic.data as { sms_name: string; slug: string };
    const text = b.sendText
      ? await textPatient(staff, {
          kind: "confirmed",
          appointmentId: appointmentId as string,
          token,
          first: person.first,
          mobile: person.mobile,
          clinicSmsName: sms_name,
          slug,
          dentist: dentistShown ? dentist.sms_name : null,
          startsAt,
          reason: "",
        })
      : "none";
    return { ok: true, text };
  } catch (e) {
    logFailure("createAppointment", e);
    return { ok: false, error: MESSAGES.generic };
  }
}
