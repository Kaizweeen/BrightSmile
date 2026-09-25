import { describe, expect, it } from "vitest";
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
import { manilaInstant } from "@/lib/time";

const profile = {
  name: " Elite Dental ",
  smsName: "Elite Dental",
  slug: "elite-dental",
  mobile: "0917 123 4567",
  address: "Makati",
  mapsUrl: "",
};

describe("parseProfile", () => {
  it("cleans the profile and stores an empty map link as null", () => {
    expect(parseProfile(profile)).toEqual({
      ok: true,
      value: { name: "Elite Dental", sms_name: "Elite Dental", slug: "elite-dental", mobile: "+639171234567", address: "Makati", maps_url: null },
    });
  });

  it("keeps an https map link and refuses anything else", () => {
    const url = "https://maps.app.goo.gl/abc123";
    expect(parseProfile({ ...profile, mapsUrl: url })).toMatchObject({ ok: true, value: { maps_url: url } });
    expect(parseProfile({ ...profile, mapsUrl: "http://maps.example" })).toMatchObject({ ok: false, field: "mapsUrl" });
    expect(parseProfile({ ...profile, mapsUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "mapsUrl" });
    expect(parseProfile({ ...profile, mapsUrl: `https://x.example/${"a".repeat(300)}` })).toMatchObject({ ok: false, field: "mapsUrl" });
  });

  it("uses the onboarding rules for the rest", () => {
    expect(parseProfile({ ...profile, slug: "app" })).toMatchObject({ ok: false, field: "slug" });
    expect(parseProfile({ ...profile, smsName: "Test Clinic" })).toMatchObject({ ok: false, field: "smsName" });
    expect(parseProfile({ ...profile, mobile: "02 8123 4567" })).toMatchObject({ ok: false, field: "mobile" });
  });
});

describe("parseRules", () => {
  const rules = { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60, alertChannel: "sms" };

  it("accepts the allowed values", () => {
    expect(parseRules(rules)).toEqual({
      ok: true,
      value: { slot_minutes: 30, min_notice_minutes: 120, max_days_ahead: 60, alert_channel: "sms" },
    });
    expect(parseRules({ ...rules, slotMinutes: "15", minNoticeMinutes: "0", maxDaysAhead: "365", alertChannel: "push" }).ok).toBe(true);
  });

  it("refuses anything outside them", () => {
    expect(parseRules({ ...rules, slotMinutes: 20 })).toMatchObject({ field: "slotMinutes" });
    expect(parseRules({ ...rules, minNoticeMinutes: 10081 })).toMatchObject({ field: "minNoticeMinutes" });
    expect(parseRules({ ...rules, minNoticeMinutes: -1 })).toMatchObject({ field: "minNoticeMinutes" });
    expect(parseRules({ ...rules, maxDaysAhead: 0 })).toMatchObject({ field: "maxDaysAhead" });
    expect(parseRules({ ...rules, maxDaysAhead: 1.5 })).toMatchObject({ field: "maxDaysAhead" });
    expect(parseRules({ ...rules, alertChannel: "email" })).toMatchObject({ field: "alertChannel" });
  });
});

describe("parseDentist", () => {
  const week = [[], [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }], [], [], [], [], []];

  it("flattens several blocks per day into rows", () => {
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: week })).toEqual({
      ok: true,
      value: {
        name: "Dr. Ben Lim",
        sms_name: "Dr. Lim",
        hours: [
          { weekday: 1, start_time: "09:00", end_time: "12:00" },
          { weekday: 1, start_time: "13:00", end_time: "17:00" },
        ],
      },
    });
  });

  it("names the field that is wrong", () => {
    expect(parseDentist({ name: "", smsName: "Dr. Lim", hours: week })).toMatchObject({ field: "name" });
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "x".repeat(17), hours: week })).toMatchObject({ field: "smsName" });
    const overlap = [[], [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }], [], [], [], [], []];
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: overlap })).toMatchObject({ field: "hours" });
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: "all day" })).toMatchObject({ field: "hours" });
  });
});

describe("parseTimeOff", () => {
  const now = new Date("2026-09-25T00:00:00Z");

  it("reads datetime-local values as Manila time", () => {
    expect(parseTimeOff({ from: "2026-10-01T09:00", to: "2026-10-01T12:30", note: " Seminar " }, now)).toEqual({
      ok: true,
      value: {
        starts_at: manilaInstant("2026-10-01", 540).toISOString(),
        ends_at: manilaInstant("2026-10-01", 750).toISOString(),
        note: "Seminar",
      },
    });
    expect(parseTimeOff({ from: "2026-10-01T09:00:00", to: "2026-10-02T09:00:00", note: "" }, now).ok).toBe(true);
  });

  it("refuses bad, reversed, past, or long input", () => {
    expect(parseTimeOff({ from: "2026-02-30T09:00", to: "2026-03-01T09:00" }, now)).toMatchObject({ field: "from" });
    expect(parseTimeOff({ from: "2026-10-01T12:00", to: "2026-10-01T09:00" }, now)).toMatchObject({ field: "to" });
    expect(parseTimeOff({ from: "2026-09-01T09:00", to: "2026-09-02T09:00" }, now)).toMatchObject({ field: "to" });
    expect(parseTimeOff({ from: "2026-10-01T09:00", to: "2026-10-01T10:00", note: "n".repeat(101) }, now)).toMatchObject({ field: "note" });
  });
});

describe("parseProcedure", () => {
  it("accepts a name and 5 to 480 minutes", () => {
    expect(parseProcedure({ name: " Braces Adjustment ", minutes: "45" })).toEqual({
      ok: true,
      value: { name: "Braces Adjustment", duration_minutes: 45 },
    });
  });

  it("refuses the rest", () => {
    expect(parseProcedure({ name: "", minutes: 30 })).toMatchObject({ field: "name" });
    expect(parseProcedure({ name: "X", minutes: 4 })).toMatchObject({ field: "minutes" });
    expect(parseProcedure({ name: "X", minutes: 481 })).toMatchObject({ field: "minutes" });
    expect(parseProcedure({ name: "X", minutes: "" })).toMatchObject({ field: "minutes" });
  });
});
