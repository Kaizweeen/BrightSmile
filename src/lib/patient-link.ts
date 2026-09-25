import "server-only";
import { canTransition, isCancellable, type Status } from "@/lib/appointments";
import { alertClinic } from "@/lib/notify";
import { adminClient } from "@/lib/supabase/admin";

export type PatientView = {
  status: Status;
  startsAt: Date;
  firstName: string;
  dentistName: string;
  clinicName: string;
  clinicMobile: string;
  slug: string;
  cancellable: boolean;
};

type Row = {
  id: string;
  clinic_id: string;
  status: Status;
  starts_at: string;
  patient: { first_name: string; last_name: string };
  dentist: { name: string; sms_name: string };
  clinic: { name: string; slug: string; mobile: string };
};

const TOKEN = /^[A-Za-z0-9]{12}$/;

async function findByToken(token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await adminClient()
    .from("appointments")
    .select(
      "id, clinic_id, status, starts_at, patient:patients(first_name, last_name), dentist:dentists(name, sms_name), clinic:clinics(name, slug, mobile)",
    )
    .eq("manage_token", token)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Row | null;
}

/** Spec 5.2: status, clinic, dentist, date, time, and the patient's first name only. */
export async function loadPatientView(token: string, now: Date): Promise<PatientView | null> {
  const row = await findByToken(token);
  if (!row) return null;
  const startsAt = new Date(row.starts_at);
  return {
    status: row.status,
    startsAt,
    firstName: row.patient.first_name,
    dentistName: row.dentist.name,
    clinicName: row.clinic.name,
    clinicMobile: row.clinic.mobile,
    slug: row.clinic.slug,
    cancellable: isCancellable({ status: row.status, starts_at: startsAt }, now),
  };
}

/** Spec 9.2: the patient cancels a future pending or confirmed visit, and the clinic is alerted. */
export async function cancelByPatient(token: string, now: Date): Promise<"cancelled" | "not_allowed" | "not_found"> {
  const row = await findByToken(token);
  if (!row) return "not_found";
  const startsAt = new Date(row.starts_at);
  if (!isCancellable({ status: row.status, starts_at: startsAt }, now) || !canTransition(row.status, "cancelled", "patient")) {
    return "not_allowed";
  }

  const db = adminClient();
  // p_from makes this a compare-and-set: false when staff changed the status a moment ago.
  const { data: changed, error } = await db.rpc("set_appointment_status", {
    p_id: row.id,
    p_from: row.status,
    p_to: "cancelled",
    p_actor: "patient",
    p_user_id: null,
    p_reason: null,
  });
  if (error) throw error;
  if (!changed) return "not_allowed";

  const { count } = await db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", row.clinic_id)
    .eq("active", true);
  await alertClinic({
    kind: "patient_cancel_alert",
    clinicId: row.clinic_id,
    appointmentId: row.id,
    first: row.patient.first_name,
    last: row.patient.last_name,
    startsAt,
    dentist: (count ?? 0) > 1 ? row.dentist.sms_name : null,
  });
  return "cancelled";
}
