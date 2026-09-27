import { describe, expect, it } from "vitest";
import {
  isCronAuthorized,
  lowCreditThreshold,
  reminders,
  reminderWindow,
  renewalNotices,
  reportMonday,
  weeklyCandidates,
  type ReminderRow,
  type RenewalRow,
  type WeeklyRow,
} from "@/lib/daily";
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
    branch: { sms_name: "Makati" },
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

  it("names the branch after the clinic once the clinic has 2 or more active branches", () => {
    expect(reminders([row], one, now, new Set(), new Map([["c1", 2]]))[0].clinic).toBe("Bright Dental Makati");
    expect(reminders([row], one, now, new Set(), new Map([["c1", 1]]))[0].clinic).toBe("Bright Dental");
  });

  it("sends nothing for a clinic whose booking is paused", () => {
    const other = { ...row, id: "a2", clinic_id: "c2" };
    const both = new Map([["c1", 1], ["c2", 1]]);
    expect(reminders([row, other], both, now, new Set(["c1"])).map((r) => r.appointmentId)).toEqual(["a2"]);
  });
});

describe("renewalNotices", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = manilaInstant("2026-10-06", 9 * 60);
  const trialEnd = manilaInstant("2026-10-09", 9 * 60); // exactly 3 days away
  const row: RenewalRow = { clinic_id: "c1", trial_ends_at: trialEnd.toISOString(), paid_through: null, renewal_notice_for: null };

  it("picks plans that end within 3 days and have had no heads-up for that end", () => {
    expect(renewalNotices([row], now)).toEqual([{ clinicId: "c1", endsAt: trialEnd }]);
    const paidThrough = new Date(now.getTime() + DAY);
    const paid = { ...row, trial_ends_at: manilaInstant("2026-09-01", 0).toISOString(), paid_through: paidThrough.toISOString() };
    expect(renewalNotices([paid], now)).toEqual([{ clinicId: "c1", endsAt: paidThrough }]);
  });

  it("skips plans further out, already ended, or already told about this end", () => {
    expect(renewalNotices([row], new Date(trialEnd.getTime() - 3 * DAY - 1))).toEqual([]);
    expect(renewalNotices([row], trialEnd)).toEqual([]);
    expect(renewalNotices([{ ...row, renewal_notice_for: trialEnd.toISOString() }], now)).toEqual([]);
    const oldNotice = { ...row, renewal_notice_for: manilaInstant("2026-09-06", 9 * 60).toISOString() };
    expect(renewalNotices([oldNotice], now)).toEqual([{ clinicId: "c1", endsAt: trialEnd }]);
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

describe("reportMonday and weeklyCandidates", () => {
  const monday = manilaInstant("2026-10-05", 9 * 60); // the cron time, 01:00 UTC
  const open = { trial_ends_at: manilaInstant("2026-10-20", 0).toISOString(), paid_through: null };
  const clinic = (id: string, weekly_report_for: string | null = null): WeeklyRow => ({
    id,
    name: `Clinic ${id}`,
    created_at: "2026-09-01T00:00:00Z",
    weekly_report_for,
  });

  it("is Monday on the Manila calendar, whatever the UTC date", () => {
    expect(reportMonday(monday)).toBe("2026-10-05");
    expect(reportMonday(manilaInstant("2026-10-05", 30))).toBe("2026-10-05"); // 12:30 AM in Manila is still Sunday in UTC
    expect(reportMonday(manilaInstant("2026-10-04", 23 * 60 + 30))).toBeNull(); // Sunday 11:30 PM in Manila
    expect(reportMonday(manilaInstant("2026-10-06", 9 * 60))).toBeNull();
  });

  it("picks clinics still taking bookings that have no summary for this Monday yet", () => {
    const clinics = [clinic("c1"), clinic("c2", "2026-09-28"), clinic("c3", "2026-10-05"), clinic("c4"), clinic("c5"), clinic("c6")];
    const billing = [
      { clinic_id: "c1", ...open },
      { clinic_id: "c2", ...open },
      { clinic_id: "c3", ...open },
      { clinic_id: "c4", trial_ends_at: manilaInstant("2026-09-20", 0).toISOString(), paid_through: null }, // paused since Sep 23
      { clinic_id: "c6", trial_ends_at: manilaInstant("2026-10-03", 0).toISOString(), paid_through: null }, // in grace until Oct 6
    ];
    // c5 has no billing row: a trial that ended at signup (Sep 1), so it is paused too.
    expect(weeklyCandidates(clinics, billing, monday).map((c) => c.id)).toEqual(["c1", "c2", "c6"]);
  });
});
