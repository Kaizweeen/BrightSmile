import "server-only";
import { actionsFor, type StaffAction } from "@/lib/schedule";
import type { Staff } from "@/lib/supabase/server";

export type RequestItem = {
  id: string;
  startsAt: string;
  requestedAt: string;
  procedures: string[];
  dentistName: string;
  patientId: string;
  first: string;
  last: string;
  mobile: string | null;
  returning: boolean;
  actions: StaffAction[];
};

type RequestRow = {
  id: string;
  starts_at: string;
  created_at: string;
  procedure_names: string[];
  patient_id: string;
  dentist: { name: string };
  patient: { first_name: string; last_name: string; mobile: string | null };
};

/** Spec 5.3 Requests: pending requests still ahead, soonest first. Returning means a completed visit here before. */
export async function loadRequests(staff: Staff, now: Date): Promise<RequestItem[]> {
  const { data } = await staff.db
    .from("appointments")
    .select(
      "id, starts_at, created_at, procedure_names, patient_id, dentist:dentists(name), patient:patients(first_name, last_name, mobile)",
    )
    .eq("clinic_id", staff.clinicId)
    .eq("status", "pending")
    .gt("starts_at", now.toISOString())
    .order("starts_at")
    .limit(100)
    .throwOnError();
  const rows = data as unknown as RequestRow[];

  const visited = new Set<string>();
  const patientIds = [...new Set(rows.map((r) => r.patient_id))];
  if (patientIds.length > 0) {
    const { data: done } = await staff.db
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", staff.clinicId)
      .eq("status", "completed")
      .in("patient_id", patientIds)
      .throwOnError();
    for (const d of done as { patient_id: string }[]) visited.add(d.patient_id);
  }

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    requestedAt: r.created_at,
    procedures: r.procedure_names,
    dentistName: r.dentist.name,
    patientId: r.patient_id,
    first: r.patient.first_name,
    last: r.patient.last_name,
    mobile: r.patient.mobile,
    returning: visited.has(r.patient_id),
    actions: actionsFor("pending", new Date(r.starts_at), now),
  }));
}
