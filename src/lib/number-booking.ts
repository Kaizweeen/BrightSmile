import "server-only";
import { bookingOpen } from "@/lib/billing-data";
import { issueCode, spendCode } from "@/lib/booking";
import { logError } from "@/lib/log";
import { normalizeMobile } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";

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
    const spent = await spendCode(requestId, code, now, "verify");
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
