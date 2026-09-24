import { describe, expect, it } from "vitest";
import {
  addDays,
  formatClock,
  formatDate,
  formatMinutes,
  formatTime,
  manilaDate,
  manilaInstant,
  manilaMinutes,
  monthDates,
  parseClock,
  weekday,
} from "@/lib/time";

describe("Manila time", () => {
  it("builds the UTC instant for a Manila wall-clock time", () => {
    expect(manilaInstant("2026-09-24", 9 * 60).toISOString()).toBe("2026-09-24T01:00:00.000Z");
  });

  it("puts times before 8 AM on the previous UTC day", () => {
    expect(manilaInstant("2026-09-24", 7 * 60 + 30).toISOString()).toBe("2026-09-23T23:30:00.000Z");
  });

  it("reads the Manila date and minutes of a late-evening UTC instant", () => {
    const instant = new Date("2026-09-30T16:30:00Z"); // 12:30 AM on Oct 1 in Manila
    expect(manilaDate(instant)).toBe("2026-10-01");
    expect(manilaMinutes(instant)).toBe(30);
  });

  it("round-trips a date and time", () => {
    const instant = manilaInstant("2026-12-31", 23 * 60 + 45);
    expect(manilaDate(instant)).toBe("2026-12-31");
    expect(manilaMinutes(instant)).toBe(23 * 60 + 45);
  });

  it("gives the weekday of a date", () => {
    expect(weekday("2026-09-20")).toBe(0);
    expect(weekday("2026-09-26")).toBe(6);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("parses and formats clock strings", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("13:30:00")).toBe(810);
    expect(formatClock(810)).toBe("13:30");
    expect(formatClock(0)).toBe("00:00");
  });

  it("formats dates and times in plain ASCII", () => {
    const instant = manilaInstant("2026-09-24", 10 * 60);
    expect(formatDate(instant)).toBe("Thu Sep 24");
    expect(formatTime(instant)).toBe("10:00 AM");
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatMinutes(13 * 60 + 5)).toBe("1:05 PM");
  });

  it("lists every date in a month", () => {
    const dates = monthDates("2026-02");
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe("2026-02-01");
    expect(dates.at(-1)).toBe("2026-02-28");
  });
});
