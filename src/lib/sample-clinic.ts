import type { Block, BookingRules, Busy } from "@/lib/slots";
import { manilaDate, manilaInstant, addDays, weekday } from "@/lib/time";

/**
 * Sample clinic for building the booking page ahead of the database.
 * Plan 2 replaces this module with Supabase queries; the shapes stay the same,
 * so the page and its components do not change when real data arrives.
 * Nothing here describes a real clinic: the page stamps itself SAMPLE.
 */

export type SampleDentist = { id: string; name: string; smsName: string };
export type SampleProcedure = { id: string; name: string; minutes: number };

export type SampleClinic = {
  slug: string;
  name: string;
  smsName: string;
  mobile: string;
  address: string;
  mapsUrl: string;
  rules: BookingRules;
  dentists: SampleDentist[];
  procedures: SampleProcedure[];
  hoursByWeekday: Block[][];
};

const MORNING: Block = { start: 9 * 60, end: 12 * 60 };
const AFTERNOON: Block = { start: 13 * 60, end: 17 * 60 };

/** Closed Sunday, Monday to Saturday 9:00 to 12:00 and 1:00 to 5:00. */
const WEEK: Block[][] = [[], [MORNING, AFTERNOON], [MORNING, AFTERNOON], [MORNING, AFTERNOON], [MORNING, AFTERNOON], [MORNING, AFTERNOON], [MORNING]];

export const SAMPLE_CLINIC: SampleClinic = {
  slug: "sample-dental",
  name: "Sample Dental Clinic",
  smsName: "Sample Dental",
  mobile: "+639170000000",
  address: "2nd floor, Sample Building, Makati",
  mapsUrl: "https://maps.google.com/?q=Makati",
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  dentists: [
    { id: "d1", name: "Dr. Ana Reyes", smsName: "Dr. Reyes" },
    { id: "d2", name: "Dr. Marco Lim", smsName: "Dr. Lim" },
  ],
  procedures: [
    { id: "p1", name: "Consultation", minutes: 30 },
    { id: "p2", name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
    { id: "p3", name: "Tooth Restoration (Pasta)", minutes: 60 },
    { id: "p4", name: "Tooth Extraction (Bunot)", minutes: 60 },
    { id: "p5", name: "Braces Consultation", minutes: 30 },
    { id: "p6", name: "Braces Adjustment", minutes: 30 },
    { id: "p7", name: "Root Canal Treatment", minutes: 90 },
    { id: "p8", name: "Teeth Whitening", minutes: 90 },
    { id: "p9", name: "Dentures Consultation", minutes: 30 },
    { id: "p10", name: "Others", minutes: 30 },
  ],
  hoursByWeekday: WEEK,
};

/**
 * Sample appointments, placed relative to now so the sheet always looks lived in:
 * a busy morning tomorrow, a fully booked Saturday, and an afternoon off.
 */
export function sampleBusy(now: Date): Busy[] {
  const today = manilaDate(now);
  const busy: Busy[] = [];
  const block = (date: string, fromMinutes: number, toMinutes: number, dentist: string) =>
    busy.push({ id: `${dentist}-${date}-${fromMinutes}`, start: manilaInstant(date, fromMinutes), end: manilaInstant(date, toMinutes) });

  const tomorrow = addDays(today, 1);
  block(tomorrow, 9 * 60, 11 * 60, "d1");
  block(tomorrow, 13 * 60, 14 * 60, "d1");

  // The next Saturday is fully booked for both dentists.
  let saturday = today;
  for (let i = 1; i <= 7 && weekday(saturday) !== 6; i++) saturday = addDays(today, i);
  if (weekday(saturday) === 6) {
    block(saturday, 9 * 60, 12 * 60, "d1");
    block(saturday, 9 * 60, 12 * 60, "d2");
  }

  const later = addDays(today, 3);
  block(later, 13 * 60, 17 * 60, "d2");
  return busy;
}

/** Busy intervals for one dentist. The database will filter this server-side. */
export function busyFor(dentistId: string, busy: Busy[]): Busy[] {
  return busy.filter((b) => (b.id ?? "").startsWith(`${dentistId}-`));
}

/** Common HMO providers, offered as suggestions on the booking form. */
export const HMO_SUGGESTIONS = [
  "Maxicare",
  "Intellicare",
  "MediCard",
  "PhilCare",
  "Cocolife",
  "Avega",
  "ValuCare",
  "Insular Health Care",
  "EastWest Healthcare",
  "Kaiser",
];
