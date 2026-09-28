import { describe, expect, it } from "vitest";
import { ALLERGIES } from "@/db/schema";
import { ageOn, ALLERGY_KEYS, alertLines, fullName } from "@/lib/patients";

describe("patient helpers", () => {
  it("lists the same allergies as the database", () => {
    expect([...ALLERGY_KEYS]).toEqual([...ALLERGIES]);
  });

  it("counts whole years", () => {
    expect(ageOn("2010-10-05", "2026-10-05")).toBe(16);
    expect(ageOn("2010-10-06", "2026-10-05")).toBe(15);
    expect(ageOn("2012-02-29", "2026-02-28")).toBe(13);
    expect(ageOn("2012-02-29", "2026-03-01")).toBe(14);
  });

  it("puts allergies and alerts in words", () => {
    expect(alertLines({ allergies: ["latex", "penicillin"], allergiesOther: "Shellfish", medicalAlerts: " On warfarin " })).toEqual([
      "Allergy: Latex",
      "Allergy: Penicillin or other antibiotics",
      "Allergy: Shellfish",
      "On warfarin",
    ]);
    expect(alertLines({ allergies: [], allergiesOther: null, medicalAlerts: "" })).toEqual([]);
  });

  it("writes names last name first", () => {
    expect(fullName({ lastName: "Santos", firstName: "Ana", middleName: "Reyes" })).toBe("Santos, Ana Reyes");
    expect(fullName({ lastName: "Santos", firstName: "Ana" })).toBe("Santos, Ana");
  });
});
