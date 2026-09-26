import { describe, expect, it } from "vitest";
import { gcashFailure, isOperator, operatorEmails, parseGcashPayment, parsePesos, parseTrialDays, trialFailure } from "@/lib/admin";

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const LIST = " Kai@Example.com, ,ops@brightsmile.ph ";
const confirmed = "2026-09-25T02:00:00Z";

describe("operatorEmails", () => {
  it("reads a comma separated list, trimmed and lowercased", () => {
    expect(operatorEmails(LIST)).toEqual(["kai@example.com", "ops@brightsmile.ph"]);
    expect(operatorEmails(undefined)).toEqual([]);
    expect(operatorEmails("")).toEqual([]);
  });
});

describe("isOperator", () => {
  it("lets in a confirmed, listed email, whatever its case", () => {
    expect(isOperator({ email: "KAI@example.com", email_confirmed_at: confirmed }, LIST)).toBe(true);
    expect(isOperator({ email: "ops@brightsmile.ph", email_confirmed_at: confirmed }, LIST)).toBe(true);
  });

  it("keeps out unconfirmed, unlisted, and look-alike emails, and everyone when the list is empty", () => {
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: null }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com" }, LIST)).toBe(false);
    expect(isOperator({ email: "ai@example.com", email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com.evil.ph", email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: null, email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: confirmed }, undefined)).toBe(false);
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: confirmed }, "")).toBe(false);
  });
});

describe("parsePesos", () => {
  it("reads pesos as typed, in centavos", () => {
    expect(["1197", "1,197.50", "₱1,197", " 399 ", "0.5", "100000"].map(parsePesos)).toEqual([119_700, 119_750, 119_700, 39_900, 50, 10_000_000]);
  });

  it("refuses zero, negatives, too many decimals, and more than ₱100,000", () => {
    for (const bad of ["0", "0.00", "-5", "1.234", "abc", "", "100001", "1e3", 1197, null]) expect(parsePesos(bad)).toBeNull();
  });
});

describe("parseGcashPayment", () => {
  const good = { clinicId: CLINIC, months: "3", amount: "3,897", reference: " 1234 567 890 " };

  it("builds the payment from the form", () => {
    expect(parseGcashPayment(good)).toEqual({ ok: true, value: { clinicId: CLINIC, months: 3, amountCentavos: 389_700, reference: "1234567890" } });
  });

  it("drops the spaces GCash shows in reference numbers, so one transfer cannot be recorded twice", () => {
    const spaced = parseGcashPayment({ ...good, reference: "5012 345 678901" });
    const plain = parseGcashPayment({ ...good, reference: "5012345678901" });
    expect(spaced).toEqual(plain);
  });

  it("says what is wrong", () => {
    expect(parseGcashPayment({ ...good, clinicId: "nope" })).toEqual({ ok: false, error: "That clinic no longer exists. Reload the page." });
    expect(parseGcashPayment({ ...good, months: "13" })).toEqual({ ok: false, error: "Choose 1 to 12 months." });
    expect(parseGcashPayment({ ...good, amount: "" })).toEqual({ ok: false, error: "Enter the amount received, like 1197 or 1,197.50." });
    expect(parseGcashPayment({ ...good, reference: "  " })).toEqual({ ok: false, error: "Enter the GCash reference number, up to 100 characters." });
    expect(parseGcashPayment({ ...good, reference: "x".repeat(101) }).ok).toBe(false);
  });
});

describe("parseTrialDays", () => {
  it("accepts 1 to 365 whole days", () => {
    expect(["1", " 14 ", "365"].map(parseTrialDays)).toEqual([1, 14, 365]);
    for (const bad of ["0", "366", "1.5", "-3", "", "abc", 7, null]) expect(parseTrialDays(bad)).toBeNull();
  });
});

describe("gcashFailure", () => {
  it("names a GCash reference already recorded, and otherwise says to check before trying again", () => {
    expect(gcashFailure({ code: "23505", message: 'duplicate key value violates unique constraint "payments_gcash_reference"' })).toBe(
      "That GCash reference is already recorded.",
    );
    const unsure = "The payment may not have been recorded. Reload the page and check the last payment before trying again.";
    for (const e of [{ code: "P0002" }, new Error("fetch failed"), null, "timeout"]) expect(gcashFailure(e)).toBe(unsure);
  });
});

describe("trialFailure", () => {
  it("names a clinic that no longer exists and a day count out of range", () => {
    expect(trialFailure({ code: "P0002", message: "clinic not found" })).toBe("That clinic no longer exists.");
    expect(trialFailure({ code: "22023", message: "days must be between 1 and 365" })).toBe("Enter 1 to 365 days.");
    for (const e of [{ code: "08006" }, new Error("fetch failed"), null]) expect(trialFailure(e)).toBe("The trial was not extended. Try again.");
  });
});
