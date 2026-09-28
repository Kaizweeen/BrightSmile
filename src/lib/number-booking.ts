import "server-only";
import { loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import { issueCode, overBookingCap, spendCode, takenStarts } from "@/lib/booking";
import { resolveSelection } from "@/lib/booking-input";
import { newToken } from "@/lib/codes";
import { formColumns, parseIntakeForm, type IntakeForm } from "@/lib/intake";
import { logError } from "@/lib/log";
import { alertClinic } from "@/lib/notify";
import { cancelByPatient } from "@/lib/patient-link";
import { normalizeMobile } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";
import { isUuid } from "@/lib/validate";

/**
 * The patient side of the booking flow (spec 3.2 to 3.5, 8). A number is verified on this phone first: the Server
 * Actions keep the verified numbers in the signed bs_verified cookie and pass them in as Device. Every function here
 * checks again that the cookie holds the number, and that each row belongs to that number and to this clinic, so
 * nothing below is reachable by calling an action directly. The secret key is used because patients have no session.
 * Logs say where it failed, never a number, a name, or a form.
 */

/** The numbers this phone verified (from the cookie), and the time. */
export type Device = { verifiedMobiles: string[]; now: Date };
/** What a function answers when it cannot act: an unverified number, an unknown booking link, or a failure. */
export type Refused = { status: "unverified" } | { status: "invalid" } | { status: "unavailable" };

type ClinicRef = { id: string; smsName: string; minNoticeMinutes: number };

/** The number in its stored form when this phone verified it, otherwise null (spec 3.2 step 3, 8). */
export function verifiedNumber(input: unknown, device: Device): string | null {
  const mobile = typeof input === "string" ? normalizeMobile(input) : null;
  return mobile && device.verifiedMobiles.includes(mobile) ? mobile : null;
}

/** The clinic of a booking link, or null. */
async function clinicOf(slug: string): Promise<ClinicRef | null> {
  const { data, error } = await adminClient().from("clinics").select("id, sms_name, min_notice_minutes").eq("slug", slug).maybeSingle();
  if (error) throw error;
  const c = data as { id: string; sms_name: string; min_notice_minutes: number } | null;
  return c ? { id: c.id, smsName: c.sms_name, minNoticeMinutes: c.min_notice_minutes } : null;
}

export type StartOutcome =
  | { status: "verified"; mobile: string }
  | { status: "code"; requestId: string; mobile: string }
  | { status: "limited" }
  | { status: "sms_failed" }
  | { status: "invalid" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.2: the start of every path. A phone that verified the number before goes straight on; otherwise the clinic
 * texts a 6 digit code within issue_otp's limits (3 per number and 10 per connection an hour, 60 seconds between
 * codes; a new code is resendBookingCode, as on the booking page). A lapsed clinic sends no code (billing spec 7.5).
 */
export async function startVerification(slug: string, mobileInput: unknown, ctx: Device & { ip: string }): Promise<StartOutcome> {
  const mobile = typeof mobileInput === "string" ? normalizeMobile(mobileInput) : null;
  if (!mobile) return { status: "invalid" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    if (!(await bookingOpen(clinic.id, ctx.now))) return { status: "paused" };
    if (ctx.verifiedMobiles.includes(mobile)) return { status: "verified", mobile };
    const issued = await issueCode(clinic, mobile, { clinicId: clinic.id, verify: true }, ctx);
    return issued.status === "code" ? { ...issued, mobile } : issued;
  } catch (e) {
    logError("startVerification", e);
    return { status: "unavailable" };
  }
}

export type CheckOutcome =
  | { status: "verified"; mobile: string }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" | "locked" | "used" | "paused" | "unavailable" };

/** Spec 3.2 step 3: a right code verifies the number; the Server Action then remembers it on this phone. */
export async function checkVerification(requestId: string, code: string, now: Date): Promise<CheckOutcome> {
  try {
    const spent = await spendCode(requestId, code, now);
    return spent.status === "ok" ? { status: "verified", mobile: spent.row.mobile } : spent;
  } catch (e) {
    logError("checkVerification", e);
    return { status: "unavailable" };
  }
}

export type NumberPatient = { id: string; first: string; last: string };
export type PatientsOutcome = { status: "ok"; patients: NumberPatient[] } | Refused;

/** Spec 3.3 step 3: this number's patients at this clinic, not deleted, for "Who is the appointment for?". */
export async function numberPatients(slug: string, mobileInput: unknown, device: Device): Promise<PatientsOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    const { data } = await adminClient()
      .from("patients")
      .select("id, first_name, last_name")
      .eq("clinic_id", clinic.id)
      .eq("mobile", mobile)
      .is("anonymized_at", null)
      .order("first_name")
      .order("last_name")
      .limit(50)
      .throwOnError();
    const rows = data as { id: string; first_name: string; last_name: string }[];
    return { status: "ok", patients: rows.map((p) => ({ id: p.id, first: p.first_name, last: p.last_name })) };
  } catch (e) {
    logError("numberPatients", e);
    return { status: "unavailable" };
  }
}

