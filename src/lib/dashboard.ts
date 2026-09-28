import "server-only";
import type { Status } from "@/lib/appointments";
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
import { busyBetween } from "@/lib/availability";
import { openStarts, type Busy } from "@/lib/slots";
import type { Staff } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validate";
import { addDays, manilaInstant, parseClock, weekday } from "@/lib/time";

export type RequestItem = {
  id: string;
  startsAt: string;
  requestedAt: string;
  procedures: string[];
  dentistName: string;
  branchId: string;
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
  branch_id: string;
  dentist: { name: string };
  patient: { first_name: string; last_name: string; mobile: string | null };
};

/**
 * Spec 5.3 Requests: pending requests still ahead, soonest first, at one branch when branchId names it (booking flow
 * spec 4). Returning means a completed visit here before.
 */
export async function loadRequests(staff: Staff, now: Date, branchId: string | null = null): Promise<RequestItem[]> {
  let query = staff.db
    .from("appointments")
    .select(
      "id, starts_at, created_at, procedure_names, patient_id, branch_id, dentist:dentists(name), patient:patients(first_name, last_name, mobile)",
    )
    .eq("clinic_id", staff.clinicId)
    .eq("status", "pending")
    .gt("starts_at", now.toISOString());
  if (branchId) query = query.eq("branch_id", branchId);
  const { data } = await query.order("starts_at").limit(100).throwOnError();
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
    branchId: r.branch_id,
    patientId: r.patient_id,
    first: r.patient.first_name,
    last: r.patient.last_name,
    mobile: r.patient.mobile,
    returning: visited.has(r.patient_id),
    actions: actionsFor("pending", new Date(r.starts_at), now),
  }));
}

export type DayView = { dentists: { id: string; name: string; active: boolean }[]; items: ScheduleItem[] };

/**
 * Spec 5.3 Schedule: one Manila day, every status except expired, with "outside hours" (at the visit's own branch) and
 * "text not delivered", for one dentist and one branch when they are named (booking flow spec 4).
 */
export async function loadDay(staff: Staff, date: string, dentistId: string | null, now: Date, branchId: string | null = null): Promise<DayView> {
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  let appointments = staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, procedure_names, dentist_id, branch_id, patient_id, patient:patients(first_name, last_name, mobile)")
    .eq("clinic_id", staff.clinicId)
    .neq("status", "expired")
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (dentistId) appointments = appointments.eq("dentist_id", dentistId);
  if (branchId) appointments = appointments.eq("branch_id", branchId);

  const [dentists, hours, timeOff, list] = await Promise.all([
    staff.db.from("dentists").select("id, name, active").eq("clinic_id", staff.clinicId).order("created_at").order("name").throwOnError(),
    staff.db.from("working_hours").select("dentist_id, branch_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
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

/**
 * The branch staff times are for (booking flow spec 4): a moved visit's own branch, otherwise the clinic's first
 * active branch, where create_booking puts a New appointment that names none.
 */
async function staffBranch(staff: Staff, appointmentId?: string): Promise<string | null> {
  if (appointmentId) {
    const { data } = await staff.db
      .from("appointments")
      .select("branch_id")
      .eq("id", appointmentId)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError();
    return (data as { branch_id: string } | null)?.branch_id ?? null;
  }
  const { data } = await staff.db
    .from("branches")
    .select("id")
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .order("sort")
    .order("created_at")
    .order("id")
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Open start times for staff (New and Move): the clinic's slot spacing inside the dentist's hours at one branch
 * (staffBranch, unless named), minus appointments and time off at every branch. No minimum notice and a 365 day
 * window, since those rules protect the public page. Move passes ignoreId so the visit's own time counts as free
 * (spec 8.4).
 */
export async function staffOpenStarts(
  staff: Staff,
  q: { dentistId: string; date: string; duration: number; ignoreId?: string; branchId?: string },
  now: Date,
): Promise<Date[]> {
  // Values can come straight from a form, so check them before they reach a query.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(q.date) && addDays(q.date, 0) === q.date;
  const validDuration = Number.isInteger(q.duration) && q.duration >= 5 && q.duration <= 9600;
  const validIds = [q.ignoreId, q.branchId].every((id) => id === undefined || isUuid(id));
  if (!isUuid(q.dentistId) || !validDate || !validDuration || !validIds) return [];
  const branchId = q.branchId ?? (await staffBranch(staff, q.ignoreId));
  if (!branchId) return [];
  const [clinic, hours, busy] = await Promise.all([
    staff.db.from("clinics").select("slot_minutes").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("working_hours")
      .select("start_time, end_time")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", q.dentistId)
      .eq("branch_id", branchId)
      .eq("weekday", weekday(q.date))
      .throwOnError(),
    busyBetween(staff.db, q.dentistId, manilaInstant(q.date, 0), manilaInstant(addDays(q.date, 1), 0)),
  ]);
  const blocks = (hours.data as { start_time: string; end_time: string }[]).map((h) => ({
    start: parseClock(h.start_time),
    end: parseClock(h.end_time),
  }));
  return openStarts({
    date: q.date,
    blocks,
    busy,
    durationMinutes: q.duration,
    rules: { slotMinutes: (clinic.data as { slot_minutes: number }).slot_minutes, minNoticeMinutes: 0, maxDaysAhead: 365 },
    now,
    ignoreId: q.ignoreId,
  });
}

export type BookingOptions = {
  dentists: { id: string; name: string }[];
  procedures: { id: string; name: string; minutes: number }[];
  /** Active branches in the clinic's order: New appointment asks for one when there are 2 or more (spec 4). */
  branches: { id: string; name: string }[];
};

/** What New appointment offers: active dentists, active procedures, and active branches. */
export async function loadBookingOptions(staff: Staff): Promise<BookingOptions> {
  const [dentists, procedures, branches] = await Promise.all([
    staff.db.from("dentists").select("id, name").eq("clinic_id", staff.clinicId).eq("active", true).order("created_at").order("name").throwOnError(),
    staff.db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", staff.clinicId).eq("active", true).order("name").throwOnError(),
    loadBranches(staff),
  ]);
  return {
    branches: branches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })),
    dentists: dentists.data as BookingOptions["dentists"],
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
    })),
  };
}

export type MoveTarget = {
  id: string;
  status: Status;
  startsAt: string;
  duration: number;
  dentistId: string;
  patientName: string;
  procedures: string[];
};

/** The visit the Move screen works on, or null for a malformed id or another clinic's visit. */
export async function loadMoveTarget(staff: Staff, id: string): Promise<MoveTarget | null> {
  if (!isUuid(id)) return null;
  const { data } = await staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, dentist_id, procedure_names, patient:patients(first_name, last_name)")
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .maybeSingle()
    .throwOnError();
  const row = data as unknown as {
    id: string;
    status: Status;
    starts_at: string;
    ends_at: string;
    dentist_id: string;
    procedure_names: string[];
    patient: { first_name: string; last_name: string };
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    duration: (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000,
    dentistId: row.dentist_id,
    patientName: `${row.patient.first_name} ${row.patient.last_name}`,
    procedures: row.procedure_names,
  };
}

export type BranchOption = { id: string; name: string; active: boolean };

/** Every branch of the clinic in its order (booking flow spec 4): names for the cards, active ones for the filters. */
export async function loadBranches(staff: Staff): Promise<BranchOption[]> {
  const { data } = await staff.db
    .from("branches")
    .select("id, name, active")
    .eq("clinic_id", staff.clinicId)
    .order("sort")
    .order("created_at")
    .order("id")
    .throwOnError();
  return data as BranchOption[];
}
