import { describe, expect, it } from "vitest";
import {
  addDays,
  fromManilaLocal,
  fromMinutes,
  manilaDate,
  manilaInstant,
  manilaMinutes,
  toManilaLocal,
  toMinutes,
  weekday,
} from "@/lib/time";

describe("Manila time", () => {
  it("finds the Manila date and minutes of an instant", () => {
    const lateSunday = new Date("2026-10-04T16:30:00Z"); // 00:30 on Monday in Manila
    expect(manilaDate(lateSunday)).toBe("2026-10-05");
    expect(manilaMinutes(lateSunday)).toBe(30);
  });

  it("turns a Manila date and time back into the instant", () => {
    expect(manilaInstant("2026-10-05", 9 * 60).toISOString()).toBe("2026-10-05T01:00:00.000Z");
    expect(manilaInstant("2026-10-05", 0).toISOString()).toBe("2026-10-04T16:00:00.000Z");
  });

  it("knows the weekday and adds days across months and years", () => {
    expect(weekday("2026-10-05")).toBe(1);
    expect(weekday("2026-10-04")).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("converts clock times", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("09:30:00")).toBe(570);
    expect(fromMinutes(570)).toBe("09:30");
    expect(fromMinutes(0)).toBe("00:00");
  });

  it("reads and writes datetime-local values as Manila time", () => {
    const instant = fromManilaLocal("2026-10-05T14:15");
    expect(instant.toISOString()).toBe("2026-10-05T06:15:00.000Z");
    expect(toManilaLocal(instant)).toBe("2026-10-05T14:15");
  });
});
