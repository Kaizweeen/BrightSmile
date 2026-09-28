import { describe, expect, it } from "vitest";
import { ageOn, formColumns, intakeInput, NO_ANSWERS, parseIntakeForm, parseMedical, QUESTIONS, WOMEN_QUESTIONS, type Medical } from "@/lib/intake";
import { WAIVER_VERSION, waiverText } from "@/lib/waiver";

const today = "2026-09-28";

const EMPTY_MEDICAL: Medical = {
  goodHealth: null,
  underTreatment: null,
  treatmentCondition: null,
  seriousIllness: null,
  illnessDetail: null,
  hospitalized: null,
  hospitalDetail: null,
  takingMedicine: null,
  medicineDetail: null,
  tobacco: null,
  allergies: [],
  allergyOther: null,
  pregnant: null,
  nursing: null,
  birthControl: null,
  conditions: [],
  conditionOther: null,
};

const adult = {
  last: " Cruz ",
  first: "Ana",
  middle: "Santos",
  birthday: "1990-05-17",
  sex: "female",
  address: "12 Rizal St, Makati",
  occupation: "",
  email: " Ana@Example.com ",
  guardian: "",
  hmo: "Maxicare",
  hmoNumber: "MX-1234",
  previousDentist: "",
  lastVisit: "2025-06",
  visitReason: "Toothache",
  emergencyName: "Ben Cruz",
  emergencyMobile: "0917 555 0000",
  medical: { goodHealth: true, takingMedicine: true, medicineDetail: " Losartan ", allergies: ["latex", "antibiotics"] },
  agree: true,
  signature: "Ana Santos Cruz",
};

describe("parseIntakeForm", () => {
  it("builds the stored form on the server's terms", () => {
    expect(parseIntakeForm(adult, today)).toEqual({
      ok: true,
      form: {
        first: "Ana",
        last: "Cruz",
        middle: "Santos",
        birthday: "1990-05-17",
        sex: "female",
        address: "12 Rizal St, Makati",
        occupation: null,
        email: "ana@example.com",
        guardian: null,
        hmo: "Maxicare",
        hmoNumber: "MX-1234",
        previousDentist: null,
        lastVisit: "2025-06",
        visitReason: "Toothache",
        emergencyName: "Ben Cruz",
        emergencyMobile: "+639175550000",
        medical: { ...EMPTY_MEDICAL, goodHealth: true, takingMedicine: true, medicineDetail: "Losartan", allergies: ["antibiotics", "latex"] },
        waiverName: "Ana Santos Cruz",
        waiverVersion: WAIVER_VERSION,
      },
    });
  });

  it("asks for every required field at once", () => {
    const result = parseIntakeForm({}, today);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["address", "agree", "birthday", "first", "last", "sex", "signature"]);
  });

  it("asks for a parent or guardian while the patient is under 18 today", () => {
    const minor = { ...adult, birthday: "2008-09-29" };
    expect(parseIntakeForm(minor, today)).toMatchObject({
      ok: false,
      errors: { guardian: "Enter the name of a parent or guardian: the patient is under 18." },
    });
    expect(parseIntakeForm({ ...minor, guardian: "Rosa Cruz" }, today)).toMatchObject({ ok: true, form: { guardian: "Rosa Cruz" } });
    expect(parseIntakeForm({ ...adult, birthday: "2008-09-28" }, today).ok).toBe(true);
  });

  it("refuses text that is too long, a bad email or mobile, and a month that has not passed", () => {
    const result = parseIntakeForm(
      { ...adult, middle: "M".repeat(51), signature: "S".repeat(151), email: "ana@", emergencyMobile: "12345", lastVisit: "2026-10", birthday: "2026-09-29" },
      today,
    );
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["birthday", "email", "emergencyMobile", "lastVisit", "middle", "signature"]);
  });

  it("stores the waiver's version, never one the client sends", () => {
    const result = parseIntakeForm({ ...adult, waiverVersion: "1999-01-01" }, today);
    expect(result.ok && result.form.waiverVersion).toBe(WAIVER_VERSION);
  });
});

