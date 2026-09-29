import { describe, expect, it } from "vitest";
import { bookable, chooseDentist } from "@/lib/portal";

const reyes = { id: "b", name: "Dr. Reyes" };
const lim = { id: "c", name: "Dr. Lim" };
const otherLim = { id: "a", name: "Dr. Lim" };

describe("choosing a dentist online", () => {
  it("picks the dentist with the fewest visits that day", () => {
    expect(chooseDentist([reyes, lim], new Map([["c", 3], ["b", 1]]))).toBe(reyes);
  });

  it("breaks a tie by name, then by id", () => {
    expect(chooseDentist([reyes, lim], new Map())).toBe(lim);
    expect(chooseDentist([lim, otherLim], new Map())).toBe(otherLim);
  });

  it("has no one to pick from an empty list", () => {
    expect(chooseDentist([], new Map())).toBeUndefined();
  });
});

describe("the days open to online booking", () => {
  // Monday 2026-10-05, 08:00 in Manila.
  const now = new Date("2026-10-05T08:00:00+08:00");

  it("run from today to 30 days ahead", () => {
    expect(bookable("2026-10-05", now)).toBe(true);
    expect(bookable("2026-11-04", now)).toBe(true);
    expect(bookable("2026-11-05", now)).toBe(false);
    expect(bookable("2026-10-04", now)).toBe(false);
  });

  it("are counted in Manila dates, not UTC ones", () => {
    // 01:00 on Tuesday in Manila is still 17:00 on Monday in UTC.
    const lateMonday = new Date("2026-10-05T17:00:00Z");
    expect(bookable("2026-10-05", lateMonday)).toBe(false);
    expect(bookable("2026-10-06", lateMonday)).toBe(true);
    expect(bookable("2026-11-05", lateMonday)).toBe(true);
  });
});
