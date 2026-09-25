import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, createAppointment, MESSAGES, moveAppointment } from "@/lib/appointment-actions";
import { staffOpenStarts } from "@/lib/dashboard";
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
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(1);
    // The loser either lost the compare-and-set (changed) or loaded the row after the winner committed (notNow).
    expect([MESSAGES.changed, MESSAGES.notNow]).toContain((losers[0] as { error: string }).error);
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

/** An appointment at an exact Manila time (days 20 and later, clear of book()). */
async function bookAt(s: StaffSeed, day: string, minutes: number, status: string, length = 30) {
  const start = manilaInstant(day, minutes);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + length * 60_000).toISOString(), status);
  const { data } = await db.from("appointments").insert(row).select("id").single().throwOnError();
  return data.id as string;
}

async function times(id: string) {
  const { data } = await db.from("appointments").select("starts_at, ends_at, dentist_id, reminder_sent_at").eq("id", id).single().throwOnError();
  return { start: new Date(data.starts_at), end: new Date(data.ends_at), dentistId: data.dentist_id, reminderSentAt: data.reminder_sent_at };
}

const consultation = (s: StaffSeed) => s.procedures.find((p) => p.name === "Consultation")!.id;
const slotAt = (s: StaffSeed, day: string, minutes: number, custom = false) => ({
  dentistId: s.seed.dentist.id,
  startsAt: manilaInstant(day, minutes).toISOString(),
  custom,
});

describe("staffOpenStarts", () => {
  const day = addDays(today, 20);

  it("lists the dentist's open times without notice rules, minus appointments and time off", async () => {
    const taken = await bookAt(a, day, 600, "confirmed");
    await db
      .from("time_off")
      .insert({
        clinic_id: a.staff.clinicId,
        dentist_id: a.seed.dentist.id,
        starts_at: manilaInstant(day, 780).toISOString(),
        ends_at: manilaInstant(day, 840).toISOString(),
      })
      .throwOnError();
    const q = { dentistId: a.seed.dentist.id, date: day, duration: 30 };
    const open = (await staffOpenStarts(a.staff, q, new Date())).map((d) => d.getTime());
    expect(open).toHaveLength(16 - 1 - 2);
    expect(open).not.toContain(manilaInstant(day, 600).getTime());
    expect(open).not.toContain(manilaInstant(day, 780).getTime());

    const moving = (await staffOpenStarts(a.staff, { ...q, ignoreId: taken }, new Date())).map((d) => d.getTime());
    expect(moving).toContain(manilaInstant(day, 600).getTime());
  });

  it("sees nothing of another clinic's dentist", async () => {
    expect(await staffOpenStarts(b.staff, { dentistId: a.seed.dentist.id, date: day, duration: 30 }, new Date())).toEqual([]);
  });
});