describe("parseMedical", () => {
  it("always has every key, with details only beside a Yes or an Other tick", () => {
    const medical = parseMedical(
      {
        underTreatment: false,
        treatmentCondition: "ignored without a Yes",
        hospitalized: true,
        hospitalDetail: "2019, appendix",
        allergies: ["other"],
        allergyOther: "Shellfish",
        conditions: ["asthma"],
        conditionOther: "ignored without the Other tick",
        unknownQuestion: true,
      },
      "male",
    );
    expect(medical).toEqual({
      ...EMPTY_MEDICAL,
      underTreatment: false,
      hospitalized: true,
      hospitalDetail: "2019, appendix",
      allergies: ["other"],
      allergyOther: "Shellfish",
      conditions: ["asthma"],
    });
  });

  it("asks the women's questions of women only", () => {
    const answers = { pregnant: true, nursing: false, birthControl: true };
    expect(parseMedical(answers, "female")).toEqual({ ...EMPTY_MEDICAL, ...answers });
    expect(parseMedical(answers, "male")).toEqual(EMPTY_MEDICAL);
  });

  it("is empty when nothing was answered", () => {
    expect(parseMedical(undefined, "female")).toEqual(EMPTY_MEDICAL);
  });

  it.each([
    ["a list", []],
    ["text", "healthy"],
    ["an answer that is not Yes or No", { tobacco: "yes" }],
    ["an unknown allergy", { allergies: ["pollen"] }],
    ["a repeated tick", { conditions: ["asthma", "asthma"] }],
    ["a detail that is too long", { takingMedicine: true, medicineDetail: "x".repeat(101) }],
  ])("refuses %s", (_, value) => {
    expect(parseMedical(value, "female")).toBeNull();
    expect(parseIntakeForm({ ...adult, medical: value }, today)).toMatchObject({ ok: false, errors: { medical: "Answer the medical questions again." } });
  });
});

describe("ageOn", () => {
  it("counts whole years on the day", () => {
    expect(ageOn("2008-09-28", today)).toBe(18);
    expect(ageOn("2008-09-29", today)).toBe(17);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
  });
});

describe("formColumns", () => {
  it("names the patients columns create_booking fills", () => {
    const result = parseIntakeForm(adult, today);
    expect(result.ok && formColumns(result.form)).toEqual({
      middle_name: "Santos",
      sex: "female",
      address: "12 Rizal St, Makati",
      occupation: null,
      email: "ana@example.com",
      guardian_name: null,
      hmo_number: "MX-1234",
      previous_dentist: null,
      last_visit: "2025-06",
      visit_reason: "Toothache",
      emergency_name: "Ben Cruz",
      emergency_mobile: "+639175550000",
      waiver_name: "Ana Santos Cruz",
      waiver_version: WAIVER_VERSION,
      medical: { ...EMPTY_MEDICAL, goodHealth: true, takingMedicine: true, medicineDetail: "Losartan", allergies: ["antibiotics", "latex"] },
    });
  });
});

describe("waiverText", () => {
  it("names the clinic in both paragraphs", () => {
    const paragraphs = waiverText("Bright Dental");
    expect(paragraphs.map((p) => p.title)).toEqual(["Consent for dental examination and treatment.", "Data privacy consent."]);
    expect(paragraphs.every((p) => p.text.includes("Bright Dental"))).toBe(true);
  });
});

describe("intakeInput", () => {
  it("gives the server back a form it parses to the same form", () => {
    const result = parseIntakeForm(adult, today);
    if (!result.ok) throw new Error("the adult form should parse");
    expect(parseIntakeForm(intakeInput(result.form), today)).toEqual(result);
  });
});

describe("the form's questions", () => {
  it("start with nothing answered and ask every Yes or No question once", () => {
    expect(NO_ANSWERS).toEqual(EMPTY_MEDICAL);
    const keys = [...QUESTIONS, ...WOMEN_QUESTIONS].map((q) => q.key).sort();
    expect(keys).toEqual(["birthControl", "goodHealth", "hospitalized", "nursing", "pregnant", "seriousIllness", "takingMedicine", "tobacco", "underTreatment"]);
  });
});
