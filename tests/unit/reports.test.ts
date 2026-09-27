import { describe, expect, it } from "vitest";
import { formatRate, noShowRate, pickWeek, reportWeeks, sumCounts, weekLabel, weekStart, type WeekStatsRow } from "@/lib/reports";
import { manilaInstant } from "@/lib/time";

const row = (dentist_id: string, counts: Partial<WeekStatsRow>): WeekStatsRow => ({
  week_start: "2026-09-21",
  dentist_id,
  completed: 0,
  no_show: 0,
  cancelled: 0,
  declined: 0,
  expired: 0,
  unmarked: 0,
  upcoming: 0,
  online: 0,
  manual: 0,
  ...counts,
});

describe("weekStart", () => {
  it("is the Monday of the week, across month and year ends", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28"); // a Monday
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // its Sunday
    expect(weekStart("2026-10-01")).toBe("2026-09-28"); // across the month end
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // across the year end
    expect(weekStart("2024-03-01")).toBe("2024-02-26"); // across a leap day
  });
});

describe("reportWeeks and pickWeek", () => {
  it("offers this week and the 7 before it, by the Manila calendar", () => {
    // Sunday Oct 4, 11:30 PM in Manila is 15:30 UTC: still the week of Sep 28.
    expect(reportWeeks(manilaInstant("2026-10-04", 23 * 60 + 30))).toEqual([
      "2026-09-28",
      "2026-09-21",
      "2026-09-14",
      "2026-09-07",
      "2026-08-31",
      "2026-08-24",
      "2026-08-17",
      "2026-08-10",
    ]);
    // Monday 12:30 AM in Manila is still Sunday in UTC: already the new week.
    expect(reportWeeks(manilaInstant("2026-10-05", 30))[0]).toBe("2026-10-05");
  });

  it("defaults to last week and ignores weeks it does not offer", () => {
    const weeks = reportWeeks(manilaInstant("2026-10-01", 600));
    expect(pickWeek(undefined, weeks)).toBe("2026-09-21");
    expect(pickWeek("2026-09-14", weeks)).toBe("2026-09-14");
    for (const other of ["2026-09-15", "2025-09-28", "last", ["2026-09-14"]]) expect(pickWeek(other, weeks)).toBe("2026-09-21");
  });
});

describe("weekLabel", () => {
  it("names the Monday and the Sunday", () => {
    expect(weekLabel("2026-09-28")).toBe("Mon Sep 28 to Sun Oct 4");
  });
});

describe("noShowRate and formatRate", () => {
  it("is no-shows over visits and no-shows, rounded to a whole percent", () => {
    expect(noShowRate(3, 1)).toBe(0.25);
    expect(formatRate(noShowRate(3, 1))).toBe("25%");
    expect(formatRate(noShowRate(2, 1))).toBe("33%");
    expect(formatRate(noShowRate(0, 2))).toBe("100%");
    expect(formatRate(noShowRate(5, 0))).toBe("0%");
  });

  it("gives no rate, not a division by zero, when nobody came or was marked a no-show", () => {
    expect(noShowRate(0, 0)).toBeNull();
    expect(formatRate(noShowRate(0, 0))).toBe("No rate");
  });
});

describe("sumCounts", () => {
  it("adds up a week's dentists, and is all zeros for a week without rows", () => {
    const total = sumCounts([row("d1", { completed: 3, no_show: 1, online: 4 }), row("d2", { completed: 2, cancelled: 1, manual: 3 })]);
    expect(total).toEqual({ completed: 5, no_show: 1, cancelled: 1, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 4, manual: 3 });
    expect(Object.values(sumCounts([]))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