export type NumberAppointment = {
  id: string;
  status: "pending" | "confirmed";
  startsAt: string;
  endsAt: string;
  procedures: string[];
  /** The clinic's active procedures with these names, where the services step of a change starts. */
  procedureIds: string[];
  patient: NumberPatient;
  dentist: { id: string; name: string };
  branch: { id: string; name: string; address: string; mapsUrl: string | null };
  /** False within the clinic's minimum notice: "Please call the clinic to change it." (spec 3.4 step 4). */
  changeable: boolean;
};
export type AppointmentsOutcome = { status: "ok"; appointments: NumberAppointment[] } | Refused;

type AppointmentRow = {
  id: string;
  status: "pending" | "confirmed";
  starts_at: string;
  ends_at: string;
  procedure_names: string[];
  patients: { id: string; first_name: string; last_name: string };
  dentist: { id: string; name: string };
  branch: { id: string; name: string; address: string; maps_url: string | null };
};

/**
 * Spec 3.4 and 3.5 step 2: every pending or confirmed appointment at this clinic, still ahead, whose patient has this
 * number and is not deleted, soonest first, with its branch.
 */
export async function numberAppointments(slug: string, mobileInput: unknown, device: Device): Promise<AppointmentsOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    const db = adminClient();
    const [appointments, procedures] = await Promise.all([
      db
        .from("appointments")
        .select(
          "id, status, starts_at, ends_at, procedure_names, patients!inner(id, first_name, last_name, mobile, anonymized_at), dentist:dentists(id, name), branch:branches(id, name, address, maps_url)",
        )
        .eq("clinic_id", clinic.id)
        .eq("patients.mobile", mobile)
        .is("patients.anonymized_at", null)
        .in("status", ["pending", "confirmed"])
        .gt("starts_at", device.now.toISOString())
        .order("starts_at")
        .limit(20)
        .throwOnError(),
      db.from("procedures").select("id, name").eq("clinic_id", clinic.id).eq("active", true).throwOnError(),
    ]);
    const byName = new Map((procedures.data as { id: string; name: string }[]).map((p) => [p.name, p.id]));
    const earliest = device.now.getTime() + clinic.minNoticeMinutes * 60_000;
    return {
      status: "ok",
      appointments: (appointments.data as unknown as AppointmentRow[]).map((a) => ({
        id: a.id,
        status: a.status,
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        procedures: a.procedure_names,
        procedureIds: a.procedure_names.flatMap((name) => byName.get(name) ?? []),
        patient: { id: a.patients.id, first: a.patients.first_name, last: a.patients.last_name },
        dentist: { id: a.dentist.id, name: a.dentist.name },
        branch: { id: a.branch.id, name: a.branch.name, address: a.branch.address, mapsUrl: a.branch.maps_url },
        changeable: new Date(a.starts_at).getTime() >= earliest,
      })),
    };
  } catch (e) {
    logError("numberAppointments", e);
    return { status: "unavailable" };
  }
}

const PICK_PATIENT = "Choose who the visit is for again.";
const PICK_TIME = "Pick the visit and time again.";

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

type Who = { patientId: string | null; first: string; last: string; form: IntakeForm | null };

/**
 * Who the visit is for (spec 3.3 steps 3 and 4): one of this number's patients at this clinic, by id, or someone new
 * with the patient form. The patient's mobile is always the verified number, never a field.
 */
async function whoFor(clinicId: string, mobile: string, v: Record<string, unknown>, today: string): Promise<Who | { errors: Record<string, string> }> {
  if (v.patientId !== undefined && v.patientId !== null) {
    if (!isUuid(v.patientId)) return { errors: { patient: PICK_PATIENT } };
    const { data } = await adminClient()
      .from("patients")
      .select("id, first_name, last_name")
      .eq("id", v.patientId)
      .eq("clinic_id", clinicId)
      .eq("mobile", mobile)
      .is("anonymized_at", null)
      .maybeSingle()
      .throwOnError();
    const p = data as { id: string; first_name: string; last_name: string } | null;
    return p ? { patientId: p.id, first: p.first_name, last: p.last_name, form: null } : { errors: { patient: PICK_PATIENT } };
  }
  const parsed = parseIntakeForm(v.form, today);
  return parsed.ok ? { patientId: null, first: parsed.form.first, last: parsed.form.last, form: parsed.form } : { errors: parsed.errors };
}

