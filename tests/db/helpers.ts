import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { newToken } from "@/lib/codes";

/** Production (first created as brightsmile-dev). */
const PRODUCTION_PROJECT_REF = "fmvqwojzsklinbdmfjkn";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || url.includes(PRODUCTION_PROJECT_REF)) {
  throw new Error(
    "Database tests never run against production: point .env.local at a development Supabase project. " +
      "They use the secret key and call global functions like expire_pending.",
  );
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Server-side client with the secret key. Bypasses RLS. */
export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, noSession);
}

/** A client with no session: a stranger on the internet. */
export function anonDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, noSession);
}

export const rand = () => Math.random().toString(36).slice(2, 8);

/** A confirmed user, and a client signed in as them. */
export async function signedInUser(): Promise<{ db: SupabaseClient; userId: string; email: string; password: string }> {
  const email = `bs-test-${rand()}@example.com`;
  const password = `pw-${rand()}-${rand()}-${rand()}`;
  const { data, error } = await adminDb().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anonDb();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email, password };
}

export async function deleteUser(userId: string) {
  await adminDb().auth.admin.deleteUser(userId);
}

/** A clinic with one dentist working 9:00 to 17:00 every day, and one patient. */
export async function seedClinic() {
  const db = adminDb();
  const { data: clinic } = await db
    .from("clinics")
    .insert({ name: "Seed Clinic", sms_name: "Seed Clinic", slug: `t-${rand()}`, mobile: "+639170000000" })
    .select()
    .single()
    .throwOnError();
  const { data: dentist } = await db
    .from("dentists")
    .insert({ clinic_id: clinic.id, name: "Dr. Seed", sms_name: "Dr. Seed" })
    .select()
    .single()
    .throwOnError();
  await db
    .from("working_hours")
    .insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      clinic_id: clinic.id, dentist_id: dentist.id, weekday, start_time: "09:00", end_time: "17:00",
    })))
    .throwOnError();
  const { data: patient } = await db
    .from("patients")
    .insert({ clinic_id: clinic.id, first_name: "Ana", last_name: "Cruz", mobile: "+639171112222" })
    .select()
    .single()
    .throwOnError();
  return { clinic, dentist, patient };
}

export type Seed = Awaited<ReturnType<typeof seedClinic>>;

export async function deleteClinic(id: string) {
  await adminDb().from("clinics").delete().eq("id", id);
}

/**
 * A clinic made through create_clinic by a signed-in staff user, so `staff.db` acts under RLS exactly
 * like the dashboard: one dentist ("Dr. Ana Reyes", short name "Dr. Reyes") working 9:00 to 17:00 every
 * day, procedures Cleaning (60) and Consultation (30), and one patient with a mobile.
 */
export async function staffClinic() {
  const user = await signedInUser();
  const { data: clinicId } = await user.db
    .rpc("create_clinic", {
      p: {
        name: "Staff Clinic",
        sms_name: "Staff Clinic",
        slug: `st-${rand()}`,
        mobile: "+639170000002",
        address: "Makati",
        dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
        hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })),
        procedures: [
          { name: "Consultation", minutes: 30 },
          { name: "Cleaning", minutes: 60 },
        ],
      },
    })
    .throwOnError();
  const db = adminDb();
  const { data: clinic } = await db.from("clinics").select("*").eq("id", clinicId).single().throwOnError();
  const { data: dentist } = await db.from("dentists").select("*").eq("clinic_id", clinicId).single().throwOnError();
  const { data: procedures } = await db.from("procedures").select("*").eq("clinic_id", clinicId).order("name").throwOnError();
  const { data: patient } = await db
    .from("patients")
    .insert({
      clinic_id: clinicId,
      first_name: "Ana",
      last_name: "Cruz",
      mobile: `+63917${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    })
    .select()
    .single()
    .throwOnError();
  return {
    staff: { db: user.db, userId: user.userId, clinicId: clinicId as string },
    login: { email: user.email, password: user.password },
    seed: { clinic, dentist, patient },
    procedures: procedures as { id: string; name: string; duration_minutes: number }[],
  };
}

export type StaffSeed = Awaited<ReturnType<typeof staffClinic>>;

export async function dropStaffClinic(s: StaffSeed) {
  await deleteClinic(s.staff.clinicId);
  await deleteUser(s.staff.userId);
}

/** An appointments row for direct inserts (no slot checks). */
export function appointmentRow(seed: Seed, startsAt: string, endsAt: string, status = "confirmed") {
  return {
    clinic_id: seed.clinic.id,
    dentist_id: seed.dentist.id,
    patient_id: seed.patient.id,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    procedure_names: ["Consultation"],
    source: "online",
    manage_token: newToken(),
  };
}
