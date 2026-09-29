import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS } from "@/lib/hours";
import { dateParam, dayRange, placement, weekDates } from "@/lib/visits";

const at = (clock: string) => `2026-10-05T${clock}:00+08:00`;

describe("calendar layout", () => {
  it("shows the branch's hours, widened to every visit and its turnover", () => {
    expect(dayRange(DEFAULT_HOURS, "2026-10-05", [])).toEqual({ start: 540, end: 1080 });
    expect(dayRange(DEFAULT_HOURS, "2026-10-05", [{ start: at("08:10"), chairFreeAt: at("18:20") }])).toEqual({ start: 480, end: 1110 });
  });

  it("shows 8:00 to 18:00 on a closed day with no visits", () => {
    expect(dayRange(DEFAULT_HOURS, "2026-10-04", [])).toEqual({ start: 480, end: 1080 });
  });

  it("starts weeks on Monday", () => {
    expect(weekDates("2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(weekDates("2026-10-05")[0]).toBe("2026-10-05");
    expect(weekDates("2026-10-11")[0]).toBe("2026-10-05");
  });

  it("places a visit and its turnover in minutes from the top of the grid", () => {
    expect(placement({ start: at("10:00"), end: at("11:30"), chairFreeAt: at("11:50") }, "2026-10-05", 540)).toEqual({ top: 60, height: 90, turnover: 20 });
  });

  it("reads a page's date, falling back to today", () => {
    expect(dateParam("2026-10-05", "2026-09-29")).toBe("2026-10-05");
    expect(dateParam("2026-02-31", "2026-09-29")).toBe("2026-09-29");
    expect(dateParam(["2026-10-05"], "2026-09-29")).toBe("2026-09-29");
    expect(dateParam(undefined, "2026-09-29")).toBe("2026-09-29");
  });
});
