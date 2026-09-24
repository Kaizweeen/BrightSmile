import "server-only";
import {
  actionsFor,
  assembleDay,
  failedTexts,
  hoursByDentist,
  type DayRow,
  type HoursRow,
  type ScheduleItem,
  type SmsLogRow,
  type StaffAction,
} from "@/lib/schedule";
import type { Busy } from "@/lib/slots";
import type { Staff } from "@/lib/supabase/server";
import { addDays, manilaInstant } from "@/lib/time";

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

export type DayView = { dentists: { id: string; name: string; active: boolean }[]; items: ScheduleItem[] };

/** Spec 5.3 Schedule: one Manila day, every status except expired, with "outside hours" and "text not delivered". */
export async function loadDay(staff: Staff, date: string, dentistId: string | null, now: Date): Promise<DayView> {
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  let appointments = staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, procedure_names, dentist_id, patient_id, patient:patients(first_name, last_name, mobile)")
    .eq("clinic_id", staff.clinicId)
    .neq("status", "expired")
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (dentistId) appointments = appointments.eq("dentist_id", dentistId);

  const [dentists, hours, timeOff, list] = await Promise.all([
    staff.db.from("dentists").select("id, name, active").eq("clinic_id", staff.clinicId).order("created_at").order("name").throwOnError(),
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
    staff.db
      .from("time_off")
      .select("dentist_id, starts_at, ends_at")
      .eq("clinic_id", staff.clinicId)
      .lt("starts_at", to)
      .gt("ends_at", from)
      .throwOnError(),
    appointments.throwOnError(),
  ]);
  const rows = list.data as unknown as DayRow[];

  let logs: SmsLogRow[] = [];
  if (rows.length > 0) {
    const { data } = await staff.db
      .from("sms_log")
      .select("id, appointment_id, kind, status")
      .eq("clinic_id", staff.clinicId)
      .in("appointment_id", rows.map((r) => r.id))
      .throwOnError();
    logs = data as SmsLogRow[];
  }

  const off = new Map<string, Busy[]>();
  for (const t of timeOff.data as { dentist_id: string; starts_at: string; ends_at: string }[]) {
    off.set(t.dentist_id, [...(off.get(t.dentist_id) ?? []), { start: new Date(t.starts_at), end: new Date(t.ends_at) }]);
  }

  return {
    dentists: dentists.data as DayView["dentists"],
    items: assembleDay(rows, { hours: hoursByDentist(hours.data as HoursRow[]), timeOff: off, failed: failedTexts(logs), now }),
  };
}
