import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, MESSAGES } from "@/lib/appointment-actions";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

process.env.SMS_MODE = "log";
process.env.APP_URL = "https://brightsmile.ph";
const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;
let n = 0;

/** A fresh appointment in its own half hour (16 per day), in the future or in the past. */
async function book(s: StaffSeed, status: string, when: "future" | "past" = "future", patientId?: string) {
  const k = n++;
  const day = when === "future" ? addDays(today, 3 + Math.floor(k / 16)) : addDays(today, -1 - Math.floor(k / 16));
  const start = manilaInstant(day, 540 + 30 * (k % 16));
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  const { data } = await db
    .from("appointments")
    .insert({ ...row, patient_id: patientId ?? row.patient_id })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

async function current(id: string) {
  const { data } = await db.from("appointments").select("status, status_reason").eq("id", id).single().throwOnError();
  return data as { status: string; status_reason: string | null };
}

async function texts(id: string) {
  const { data } = await db.from("sms_log").select("kind, body, status").eq("appointment_id", id).order("id").throwOnError();
  return data as { kind: string; body: string; status: string }[];
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("changeStatus", () => {
  it("approves a request and texts the confirmation without the dentist (one dentist)", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(a.staff, id, "confirmed", "", new Date())).toEqual({ ok: true, text: "logged" });
    expect((await current(id)).status).toBe("confirmed");
    const [text] = await texts(id);
    expect(text.kind).toBe("confirmed");
    expect(text.body).toContain("Staff Clinic: Ana's visit on");
    expect(text.body).toContain("is confirmed. View or cancel: https://");
    expect(text.body).not.toContain(" with ");
  });

  it("declines with a reason and puts the reason in the text", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(a.staff, id, "declined", "Dentist unavailable", new Date())).toEqual({ ok: true, text: "logged" });
    expect(await current(id)).toEqual({ status: "declined", status_reason: "Dentist unavailable" });
    const [text] = await texts(id);
    expect(text.kind).toBe("declined");
    expect(text.body).toContain("Dentist unavailable. Rebook: https://");
  });

  it("refuses a reason over 36 characters and changes nothing", async () => {
    const id = await book(a, "pending");
    const result = await changeStatus(a.staff, id, "declined", "x".repeat(37), new Date());
    expect(result.ok).toBe(false);
    expect((await current(id)).status).toBe("pending");
    expect(await texts(id)).toEqual([]);
  });

  it("cancels a confirmed visit and texts the patient", async () => {
    const id = await book(a, "confirmed");
    expect(await changeStatus(a.staff, id, "cancelled", "Please call the clinic", new Date())).toEqual({ ok: true, text: "logged" });
    expect((await current(id)).status).toBe("cancelled");
    expect((await texts(id)).map((t) => t.kind)).toEqual(["cancelled"]);
  });

  it("refuses changes the status table does not allow", async () => {
    const pending = await book(a, "pending");
    expect(await changeStatus(a.staff, pending, "cancelled", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    expect(await changeStatus(a.staff, pending, "completed", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    const confirmed = await book(a, "confirmed");
    expect(await changeStatus(a.staff, confirmed, "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    expect(await texts(pending)).toEqual([]);
    expect(await texts(confirmed)).toEqual([]);
  });

  it("refuses to approve a request whose time has passed", async () => {
    const id = await book(a, "pending", "past");
    const result = await changeStatus(a.staff, id, "confirmed", "", new Date());
    expect(result.ok).toBe(false);
    expect((await current(id)).status).toBe("pending");
  });

  it("records attendance only after the start, switches it, and sends no text", async () => {
    const upcoming = await book(a, "confirmed");
    expect((await changeStatus(a.staff, upcoming, "completed", "", new Date())).ok).toBe(false);

    const id = await book(a, "confirmed", "past");
    expect(await changeStatus(a.staff, id, "completed", "", new Date())).toEqual({ ok: true, text: "none" });
    expect(await changeStatus(a.staff, id, "no_show", "", new Date())).toEqual({ ok: true, text: "none" });
    expect((await current(id)).status).toBe("no_show");
    expect(await texts(id)).toEqual([]);
  });

  it("changes a double tap once and texts once", async () => {
    const id = await book(a, "pending");
    const results = await Promise.all([
      changeStatus(a.staff, id, "confirmed", "", new Date()),
      changeStatus(a.staff, id, "confirmed", "", new Date()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: MESSAGES.changed }]);
    expect(await texts(id)).toHaveLength(1);
  });

  it("sends nothing to a patient without a mobile", async () => {
    const { data: patient } = await db
      .from("patients")
      .insert({ clinic_id: a.staff.clinicId, first_name: "Lolo", last_name: "Santos", mobile: null })
      .select("id")
      .single()
      .throwOnError();
    const id = await book(a, "pending", "future", patient.id);
    expect(await changeStatus(a.staff, id, "confirmed", "", new Date())).toEqual({ ok: true, text: "none" });
    expect(await texts(id)).toEqual([]);
  });

  it("names the dentist once the clinic has 2 active dentists", async () => {
    const { data: second } = await db
      .from("dentists")
      .insert({ clinic_id: a.staff.clinicId, name: "Dr. Ben Lim", sms_name: "Dr. Lim" })
      .select("id")
      .single()
      .throwOnError();
    try {
      const id = await book(a, "pending");
      await changeStatus(a.staff, id, "confirmed", "", new Date());
      const [text] = await texts(id);
      expect(text.body).toContain(" with Dr. Reyes is confirmed.");
    } finally {
      await db.from("dentists").delete().eq("id", second.id);
    }
  });

  it("lets no one change another clinic's appointment", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(b.staff, id, "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect(await changeStatus(b.staff, id, "declined", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect((await current(id)).status).toBe("pending");
    expect(await texts(id)).toEqual([]);
  });

  it("treats a malformed id as not found", async () => {
    expect(await changeStatus(a.staff, "not-a-uuid", "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
  });
});
