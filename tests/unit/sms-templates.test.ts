import { describe, expect, it } from "vitest";
import { renderSms, smsCredits, toSmsText, type SmsKind } from "@/lib/sms/templates";

const kinds: SmsKind[] = [
  "otp", "request_alert", "confirmed", "declined", "moved",
  "cancelled", "reminder", "patient_cancel_alert", "low_credit",
];

// Longest values the database allows (Global Constraints) plus the longest date and time.
const worst = {
  clinic: "C".repeat(20),
  dentist: "D".repeat(16),
  first: "F".repeat(12),
  lastInitial: "L",
  date: "Wed Sep 30",
  time: "10:30 AM",
  reason: "R".repeat(36),
  code: "123456",
  credits: 99999,
};

const appUrls = [...new Set(["https://brightsmile.ph", process.env.APP_URL].filter((u): u is string => !!u))];

describe.each(appUrls)("worst case with %s", (appUrl) => {
  const vars = { ...worst, appUrl, link: `${appUrl}/a/${"t".repeat(12)}`, bookLink: `${appUrl}/${"s".repeat(24)}` };

  it.each(kinds)("%s fits in one text", (kind) => {
    const text = renderSms(kind, vars);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/^[\x20-\x7E]+$/);
    expect(smsCredits(kind, text)).toBe(kind === "otp" ? 2 : 1);
  });
});

describe("renderSms", () => {
  it("renders a confirmation", () => {
    const text = renderSms("confirmed", {
      clinic: "Elite Dental", first: "Juan", date: "Thu Sep 24", time: "10:00 AM",
      link: "https://brightsmile.ph/a/Ab12Cd34Ef56",
    });
    expect(text).toBe("Elite Dental: Juan's visit on Thu Sep 24, 10:00 AM is confirmed. View or cancel: https://brightsmile.ph/a/Ab12Cd34Ef56");
  });

  it("adds the dentist when given", () => {
    const text = renderSms("reminder", {
      clinic: "Elite Dental", first: "Juan", time: "10:00 AM", dentist: "Dr. Reyes", link: "https://x.ph/a/1",
    });
    expect(text).toBe("Elite Dental: Reminder, Juan's visit is tomorrow at 10:00 AM with Dr. Reyes. Can't come? Cancel: https://x.ph/a/1");
  });

  it("ends a reason with a period", () => {
    const text = renderSms("declined", {
      clinic: "Elite Dental", date: "Thu Sep 24", time: "10:00 AM", reason: "Dentist unavailable", bookLink: "https://x.ph/elite",
    });
    expect(text).toBe("Elite Dental can't take Thu Sep 24, 10:00 AM. Dentist unavailable. Rebook: https://x.ph/elite");
  });

  it("never starts a clinic alert with the patient's name", () => {
    const text = renderSms("patient_cancel_alert", { first: "Tester", lastInitial: "Q", date: "Thu Sep 24", time: "10:00 AM" });
    expect(text).toBe("Cancelled: Tester Q., Thu Sep 24, 10:00 AM.");
  });

  it("cuts long first names to 12 characters", () => {
    const text = renderSms("confirmed", { clinic: "X", first: "Maximilianoooo", date: "d", time: "t", link: "l" });
    expect(text).toContain("Maximilianoo's");
  });
});

describe("toSmsText", () => {
  it("keeps texts in plain ASCII without GSM-7 extension characters", () => {
    expect(toSmsText("Ngiti ng Parañaque ‘Dental’ ₱500 — ok {x}")).toBe("Ngiti ng Paranaque 'Dental' PHP500 - ok x");
  });
});

describe("smsCredits", () => {
  it("counts parts and doubles the OTP route", () => {
    expect(smsCredits("confirmed", "x".repeat(160))).toBe(1);
    expect(smsCredits("confirmed", "x".repeat(161))).toBe(2);
    expect(smsCredits("otp", "x".repeat(100))).toBe(2);
  });
});
