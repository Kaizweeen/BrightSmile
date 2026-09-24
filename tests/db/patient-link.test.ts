import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelByPatient, loadPatientView } from "@/lib/patient-link";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const today = manilaDate(new Date());
const date = addDays(today, 3);
let seed: Seed;

async function book(startMinutes: number, status: string, day = date) {
  const row = appointmentRow(
    seed,
    manilaInstant(day, startMinutes).toISOString(),
    manilaInstant(day, startMinutes + 30).toISOString(),
    status,
  );
  const { data } = await db.from("appointments").insert(row).select("id, manage_token").single().throwOnError();
  return data as { id: string; manage_token: string };
}

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("loadPatientView", () => {
  it("shows the visit with the patient's first name only", async () => {
    const a = await book(540, "pending");
    expect(await loadPatientView(a.manage_token, new Date())).toEqual({
      status: "pending",
      startsAt: manilaInstant(date, 540),
      firstName: "Ana",
      dentistName: "Dr. Seed",
      clinicName: "Seed Clinic",
      clinicMobile: "+639170000000",
      slug: seed.clinic.slug,
      cancellable: true,
    });
  });

  it("knows nothing about unknown or malformed tokens", async () => {
    expect(await loadPatientView("AAAAAAAAAAAA", new Date())).toBeNull();
    expect(await loadPatientView("x", new Date())).toBeNull();
  });
});

describe("cancelByPatient", () => {
  it("cancels a pending request, records the patient as the actor, and alerts the clinic", async () => {
    const a = await book(600, "pending");
    expect(await cancelByPatient(a.manage_token, new Date())).toBe("cancelled");

    const { data: appt } = await db.from("appointments").select("status").eq("id", a.id).single().throwOnError();
    expect(appt.status).toBe("cancelled");
    const { data: events } = await db
      .from("appointment_events")
      .select("from_status, to_status, actor")
      .eq("appointment_id", a.id)
      .eq("to_status", "cancelled")
      .throwOnError();
    expect(events).toEqual([{ from_status: "pending", to_status: "cancelled", actor: "patient" }]);
    const { data: text } = await db
      .from("sms_log")
      .select("kind, to_mobile, body")
      .eq("appointment_id", a.id)
      .single()
      .throwOnError();
    expect(text.kind).toBe("patient_cancel_alert");
    expect(text.to_mobile).toBe("+639170000000");
    expect(text.body).toMatch(/^Cancelled: Ana C\., /);

    expect(await cancelByPatient(a.manage_token, new Date())).toBe("not_allowed");
    expect((await loadPatientView(a.manage_token, new Date()))?.cancellable).toBe(false);
  });

  it("cancels a confirmed visit", async () => {
    const a = await book(660, "confirmed");
    expect(await cancelByPatient(a.manage_token, new Date())).toBe("cancelled");
  });

  it("refuses a visit that already started", async () => {
    const past = await book(540, "confirmed", addDays(today, -1));
    expect(await cancelByPatient(past.manage_token, new Date())).toBe("not_allowed");
    expect((await loadPatientView(past.manage_token, new Date()))?.cancellable).toBe(false);
  });

  it("refuses statuses the patient can't change", async () => {
    const declined = await book(720, "declined");
    expect(await cancelByPatient(declined.manage_token, new Date())).toBe("not_allowed");
  });

  it("does not find unknown tokens", async () => {
    expect(await cancelByPatient("AAAAAAAAAAAA", new Date())).toBe("not_found");
    expect(await cancelByPatient("x", new Date())).toBe("not_found");
  });
});