describe("moveAppointment", () => {
  const day = addDays(today, 21);

  it("moves a confirmed visit to an open time, keeps its length, and texts the patient", async () => {
    const id = await bookAt(a, day, 540, "confirmed", 60);
    await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id).throwOnError();
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 660), new Date())).toEqual({ ok: true, text: "logged" });
    const moved = await times(id);
    expect(moved.start).toEqual(manilaInstant(day, 660));
    expect(moved.end).toEqual(manilaInstant(day, 720));
    expect(moved.reminderSentAt).toBeNull();
    expect((await texts(id)).map((t) => t.kind)).toEqual(["moved"]);
  });

  it("refuses a time that is no longer open, and an overlapping custom time", async () => {
    const id = await bookAt(a, day, 900, "confirmed");
    await bookAt(a, day, 960, "confirmed");
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 960), new Date())).toEqual({
      ok: false,
      error: "That time is no longer open. Pick another.",
    });
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 960, true), new Date())).toEqual({ ok: false, error: MESSAGES.overlap });
    expect((await times(id)).start).toEqual(manilaInstant(day, 900));
    expect(await texts(id)).toEqual([]);
  });

  it("allows a custom time outside working hours", async () => {
    const id = await bookAt(a, day, 990, "confirmed");
    expect((await moveAppointment(a.staff, id, slotAt(a, day, 1110, true), new Date())).ok).toBe(true);
    expect((await times(id)).start).toEqual(manilaInstant(day, 1110));
  });

  it("refuses a custom time that has already passed", async () => {
    const id = await bookAt(a, day, 990, "confirmed");
    // Noon Manila today, so "two minutes earlier" is still today even when the suite runs just after midnight.
    const now = manilaInstant(today, 720);
    const past = { dentistId: a.seed.dentist.id, startsAt: manilaInstant(today, 718).toISOString(), custom: true };
    expect(await moveAppointment(a.staff, id, past, now)).toEqual({
      ok: false,
      error: "This time has already passed. Pick a later time.",
    });
    expect((await times(id)).start).toEqual(manilaInstant(day, 990));
  });

  it("moves only confirmed visits that have not started", async () => {
    const pending = await bookAt(a, addDays(today, 22), 540, "pending");
    expect(await moveAppointment(a.staff, pending, slotAt(a, addDays(today, 22), 600), new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    const started = await book(a, "confirmed", "past");
    expect(await moveAppointment(a.staff, started, slotAt(a, addDays(today, 22), 660), new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
  });

  it("lets no one move another clinic's visit, or move a visit to another clinic's dentist", async () => {
    const id = await bookAt(a, addDays(today, 23), 540, "confirmed");
    expect(await moveAppointment(b.staff, id, slotAt(b, addDays(today, 23), 600), new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect(await moveAppointment(a.staff, id, slotAt(b, addDays(today, 23), 600), new Date())).toEqual({
      ok: false,
      error: "Choose an active dentist.",
    });
    expect((await times(id)).start).toEqual(manilaInstant(addDays(today, 23), 540));
  });
});

describe("createAppointment", () => {
  const day = addDays(today, 24);

  async function onlyAppointmentAt(clinicId: string, minutes: number) {
    const { data } = await db
      .from("appointments")
      .select("id, status, source, procedure_names, patient:patients(first_name, mobile, consent_at)")
      .eq("clinic_id", clinicId)
      .eq("starts_at", manilaInstant(day, minutes).toISOString())
      .throwOnError();
    return data as unknown as {
      id: string;
      status: string;
      source: string;
      procedure_names: string[];
      patient: { first_name: string; mobile: string | null; consent_at: string | null };
    }[];
  }

  it("books a walk-in without a mobile at a custom time, confirmed, with no text", async () => {
    const input = {
      patient: { first: "Lolo", last: "Walk-in" },
      procedureIds: [consultation(a)],
      slot: slotAt(a, day, 1140, true),
      sendText: true,
    };
    expect(await createAppointment(a.staff, input, new Date())).toEqual({ ok: true, text: "none" });
    const [row] = await onlyAppointmentAt(a.staff.clinicId, 1140);
    expect(row).toMatchObject({
      status: "confirmed",
      source: "manual",
      procedure_names: ["Consultation"],
      patient: { first_name: "Lolo", mobile: null, consent_at: null },
    });
    expect(await texts(row.id)).toEqual([]);
  });

  it("books an existing patient at an open time and sends the confirmation only when asked", async () => {
    const texted = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 540), sendText: true };
    expect(await createAppointment(a.staff, texted, new Date())).toEqual({ ok: true, text: "logged" });
    const [first] = await onlyAppointmentAt(a.staff.clinicId, 540);
    expect((await texts(first.id)).map((t) => t.kind)).toEqual(["confirmed"]);

    const quiet = { ...texted, slot: slotAt(a, day, 600), sendText: false };
    expect(await createAppointment(a.staff, quiet, new Date())).toEqual({ ok: true, text: "none" });
    const [second] = await onlyAppointmentAt(a.staff.clinicId, 600);
    expect(await texts(second.id)).toEqual([]);
  });

  it("refuses a taken open time and an overlapping custom time", async () => {
    const input = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 540), sendText: false };
    expect(await createAppointment(a.staff, input, new Date())).toEqual({ ok: false, error: "That time is no longer open. Pick another." });
    expect(await createAppointment(a.staff, { ...input, slot: slotAt(a, day, 555, true) }, new Date())).toEqual({
      ok: false,
      error: MESSAGES.overlap,
    });
  });

  it("refuses archived procedures and bad input", async () => {
    const { data: old } = await db
      .from("procedures")
      .insert({ clinic_id: a.staff.clinicId, name: "Old", duration_minutes: 30, active: false })
      .select("id")
      .single()
      .throwOnError();
    const input = { patientId: a.seed.patient.id, procedureIds: [old.id], slot: slotAt(a, day, 720), sendText: false };
    expect((await createAppointment(a.staff, input, new Date())).ok).toBe(false);
    expect(await createAppointment(a.staff, { nonsense: true }, new Date())).toMatchObject({ ok: false });
    expect(await onlyAppointmentAt(a.staff.clinicId, 720)).toEqual([]);
  });

  it("never books with another clinic's patient, dentist, or procedures", async () => {
    const own = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 780), sendText: false };
    expect(await createAppointment(a.staff, { ...own, patientId: b.seed.patient.id }, new Date())).toEqual({
      ok: false,
      error: "That patient was deleted or can't be found. Pick another.",
    });
    expect(await createAppointment(a.staff, { ...own, procedureIds: [consultation(b)] }, new Date())).toEqual({
      ok: false,
      error: "A chosen procedure was archived. Choose again.",
    });
    expect(await createAppointment(a.staff, { ...own, slot: slotAt(b, day, 780) }, new Date())).toEqual({
      ok: false,
      error: "Choose an active dentist.",
    });
    expect(await onlyAppointmentAt(a.staff.clinicId, 780)).toEqual([]);
    expect(await onlyAppointmentAt(b.staff.clinicId, 780)).toEqual([]);
  });
});
