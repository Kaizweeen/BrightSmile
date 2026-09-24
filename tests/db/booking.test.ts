import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { adminDb, anonDb, appointmentRow, deleteClinic, deleteUser, seedClinic, signedInUser, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;
const at = (clock: string) => `2030-01-08T${clock}:00+08:00`;

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

function args(overrides: Record<string, unknown> = {}) {
  return {
    p_clinic_id: seed.clinic.id,
    p_dentist_id: seed.dentist.id,
    p_starts_at: at("09:00"),
    p_ends_at: at("09:30"),
    p_procedure_names: ["Consultation"],
    p_source: "online",
    p_status: "pending",
    p_manage_token: newToken(),
    p_patient_id: null,
    p_first_name: "Maria",
    p_last_name: "Santos",
    p_mobile: "+639181234567",
    p_birthday: null,
    p_hmo: "",
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
    ...overrides,
  };
}

describe("create_booking", () => {
  it("creates the patient, the appointment, and its first event together", async () => {
    const { data: id } = await db.rpc("create_booking", args()).throwOnError();
    const { data: appt } = await db.from("appointments").select("status, patient_id").eq("id", id).single().throwOnError();
    expect(appt.status).toBe("pending");
    const { data: patient } = await db.from("patients").select("first_name, consent_at").eq("id", appt.patient_id).single().throwOnError();
    expect(patient.first_name).toBe("Maria");
    expect(patient.consent_at).not.toBeNull();
    const { data: events } = await db.from("appointment_events").select("to_status, actor").eq("appointment_id", id).throwOnError();
    expect(events).toEqual([{ to_status: "pending", actor: "patient" }]);
  });

  it("reuses the patient when mobile and name match, ignoring case", async () => {
    await db
      .rpc("create_booking", args({ p_starts_at: at("10:00"), p_ends_at: at("10:30"), p_first_name: "MARIA", p_birthday: "1990-05-17" }))
      .throwOnError();
    const { data } = await db
      .from("patients")
      .select("birthday")
      .eq("clinic_id", seed.clinic.id)
      .eq("mobile", "+639181234567")
      .throwOnError();
    expect(data).toEqual([{ birthday: "1990-05-17" }]);
  });

  it("keeps a parent and child with one number as two patients", async () => {
    await db.rpc("create_booking", args({ p_starts_at: at("11:00"), p_ends_at: at("11:30"), p_first_name: "Junior" })).throwOnError();
    const { data } = await db
      .from("patients")
      .select("first_name")
      .eq("clinic_id", seed.clinic.id)
      .eq("mobile", "+639181234567")
      .order("first_name")
      .throwOnError();
    expect(data.map((p: { first_name: string }) => p.first_name)).toEqual(["Junior", "Maria"]);
  });

  it("rolls back a new patient when the time is taken", async () => {
    const { error } = await db.rpc("create_booking", args({ p_first_name: "Late", p_last_name: "Comer" }));
    expect(error?.code).toBe("23P01");
    const { data } = await db.from("patients").select("id").eq("clinic_id", seed.clinic.id).eq("first_name", "Late").throwOnError();
    expect(data).toEqual([]);
  });

  it("lets clinic staff book manually, but not into another clinic", async () => {
    const staff = await signedInUser();
    await db.from("clinic_members").insert({ clinic_id: seed.clinic.id, user_id: staff.userId }).throwOnError();
    const walkIn = args({
      p_starts_at: at("16:30"), p_ends_at: at("17:00"), p_status: "confirmed", p_source: "manual",
      p_actor: "staff", p_user_id: staff.userId, p_first_name: "Walk", p_last_name: "In", p_mobile: null,
    });
    const ok = await staff.db.rpc("create_booking", walkIn);
    expect(ok.error).toBeNull();

    const other = await seedClinic();
    const blocked = await staff.db.rpc("create_booking", args({ p_clinic_id: other.clinic.id, p_dentist_id: other.dentist.id }));
    expect(blocked.error?.code).toBe("42501");

    await deleteClinic(other.clinic.id);
    await deleteUser(staff.userId);
  });

  it("does not let strangers call it", async () => {
    const { error } = await anonDb().rpc("create_booking", args({ p_starts_at: at("12:00"), p_ends_at: at("12:30") }));
    expect(error).not.toBeNull();
  });
});

describe("set_appointment_status", () => {
  it("confirms a pending request once", async () => {
    const { data: id } = await db.rpc("create_booking", args({ p_starts_at: at("13:00"), p_ends_at: at("13:30") })).throwOnError();
    const change = { p_id: id, p_from: "pending", p_to: "confirmed", p_actor: "staff", p_user_id: null, p_reason: null };
    expect((await db.rpc("set_appointment_status", change)).data).toBe(true);
    expect((await db.rpc("set_appointment_status", change)).data).toBe(false);
    const { data: appt } = await db.from("appointments").select("status, confirmed_at").eq("id", id).single().throwOnError();
    expect(appt.status).toBe("confirmed");
    expect(appt.confirmed_at).not.toBeNull();
  });
});

describe("move_appointment", () => {
  it("moves a confirmed appointment and resets its reminder", async () => {
    const { data: id } = await db
      .rpc("create_booking", args({ p_starts_at: at("14:00"), p_ends_at: at("14:30"), p_status: "confirmed", p_source: "manual", p_actor: "staff" }))
      .throwOnError();
    await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id).throwOnError();
    const { data: moved } = await db
      .rpc("move_appointment", { p_id: id, p_dentist_id: seed.dentist.id, p_starts_at: at("15:00"), p_ends_at: at("15:30"), p_user_id: null })
      .throwOnError();
    expect(moved).toBe(true);
    const { data: appt } = await db.from("appointments").select("starts_at, reminder_sent_at").eq("id", id).single().throwOnError();
    expect(new Date(appt.starts_at).getTime()).toBe(new Date(at("15:00")).getTime());
    expect(appt.reminder_sent_at).toBeNull();
  });

  it("refuses to move onto another appointment", async () => {
    const { data: id } = await db
      .rpc("create_booking", args({ p_starts_at: at("16:00"), p_ends_at: at("16:30"), p_status: "confirmed", p_source: "manual", p_actor: "staff" }))
      .throwOnError();
    const { error } = await db.rpc("move_appointment", {
      p_id: id, p_dentist_id: seed.dentist.id, p_starts_at: at("15:00"), p_ends_at: at("15:30"), p_user_id: null,
    });
    expect(error?.code).toBe("23P01");
  });
});

describe("expire_pending", () => {
  it("expires pending requests whose time has passed", async () => {
    const start = new Date(Date.now() - 2 * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const { data: row } = await db
      .from("appointments")
      .insert(appointmentRow(seed, start.toISOString(), end.toISOString(), "pending"))
      .select("id")
      .single()
      .throwOnError();
    const { data: count } = await db.rpc("expire_pending").throwOnError();
    expect(count).toBeGreaterThanOrEqual(1);
    const { data: appt } = await db.from("appointments").select("status").eq("id", row.id).single().throwOnError();
    expect(appt.status).toBe("expired");
  });
});
