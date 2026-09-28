import "server-only";
import type { Status } from "@/lib/appointments";
import { ALLERGIES, CONDITIONS, parseMedical, QUESTIONS, WOMEN_QUESTIONS } from "@/lib/intake";
import { localMobile } from "@/lib/phone";
import { matchesWords, parsePatientFields, patientSearch, type Saved } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { manilaDate } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export type PatientHit = { id: string; first: string; last: string; mobile: string | null };

export type PatientDetail = {
  patient: {
    id: string;
    first: string;
    last: string;
    mobile: string | null;
    birthday: string | null;
    hmo: string | null;
    anonymized: boolean;
  };
  history: { id: string; startsAt: string; status: Status; procedures: string[]; dentistName: string }[];
  noShows: number;
  /** The patient form, or null when there is none (booking flow spec 6). */
  form: PatientFormView | null;
};

/** The patient form as the patient page shows it: allergies and ticked conditions first (booking flow spec 6). */
export type PatientFormView = {
  allergies: string[];
  conditions: string[];
  /** The rest of the form, answered lines only, in the form's order. */
  rows: { label: string; value: string }[];
  signed: { name: string; at: string; version: string };
};

/** The form's columns on public.patients, as the patient page reads them. */
type FormRow = {
  middle_name: string | null;
  sex: "female" | "male" | null;
  address: string | null;
  occupation: string | null;
  email: string | null;
  guardian_name: string | null;
  hmo_number: string | null;
  previous_dentist: string | null;
  last_visit: string | null;
  visit_reason: string | null;
  emergency_name: string | null;
  emergency_mobile: string | null;
  waiver_name: string | null;
  waiver_version: string | null;
  waiver_at: string | null;
  medical: unknown;
};

const FORM_COLUMNS =
  "middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit, visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The patient form for the patient page (booking flow spec 6 "In the dashboard"), or null for a patient who never signed
 * one (booked before the form existed, or added by staff). Allergies and ticked conditions come first; the rest lists
 * only what was answered, in the form's order. The medical answers are read back through parseMedical, so only the
 * fixed shape shows. Health information: the clinic's members read it here and nowhere else, and it is never logged.
 */
export function formView(row: FormRow): PatientFormView | null {
  if (!row.waiver_name || !row.waiver_at || !row.waiver_version) return null;
  const medical = parseMedical(row.medical, row.sex ?? "male");
  const allergies = (medical?.allergies ?? []).map((k) => (k === "other" ? `Other: ${medical?.allergyOther ?? "not named"}` : ALLERGIES[k]));
  const conditions = (medical?.conditions ?? []).map((k) => (k === "other" ? `Other: ${medical?.conditionOther ?? "not named"}` : CONDITIONS[k]));
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };
  add("Middle name", row.middle_name);
  add("Sex", row.sex === "female" ? "Female" : row.sex === "male" ? "Male" : null);
  add("Home address", row.address);
  add("Occupation", row.occupation);
  add("Email", row.email);
  add("Parent or guardian", row.guardian_name);
  add("HMO card or member number", row.hmo_number);
  add("Previous dentist", row.previous_dentist);
  add("Last dental visit", row.last_visit ? `${MONTHS[Number(row.last_visit.slice(5, 7)) - 1]} ${row.last_visit.slice(0, 4)}` : null);
  add("Reason for the visit", row.visit_reason);
  if (medical) {
    for (const q of [...QUESTIONS, ...(row.sex === "female" ? WOMEN_QUESTIONS : [])]) {
      const answer = medical[q.key];
      if (answer === null) continue;
      const detail = answer && q.detail ? medical[q.detail.key] : null;
      add(q.label, answer ? (detail ? `Yes: ${detail}` : "Yes") : "No");
    }
  }
  add("Emergency contact", [row.emergency_name, row.emergency_mobile ? localMobile(row.emergency_mobile) : null].filter(Boolean).join(", ") || null);
  return { allergies, conditions, rows, signed: { name: row.waiver_name, at: row.waiver_at, version: row.waiver_version } };
}

const GONE = "This patient no longer exists.";

/** The patient form (booking flow spec 6): all of it goes when a patient is anonymized (patients_anonymized_clean). */
const FORM_CLEARED = {
  middle_name: null,
  sex: null,
  address: null,
  occupation: null,
  email: null,
  guardian_name: null,
  hmo_number: null,
  previous_dentist: null,
  last_visit: null,
  visit_reason: null,
  emergency_name: null,
  emergency_mobile: null,
  waiver_name: null,
  waiver_version: null,
  waiver_at: null,
  medical: null,
};
const GENERIC = "Something went wrong. Please try again.";
const HAS_UPCOMING = "Cancel this patient's upcoming visits first.";

