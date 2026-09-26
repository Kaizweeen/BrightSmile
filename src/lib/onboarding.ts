import { normalizeMobile } from "@/lib/phone";
import { cleanText, LIMITS, slugProblem, smsNameProblem } from "@/lib/validate";

/** A working block as the form holds it, in "HH:MM" clock times. */
export type Clock = { start: string; end: string };
export type ProcedureDraft = { name: string; minutes: number };

export type OnboardingInput = {
  name: string;
  smsName: string;
  slug: string;
  mobile: string;
  address: string;
  dentistName: string;
  dentistSmsName: string;
  /** Index 0 is Sunday, 6 is Saturday. */
  hours: Clock[][];
  procedures: ProcedureDraft[];
};

export type OnboardingField = keyof OnboardingInput;
export type Problems = Partial<Record<OnboardingField, string>>;

/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260925000200_billing.sql). */
export type CreateClinicPayload = {
  name: string;
  sms_name: string;
  slug: string;
  mobile: string;
  address: string;
  dentist: { name: string; sms_name: string };
  hours: { weekday: number; start: string; end: string }[];
  procedures: { name: string; minutes: number }[];
};

const MORNING: Clock = { start: "09:00", end: "12:00" };
const AFTERNOON: Clock = { start: "13:00", end: "17:00" };

/** Spec 5.4: Monday to Saturday, 9:00 AM to 12:00 PM and 1:00 PM to 5:00 PM. */
export const DEFAULT_HOURS: Clock[][] = [[], ...Array.from({ length: 6 }, () => [MORNING, AFTERNOON])];

/** Spec 5.4 default procedures. The clinic edits them before saving. */
export const DEFAULT_PROCEDURES: ProcedureDraft[] = [
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
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** "Dr. Ana Reyes" suggests "Dr. Reyes": the title, if any, and the last word. */
export function dentistShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const title = words.length > 1 && /^dra?\.?$/i.test(words[0]) ? `${words[0]} ` : "";
  return `${title}${words[words.length - 1]}`.slice(0, LIMITS.dentistSmsName);
}

/** Screen 2: the clinic. */
export function clinicProblems(i: OnboardingInput): Problems {
  const p: Problems = {};
  if (!cleanText(i.name, LIMITS.clinicName)) p.name = `Enter the clinic name, up to ${LIMITS.clinicName} characters.`;
  const sms = smsNameProblem(text(i.smsName), LIMITS.clinicSmsName);
  if (sms) p.smsName = sms;
  const slug = slugProblem(text(i.slug));
  if (slug) p.slug = slug;
  if (!normalizeMobile(text(i.mobile))) p.mobile = "Enter a Philippine mobile number, like 0917 123 4567.";
  if (!cleanText(i.address, LIMITS.address)) p.address = `Enter the clinic address, up to ${LIMITS.address} characters.`;
  return p;
}

function hoursProblem(hours: unknown): string | null {
  if (!Array.isArray(hours) || hours.length !== 7) return "Set the working hours for each day.";
  let blocks = 0;
  for (let day = 0; day < 7; day++) {
    const list: unknown = hours[day];
    if (!Array.isArray(list)) return "Set the working hours for each day.";
    if (list.length > 6) return `Use at most 6 blocks on ${DAYS[day]}.`;
    const clean = list
      .map((b) => ({ start: text(b?.start), end: text(b?.end) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const [k, b] of clean.entries()) {
      if (!CLOCK.test(b.start) || !CLOCK.test(b.end) || b.start >= b.end) {
        return `Check the hours on ${DAYS[day]}: each block must end after it starts.`;
      }
      if (k > 0 && b.start < clean[k - 1].end) return `The blocks on ${DAYS[day]} overlap.`;
      blocks++;
    }
  }
  return blocks === 0 ? "Add at least one working block." : null;
}

/** Screen 3: the first dentist and their weekly hours. */
export function dentistProblems(i: OnboardingInput): Problems {
  const p: Problems = {};
  if (!cleanText(i.dentistName, LIMITS.dentistName)) p.dentistName = `Enter the dentist's name, up to ${LIMITS.dentistName} characters.`;
  const sms = smsNameProblem(text(i.dentistSmsName), LIMITS.dentistSmsName);
  if (sms) p.dentistSmsName = sms;
  const hours = hoursProblem(i.hours);
  if (hours) p.hours = hours;
  return p;
}

/** Screen 4: the procedures. */
export function procedureProblems(i: OnboardingInput): Problems {
  const list: unknown = i.procedures;
  if (!Array.isArray(list) || list.length === 0) return { procedures: "Add at least one procedure." };
  if (list.length > 40) return { procedures: "Use at most 40 procedures." };
  for (const [k, x] of list.entries()) {
    const name = cleanText(x?.name, LIMITS.procedureName);
    if (!name) return { procedures: `Procedure ${k + 1}: enter a name, up to ${LIMITS.procedureName} characters.` };
    const minutes = x?.minutes;
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { procedures: `${name}: use 5 to 480 minutes.` };
  }
  return {};
}

/** Validates every screen on the server and builds the create_clinic payload. */
export function parseOnboarding(
  input: unknown,
): { ok: true; payload: CreateClinicPayload } | { ok: false; field: OnboardingField; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, field: "name", error: "Something is missing. Start again." };
  const i = input as OnboardingInput;
  const problems: Problems = { ...clinicProblems(i), ...dentistProblems(i), ...procedureProblems(i) };
  const first = Object.entries(problems)[0] as [OnboardingField, string] | undefined;
  if (first) return { ok: false, field: first[0], error: first[1] };
  return {
    ok: true,
    payload: {
      name: i.name.trim(),
      sms_name: i.smsName.trim(),
      slug: i.slug,
      mobile: normalizeMobile(i.mobile)!,
      address: i.address.trim(),
      dentist: { name: i.dentistName.trim(), sms_name: i.dentistSmsName.trim() },
      hours: i.hours.flatMap((blocks, weekday) => blocks.map((b) => ({ weekday, start: b.start, end: b.end }))),
      procedures: i.procedures.map((x) => ({ name: x.name.trim(), minutes: x.minutes })),
    },
  };
}
