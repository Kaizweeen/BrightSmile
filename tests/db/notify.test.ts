import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertClinic } from "@/lib/notify";
import { addDays, formatDate, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const start = manilaInstant(addDays(manilaDate(new Date()), 5), 600);
let seed: Seed;
let appointmentId: string;

beforeAll(async () => {
  seed = await seedClinic();
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data } = await db
    .from("appointments")
    .insert(appointmentRow(seed, start.toISOString(), end.toISOString(), "pending"))
    .select("id")
    .single()
    .throwOnError();
  appointmentId = data.id;
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

async function lastText() {
  const { data } = await db
    .from("sms_log")
    .select("kind, to_mobile, body, status")
    .eq("appointment_id", appointmentId)
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return data;
}

const alert = { clinicId: "", appointmentId: "", first: "Maria", last: "Santos", startsAt: start };

describe("alertClinic", () => {
  it("texts the clinic when push reached nobody", async () => {
    const via = await alertClinic({ ...alert, kind: "request_alert", clinicId: seed.clinic.id, appointmentId, dentist: "Dr. Seed" });
    expect(via).toBe("sms");
    expect(await lastText()).toEqual({
      kind: "request_alert",
      to_mobile: "+639170000000",
      status: "logged",
      body: `New request: Maria S., ${formatDate(start)} ${formatTime(start)} with Dr. Seed. Approve at ${process.env.APP_URL}/app/requests`,
    });
  });

  it("texts the clinic when it chose texts", async () => {
    await db.from("clinics").update({ alert_channel: "sms" }).eq("id", seed.clinic.id).throwOnError();
    const via = await alertClinic({ ...alert, kind: "patient_cancel_alert", clinicId: seed.clinic.id, appointmentId, dentist: null });
    expect(via).toBe("sms");
    expect(await lastText()).toMatchObject({
      kind: "patient_cancel_alert",
      body: `Cancelled: Maria S., ${formatDate(start)}, ${formatTime(start)}.`,
    });
  });

  it("never throws, even for a clinic that does not exist", async () => {
    const via = await alertClinic({
      ...alert,
      kind: "request_alert",
      clinicId: "00000000-0000-0000-0000-000000000000",
      appointmentId,
      dentist: null,
    });
    expect(via).toBe("failed");
  });
});