type HitRow = { id: string; first_name: string; last_name: string; mobile: string | null };

/** Spec 5.3: search by name or mobile. Deleted patients never appear. */
export async function searchPatients(staff: Staff, input: unknown): Promise<PatientHit[]> {
  const q = patientSearch(input);
  if (!q) return [];
  let query = staff.db
    .from("patients")
    .select("id, first_name, last_name, mobile")
    .eq("clinic_id", staff.clinicId)
    .is("anonymized_at", null);
  if (q.kind === "mobile") {
    query = query.like("mobile", `${q.prefix}%`);
  } else {
    // The database narrows by the longest word; every word is then checked here.
    const longest = [...q.words].sort((x, y) => y.length - x.length)[0];
    query = query.or(`first_name.ilike.%${longest}%,last_name.ilike.%${longest}%`);
  }
  const { data } = await query.order("last_name").order("first_name").limit(200).throwOnError();
  const hits = (data as HitRow[]).map((r) => ({ id: r.id, first: r.first_name, last: r.last_name, mobile: r.mobile }));
  return (q.kind === "name" ? hits.filter((h) => matchesWords(h, q.words)) : hits).slice(0, 30);
}

type PatientRow = HitRow & FormRow & { birthday: string | null; hmo: string | null; anonymized_at: string | null };
type HistoryRow = { id: string; starts_at: string; status: Status; procedure_names: string[]; dentist: { name: string } };

/** Spec 5.3 patient detail: details, appointment history (newest first), and the no-show count. */
export async function loadPatient(staff: Staff, id: string): Promise<PatientDetail | null> {
  if (!isUuid(id)) return null;
  const [patient, history] = await Promise.all([
    staff.db
      .from("patients")
      .select(`id, first_name, last_name, mobile, birthday, hmo, anonymized_at, ${FORM_COLUMNS}`)
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError(),
    staff.db
      .from("appointments")
      .select("id, starts_at, status, procedure_names, dentist:dentists(name)")
      .eq("clinic_id", staff.clinicId)
      .eq("patient_id", id)
      .order("starts_at", { ascending: false })
      .limit(200)
      .throwOnError(),
  ]);
  const p = patient.data as PatientRow | null;
  if (!p) return null;
  const rows = history.data as unknown as HistoryRow[];
  return {
    patient: {
      id: p.id,
      first: p.first_name,
      last: p.last_name,
      mobile: p.mobile,
      birthday: p.birthday,
      hmo: p.hmo,
      anonymized: p.anonymized_at !== null,
    },
    history: rows.map((r) => ({ id: r.id, startsAt: r.starts_at, status: r.status, procedures: r.procedure_names, dentistName: r.dentist.name })),
    noShows: rows.filter((r) => r.status === "no_show").length,
    form: formView(p),
  };
}

/** Saves edited details. A deleted patient can't be edited. */
export async function updatePatient(staff: Staff, id: string, input: unknown, now: Date): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  const parsed = parsePatientFields(input, manilaDate(now));
  if (!parsed.ok) {
    const [field, error] = Object.entries(parsed.errors)[0];
    return { ok: false, field, error };
  }
  const p = parsed.value;
  try {
    const { data, error } = await staff.db
      .from("patients")
      .update({ first_name: p.first, last_name: p.last, mobile: p.mobile, birthday: p.birthday, hmo: p.hmo || null })
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .is("anonymized_at", null)
      .select("id");
    // patients_identity: one patient per clinic, mobile, and name.
    if (error?.code === "23505") return { ok: false, field: "mobile", error: "Another patient already has this name and mobile." };
    if (error) throw error;
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    console.error("updatePatient failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return { ok: false, error: GENERIC };
  }
}

/** Spec 12: "Delete patient" anonymizes. Appointments stay for counts. */
export async function deletePatient(staff: Staff, id: string, now: Date): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    const { count, error: countError } = await staff.db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", staff.clinicId)
      .eq("patient_id", id)
      .in("status", ["pending", "confirmed"])
      .gt("starts_at", now.toISOString());
    if (countError) throw countError;
    if ((count ?? 0) > 0) return { ok: false, error: HAS_UPCOMING };

    const { data, error } = await staff.db
      .from("patients")
      .update({
        first_name: "Deleted",
        last_name: "patient",
        mobile: null,
        birthday: null,
        hmo: null,
        ...FORM_CLEARED,
        anonymized_at: now.toISOString(),
      })
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .is("anonymized_at", null)
      .select("id");
    if (error) throw error;
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    console.error("deletePatient failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return { ok: false, error: GENERIC };
  }
}
