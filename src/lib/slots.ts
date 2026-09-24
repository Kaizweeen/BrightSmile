import { addDays, manilaDate, manilaInstant, manilaMinutes, weekday } from "@/lib/time";

/** A working block in minutes after Manila midnight, e.g. 9:00 to 12:00 is { start: 540, end: 720 }. */
export type Block = { start: number; end: number };
/** A pending or confirmed appointment, or time off. */
export type Busy = { start: Date; end: Date; id?: string };
export type BookingRules = { slotMinutes: number; minNoticeMinutes: number; maxDaysAhead: number };

type StartsInput = {
  date: string;
  blocks: Block[];
  busy: Busy[];
  durationMinutes: number;
  rules: BookingRules;
  now: Date;
  ignoreId?: string;
};

/** Open start times for one dentist on one Manila date (spec section 8). */
export function openStarts({ date, blocks, busy, durationMinutes, rules, now, ignoreId }: StartsInput): Date[] {
  const today = manilaDate(now);
  if (date < today || date > addDays(today, rules.maxDaysAhead)) return [];
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000;
  const others = ignoreId ? busy.filter((b) => b.id !== ignoreId) : busy;
  const starts: Date[] = [];
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    for (let m = block.start; m + durationMinutes <= block.end; m += rules.slotMinutes) {
      const start = manilaInstant(date, m);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (start.getTime() < earliest) continue;
      if (others.some((b) => b.start < end && start < b.end)) continue;
      starts.push(start);
    }
  }
  return starts;
}

type DatesInput = Omit<StartsInput, "date" | "blocks"> & { dates: string[]; blocksByWeekday: Block[][] };

/** The dates, out of `dates`, with at least one open start. */
export function openDates({ dates, blocksByWeekday, ...rest }: DatesInput): string[] {
  return dates.filter((date) => openStarts({ ...rest, date, blocks: blocksByWeekday[weekday(date)] }).length > 0);
}

/** True when the appointment lies inside one working block of its Manila weekday. */
export function withinHours(start: Date, end: Date, blocksByWeekday: Block[][]): boolean {
  const from = manilaMinutes(start);
  const to = from + (end.getTime() - start.getTime()) / 60_000;
  return blocksByWeekday[weekday(manilaDate(start))].some((b) => b.start <= from && to <= b.end);
}

/** False when no working block anywhere in the week can hold this duration. */
export function fitsAnyBlock(durationMinutes: number, blocksByWeekday: Block[][]): boolean {
  return blocksByWeekday.some((blocks) => blocks.some((b) => b.end - b.start >= durationMinutes));
}

/** The clinic's opening hours: every dentist's blocks per weekday, with overlapping or touching blocks merged. */
export function mergeWeeks(weeks: Block[][][]): Block[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const merged: Block[] = [];
    for (const block of weeks.flatMap((w) => w[day] ?? []).sort((x, y) => x.start - y.start)) {
      const last = merged.at(-1);
      if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
      else merged.push({ ...block });
    }
    return merged;
  });
}
