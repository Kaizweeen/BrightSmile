import { describe, expect, it } from "vitest";
import { canMarkAttendance, canTransition, isCancellable, needsReminder } from "@/lib/appointments";
import { manilaInstant } from "@/lib/time";

describe("canTransition", () => {
  it.each([
    ["pending", "confirmed", "staff"],
    ["pending", "declined", "staff"],
    ["pending", "cancelled", "patient"],
    ["pending", "expired", "system"],
    ["confirmed", "cancelled", "staff"],
    ["confirmed", "cancelled", "patient"],
    ["confirmed", "completed", "staff"],
    ["confirmed", "no_show", "staff"],
    ["confirmed", "confirmed", "staff"],
    ["completed", "no_show", "staff"],
    ["no_show", "completed", "staff"],
  ] as const)("allows %s to %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it.each([
    ["pending", "confirmed", "patient"],
    ["pending", "completed", "staff"],
    ["pending", "expired", "staff"],
    ["declined", "confirmed", "staff"],
    ["cancelled", "confirmed", "staff"],
    ["expired", "confirmed", "staff"],
    ["confirmed", "pending", "staff"],
    ["completed", "cancelled", "patient"],
  ] as const)("rejects %s to %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });
});

const now = manilaInstant("2026-09-22", 9 * 60);
const tomorrow10 = manilaInstant("2026-09-23", 10 * 60);
const earlier = manilaInstant("2026-09-22", 8 * 60);

describe("needsReminder", () => {
  const base = {
    status: "confirmed" as const,
    starts_at: tomorrow10,
    confirmed_at: manilaInstant("2026-09-21", 15 * 60),
    reminder_sent_at: null,
  };

  it("reminds tomorrow's confirmed visits that were confirmed before today", () => {
    expect(needsReminder(base, now)).toBe(true);
  });

  it("skips visits confirmed today, already reminded, not tomorrow, or not confirmed", () => {
    expect(needsReminder({ ...base, confirmed_at: earlier }, now)).toBe(false);
    expect(needsReminder({ ...base, confirmed_at: manilaInstant("2026-09-22", 60) }, now)).toBe(false);
    expect(needsReminder({ ...base, reminder_sent_at: now }, now)).toBe(false);
    expect(needsReminder({ ...base, starts_at: manilaInstant("2026-09-24", 10 * 60) }, now)).toBe(false);
    expect(needsReminder({ ...base, status: "pending" }, now)).toBe(false);
  });

  it("uses Manila dates when the server clock is UTC", () => {
    const lateUtc = new Date("2026-09-22T16:30:00Z"); // 12:30 AM on Sep 23 in Manila
    expect(needsReminder({ ...base, starts_at: manilaInstant("2026-09-24", 9 * 60) }, lateUtc)).toBe(true);
  });
});

describe("isCancellable", () => {
  it("lets patients cancel future pending or confirmed visits only", () => {
    expect(isCancellable({ status: "confirmed", starts_at: tomorrow10 }, now)).toBe(true);
    expect(isCancellable({ status: "pending", starts_at: tomorrow10 }, now)).toBe(true);
    expect(isCancellable({ status: "confirmed", starts_at: earlier }, now)).toBe(false);
    expect(isCancellable({ status: "declined", starts_at: tomorrow10 }, now)).toBe(false);
  });
});

describe("canMarkAttendance", () => {
  it("allows marking once the visit has started", () => {
    expect(canMarkAttendance({ status: "confirmed", starts_at: earlier }, now)).toBe(true);
    expect(canMarkAttendance({ status: "no_show", starts_at: earlier }, now)).toBe(true);
    expect(canMarkAttendance({ status: "confirmed", starts_at: tomorrow10 }, now)).toBe(false);
    expect(canMarkAttendance({ status: "pending", starts_at: earlier }, now)).toBe(false);
  });
});
