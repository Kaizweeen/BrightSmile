import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { adminDb, anonDb, deleteClinic, deleteUser, rand, signedInUser } from "./helpers";

type User = Awaited<ReturnType<typeof signedInUser>>;

const payload = (slug: string) => ({
  name: "Access Clinic",
  sms_name: "Access Clinic",
  slug,
  mobile: "+639170000001",
  address: "Cebu",
  dentist: { name: "Dr. Access", sms_name: "Dr. Access" },
  hours: [
    { weekday: 1, start: "09:00", end: "12:00" },
    { weekday: 1, start: "13:00", end: "17:00" },
  ],
  procedures: [
    { name: "Consultation", minutes: 30 },
    { name: "Braces Adjustment", minutes: 30 },
  ],
});

let a: User;
let b: User;
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  a = await signedInUser();
  b = await signedInUser();
  clinicA = (await a.db.rpc("create_clinic", { p: payload(`a-${rand()}`) }).throwOnError()).data;
  clinicB = (await b.db.rpc("create_clinic", { p: payload(`b-${rand()}`) }).throwOnError()).data;
});

afterAll(async () => {
  await deleteClinic(clinicA);
  await deleteClinic(clinicB);
  await deleteUser(a.userId);
  await deleteUser(b.userId);
});

describe("create_clinic", () => {
  it("creates the clinic with its dentist, hours, and procedures", async () => {
    const { data: dentists } = await a.db.from("dentists").select("name").eq("clinic_id", clinicA).throwOnError();
    expect(dentists.map((d: { name: string }) => d.name)).toEqual(["Dr. Access"]);
    const hours = await a.db.from("working_hours").select("*", { count: "exact", head: true }).eq("clinic_id", clinicA).throwOnError();
    expect(hours.count).toBe(2);
    const procedures = await a.db.from("procedures").select("*", { count: "exact", head: true }).eq("clinic_id", clinicA).throwOnError();
    expect(procedures.count).toBe(2);
  });

  it("allows only one clinic per account", async () => {
    const { error } = await a.db.rpc("create_clinic", { p: payload(`a2-${rand()}`) });
    expect(error?.code).toBe("23505");
  });

  it("reports a taken booking link", async () => {
    const c = await signedInUser();
    const { data: taken } = await adminDb().from("clinics").select("slug").eq("id", clinicA).single().throwOnError();
    const { error } = await c.db.rpc("create_clinic", { p: payload(taken.slug) });
    expect(error?.code).toBe("23505");
    await deleteUser(c.userId);
  });
});

describe("clinic isolation", () => {
  it("shows members only their own clinic", async () => {
    const { data } = await a.db.from("clinics").select("id").throwOnError();
    expect(data.map((c: { id: string }) => c.id)).toEqual([clinicA]);
  });

  it("hides another clinic's patients and blocks writing into it", async () => {
    await adminDb()
      .from("patients")
      .insert({ clinic_id: clinicB, first_name: "Secret", last_name: "Patient", mobile: "+639175550000" })
      .throwOnError();
    const { data } = await a.db.from("patients").select("id").eq("clinic_id", clinicB).throwOnError();
    expect(data).toEqual([]);
    const { error } = await a.db.from("patients").insert({ clinic_id: clinicB, first_name: "Sneaky", last_name: "Insert" });
    expect(error?.code).toBe("42501");
  });

  it("cannot change another clinic", async () => {
    const { data } = await a.db.from("clinics").update({ name: "Hacked" }).eq("id", clinicB).select().throwOnError();
    expect(data).toEqual([]);
  });

  it("gives strangers nothing", async () => {
    const { error: selectError } = await anonDb().from("patients").select("id");
    expect(selectError?.code).toBe("42501");
    const { error } = await anonDb().rpc("create_clinic", { p: payload(`c-${rand()}`) });
    expect(error?.code).toBe("42501");
  });

  it("cannot insert their own membership into another clinic", async () => {
    const { error } = await a.db.from("clinic_members").insert({ clinic_id: clinicB, user_id: a.userId });
    expect(error?.code).toBe("42501");
  });

  it("cannot delete their own clinic", async () => {
    const { data, error } = await a.db.from("clinics").delete().eq("id", clinicA).select();
    if (!error) expect(data).toEqual([]);
    const { data: stillThere } = await adminDb().from("clinics").select("id").eq("id", clinicA).single().throwOnError();
    expect(stillThere.id).toBe(clinicA);
  });

  it("blocks attaching an event to another clinic's appointment", async () => {
    const { data: apptB } = await adminDb()
      .from("appointments")
      .insert({
        clinic_id: clinicB,
        dentist_id: (await adminDb().from("dentists").select("id").eq("clinic_id", clinicB).single().throwOnError()).data.id,
        patient_id: (
          await adminDb()
            .from("patients")
            .insert({ clinic_id: clinicB, first_name: "Cross", last_name: "Clinic", mobile: "+639175559999" })
            .select()
            .single()
            .throwOnError()
        ).data.id,
        starts_at: "2030-02-01T09:00:00+08:00",
        ends_at: "2030-02-01T09:30:00+08:00",
        status: "confirmed",
        procedure_names: ["Consultation"],
        source: "manual",
        manage_token: newToken(),
      })
      .select()
      .single()
      .throwOnError();
    const { error } = await a.db
      .from("appointment_events")
      .insert({ clinic_id: clinicA, appointment_id: apptB.id, to_status: "confirmed", actor: "staff" });
    expect(error?.code).toBe("23503");
  });
});
