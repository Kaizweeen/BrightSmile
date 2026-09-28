import { describe, expect, it } from "vitest";
import { formView } from "@/lib/patients";

const signed = { waiver_name: "Ana Santos Cruz", waiver_version: "2026-09-26", waiver_at: "2026-09-28T02:00:00.000Z" };
const empty = {
  middle_name: null,
  sex: null,
  address: null,
  occupation: null,
  email: null,
  guardian_name: null,
  hmo_number: null,
  previous_dentist: null,
  last_visit: null,
  visit_reason: null,
  emergency_name: null,
  emergency_mobile: null,
  waiver_name: null,
  waiver_version: null,
  waiver_at: null,
  medical: null,
};

describe("formView", () => {
  it("is null for a patient who never signed the form", () => {
    expect(formView(empty)).toBeNull();
  });

  it("puts allergies and ticked conditions first, then only what was answered, in the form's order", () => {
    const view = formView({
      ...empty,
      ...signed,
      sex: "female",
      address: "12 Rizal St, Makati",
      last_visit: "2025-06",
      emergency_name: "Ben Cruz",
      emergency_mobile: "+639175550000",
      medical: {
        goodHealth: true,
        takingMedicine: true,
        medicineDetail: "Losartan",
        tobacco: false,
        pregnant: false,
        allergies: ["latex", "antibiotics"],
        conditions: ["asthma", "other"],
        conditionOther: "Migraine",
      },
    });
    expect(view).toEqual({
      allergies: ["Penicillin or other antibiotics", "Latex"],
      conditions: ["Asthma", "Other: Migraine"],
      rows: [
        { label: "Sex", value: "Female" },
        { label: "Home address", value: "12 Rizal St, Makati" },
        { label: "Last dental visit", value: "June 2025" },
        { label: "Are you in good health?", value: "Yes" },
        { label: "Are you taking any medicine now?", value: "Yes: Losartan" },
        { label: "Do you smoke or use tobacco?", value: "No" },
        { label: "Are you pregnant?", value: "No" },
        { label: "Emergency contact", value: "Ben Cruz, 09175550000" },
      ],
      signed: { name: "Ana Santos Cruz", at: "2026-09-28T02:00:00.000Z", version: "2026-09-26" },
    });
  });

  it("shows a male patient no women's answers, and survives answers that are not the stored shape", () => {
    const male = formView({ ...empty, ...signed, sex: "male", medical: { pregnant: true, allergies: [] } });
    expect(male?.rows).toEqual([{ label: "Sex", value: "Male" }]);
    const odd = formView({ ...empty, ...signed, sex: "female", medical: "not an object" });
    expect(odd).toMatchObject({ allergies: [], conditions: [], rows: [{ label: "Sex", value: "Female" }] });
  });
});
