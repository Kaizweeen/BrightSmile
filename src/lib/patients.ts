import { ALLERGIES } from "@/db/schema";

/** The allergies the PDA form lists (src/db/schema.ts keeps the same keys for its check constraint). */
export const ALLERGY_KEYS = ALLERGIES;
export type Allergy = (typeof ALLERGY_KEYS)[number];

export const ALLERGY_LABELS: Record<Allergy, string> = {
  local_anesthetic: "Local anesthetic (for example lidocaine)",
  penicillin: "Penicillin or other antibiotics",
  sulfa: "Sulfa drugs",
  aspirin: "Aspirin",
  latex: "Latex",
};

/** Whole years from a birthday to a date, both "YYYY-MM-DD". */
export function ageOn(birthday: string, date: string): number {
  const [by, bm, bd] = birthday.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Allergies and medical alerts in words, for the red banner. Empty when there are none. */
export function alertLines(p: { allergies: readonly string[]; allergiesOther: string | null; medicalAlerts: string }): string[] {
  const lines = p.allergies.map((a) => `Allergy: ${ALLERGY_LABELS[a as Allergy] ?? a}`);
  if (p.allergiesOther) lines.push(`Allergy: ${p.allergiesOther}`);
  if (p.medicalAlerts.trim()) lines.push(p.medicalAlerts.trim());
  return lines;
}

export function fullName(p: { lastName: string; firstName: string; middleName?: string | null }): string {
  return `${p.lastName}, ${p.firstName}${p.middleName ? ` ${p.middleName}` : ""}`;
}
