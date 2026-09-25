import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOURS,
  DEFAULT_PROCEDURES,
  dentistShortName,
  parseOnboarding,
  type OnboardingInput,
} from "@/lib/onboarding";

const good: OnboardingInput = {
  name: "Bright Dental Makati",
  smsName: "Bright Dental",
  slug: "bright-dental-makati",
  mobile: "0917 123 4567",
  address: "2F Ayala Avenue, Makati",
  dentistName: "Dr. Ana Reyes",
  dentistSmsName: "Dr. Reyes",
  hours: DEFAULT_HOURS,
  procedures: DEFAULT_PROCEDURES,
};

const withHours = (day: number, blocks: { start: string; end: string }[]) =>
  ({ ...good, hours: good.hours.map((b, d) => (d === day ? blocks : b)) });

describe("onboarding defaults", () => {
  it("pins the spec 5.4 procedures", () => {
    expect(DEFAULT_PROCEDURES).toEqual([
      { name: "Consultation", minutes: 30 },
      { name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
      { name: "Tooth Restoration (Pasta)", minutes: 60 },
      { name: "Tooth Extraction (Bunot)", minutes: 60 },
      { name: "Braces Consultation", minutes: 30 },
      { name: "Braces Adjustment", minutes: 30 },
      { name: "Root Canal Treatment", minutes: 90 },
      { name: "Teeth Whitening", minutes: 90 },
      { name: "Dentures Consultation", minutes: 30 },
      { name: "Others", minutes: 30 },
    ]);
  });

  it("presets Monday to Saturday, 9 to 12 and 1 to 5, closed Sunday", () => {
    const day = [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }];
    expect(DEFAULT_HOURS).toEqual([[], day, day, day, day, day, day]);
  });
});

describe("dentistShortName", () => {
  it("keeps the title and the last name", () => {
    expect(dentistShortName("Dr. Ana Reyes")).toBe("Dr. Reyes");
    expect(dentistShortName("Dra. Liza Santos")).toBe("Dra. Santos");
    expect(dentistShortName("  Dr.   Reyes ")).toBe("Dr. Reyes");
  });

  it("uses the last name alone without a title", () => {
    expect(dentistShortName("Ana Reyes")).toBe("Reyes");
    expect(dentistShortName("")).toBe("");
  });

  it("fits the 16 character limit", () => {
    expect(dentistShortName("Dr. Anastasia Villanueva-Fernandez")).toBe("Dr. Villanueva-F");
  });
});

describe("parseOnboarding", () => {
  it("builds the create_clinic payload", () => {
    const result = parseOnboarding(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      name: "Bright Dental Makati",
      sms_name: "Bright Dental",
      slug: "bright-dental-makati",
      mobile: "+639171234567",
      address: "2F Ayala Avenue, Makati",
      dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    });
    expect(result.payload.hours).toHaveLength(12);
    expect(result.payload.hours[0]).toEqual({ weekday: 1, start: "09:00", end: "12:00" });
    expect(result.payload.hours.some((h) => h.weekday === 0)).toBe(false);
    expect(result.payload.procedures).toEqual(DEFAULT_PROCEDURES);
  });

  it("trims names before saving", () => {
    const result = parseOnboarding({ ...good, name: "  Bright Dental  ", procedures: [{ name: " Cleaning ", minutes: 60 }] });
    expect(result.ok && result.payload.name).toBe("Bright Dental");
    expect(result.ok && result.payload.procedures).toEqual([{ name: "Cleaning", minutes: 60 }]);
  });

  it.each([
    [{ ...good, slug: "app" }, "slug", "That link is reserved. Try another."],
    [{ ...good, smsName: "Test Dental" }, "smsName", 'The SMS provider drops texts that start with "test". Try another name.'],
    [{ ...good, mobile: "02 8123 4567" }, "mobile", "Enter a Philippine mobile number, like 0917 123 4567."],
    [{ ...good, address: "" }, "address", "Enter the clinic address, up to 200 characters."],
    [{ ...good, dentistSmsName: "Dr. Maximiliano R" }, "dentistSmsName", "Use 1 to 16 characters."],
    [withHours(1, [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "15:00" }]), "hours", "The blocks on Monday overlap."],
    [withHours(2, [{ start: "12:00", end: "09:00" }]), "hours", "Check the hours on Tuesday: each block must end after it starts."],
    [{ ...good, hours: [[], [], [], [], [], [], []] }, "hours", "Add at least one working block."],
    [{ ...good, procedures: [] }, "procedures", "Add at least one procedure."],
    [{ ...good, procedures: [{ name: "Cleaning", minutes: 3 }] }, "procedures", "Cleaning: use 5 to 480 minutes."],
    [{ ...good, procedures: [{ name: " ", minutes: 30 }] }, "procedures", "Procedure 1: enter a name, up to 60 characters."],
  ])("rejects %#", (input, field, error) => {
    expect(parseOnboarding(input)).toEqual({ ok: false, field, error });
  });

  it("reports the first problem in screen order", () => {
    const result = parseOnboarding({ ...good, name: "", procedures: [] });
    expect(result).toMatchObject({ ok: false, field: "name" });
  });

  it("rejects something that is not a form at all", () => {
    expect(parseOnboarding(null)).toMatchObject({ ok: false, field: "name" });
  });
});
