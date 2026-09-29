import { describe, expect, it } from "vitest";
import { EXAM_SECTIONS, examFindingsSchema } from "@/lib/exam";

describe("the PDA exam", () => {
  it("has the five sections under the chart", () => {
    expect(EXAM_SECTIONS.map((s) => s.label)).toEqual(["Periodontal screening", "Occlusion", "Appliances", "TMD", "X-rays taken"]);
  });

  it("accepts marked items with short details", () => {
    const findings = { periodontal: { gingivitis: "" }, xrays: { periapical: "16, 26", panoramic: "" } };
    expect(examFindingsSchema.parse(findings)).toEqual(findings);
    expect(examFindingsSchema.parse({})).toEqual({});
  });

  it("refuses unknown sections or items and long details", () => {
    expect(examFindingsSchema.safeParse({ fillings: { a: "" } }).success).toBe(false);
    expect(examFindingsSchema.safeParse({ tmd: { snoring: "" } }).success).toBe(false);
    expect(examFindingsSchema.safeParse({ tmd: { clicking: "x".repeat(61) } }).success).toBe(false);
  });
});
