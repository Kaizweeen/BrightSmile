import { describe, expect, it } from "vitest";
import { cleanBirthday, cleanText, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";

describe("slugProblem", () => {
  it.each(["elite-dental", "abc", "a1b", "smile-studio-dental-mkt1"])("accepts %s", (slug) => {
    expect(slugProblem(slug)).toBeNull();
  });

  it.each(["ab", "-abc", "abc-", "Elite", "elite_dental", "a".repeat(25)])("rejects %s", (slug) => {
    expect(slugProblem(slug)).not.toBeNull();
  });

  it.each(["app", "login", "privacy", "reset-password"])("rejects reserved %s", (slug) => {
    expect(slugProblem(slug)).toMatch(/reserved/);
  });
});

describe("slugFromName", () => {
  it("turns a clinic name into a booking link", () => {
    expect(slugFromName("Elite Dental Makati")).toBe("elite-dental-makati");
    expect(slugFromName("Dr. Peña's Dental Clinic & Orthodontics")).toBe("dr-pena-s-dental-clinic");
  });
});

describe("smsNameProblem", () => {
  it("accepts a normal short name", () => {
    expect(smsNameProblem("Elite Dental", 20)).toBeNull();
  });

  it("rejects empty and over-long names", () => {
    expect(smsNameProblem("  ", 20)).not.toBeNull();
    expect(smsNameProblem("A".repeat(21), 20)).not.toBeNull();
  });

  it("accepts a name exactly at the limit", () => {
    expect(smsNameProblem("A".repeat(20), 20)).toBeNull();
  });

  it("rejects names the SMS provider would drop", () => {
    expect(smsNameProblem("Test Dental", 20)).toMatch(/test/i);
  });
});

describe("cleanText", () => {
  it("trims and enforces the limit", () => {
    expect(cleanText("  Ana ", 50)).toBe("Ana");
    expect(cleanText("", 50)).toBeNull();
    expect(cleanText("", 36, true)).toBe("");
    expect(cleanText("x".repeat(37), 36, true)).toBeNull();
    expect(cleanText(42, 50)).toBeNull();
  });

  it("accepts text exactly at the limit", () => {
    expect(cleanText("x".repeat(36), 36)).toBe("x".repeat(36));
  });
});

describe("cleanBirthday", () => {
  const today = "2026-09-22";

  it("accepts an empty or real past date", () => {
    expect(cleanBirthday("", today)).toBe("");
    expect(cleanBirthday("1990-05-17", today)).toBe("1990-05-17");
  });

  it("accepts both boundary dates: today and 1900-01-01", () => {
    expect(cleanBirthday(today, today)).toBe(today);
    expect(cleanBirthday("1900-01-01", today)).toBe("1900-01-01");
  });

  it("rejects future, ancient, malformed, and impossible dates", () => {
    expect(cleanBirthday("2026-09-23", today)).toBeNull();
    expect(cleanBirthday("1899-12-31", today)).toBeNull();
    expect(cleanBirthday("17/05/1990", today)).toBeNull();
    expect(cleanBirthday("2026-02-30", today)).toBeNull();
  });
});
