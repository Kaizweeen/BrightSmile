import { describe, expect, it } from "vitest";
import { isCronAuthorized, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
import { manilaInstant } from "@/lib/time";

const SECRET = "s3cret-s3cret-s3cret-s3cret";

describe("isCronAuthorized", () => {
  it("accepts exactly the bearer header Vercel Cron sends", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
  });

  it("refuses a secret too short to be a real one", () => {
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
  });
});

describe("reminderWindow", () => {
  it("is tomorrow's Manila day, whatever the UTC date", () => {
    const window = { from: manilaInstant("2026-09-26", 0), to: manilaInstant("2026-09-27", 0) };
    expect(reminderWindow(manilaInstant("2026-09-25", 9 * 60))).toEqual(window); // the cron time, 01:00 UTC
    expect(reminderWindow(manilaInstant("2026-09-25", 30))).toEqual(window); // 00:30 Manila is still Sep 24 in UTC
    expect(reminderWindow(manilaInstant("2026-09-25", 23 * 60 + 59))).toEqual(window);
  });
});

describe("reminders", () => {
  const now = manilaInstant("2026-09-25", 9 * 60);
  const row: ReminderRow = {
    id: "a1",
    clinic_id: "c1",
    status: "confirmed",
    starts_at: manilaInstant("2026-09-26", 10 * 60).toISOString(),
    confirmed_at: manilaInstant("2026-09-24", 15 * 60).toISOString(),
    reminder_sent_at: null,
    manage_token: "AbCdEfGhIjKl",
    patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
    dentist: { sms_name: "Dr. Reyes" },
    clinic: { sms_name: "Bright Dental" },
  };
  const one = new Map([["c1", 1]]);

  it("reminds tomorrow's confirmed visits, naming the dentist only for clinics with 2 or more", () => {
    const base = { appointmentId: "a1", clinicId: "c1", to: "+639171112222", token: "AbCdEfGhIjKl", clinic: "Bright Dental", first: "Ana", time: "10:00 AM" };
    expect(reminders([row], one, now)).toEqual([{ ...base, dentist: null }]);
    expect(reminders([row], new Map([["c1", 2]]), now)).toEqual([{ ...base, dentist: "Dr. Reyes" }]);
  });

  it("skips visits that are not due or have no one to text", () => {
    const skipped: ReminderRow[] = [
      { ...row, status: "pending" },
      { ...row, reminder_sent_at: manilaInstant("2026-09-25", 9 * 60).toISOString() },
      { ...row, confirmed_at: manilaInstant("2026-09-25", 8 * 60).toISOString() },
      { ...row, confirmed_at: null },
      { ...row, starts_at: manilaInstant("2026-09-27", 10 * 60).toISOString() },
      { ...row, patient: { first_name: "Ana", mobile: null, anonymized_at: null } },
      { ...row, patient: { first_name: "Deleted patient", mobile: "+639171112222", anonymized_at: "2026-09-20T00:00:00Z" } },
      { ...row, patient: null },
    ];
    expect(reminders(skipped, one, now)).toEqual([]);
  });

  it("sends nothing for a clinic whose booking is paused", () => {
    const other = { ...row, id: "a2", clinic_id: "c2" };
    const both = new Map([["c1", 1], ["c2", 1]]);
    expect(reminders([row, other], both, now, new Set(["c1"])).map((r) => r.appointmentId)).toEqual(["a2"]);
  });
});

describe("lowCreditThreshold", () => {
  it("reads SMS_LOW_CREDIT_THRESHOLD and falls back to 500", () => {
    expect(lowCreditThreshold(undefined)).toBe(500);
    expect(lowCreditThreshold("")).toBe(500);
    expect(lowCreditThreshold("200")).toBe(200);
    expect(lowCreditThreshold(" 300 ")).toBe(300);
    expect(lowCreditThreshold("0")).toBe(0);
    expect(lowCreditThreshold("abc")).toBe(500);
    expect(lowCreditThreshold("-5")).toBe(500);
    expect(lowCreditThreshold("1.5")).toBe(500);
  });
});
