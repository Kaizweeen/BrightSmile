import { z } from "zod";
import type { OperatingHours } from "@/db/schema";
import { toMinutes } from "./time";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00")
  .refine((value) => toMinutes(value) % 15 === 0, "Use 15-minute steps");

export const dayHoursSchema = z
  .object({ open: clock, close: clock })
  .refine((day) => toMinutes(day.open) < toMinutes(day.close), {
    message: "Closing time must be after opening time",
    path: ["close"],
  });

/** All seven days, each open with its hours or null when closed. */
export const operatingHoursSchema = z.record(z.enum(DAY_KEYS), dayHoursSchema.nullable());

/** Monday to Saturday, 9:00 to 18:00: the starting week for a new branch. */
export const DEFAULT_HOURS: OperatingHours = {
  "0": null,
  "1": { open: "09:00", close: "18:00" },
  "2": { open: "09:00", close: "18:00" },
  "3": { open: "09:00", close: "18:00" },
  "4": { open: "09:00", close: "18:00" },
  "5": { open: "09:00", close: "18:00" },
  "6": { open: "09:00", close: "18:00" },
};

/** A weekday's opening hours in minutes since midnight, or null when the branch is closed that day. */
export function hoursOn(hours: OperatingHours, day: number): { open: number; close: number } | null {
  const today = hours[String(day)];
  return today ? { open: toMinutes(today.open), close: toMinutes(today.close) } : null;
}

/** "Mon to Sat 09:00 to 18:00": consecutive days (Monday first) with the same hours share one entry. */
export function hoursSummary(hours: OperatingHours): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parts: string[] = [];
  for (let i = 0; i < order.length; ) {
    const day = hours[String(order[i])];
    if (!day) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < order.length) {
      const next = hours[String(order[j + 1])];
      if (!next || next.open !== day.open || next.close !== day.close) break;
      j += 1;
    }
    const days = i === j ? SHORT[order[i]] : `${SHORT[order[i]]} to ${SHORT[order[j]]}`;
    parts.push(`${days} ${day.open} to ${day.close}`);
    i = j + 1;
  }
  return parts.length > 0 ? parts.join(", ") : "Closed every day";
}
