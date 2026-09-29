import type { OperatingHours } from "@/db/schema";
import { hoursOn, WEEKDAYS } from "./hours";
import { formatTime, fromMinutes, manilaDate, manilaMinutes, toMinutes, weekday } from "./time";

/** An active visit as the rules see it. */
export type Visit = {
  id: string;
  branchId: string;
  branchName: string;
  chairNumber: number;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
};

export type WeeklyBlock = { branchId: string; dayOfWeek: number; startTime: string; endTime: string };
export type Finding = { code: string; message: string };
export type Conflict = {
  kind: "dentist" | "chair" | "patient";
  appointmentId: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  branch: string;
  chairNumber: number;
  patient: string;
  dentist: string;
};

/** Everything checkBooking needs, gathered by src/server/booking.ts. */
export type BookingFacts = {
  now: Date;
  walkIn: boolean;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  branch: { id: string; name: string; active: boolean; hours: OperatingHours };
  chair: { number: number; active: boolean } | null;
  dentist: { id: string; name: string; active: boolean; seesPatients: boolean; worksHere: boolean };
  patientId: string;
  procedures: readonly { name: string; active: boolean }[];
  blocks: readonly WeeklyBlock[];
  branchNames: ReadonlyMap<string, string>;
  timeOff: readonly { startsAt: Date; endsAt: Date; reason: string }[];
  visits: readonly Visit[];
};

/** Two [start, end) spans overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Joins touching or overlapping [start, end) minute ranges. */
export function mergeRanges(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const merged: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function conflictFor(kind: Conflict["kind"], v: Visit): Conflict {
  return {
    kind,
    appointmentId: v.id,
    start: v.start,
    end: v.end,
    chairFreeAt: v.chairFreeAt,
    branch: v.branchName,
    chairNumber: v.chairNumber,
    patient: v.patientName,
    dentist: v.dentistName,
  };
}

function clashMessage(c: Conflict): string {
  if (c.kind === "chair") return `Chair ${c.chairNumber} is taken until ${formatTime(c.chairFreeAt)}, turnover included.`;
  const who = c.kind === "dentist" ? c.dentist : c.patient;
  return `${who} has a visit from ${formatTime(c.start)} to ${formatTime(c.end)} at ${c.branch}.`;
}

/** Spec 8.3 and 8.4: the hard stops, the warnings, and the visits a booking clashes with. */
export function checkBooking(f: BookingFacts): { errors: Finding[]; warnings: Finding[]; conflicts: Conflict[] } {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const conflicts: Conflict[] = [];
  const day = weekday(manilaDate(f.start));
  const startMin = manilaMinutes(f.start);
  const endMin = startMin + Math.round((f.end.getTime() - f.start.getTime()) / 60_000);

  if (!f.branch.active) errors.push({ code: "inactive", message: `${f.branch.name} takes no bookings.` });
  if (!f.chair) errors.push({ code: "inactive", message: `That chair does not exist at ${f.branch.name}.` });
  else if (!f.chair.active) errors.push({ code: "inactive", message: `Chair ${f.chair.number} is not in use.` });
  if (!f.dentist.active || !f.dentist.seesPatients) {
    errors.push({ code: "inactive", message: `${f.dentist.name} ${f.dentist.active ? "does not see patients" : "is disabled"}.` });
  } else if (!f.dentist.worksHere) {
    errors.push({ code: "inactive", message: `${f.dentist.name} does not work at ${f.branch.name}.` });
  }
  for (const p of f.procedures) if (!p.active) errors.push({ code: "inactive", message: `${p.name} is no longer offered.` });
  if (endMin > 24 * 60) errors.push({ code: "overnight", message: "A visit must end on the day it starts." });
  if (!f.walkIn && f.start < f.now) errors.push({ code: "past", message: "That time has passed." });

  const today = f.blocks.filter((b) => b.dayOfWeek === day);
  const elsewhere = today.find(
    (b) => b.branchId !== f.branch.id && toMinutes(b.startTime) < endMin && startMin < toMinutes(b.endTime),
  );
  if (elsewhere) {
    const where = f.branchNames.get(elsewhere.branchId) ?? "another branch";
    errors.push({
      code: "dentist_elsewhere",
      message: `${f.dentist.name} works at ${where} from ${elsewhere.startTime} to ${elsewhere.endTime} on ${WEEKDAYS[day]}.`,
    });
  }
  const off = f.timeOff.find((t) => overlaps(f.start, f.end, t.startsAt, t.endsAt));
  if (off) errors.push({ code: "dentist_time_off", message: `${f.dentist.name} is off then${off.reason ? ` (${off.reason})` : ""}.` });

  for (const v of f.visits) {
    if (v.dentistId === f.dentist.id && overlaps(f.start, f.end, v.start, v.end)) conflicts.push(conflictFor("dentist", v));
    if (f.chair && v.branchId === f.branch.id && v.chairNumber === f.chair.number && overlaps(f.start, f.chairFreeAt, v.start, v.chairFreeAt)) {
      conflicts.push(conflictFor("chair", v));
    }
    if (v.patientId === f.patientId && overlaps(f.start, f.end, v.start, v.end)) conflicts.push(conflictFor("patient", v));
  }
  for (const c of conflicts) errors.push({ code: `${c.kind}_overlap`, message: clashMessage(c) });

  if (!elsewhere) {
    const here = mergeRanges(
      today.filter((b) => b.branchId === f.branch.id).map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
    );
    if (!here.some((r) => r.start <= startMin && endMin <= r.end)) {
      warnings.push({ code: "outside_dentist_hours", message: `This is outside the hours ${f.dentist.name} works at ${f.branch.name}.` });
    }
  }
  const open = hoursOn(f.branch.hours, day);
  if (!open) {
    warnings.push({ code: "outside_branch_hours", message: `${f.branch.name} is closed on ${WEEKDAYS[day]}.` });
  } else if (startMin < open.open || endMin > open.close) {
    warnings.push({
      code: "outside_branch_hours",
      message: `${f.branch.name} is open ${fromMinutes(open.open)} to ${fromMinutes(open.close)} on ${WEEKDAYS[day]}.`,
    });
  }
  return { errors, warnings, conflicts };
}
