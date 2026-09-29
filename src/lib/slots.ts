import type { OperatingHours } from "@/db/schema";
import { mergeRanges, overlaps, type Visit, type WeeklyBlock } from "./booking-rules";
import { hoursOn } from "./hours";
import { manilaInstant, toMinutes, weekday } from "./time";

/** The grid of start times, in minutes. */
export const STEP = 15;

export type SlotFacts = {
  date: string;
  now: Date;
  minutes: number;
  turnover: number;
  branch: { id: string; hours: OperatingHours };
  chairs: readonly number[];
  dentists: readonly { id: string; name: string }[];
  blocks: ReadonlyMap<string, readonly WeeklyBlock[]>;
  timeOff: ReadonlyMap<string, readonly { startsAt: Date; endsAt: Date }[]>;
  visits: readonly Visit[];
  patientId?: string;
};

export type OpenTime = { start: Date; dentists: { id: string; name: string; chairs: number[] }[] };

/**
 * Spec 8.5: every start on the grid where a dentist's block at this branch covers the whole visit, the dentist and the
 * patient are free, and at least one chair is free for the visit plus turnover.
 */
export function openTimes(f: SlotFacts): OpenTime[] {
  const day = weekday(f.date);
  const hours = hoursOn(f.branch.hours, day);
  if (!hours) return [];
  const byStart = new Map<number, OpenTime>();
  for (const dentist of f.dentists) {
    const ranges = mergeRanges(
      (f.blocks.get(dentist.id) ?? [])
        .filter((b) => b.dayOfWeek === day && b.branchId === f.branch.id)
        .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
    );
    const off = f.timeOff.get(dentist.id) ?? [];
    for (const range of ranges) {
      const from = Math.max(range.start, hours.open);
      const until = Math.min(range.end, hours.close);
      for (let minute = Math.ceil(from / STEP) * STEP; minute + f.minutes <= until; minute += STEP) {
        const start = manilaInstant(f.date, minute);
        if (start < f.now) continue;
        const end = new Date(start.getTime() + f.minutes * 60_000);
        const freeAt = new Date(end.getTime() + f.turnover * 60_000);
        if (off.some((t) => overlaps(start, end, t.startsAt, t.endsAt))) continue;
        if (f.visits.some((v) => v.dentistId === dentist.id && overlaps(start, end, v.start, v.end))) continue;
        if (f.patientId && f.visits.some((v) => v.patientId === f.patientId && overlaps(start, end, v.start, v.end))) continue;
        const chairs = f.chairs.filter(
          (n) => !f.visits.some((v) => v.branchId === f.branch.id && v.chairNumber === n && overlaps(start, freeAt, v.start, v.chairFreeAt)),
        );
        if (chairs.length === 0) continue;
        const slot = byStart.get(minute) ?? { start, dentists: [] };
        slot.dentists.push({ id: dentist.id, name: dentist.name, chairs });
        byStart.set(minute, slot);
      }
    }
  }
  return [...byStart.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot);
}
