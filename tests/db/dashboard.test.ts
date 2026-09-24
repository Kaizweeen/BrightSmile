import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRequests } from "@/lib/dashboard";
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
