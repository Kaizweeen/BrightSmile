import { normalizeMobile } from "@/lib/phone";
import { cleanBirthday, cleanText, isUuid, LIMITS } from "@/lib/validate";

/** What a staff form gets back from a save. */
export type Saved = { ok: true } | { ok: false; error: string; field?: string };

export type PatientFields = { first: string; last: string; mobile: string | null; birthday: string | null; hmo: string };
export type SlotChoice = { dentistId: string; startsAt: Date; custom: boolean };
export type ManualBooking = {
  patientId: string | null;
  patient: PatientFields | null;
  procedureIds: string[];
  slot: SlotChoice;
  sendText: boolean;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

// appointments.procedure_names holds 1 to 20 names.
const MAX_PROCEDURES = 20;

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

/** Patient details typed by staff (spec 5.3): names required, mobile optional (no mobile means no texts). */
export function parsePatientFields(value: unknown, today: string): Parsed<PatientFields> {
  const v = record(value);
  const errors: Record<string, string> = {};
  const first = cleanText(v.first, LIMITS.personName);
  const last = cleanText(v.last, LIMITS.personName);
  const typedMobile = typeof v.mobile === "string" ? v.mobile.trim() : "";
  const mobile = typedMobile ? normalizeMobile(typedMobile) : null;
  const birthday = cleanBirthday(v.birthday, today);
  const hmo = cleanText(v.hmo, LIMITS.hmo, true);
  if (!first) errors.first = `Enter a first name, up to ${LIMITS.personName} characters.`;
  if (!last) errors.last = `Enter a last name, up to ${LIMITS.personName} characters.`;
  if (typedMobile && !mobile) errors.mobile = "Enter a Philippine mobile number, like 0917 123 4567, or leave it blank.";
  if (birthday === null) errors.birthday = "Use a real past date, or leave this blank.";
  if (hmo === null) errors.hmo = `Keep this under ${LIMITS.hmo} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { first: first!, last: last!, mobile, birthday: birthday || null, hmo: hmo! } };
}

/** A chosen time: an open time from the list or a custom time, on a whole minute. */
export function parseSlot(value: unknown): SlotChoice | null {
  const v = record(value);
  const start = typeof v.startsAt === "string" ? new Date(v.startsAt) : null;
  if (!isUuid(v.dentistId) || !start || Number.isNaN(start.getTime()) || start.getTime() % 60_000 !== 0) return null;
  if (typeof v.custom !== "boolean") return null;
  return { dentistId: v.dentistId, startsAt: start, custom: v.custom };
}

/** New appointment (spec 5.3): an existing patient by id, or a new patient's details; procedures; a time. */
export function parseManualBooking(value: unknown, today: string): Parsed<ManualBooking> {
  const v = record(value);
  const errors: Record<string, string> = {};
  const patientId = isUuid(v.patientId) ? v.patientId : null;
  let patient: PatientFields | null = null;
  if (!patientId) {
    const parsed = parsePatientFields(v.patient, today);
    if (parsed.ok) patient = parsed.value;
    else Object.assign(errors, parsed.errors);
  }
  const ids: unknown[] = Array.isArray(v.procedureIds) ? v.procedureIds : [];
  if (ids.length === 0 || ids.length > MAX_PROCEDURES || !ids.every((id) => isUuid(id)) || new Set(ids).size !== ids.length) {
    errors.procedures = "Choose one or more procedures.";
  }
  const slot = parseSlot(v.slot);
  if (!slot) errors.slot = "Choose a time.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { patientId, patient, procedureIds: ids as string[], slot: slot!, sendText: v.sendText === true } };
}

export type PatientQuery = { kind: "mobile"; prefix: string } | { kind: "name"; words: string[] };

/**
 * Search terms from what staff typed (spec 5.3). Three or more digits search mobiles by prefix in the
 * stored +639 form ("0918 123" finds +63918123...). Anything else searches names by word; only letters,
 * digits, apostrophes, and hyphens are kept, so nothing typed can change the database filter.
 */
export function patientSearch(input: unknown): PatientQuery | null {
  const text = typeof input === "string" ? input.trim().slice(0, 60) : "";
  const digits = text.replace(/[\s().+-]/g, "");
  if (/^\d{3,}$/.test(digits)) return { kind: "mobile", prefix: `+63${digits.replace(/^(63|0)/, "")}` };
  const words = text
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w.length > 0)
    .slice(0, 4);
  return words.length > 0 ? { kind: "name", words } : null;
}

/** True when every search word appears in the patient's full name. */
export function matchesWords(p: { first: string; last: string }, words: string[]): boolean {
  const name = `${p.first} ${p.last}`.normalize("NFC").toLowerCase();
  return words.every((w) => name.includes(w));
}
