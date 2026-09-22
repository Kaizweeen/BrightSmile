import { describe, expect, it } from "vitest";
import { fitsAnyBlock, openDates, openStarts, withinHours, type Block } from "@/lib/slots";
import { formatTime, manilaInstant } from "@/lib/time";

const rules = { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 };
const day: Block[] = [
  { start: 9 * 60, end: 12 * 60 },
  { start: 13 * 60, end: 17 * 60 },
];
const now = manilaInstant("2026-09-22", 8 * 60); // Tuesday 8:00 AM in Manila
const times = (starts: Date[]) => starts.map(formatTime);
const week = (d: Block[], saturday: Block[] = d): Block[][] => [[], d, d, d, d, d, saturday];

describe("openStarts", () => {
  it("offers every 30 minutes inside each block, skipping the lunch gap", () => {
    const starts = openStarts({ date: "2026-09-24", blocks: day, busy: [], durationMinutes: 30, rules, now });
    expect(times(starts)).toEqual([
      "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
      "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
    ]);
  });

  it("keeps the whole appointment inside one block", () => {
    const starts = openStarts({ date: "2026-09-24", blocks: day, busy: [], durationMinutes: 90, rules, now });
    expect(times(starts)).toEqual([
      "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
      "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM",
    ]);
  });

  it("skips starts that overlap a busy interval but allows back-to-back", () => {
    const busy = [{ start: manilaInstant("2026-09-24", 10 * 60), end: manilaInstant("2026-09-24", 11 * 60) }];
    const starts = openStarts({ date: "2026-09-24", blocks: [{ start: 9 * 60, end: 12 * 60 }], busy, durationMinutes: 60, rules, now });
    expect(times(starts)).toEqual(["9:00 AM", "11:00 AM"]);
  });

  it("respects the minimum notice", () => {
    const later = manilaInstant("2026-09-22", 9 * 60 + 15);
    const starts = openStarts({ date: "2026-09-22", blocks: [{ start: 9 * 60, end: 12 * 60 }], busy: [], durationMinutes: 30, rules, now: later });
    expect(times(starts)).toEqual(["11:30 AM"]);
  });

  it("returns nothing for past dates or dates beyond the booking window", () => {
    const base = { blocks: day, busy: [], durationMinutes: 30, rules, now };
    expect(openStarts({ ...base, date: "2026-09-21" })).toEqual([]);
    expect(openStarts({ ...base, date: "2026-11-21" })).toHaveLength(14);
    expect(openStarts({ ...base, date: "2026-11-22" })).toEqual([]);
  });

  it("uses Manila dates when the server clock is UTC", () => {
    const lateUtc = new Date("2026-09-22T17:00:00Z"); // 1:00 AM on Sep 23 in Manila
    const base = { blocks: day, busy: [], durationMinutes: 30, rules, now: lateUtc };
    expect(openStarts({ ...base, date: "2026-09-22" })).toEqual([]);
    expect(openStarts({ ...base, date: "2026-09-23" })).toHaveLength(14);
    // Manila today is Sep 23, so the 60-day window's last valid date is Nov 22, not Nov 21.
    // A mutant that computes today from the UTC date would return [] here instead of 14.
    expect(openStarts({ ...base, date: "2026-11-22" })).toHaveLength(14);
    expect(openStarts({ ...base, date: "2026-11-23" })).toEqual([]);
  });

  it("ignores the appointment being moved", () => {
    const busy = [{ id: "a1", start: manilaInstant("2026-09-24", 9 * 60), end: manilaInstant("2026-09-24", 10 * 60) }];
    const starts = openStarts({ date: "2026-09-24", blocks: [{ start: 9 * 60, end: 10 * 60 }], busy, durationMinutes: 60, rules, now, ignoreId: "a1" });
    expect(times(starts)).toEqual(["9:00 AM"]);
  });
});

describe("openDates", () => {
  it("lists only dates with at least one open start", () => {
    const dates = openDates({
      dates: ["2026-09-26", "2026-09-27", "2026-09-28"],
      blocksByWeekday: week(day, [{ start: 9 * 60, end: 12 * 60 }]),
      busy: [],
      durationMinutes: 30,
      rules,
      now,
    });
    expect(dates).toEqual(["2026-09-26", "2026-09-28"]); // Saturday and Monday; closed Sunday
  });
});

describe("withinHours", () => {
  it("flags appointments outside working hours", () => {
    const blocks = week(day, []);
    expect(withinHours(manilaInstant("2026-09-24", 9 * 60), manilaInstant("2026-09-24", 10 * 60), blocks)).toBe(true);
    expect(withinHours(manilaInstant("2026-09-24", 11 * 60 + 30), manilaInstant("2026-09-24", 12 * 60 + 30), blocks)).toBe(false);
    expect(withinHours(manilaInstant("2026-09-27", 9 * 60), manilaInstant("2026-09-27", 10 * 60), blocks)).toBe(false);
  });

  it("uses the Manila weekday even when it differs from the UTC weekday", () => {
    // Mon 7:00-8:00 AM Manila is Sun 23:00Z-00:00Z UTC, so a UTC-weekday bug would look Sunday and find no block.
    const mondayMorning: Block[][] = [[], [{ start: 7 * 60, end: 12 * 60 }], [], [], [], [], []];
    expect(withinHours(manilaInstant("2026-09-28", 7 * 60), manilaInstant("2026-09-28", 8 * 60), mondayMorning)).toBe(true);
  });
});

describe("fitsAnyBlock", () => {
  it("knows when no block is long enough", () => {
    const blocks: Block[][] = [[], [{ start: 9 * 60, end: 12 * 60 }], [], [], [], [], []];
    expect(fitsAnyBlock(180, blocks)).toBe(true);
    expect(fitsAnyBlock(181, blocks)).toBe(false);
  });
});
