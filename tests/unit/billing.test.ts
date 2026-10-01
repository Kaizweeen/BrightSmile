import { describe, expect, it } from "vitest";
import { billTotal, changeDue, peso, receiptNumber, toCentavos } from "@/lib/billing";

describe("billTotal", () => {
  it("sums quantity times price in centavos", () => {
    expect(billTotal([{ qty: 1, unitPrice: 150000 }, { qty: 3, unitPrice: 2500 }])).toBe(157500);
    expect(billTotal([])).toBe(0);
  });
});

describe("changeDue", () => {
  it("returns the change, and refuses short cash", () => {
    expect(changeDue(157500, 200000)).toBe(42500);
    expect(changeDue(1000, 1000)).toBe(0);
    expect(() => changeDue(1000, 999)).toThrow("Cash received is less than the total due");
  });
});

describe("toCentavos", () => {
  it("reads pesos typed by staff", () => {
    expect(toCentavos("150")).toBe(15000);
    expect(toCentavos("150.5")).toBe(15050);
    expect(toCentavos("1,250.75")).toBe(125075);
    expect(toCentavos(" 0 ")).toBe(0);
  });
  it("refuses anything else", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3", "1.", ".5"]) expect(toCentavos(bad)).toBeNull();
  });
});

describe("receiptNumber and peso", () => {
  it("builds OR-BRANCH-YYYYMMDD-000001", () => {
    expect(receiptNumber("downtown", "2026-10-01", 1)).toBe("OR-DOWNTOWN-20261001-000001");
    expect(receiptNumber("mn", "2026-12-31", 123456)).toBe("OR-MN-20261231-123456");
  });
  it("formats pesos", () => {
    expect(peso(125075)).toContain("1,250.75");
    expect(peso(125075)).toContain("₱");
  });
});
