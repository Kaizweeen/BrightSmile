import { z } from "zod";
import type { OperatingHours } from "@/db/schema";
import { hoursOn } from "./hours";
import type { Status } from "./lifecycle";
import { addDays, manilaInstant, weekday } from "./time";

/** A visit as GET /appointments and GET /overview send it (`VisitView` in src/server/appointments.ts, dates as strings). */
export type VisitJson = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  chartNo: number;
  hasAlerts: boolean;
  start: string;
  end: string;
  chairFreeAt: string;
  status: Status;
  source: string;
  note: string;
  cancelReason: string | null;
  procedures: string[];
};

/** GET /appointments/{id}: the visit, its procedure ids, the patient's alerts, and its history. */
export type VisitDetailJson = VisitJson & {
  procedureIds: string[];
  alerts: string[];
  history: { at: string; by: string; text: string }[];
};

/** "Chair 2 · Ortho", or "Chair 2" without a label. */
export function chairName(number: number, label: string): string {
  return label ? `Chair ${number} · ${label}` : `Chair ${number}`;
}

/** Cancelled and no-show visits no longer hold their chair, so the day grid lists them under it instead. */
export function offGrid(status: Status): boolean {
  return status === "cancelled" || status === "no_show";
}

export const ROW_MINUTES = 15;

/** The minutes a day grid shows: the branch's hours, widened to every visit and its turnover (8:00 to 18:00 when closed). */
export function dayRange(
  hours: OperatingHours,
  date: string,
  visits: readonly { start: string; chairFreeAt: string }[],
): { start: number; end: number } {
  const open = hoursOn(hours, weekday(date));
  const midnight = manilaInstant(date, 0).getTime();
  let start = open?.open ?? 8 * 60;
  let end = open?.close ?? 18 * 60;
  for (const v of visits) {
    start = Math.min(start, (Date.parse(v.start) - midnight) / 60_000);
    end = Math.max(end, (Date.parse(v.chairFreeAt) - midnight) / 60_000);
  }
  return {
    start: Math.max(0, Math.floor(start / ROW_MINUTES) * ROW_MINUTES),
    end: Math.min(24 * 60, Math.ceil(end / ROW_MINUTES) * ROW_MINUTES),
  };
}

/** The seven dates of the week (Monday first) that holds a date. */
export function weekDates(date: string): string[] {
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Where a visit sits in a day grid, in minutes from the grid's first row: the visit, then its turnover. */
export function placement(
  v: { start: string; end: string; chairFreeAt: string },
  date: string,
  rangeStart: number,
): { top: number; height: number; turnover: number } {
  const midnight = manilaInstant(date, 0).getTime();
  const minutes = (iso: string) => (Date.parse(iso) - midnight) / 60_000;
  return { top: minutes(v.start) - rangeStart, height: minutes(v.end) - minutes(v.start), turnover: minutes(v.chairFreeAt) - minutes(v.end) };
}

/** A page's `?date=`: a real "YYYY-MM-DD" date, or today. */
export function dateParam(value: string | string[] | undefined, today: string): string {
  return typeof value === "string" && z.iso.date().safeParse(value).success ? value : today;
}
