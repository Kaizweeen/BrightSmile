import type { Status } from "@/lib/appointments";
import { withinHours, type Block, type Busy } from "@/lib/slots";
import { parseClock } from "@/lib/time";

export type StaffAction = "approve" | "decline" | "move" | "cancel" | "completed" | "no_show";

/** Every status carries a word, never colour alone. */
export const STATUS_LABEL: Record<Status, { word: string; chip: string }> = {
  pending: { word: "Pending", chip: "chip-amber" },
  confirmed: { word: "Confirmed", chip: "chip-green" },
  declined: { word: "Declined", chip: "chip-red" },
  cancelled: { word: "Cancelled", chip: "chip-red" },
  completed: { word: "Completed", chip: "chip-blue" },
  no_show: { word: "No-show", chip: "chip-red" },
  expired: { word: "Expired", chip: "chip-gold" },
};

/**
 * The buttons an appointment offers staff (spec 5.3 and 9.2). Matches what changeStatus and
 * moveAppointment accept, so a button never leads to a refusal unless something changed meanwhile.
 */
export function actionsFor(status: Status, startsAt: Date, now: Date): StaffAction[] {
  const started = startsAt <= now;
  switch (status) {
    case "pending":
      return started ? ["decline"] : ["approve", "decline"];
    case "confirmed":
      return started ? ["completed", "no_show"] : ["move", "cancel"];
    case "completed":
      return ["no_show"];
    case "no_show":
      return ["completed"];
    default:
      return [];
  }
}

// Texts to the patient. Clinic alerts (request_alert, patient_cancel_alert) also carry an appointment id but don't count.
const PATIENT_TEXTS = new Set(["confirmed", "declined", "moved", "cancelled", "reminder"]);

export type SmsLogRow = { id: number; appointment_id: string; kind: string; status: string };

/** Spec 13: appointments whose latest patient text failed, so staff know to call. */
export function failedTexts(rows: SmsLogRow[]): Set<string> {
  const latest = new Map<string, SmsLogRow>();
  for (const r of rows) {
    if (!PATIENT_TEXTS.has(r.kind)) continue;
    const seen = latest.get(r.appointment_id);
    if (!seen || r.id > seen.id) latest.set(r.appointment_id, r);
  }
  return new Set([...latest.values()].filter((r) => r.status === "failed").map((r) => r.appointment_id));
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The schedule's date from the URL, or today when it is missing or not a real date. */
export function parseDay(value: unknown, today: string): string {
  if (typeof value !== "string" || !DATE.test(value)) return today;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : today;
}

export type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string };

/** working_hours rows as each dentist's week: index 0 is Sunday, blocks in minutes, sorted. */
export function hoursByDentist(rows: HoursRow[]): Map<string, Block[][]> {
  const weeks = new Map<string, Block[][]>();
  for (const h of rows) {
    const week = weeks.get(h.dentist_id) ?? Array.from({ length: 7 }, (): Block[] => []);
    week[h.weekday].push({ start: parseClock(h.start_time), end: parseClock(h.end_time) });
    weeks.set(h.dentist_id, week);
  }
  for (const week of weeks.values()) for (const blocks of week) blocks.sort((x, y) => x.start - y.start);
  return weeks;
}

export type DayRow = {
  id: string;
  status: Status;
  starts_at: string;
  ends_at: string;
  procedure_names: string[];
  dentist_id: string;
  patient_id: string;
  patient: { first_name: string; last_name: string; mobile: string | null };
};

export type ScheduleItem = {
  id: string;
  status: Status;
  startsAt: string;
  endsAt: string;
  procedures: string[];
  dentistId: string;
  patientId: string;
  patientName: string;
  mobile: string | null;
  outsideHours: boolean;
  textFailed: boolean;
  actions: StaffAction[];
};

const NO_HOURS: Block[][] = Array.from({ length: 7 }, () => []);

/**
 * One day's appointments in time order with their flags (spec 5.3 and 13). "Outside hours" applies to
 * pending and confirmed visits that are not inside one working block, or that overlap time off.
 */
export function assembleDay(
  rows: DayRow[],
  ctx: { hours: Map<string, Block[][]>; timeOff: Map<string, Busy[]>; failed: Set<string>; now: Date },
): ScheduleItem[] {
  return rows
    .map((r) => ({ r, start: new Date(r.starts_at), end: new Date(r.ends_at) }))
    .sort((x, y) => x.start.getTime() - y.start.getTime())
    .map(({ r, start, end }) => {
      const active = r.status === "pending" || r.status === "confirmed";
      const inTimeOff = (ctx.timeOff.get(r.dentist_id) ?? []).some((t) => t.start < end && start < t.end);
      const outside = !withinHours(start, end, ctx.hours.get(r.dentist_id) ?? NO_HOURS) || inTimeOff;
      return {
        id: r.id,
        status: r.status,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        procedures: r.procedure_names,
        dentistId: r.dentist_id,
        patientId: r.patient_id,
        patientName: `${r.patient.first_name} ${r.patient.last_name}`,
        mobile: r.patient.mobile,
        outsideHours: active && outside,
        textFailed: ctx.failed.has(r.id),
        actions: actionsFor(r.status, start, ctx.now),
      };
    });
}
