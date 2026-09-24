import { normalizeMobile } from "@/lib/phone";
import type { Block, BookingRules } from "@/lib/slots";
import { cleanBirthday, cleanText, LIMITS } from "@/lib/validate";

export type PublicDentist = { id: string; name: string; smsName: string; hours: Block[][] };
export type PublicProcedure = { id: string; name: string; minutes: number };

/** Everything the public booking page receives (spec 6): no patients and no busy intervals. */
export type PublicClinic = {
  id: string;
  slug: string;
  name: string;
  smsName: string;
  mobile: string;
  address: string;
  mapsUrl: string | null;
  rules: BookingRules;
  dentists: PublicDentist[];
  procedures: PublicProcedure[];
};

export type Selection = { dentistId: string; procedureIds: string[] };
export type Details = { first: string; last: string; mobile: string; birthday: string; hmo: string; consent: boolean };
export type BookingInput = Selection & Details & { startsAt: string };

/** The pending booking: stored in otp_requests.booking, then passed to create_booking. */
export type BookingPayload = {
  clinicId: string;
  slug: string;
  dentistId: string;
  startsAt: string;
  endsAt: string;
  procedureNames: string[];
  first: string;
  last: string;
  mobile: string;
  birthday: string | null;
  hmo: string;
};

export type ResolvedSelection = { dentist: PublicDentist; procedures: PublicProcedure[]; duration: number };

/** Common HMO providers, offered as suggestions on the booking form (spec 5.1). */
export const HMO_SUGGESTIONS = [
  "Maxicare",
  "Intellicare",
  "MediCard",
  "PhilCare",
  "Cocolife",
  "Avega",
  "ValuCare",
  "Insular Health Care",
  "EastWest Healthcare",
  "Kaiser",
];

// appointments.procedure_names holds 1 to 20 names.
const MAX_PROCEDURES = 20;

/** The dentist and procedures the client picked, checked against the clinic, or null. */
export function resolveSelection(clinic: PublicClinic, value: unknown): ResolvedSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const { dentistId, procedureIds } = value as Record<string, unknown>;
  const dentist = clinic.dentists.find((d) => d.id === dentistId);
  if (!dentist || !Array.isArray(procedureIds) || procedureIds.length === 0 || procedureIds.length > MAX_PROCEDURES) return null;
  const ids = new Set(procedureIds);
  const procedures = clinic.procedures.filter((p) => ids.has(p.id));
  if (ids.size !== procedureIds.length || procedures.length !== ids.size) return null;
  return { dentist, procedures, duration: procedures.reduce((sum, p) => sum + p.minutes, 0) };
}

/** Problems with the patient's details, keyed by field. Used by the form and again by the server. */
export function detailErrors(d: Details, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!cleanText(d.first, LIMITS.personName)) errors.first = "Please enter your first name.";
  if (!cleanText(d.last, LIMITS.personName)) errors.last = "Please enter your last name.";
  if (!normalizeMobile(d.mobile)) errors.mobile = "Enter a Philippine mobile number, like 0917 123 4567.";
  if (cleanBirthday(d.birthday, today) === null) errors.birthday = "Use a real past date, or leave this blank.";
  if (cleanText(d.hmo, LIMITS.hmo, true) === null) errors.hmo = `Keep this under ${LIMITS.hmo} characters.`;
  if (!d.consent) errors.consent = "Please agree before sending your request.";
  return errors;
}

/**
 * Validates a booking request on the server (spec 12) and builds the payload from the clinic's own
 * data: the end time, procedure names, and clinic come from the server, never from the client.
 * Whether the start is still open is checked separately, against the database.
 */
export function parseBookingInput(
  clinic: PublicClinic,
  value: unknown,
  today: string,
): { ok: true; payload: BookingPayload } | { ok: false; errors: Record<string, string> } {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : "");
  const details: Details = {
    first: text("first"),
    last: text("last"),
    mobile: text("mobile"),
    birthday: text("birthday"),
    hmo: text("hmo"),
    consent: v.consent === true,
  };
  const errors = detailErrors(details, today);
  const chosen = resolveSelection(clinic, v);
  const start = new Date(text("startsAt"));
  if (!chosen || Number.isNaN(start.getTime())) errors.slot = "Pick the visit and time again.";
  if (!chosen || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      clinicId: clinic.id,
      slug: clinic.slug,
      dentistId: chosen.dentist.id,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + chosen.duration * 60_000).toISOString(),
      procedureNames: chosen.procedures.map((p) => p.name),
      first: cleanText(details.first, LIMITS.personName)!,
      last: cleanText(details.last, LIMITS.personName)!,
      mobile: normalizeMobile(details.mobile)!,
      birthday: cleanBirthday(details.birthday, today) || null,
      hmo: cleanText(details.hmo, LIMITS.hmo, true) ?? "",
    },
  };
}
