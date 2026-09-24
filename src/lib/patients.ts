import "server-only";
import type { Status } from "@/lib/appointments";
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
};

const GONE = "This patient no longer exists.";
const GENERIC = "Something went wrong. Please try again.";

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

type PatientRow = HitRow & { birthday: string | null; hmo: string | null; anonymized_at: string | null };
type HistoryRow = { id: string; starts_at: string; status: Status; procedure_names: string[]; dentist: { name: string } };

/** Spec 5.3 patient detail: details, appointment history (newest first), and the no-show count. */
export async function loadPatient(staff: Staff, id: string): Promise<PatientDetail | null> {
  if (!isUuid(id)) return null;
  const [patient, history] = await Promise.all([
    staff.db
      .from("patients")
      .select("id, first_name, last_name, mobile, birthday, hmo, anonymized_at")
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
    const { data, error } = await staff.db
      .from("patients")
      .update({
        first_name: "Deleted",
        last_name: "patient",
        mobile: null,
        birthday: null,
        hmo: null,
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
