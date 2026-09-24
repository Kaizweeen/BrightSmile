import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayOpenStarts, loadClinic, monthOpenDates } from "@/lib/availability";
import type { PublicClinic } from "@/lib/booking-input";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

const db = adminDb();
const now = new Date();
const today = manilaDate(now);
const date = addDays(today, 3);
const fullDay = addDays(today, 4);
const at = (day: string, minutes: number) => manilaInstant(day, minutes).toISOString();
let seed: Seed;
let clinic: PublicClinic;

beforeAll(async () => {
  seed = await seedClinic();
  await db.from("procedures").insert({ clinic_id: seed.clinic.id, name: "Consultation", duration_minutes: 30 }).throwOnError();
  await db.from("procedures").insert({ clinic_id: seed.clinic.id, name: "Archived", duration_minutes: 30, active: false }).throwOnError();
  clinic = (await loadClinic({ slug: seed.clinic.slug }))!;
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("loadClinic", () => {
  it("gives the page the clinic profile, dentists, procedures, hours, and rules, and nothing else", () => {
    expect(Object.keys(clinic).sort()).toEqual([
      "address", "dentists", "id", "mapsUrl", "mobile", "name", "procedures", "rules", "slug", "smsName",
    ]);
    expect(clinic.dentists).toEqual([
      { id: seed.dentist.id, name: "Dr. Seed", smsName: "Dr. Seed", hours: Array.from({ length: 7 }, () => [{ start: 540, end: 1020 }]) },
    ]);
    expect(clinic.procedures).toEqual([{ id: expect.any(String), name: "Consultation", minutes: 30 }]);
    expect(clinic.rules).toEqual({ slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 });
  });

  it("finds the same clinic by id, and nothing for an unknown link", async () => {
    expect((await loadClinic({ id: seed.clinic.id }))?.slug).toBe(seed.clinic.slug);
    expect(await loadClinic({ slug: "no-such-clinic-zz9" })).toBeNull();
  });
});

describe("dayOpenStarts", () => {
  it("returns open start instants and nothing else, minus appointments and time off", async () => {
    const dentist = clinic.dentists[0];
    expect(await dayOpenStarts(clinic, dentist, 30, date, now)).toHaveLength(16);

    await db.from("appointments").insert(appointmentRow(seed, at(date, 600), at(date, 660), "pending")).throwOnError();
    await db
      .from("time_off")
      .insert({ clinic_id: seed.clinic.id, dentist_id: seed.dentist.id, starts_at: at(date, 780), ends_at: at(date, 840) })
      .throwOnError();

    const starts = await dayOpenStarts(clinic, dentist, 30, date, now);
    expect(starts.every((s) => s instanceof Date)).toBe(true);
    const iso = starts.map((s) => s.toISOString());
    expect(iso).toHaveLength(12);
    for (const taken of [600, 630, 780, 810]) expect(iso).not.toContain(at(date, taken));
    expect(iso).toContain(at(date, 660));
  });

  it("returns nothing outside the booking window", async () => {
    expect(await dayOpenStarts(clinic, clinic.dentists[0], 30, addDays(today, -1), now)).toEqual([]);
    expect(await dayOpenStarts(clinic, clinic.dentists[0], 30, addDays(today, 61), now)).toEqual([]);
  });
});

describe("monthOpenDates", () => {
  it("drops a fully booked day and returns only bookable dates of that month", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at(fullDay, 540), at(fullDay, 1020), "confirmed")).throwOnError();
    const month = fullDay.slice(0, 7);
    const open = await monthOpenDates(clinic, clinic.dentists[0], 30, month, now);
    expect(open).not.toContain(fullDay);
    if (date.slice(0, 7) === month) expect(open).toContain(date);
    expect(open.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month) && d >= today)).toBe(true);
  });

  it("returns nothing for a month outside the window", async () => {
    expect(await monthOpenDates(clinic, clinic.dentists[0], 30, "2000-01", now)).toEqual([]);
  });
});