export type BookOutcome =
  | { status: "sent"; token: string }
  | { status: "taken"; starts: string[] }
  | { status: "too_many" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unverified" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.3 step 7 "Send request": for a verified number, at an active branch, for one of the number's patients or
 * someone new with the form. Re-validated exactly like the booking page's request: the services and dentist against
 * the branch, the cap on pending requests, and the time against the branch's open times (minimum notice, days ahead).
 * The request holds its time at once (spec 2.4) and the clinic gets today's new request alert.
 */
export async function bookForNumber(slug: string, input: unknown, device: Device): Promise<BookOutcome> {
  const v = record(input);
  const mobile = verifiedNumber(v.mobile, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = isUuid(v.branchId) ? await loadClinic({ slug }, v.branchId) : null;
    if (!clinic) return { status: "invalid", errors: { branch: "Choose the branch again." } };
    if (!(await bookingOpen(clinic.id, device.now))) return { status: "paused" };
    const chosen = resolveSelection(clinic, v);
    const start = new Date(typeof v.startsAt === "string" ? v.startsAt : Number.NaN);
    if (!chosen || Number.isNaN(start.getTime())) return { status: "invalid", errors: { slot: PICK_TIME } };
    const who = await whoFor(clinic.id, mobile, v, manilaDate(device.now));
    if ("errors" in who) return { status: "invalid", errors: who.errors };
    if (await overBookingCap(clinic.id, mobile, device.now)) return { status: "too_many" };
    const end = new Date(start.getTime() + chosen.duration * 60_000);
    const taken = await takenStarts(clinic, chosen.dentist.id, start, end, device.now);
    if (taken) return { status: "taken", starts: taken };

    const token = newToken();
    const { data: appointmentId, error } = await adminClient().rpc("create_booking", {
      p_clinic_id: clinic.id,
      p_branch_id: clinic.branch.id,
      p_dentist_id: chosen.dentist.id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_procedure_names: chosen.procedures.map((p) => p.name),
      p_source: "online",
      p_status: "pending",
      p_manage_token: token,
      p_patient_id: who.patientId,
      p_first_name: who.first,
      p_last_name: who.last,
      p_mobile: mobile,
      p_birthday: who.form?.birthday ?? null,
      p_hmo: who.form?.hmo ?? "",
      p_consent: true,
      p_actor: "patient",
      p_user_id: null,
      p_form: who.form ? formColumns(who.form) : null,
    });
    // 23P01: the overlap guard caught a booking that landed between the check above and this insert.
    if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, chosen.dentist.id, start, end, device.now)) ?? [] };
    if (error?.code === "P0002") return { status: "invalid", errors: { patient: PICK_PATIENT } };
    if (error) throw error;

    await alertClinic({
      kind: "request_alert",
      clinicId: clinic.id,
      appointmentId: appointmentId as string,
      first: who.first,
      last: who.last,
      startsAt: start,
      dentist: clinic.dentists.length > 1 ? chosen.dentist.smsName : null,
    });
    return { status: "sent", token };
  } catch (e) {
    logError("bookForNumber", e);
    return { status: "unavailable" };
  }
}

type OwnedRow = {
  id: string;
  status: "pending" | "confirmed";
  starts_at: string;
  ends_at: string;
  dentist_id: string;
  branch_id: string;
  patient_id: string;
  procedure_names: string[];
  manage_token: string;
};

/** One of this number's pending or confirmed appointments at this clinic, still ahead, or null (spec 8). */
async function ownedAppointment(clinicId: string, mobile: string, id: unknown, now: Date): Promise<OwnedRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await adminClient()
    .from("appointments")
    .select("id, status, starts_at, ends_at, dentist_id, branch_id, patient_id, procedure_names, manage_token, patients!inner(mobile, anonymized_at)")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .eq("patients.mobile", mobile)
    .is("patients.anonymized_at", null)
    .in("status", ["pending", "confirmed"])
    .gt("starts_at", now.toISOString())
    .maybeSingle()
    .throwOnError();
  return data as OwnedRow | null;
}

/**
 * For open times while a patient changes an appointment (spec 3.4 step 3): its branch, where it stays, and its id,
 * whose own time counts as free. Only for a number this phone verified, and only that number's own appointment.
 */
export async function changeScope(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<{ branchId: string; ignoreId: string } | null> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return null;
  const clinic = await clinicOf(slug);
  const owned = clinic ? await ownedAppointment(clinic.id, mobile, appointmentId, device.now) : null;
  return owned ? { branchId: owned.branch_id, ignoreId: owned.id } : null;
}

