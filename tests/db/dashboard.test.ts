import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDay, loadRequests } from "@/lib/dashboard";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;

async function book(s: StaffSeed, day: string, minutes: number, status: string, patientId?: string) {
  const start = manilaInstant(day, minutes);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  const { data } = await db
    .from("appointments")
    .insert({ ...row, patient_id: patientId ?? row.patient_id })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("loadRequests", () => {
  it("lists upcoming pending requests soonest first, with New and Returning", async () => {
    const { data: newcomer } = await db
      .from("patients")
      .insert({ clinic_id: a.staff.clinicId, first_name: "Bea", last_name: "Lim", mobile: null })
      .select("id")
      .single()
      .throwOnError();
    await book(a, addDays(today, -3), 540, "completed"); // Ana has visited before
    const later = await book(a, addDays(today, 5), 600, "pending", newcomer.id);
    const sooner = await book(a, addDays(today, 4), 540, "pending");
    await book(a, addDays(today, -1), 540, "pending"); // its time passed
    await book(a, addDays(today, 4), 660, "confirmed");

    const items = await loadRequests(a.staff, new Date());
    expect(items.map((i) => i.id)).toEqual([sooner, later]);
    expect(items[0]).toMatchObject({
      first: "Ana",
      last: "Cruz",
      mobile: a.seed.patient.mobile,
      dentistName: "Dr. Ana Reyes",
      procedures: ["Consultation"],
      returning: true,
      actions: ["approve", "decline"],
    });
    expect(items[1]).toMatchObject({ first: "Bea", mobile: null, returning: false });
  });

  it("shows another clinic nothing", async () => {
    expect(await loadRequests(b.staff, new Date())).toEqual([]);
  });
});

describe("loadDay", () => {
  const day = addDays(today, 6);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.fine = await book(a, day, 540, "confirmed");
    ids.pending = await book(a, day, 600, "pending");
    ids.cancelled = await book(a, day, 660, "cancelled");
    ids.expired = await book(a, day, 720, "expired");
    ids.inTimeOff = await book(a, day, 840, "confirmed");
    ids.evening = await book(a, day, 1080, "confirmed");
    await db
      .from("time_off")
      .insert({
        clinic_id: a.staff.clinicId,
        dentist_id: a.seed.dentist.id,
        starts_at: manilaInstant(day, 840).toISOString(),
        ends_at: manilaInstant(day, 900).toISOString(),
      })
      .throwOnError();
    const log = (appointment_id: string, kind: string, status: string) => ({
      clinic_id: a.staff.clinicId,
      appointment_id,
      to_mobile: "+639171112222",
      kind,
      body: "test",
      credits: 0,
      status,
    });
    await db
      .from("sms_log")
      .insert([log(ids.cancelled, "cancelled", "failed"), log(ids.pending, "request_alert", "failed")])
      .throwOnError();
  });

  it("lists the day in time order without expired visits, with flags", async () => {
    const { items, dentists } = await loadDay(a.staff, day, null, new Date());
    expect(dentists).toEqual([{ id: a.seed.dentist.id, name: "Dr. Ana Reyes", active: true }]);
    expect(items.map((i) => [i.id, i.status, i.outsideHours, i.textFailed])).toEqual([
      [ids.fine, "confirmed", false, false],
      [ids.pending, "pending", false, false],
      [ids.cancelled, "cancelled", false, true],
      [ids.inTimeOff, "confirmed", true, false],
      [ids.evening, "confirmed", true, false],
    ]);
    expect(items[1].actions).toEqual(["approve", "decline"]);
  });

  it("filters by dentist", async () => {
    expect((await loadDay(a.staff, day, a.seed.dentist.id, new Date())).items).toHaveLength(5);
    expect((await loadDay(a.staff, day, b.seed.dentist.id, new Date())).items).toEqual([]);
  });

  it("shows another clinic nothing of this clinic", async () => {
    const view = await loadDay(b.staff, day, null, new Date());
    expect(view.items).toEqual([]);
    expect(view.dentists.map((d) => d.id)).toEqual([b.seed.dentist.id]);
  });
});
