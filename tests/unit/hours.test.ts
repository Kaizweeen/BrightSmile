import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS, hoursOn, hoursSummary, operatingHoursSchema } from "@/lib/hours";

describe("operating hours", () => {
  it("accepts the default week", () => {
    expect(operatingHoursSchema.parse(DEFAULT_HOURS)).toEqual(DEFAULT_HOURS);
  });

  it("needs all seven days", () => {
    const sixDays = Object.fromEntries(Object.entries(DEFAULT_HOURS).filter(([day]) => day !== "0"));
    expect(operatingHoursSchema.safeParse(sixDays).success).toBe(false);
  });

  it("refuses closing before opening and times off the 15-minute grid", () => {
    expect(operatingHoursSchema.safeParse({ ...DEFAULT_HOURS, "1": { open: "18:00", close: "09:00" } }).success).toBe(false);
    expect(operatingHoursSchema.safeParse({ ...DEFAULT_HOURS, "1": { open: "09:10", close: "18:00" } }).success).toBe(false);
  });

  it("gives a weekday's hours in minutes", () => {
    expect(hoursOn(DEFAULT_HOURS, 1)).toEqual({ open: 540, close: 1080 });
    expect(hoursOn(DEFAULT_HOURS, 0)).toBeNull();
  });

  it("summarises the week", () => {
    expect(hoursSummary(DEFAULT_HOURS)).toBe("Mon to Sat 09:00 to 18:00");
    expect(hoursSummary({ ...DEFAULT_HOURS, "6": { open: "09:00", close: "12:00" } })).toBe(
      "Mon to Fri 09:00 to 18:00, Sat 09:00 to 12:00",
    );
    const closed = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null };
    expect(hoursSummary(closed)).toBe("Closed every day");
  });
});