export type ChangeOutcome =
  | { status: "sent" }
  | { status: "taken"; starts: string[] }
  /** Within the clinic's minimum notice, or its branch no longer takes bookings: "Please call the clinic to change it." */
  | { status: "call_clinic" }
  | { status: "unchanged" }
  /** Not this number's upcoming pending or confirmed appointment at this clinic (any more). */
  | { status: "gone" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unverified" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.4 step 4 "Send changes" and spec 5. The branch stays the appointment's; the new time is re-validated exactly
 * like a new booking (open times at that branch, minimum notice, days ahead), counting the appointment's own time as
 * free. change_booking then moves it in one statement, so the old time frees as the new one is taken, and sends it
 * back to pending; the clinic gets the changed request alert.
 */
export async function changeForNumber(slug: string, input: unknown, device: Device): Promise<ChangeOutcome> {
  const v = record(input);
  const mobile = verifiedNumber(v.mobile, device);
  if (!mobile) return { status: "unverified" };
  try {
    const ref = await clinicOf(slug);
    const owned = ref ? await ownedAppointment(ref.id, mobile, v.appointmentId, device.now) : null;
    if (!ref || !owned) return { status: "gone" };
    if (!(await bookingOpen(ref.id, device.now))) return { status: "paused" };
    if (new Date(owned.starts_at).getTime() < device.now.getTime() + ref.minNoticeMinutes * 60_000) return { status: "call_clinic" };
    const clinic = await loadClinic({ id: ref.id }, owned.branch_id);
    if (!clinic) return { status: "call_clinic" };
    const chosen = resolveSelection(clinic, v);
    const start = new Date(typeof v.startsAt === "string" ? v.startsAt : Number.NaN);
    if (!chosen || Number.isNaN(start.getTime())) return { status: "invalid", errors: { slot: PICK_TIME } };
    const who = await whoFor(ref.id, mobile, v, manilaDate(device.now));
    if ("errors" in who) return { status: "invalid", errors: who.errors };
    const end = new Date(start.getTime() + chosen.duration * 60_000);
    const names = chosen.procedures.map((p) => p.name);
    const same =
      who.patientId === owned.patient_id &&
      chosen.dentist.id === owned.dentist_id &&
      start.getTime() === new Date(owned.starts_at).getTime() &&
      names.join("\n") === owned.procedure_names.join("\n");
    if (same) return { status: "unchanged" };
    const taken = await takenStarts(clinic, chosen.dentist.id, start, end, device.now, owned.id);
    if (taken) return { status: "taken", starts: taken };

    const { data: changed, error } = await adminClient().rpc("change_booking", {
      p_clinic_id: ref.id,
      p_id: owned.id,
      p_mobile: mobile,
      p_dentist_id: chosen.dentist.id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_procedure_names: names,
      p_patient_id: who.patientId,
      p_first_name: who.form ? who.first : null,
      p_last_name: who.form ? who.last : null,
      p_birthday: who.form?.birthday ?? null,
      p_hmo: who.form?.hmo ?? null,
      p_form: who.form ? formColumns(who.form) : null,
    });
    if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, chosen.dentist.id, start, end, device.now, owned.id)) ?? [] };
    if (error?.code === "P0002") return { status: "invalid", errors: { patient: PICK_PATIENT } };
    if (error) throw error;
    // False: staff changed it, or it came within the minimum notice, a moment ago.
    if (!changed) return { status: "gone" };

    await alertClinic({
      kind: "change_alert",
      clinicId: ref.id,
      appointmentId: owned.id,
      first: who.first,
      last: who.last,
      startsAt: start,
      dentist: clinic.dentists.length > 1 ? chosen.dentist.smsName : null,
    });
    return { status: "sent" };
  } catch (e) {
    logError("changeForNumber", e);
    return { status: "unavailable" };
  }
}

export type CancelOutcome = "cancelled" | "not_allowed" | "gone" | "unverified" | "unavailable";

/**
 * Spec 3.5 step 3 "Yes, cancel it": one of this number's appointments, cancelled exactly as the patient link cancels
 * it (cancelByPatient): the time frees, the clinic gets today's cancellation alert, and the event is recorded. Like
 * the link in every text, it works while the clinic is paused.
 */
export async function cancelForNumber(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<CancelOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return "unverified";
  try {
    const clinic = await clinicOf(slug);
    const owned = clinic ? await ownedAppointment(clinic.id, mobile, appointmentId, device.now) : null;
    if (!owned) return "gone";
    const result = await cancelByPatient(owned.manage_token, device.now);
    return result === "not_found" ? "gone" : result;
  } catch (e) {
    logError("cancelForNumber", e);
    return "unavailable";
  }
}
