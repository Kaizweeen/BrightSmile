import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deletePatient, loadPatient, searchPatients, updatePatient } from "@/lib/patients";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;
let maria: string;
let mario: string;
const suffix = String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
const MARIA = `+63918123${suffix}`;
const MARIO = `+63918124${suffix}`;

async function addPatient(s: StaffSeed, first: string, last: string, mobile: string | null) {
  const { data } = await db
    .from("patients")
    .insert({ clinic_id: s.staff.clinicId, first_name: first, last_name: last, mobile, birthday: "1990-05-01", hmo: "Maxicare" })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

async function visit(s: StaffSeed, patientId: string, day: string, status: string) {
  const start = manilaInstant(day, 540);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  await db.from("appointments").insert({ ...row, patient_id: patientId }).throwOnError();
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
  maria = await addPatient(a, "Maria", "Santos", MARIA);
  mario = await addPatient(a, "Mario", "Reyes", MARIO);
  await visit(a, maria, addDays(today, -10), "completed");
  await visit(a, maria, addDays(today, -5), "no_show");
  await visit(a, maria, addDays(today, 5), "confirmed");
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("searchPatients", () => {
  it("finds patients by name words, any case", async () => {
    expect((await searchPatients(a.staff, "MARIA")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, "mar san")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, "mar")).map((p) => p.id).sort()).toEqual([maria, mario].sort());
  });

  it("finds patients by mobile prefix typed the local way", async () => {
    expect((await searchPatients(a.staff, "0918 123")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, `0918123${suffix}`))[0]).toEqual({ id: maria, first: "Maria", last: "Santos", mobile: MARIA });
  });

  it("never shows another clinic's patients", async () => {
    expect(await searchPatients(b.staff, "maria")).toEqual([]);
    expect(await searchPatients(b.staff, "0918")).toEqual([]);
  });
});

describe("loadPatient", () => {
  it("returns details, history newest first, and the no-show count", async () => {
    const detail = await loadPatient(a.staff, maria);
    expect(detail?.patient).toEqual({
      id: maria,
      first: "Maria",
      last: "Santos",
      mobile: MARIA,
      birthday: "1990-05-01",
      hmo: "Maxicare",
      anonymized: false,
    });
    expect(detail?.history.map((h) => h.status)).toEqual(["confirmed", "no_show", "completed"]);
    expect(detail?.history[0].dentistName).toBe("Dr. Ana Reyes");
    expect(detail?.noShows).toBe(1);
  });

  it("returns null for another clinic's patient or a malformed id", async () => {
    expect(await loadPatient(b.staff, maria)).toBeNull();
    expect(await loadPatient(a.staff, "nope")).toBeNull();
  });
});

describe("updatePatient", () => {
  it("saves edits and can clear the mobile", async () => {
    const id = await addPatient(a, "Pedro", "Penduko", "+639189990000");
    const input = { first: "Pedro", last: "Penduko Jr", mobile: "", birthday: "", hmo: "" };
    expect(await updatePatient(a.staff, id, input, new Date())).toEqual({ ok: true });
    const { data } = await db.from("patients").select("last_name, mobile, birthday, hmo").eq("id", id).single().throwOnError();
    expect(data).toEqual({ last_name: "Penduko Jr", mobile: null, birthday: null, hmo: null });
  });

  it("reports the field that is wrong", async () => {
    expect(await updatePatient(a.staff, maria, { first: "", last: "Santos" }, new Date())).toMatchObject({ ok: false, field: "first" });
  });

  it("refuses a second patient with the same name and mobile", async () => {
    const clash = { first: "Maria", last: "Santos", mobile: MARIA, birthday: "", hmo: "" };
    expect(await updatePatient(a.staff, mario, clash, new Date())).toMatchObject({ ok: false, field: "mobile" });
    expect((await loadPatient(a.staff, mario))?.patient.first).toBe("Mario");
  });

  it("changes nothing in another clinic", async () => {
    expect(await updatePatient(b.staff, maria, { first: "Hacked", last: "Name" }, new Date())).toMatchObject({ ok: false });
    expect((await loadPatient(a.staff, maria))?.patient.first).toBe("Maria");
  });
});

describe("deletePatient", () => {
  it("refuses while the patient has an upcoming pending or confirmed visit", async () => {
    const id = await addPatient(a, "Rosa", "Santos", "+639187779999");
    await visit(a, id, addDays(today, 6), "pending");
    expect(await deletePatient(a.staff, id, new Date())).toEqual({
      ok: false,
      error: "Cancel this patient's upcoming visits first.",
    });

    await db.from("appointments").update({ status: "cancelled" }).eq("patient_id", id).throwOnError();
    expect(await deletePatient(a.staff, id, new Date())).toEqual({ ok: true });
  });

  it("anonymizes the patient and keeps the appointments", async () => {
    const id = await addPatient(a, "Juan", "Delacruz", "+639187770000");
    await visit(a, id, addDays(today, -2), "completed");
    expect(await deletePatient(b.staff, id, new Date())).toMatchObject({ ok: false });
    expect(await deletePatient(a.staff, id, new Date())).toEqual({ ok: true });

    const detail = await loadPatient(a.staff, id);
    expect(detail?.patient).toMatchObject({ first: "Deleted", last: "patient", mobile: null, birthday: null, hmo: null, anonymized: true });
    expect(detail?.history).toHaveLength(1);
    expect(await searchPatients(a.staff, "juan")).toEqual([]);
    expect(await searchPatients(a.staff, "0918777")).toEqual([]);
    expect(await updatePatient(a.staff, id, { first: "Juan", last: "Delacruz" }, new Date())).toMatchObject({ ok: false });
    expect(await deletePatient(a.staff, id, new Date())).toMatchObject({ ok: false });
  });
});
