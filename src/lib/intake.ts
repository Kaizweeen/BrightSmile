import { normalizeMobile } from "@/lib/phone";
import { cleanBirthday, cleanEmail, cleanText, LIMITS } from "@/lib/validate";
import { WAIVER_VERSION } from "@/lib/waiver";

/** Allergies the form offers to tick (booking flow spec 6, item 5), by the key patients.medical stores. */
export const ALLERGIES = {
  local_anaesthetic: "Local anaesthetic (for example lidocaine)",
  antibiotics: "Penicillin or other antibiotics",
  sulfa: "Sulfa drugs",
  aspirin: "Aspirin",
  latex: "Latex",
  other: "Other",
} as const;

/** Conditions the patient has or had, to tick (spec 6, item 5). */
export const CONDITIONS = {
  high_blood_pressure: "High blood pressure",
  low_blood_pressure: "Low blood pressure",
  heart_disease: "Heart disease",
  heart_surgery: "Heart surgery or pacemaker",
  diabetes: "Diabetes",
  asthma: "Asthma",
  bleeding: "Bleeding problems",
  hepatitis: "Hepatitis or liver disease",
  kidney: "Kidney disease",
  epilepsy: "Epilepsy or seizures",
  stroke: "Stroke",
  cancer: "Cancer",
  tuberculosis: "Tuberculosis",
  thyroid: "Thyroid problems",
  hiv: "HIV",
  other: "Other",
} as const;

export type Allergy = keyof typeof ALLERGIES;
export type Condition = keyof typeof CONDITIONS;
/** A Yes or No answer, or null when it was left empty: spec 6 requires only the fields it marks. */
export type YesNo = boolean | null;

/**
 * The medical history as patients.medical stores it (spec 6, item 5): always every key, a detail only beside its Yes
 * (or the Other tick), and the women's questions only for women.
 */
export type Medical = {
  goodHealth: YesNo;
  underTreatment: YesNo;
  treatmentCondition: string | null;
  seriousIllness: YesNo;
  illnessDetail: string | null;
  hospitalized: YesNo;
  hospitalDetail: string | null;
  takingMedicine: YesNo;
  medicineDetail: string | null;
  tobacco: YesNo;
  allergies: Allergy[];
  allergyOther: string | null;
  pregnant: YesNo;
  nursing: YesNo;
  birthControl: YesNo;
  conditions: Condition[];
  conditionOther: string | null;
};

/** The patient form (spec 6) as create_booking stores it. The patient's mobile is the verified number, never a field here. */
export type IntakeForm = {
  first: string;
  last: string;
  middle: string | null;
  birthday: string;
  sex: "female" | "male";
  address: string;
  occupation: string | null;
  email: string | null;
  guardian: string | null;
  hmo: string | null;
  hmoNumber: string | null;
  previousDentist: string | null;
  lastVisit: string | null;
  visitReason: string | null;
  emergencyName: string | null;
  emergencyMobile: string | null;
  medical: Medical;
  waiverName: string;
  waiverVersion: string;
};

/** Field limits, the same as the checks on public.patients (20260928000100_branches_booking.sql). */
export const INTAKE_LIMITS = {
  name: LIMITS.personName,
  address: LIMITS.address,
  occupation: 60,
  guardian: 100,
  hmo: LIMITS.hmo,
  hmoNumber: 40,
  previousDentist: 100,
  visitReason: 200,
  emergencyName: 100,
  signature: 150,
  detail: 100,
} as const;

