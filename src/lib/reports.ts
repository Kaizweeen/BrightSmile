import { addDays, formatDate, manilaDate, manilaInstant, weekday } from "@/lib/time";

/** The Reports page offers this week and the 7 before it (teams spec 6.3). */
export const REPORT_WEEKS = 8;

/** One clinic_week_stats row: a Manila week (by its Monday) and one dentist. */
export type WeekStatsRow = {
  week_start: string;
  dentist_id: string;
  completed: number;
  no_show: number;
  cancelled: number;
  declined: number;
  expired: number;
  unmarked: number;
  upcoming: number;
  online: number;
  manual: number;
};

export type WeekCounts = Omit<WeekStatsRow, "week_start" | "dentist_id">;

/** The Monday of the Manila week a "YYYY-MM-DD" date falls in (weeks run Monday to Sunday). */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** This week's Monday and the 7 before it, newest first, by the Manila calendar. */
export function reportWeeks(now: Date): string[] {
  const monday = weekStart(manilaDate(now));
  return Array.from({ length: REPORT_WEEKS }, (_, i) => addDays(monday, -7 * i));
}

/** The week from ?week= when it is one of the offered Mondays, otherwise last week (the default, teams spec 6.3). */
export function pickWeek(value: unknown, weeks: string[]): string {
  return typeof value === "string" && weeks.includes(value) ? value : weeks[1];
}

/** "Mon Sep 21 to Sun Sep 27". */
export function weekLabel(monday: string): string {
  return `${formatDate(manilaInstant(monday, 0))} to ${formatDate(manilaInstant(addDays(monday, 6), 0))}`;
}

/** Adds rows up: a week's dentists, or one dentist's rows. No rows is all zeros. */
export function sumCounts(rows: WeekCounts[]): WeekCounts {
  const sum: WeekCounts = { completed: 0, no_show: 0, cancelled: 0, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 0, manual: 0 };
  for (const r of rows) for (const key of Object.keys(sum) as (keyof WeekCounts)[]) sum[key] += r[key];
  return sum;
}

/** no_show / (completed + no_show), or null when there was neither: no rate, not a division by zero (teams spec 2.5). */
export function noShowRate(completed: number, noShow: number): number | null {
  return completed + noShow === 0 ? null : noShow / (completed + noShow);
}

/** "25%", to the nearest whole percent, or "No rate". */
export function formatRate(rate: number | null): string {
  return rate === null ? "No rate" : `${Math.round(rate * 100)}%`;
}