const ALLERGY_KEYS = Object.keys(ALLERGIES) as Allergy[];
const CONDITION_KEYS = Object.keys(CONDITIONS) as Condition[];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const record = (value: unknown) =>
  (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** true, false, null for no answer, or undefined for anything that is not an answer. */
function yesNo(value: unknown): YesNo | undefined {
  if (value === true || value === false) return value;
  return value === null || value === undefined ? null : undefined;
}

/** The ticked keys in the form's order, or null for anything but a list of distinct known keys. */
function ticks<K extends string>(value: unknown, keys: K[]): K[] | null {
  if (value === null || value === undefined) return [];
  const known: unknown[] = keys;
  if (!Array.isArray(value) || new Set(value).size !== value.length || !value.every((x) => known.includes(x))) return null;
  return keys.filter((k) => value.includes(k));
}

/** A detail box: trimmed text or null when empty, undefined when too long. */
function detail(value: unknown): string | null | undefined {
  const text = cleanText(value, INTAKE_LIMITS.detail, true);
  return text === null ? undefined : text || null;
}

/** Age in whole years on a "YYYY-MM-DD" day. */
export function ageOn(birthday: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birthday.slice(0, 4));
  return day.slice(5) < birthday.slice(5) ? years - 1 : years;
}

/** The medical history in its fixed shape, or null when the input is not one. Unknown keys are dropped. */
export function parseMedical(value: unknown, sex: "female" | "male"): Medical | null {
  if (value !== null && value !== undefined && (typeof value !== "object" || Array.isArray(value))) return null;
  const v = record(value);
  const women = (key: string) => (sex === "female" ? yesNo(v[key]) : null);
  const answers = {
    goodHealth: yesNo(v.goodHealth),
    underTreatment: yesNo(v.underTreatment),
    seriousIllness: yesNo(v.seriousIllness),
    hospitalized: yesNo(v.hospitalized),
    takingMedicine: yesNo(v.takingMedicine),
    tobacco: yesNo(v.tobacco),
    pregnant: women("pregnant"),
    nursing: women("nursing"),
    birthControl: women("birthControl"),
  };
  const details = {
    treatmentCondition: detail(v.treatmentCondition),
    illnessDetail: detail(v.illnessDetail),
    hospitalDetail: detail(v.hospitalDetail),
    medicineDetail: detail(v.medicineDetail),
    allergyOther: detail(v.allergyOther),
    conditionOther: detail(v.conditionOther),
  };
  const allergies = ticks(v.allergies, ALLERGY_KEYS);
  const conditions = ticks(v.conditions, CONDITION_KEYS);
  if (Object.values(answers).includes(undefined) || Object.values(details).includes(undefined) || !allergies || !conditions) return null;
  const a = answers as Record<keyof typeof answers, YesNo>;
  const d = details as Record<keyof typeof details, string | null>;
  return {
    goodHealth: a.goodHealth,
    underTreatment: a.underTreatment,
    treatmentCondition: a.underTreatment ? d.treatmentCondition : null,
    seriousIllness: a.seriousIllness,
    illnessDetail: a.seriousIllness ? d.illnessDetail : null,
    hospitalized: a.hospitalized,
    hospitalDetail: a.hospitalized ? d.hospitalDetail : null,
    takingMedicine: a.takingMedicine,
    medicineDetail: a.takingMedicine ? d.medicineDetail : null,
    tobacco: a.tobacco,
    allergies,
    allergyOther: allergies.includes("other") ? d.allergyOther : null,
    pregnant: a.pregnant,
    nursing: a.nursing,
    birthControl: a.birthControl,
    conditions,
    conditionOther: conditions.includes("other") ? d.conditionOther : null,
  };
}

/**
 * Validates the patient form and waiver on the server (spec 6, 8): the required fields, a parent or guardian when the
 * patient is under 18 today (the form comes before the visit date is chosen), lengths, the email and mobile formats,
 * and the medical history's shape. Reports every problem at once, keyed by field. `today` is Manila's date.
 */
export function parseIntakeForm(value: unknown, today: string): { ok: true; form: IntakeForm } | { ok: false; errors: Record<string, string> } {
  const v = record(value);
  const errors: Record<string, string> = {};
  const required = (key: string, max: number, message: string) => {
    const text = cleanText(v[key], max);
    if (!text) errors[key] = message;
    return text ?? "";
  };
  const optional = (key: string, max: number) => {
    const text = cleanText(v[key], max, true);
    if (text === null) errors[key] = `Keep this to ${max} characters or fewer.`;
    return text || null;
  };
  const typed = (key: string) => (typeof v[key] === "string" ? (v[key] as string).trim() : "");

  const last = required("last", INTAKE_LIMITS.name, `Enter the last name, up to ${INTAKE_LIMITS.name} characters.`);
  const first = required("first", INTAKE_LIMITS.name, `Enter the first name, up to ${INTAKE_LIMITS.name} characters.`);
  const middle = optional("middle", INTAKE_LIMITS.name);
  const birthday = cleanBirthday(v.birthday, today);
  if (!birthday) errors.birthday = "Enter the birthday, a real past date.";
  const sex = v.sex === "female" || v.sex === "male" ? v.sex : null;
  if (!sex) errors.sex = "Choose female or male.";
  const address = required("address", INTAKE_LIMITS.address, `Enter the home address, up to ${INTAKE_LIMITS.address} characters.`);
  const occupation = optional("occupation", INTAKE_LIMITS.occupation);
  const email = typed("email") ? cleanEmail(typed("email")) : null;
  if (typed("email") && !email) errors.email = "Enter an email address like name@example.com, or leave it blank.";
  const guardian = optional("guardian", INTAKE_LIMITS.guardian);
  if (birthday && ageOn(birthday, today) < 18 && !guardian && !errors.guardian) {
    errors.guardian = "Enter the name of a parent or guardian: the patient is under 18.";
  }
  const hmo = optional("hmo", INTAKE_LIMITS.hmo);
  const hmoNumber = optional("hmoNumber", INTAKE_LIMITS.hmoNumber);
  const previousDentist = optional("previousDentist", INTAKE_LIMITS.previousDentist);
  const month = typed("lastVisit");
  const lastVisit = MONTH.test(month) && month >= "1900-01" && month <= today.slice(0, 7) ? month : null;
  if (month && !lastVisit) errors.lastVisit = "Choose a month that has passed, or leave it blank.";
  const visitReason = optional("visitReason", INTAKE_LIMITS.visitReason);
  const emergencyName = optional("emergencyName", INTAKE_LIMITS.emergencyName);
  const emergencyMobile = typed("emergencyMobile") ? normalizeMobile(typed("emergencyMobile")) : null;
  if (typed("emergencyMobile") && !emergencyMobile) errors.emergencyMobile = "Enter a Philippine mobile number, like 0917 123 4567, or leave it blank.";
  const medical = parseMedical(v.medical, sex ?? "male");
  if (!medical) errors.medical = "Answer the medical questions again.";
  if (v.agree !== true) errors.agree = "Please read the waiver and tick that you agree.";
  const waiverName = required("signature", INTAKE_LIMITS.signature, "Type the patient's full name as the signature.");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    form: {
      first,
      last,
      middle,
      birthday: birthday as string,
      sex: sex as "female" | "male",
      address,
      occupation,
      email,
      guardian,
      hmo,
      hmoNumber,
      previousDentist,
      lastVisit,
      visitReason,
      emergencyName,
      emergencyMobile,
      medical: medical as Medical,
      waiverName,
      waiverVersion: WAIVER_VERSION,
    },
  };
}

/** The form's columns on public.patients, as create_booking and change_booking take them (p_form). */
export function formColumns(f: IntakeForm): Record<string, unknown> {
  return {
    middle_name: f.middle,
    sex: f.sex,
    address: f.address,
    occupation: f.occupation,
    email: f.email,
    guardian_name: f.guardian,
    hmo_number: f.hmoNumber,
    previous_dentist: f.previousDentist,
    last_visit: f.lastVisit,
    visit_reason: f.visitReason,
    emergency_name: f.emergencyName,
    emergency_mobile: f.emergencyMobile,
    waiver_name: f.waiverName,
    waiver_version: f.waiverVersion,
    medical: f.medical,
  };
}
