import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkCredit, cleanup, expirePending, sendReminders } from "@/lib/daily-job";
import { addDays, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
process.env.SMS_LOW_CREDIT_THRESHOLD = "500";
const db = adminDb();
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const today = manilaDate(now);
const yesterday = manilaInstant(addDays(today, -1), 600).toISOString();
const randomMobile = (prefix: string) => `+63${prefix}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
let seed: Seed;

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

/** A 30 minute visit for the seed clinic's patient and dentist. */
async function visit(start: Date, status: string, extra: Record<string, unknown> = {}) {
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data } = await db
    .from("appointments")
    .insert({ ...appointmentRow(seed, start.toISOString(), end.toISOString(), status), ...extra })
    .select("id, manage_token")
    .single()
    .throwOnError();
  return data as { id: string; manage_token: string };
}

async function textsFor(appointmentId: string) {
  const { data } = await db.from("sms_log").select("kind, to_mobile, body").eq("appointment_id", appointmentId).throwOnError();
  return data;
}

describe("sendReminders", () => {
  it("texts tomorrow's confirmed visits once, even when the job runs twice", async () => {
    const start = manilaInstant(addDays(today, 1), 600);
    const due = await visit(start, "confirmed", { confirmed_at: yesterday });
    const confirmedToday = await visit(manilaInstant(addDays(today, 1), 720), "confirmed", { confirmed_at: now.toISOString() });

    await sendReminders(now);
    await sendReminders(now);

    expect(await textsFor(due.id)).toEqual([
      {
        kind: "reminder",
        to_mobile: seed.patient.mobile,
        body: `Seed Clinic: Reminder, Ana's visit is tomorrow at ${formatTime(start)}. Can't come? Cancel: ${process.env.APP_URL}/a/${due.manage_token}`,
      },
    ]);
    expect(await textsFor(confirmedToday.id)).toEqual([]);
    const { data } = await db.from("appointments").select("reminder_sent_at").eq("id", due.id).single().throwOnError();
    expect(data.reminder_sent_at).not.toBeNull();
  });

  it("names the dentist once the clinic has 2 active dentists", async () => {
    const { data: second } = await db
      .from("dentists")
      .insert({ clinic_id: seed.clinic.id, name: "Dr. Two", sms_name: "Dr. Two" })
      .select("id")
      .single()
      .throwOnError();
    const start = manilaInstant(addDays(today, 1), 840);
    const due = await visit(start, "confirmed", { confirmed_at: yesterday });

    await sendReminders(now);

    const [text] = await textsFor(due.id);
    expect(text.body).toContain(`tomorrow at ${formatTime(start)} with Dr. Seed. Can't come?`);
    await db.from("dentists").update({ active: false }).eq("id", second.id).throwOnError();
  });
});

describe("expirePending", () => {
  it("expires pending requests whose time has passed, with an event", async () => {
    const past = await visit(manilaInstant(addDays(today, -1), 600), "pending");
    expect(await expirePending()).toBeGreaterThanOrEqual(1);
    const { data: row } = await db.from("appointments").select("status").eq("id", past.id).single().throwOnError();
    expect(row.status).toBe("expired");
    const { data: events } = await db.from("appointment_events").select("from_status, to_status, actor").eq("appointment_id", past.id).throwOnError();
    expect(events).toEqual([{ from_status: "pending", to_status: "expired", actor: "system" }]);
    expect(await expirePending()).toBeGreaterThanOrEqual(0);
    const { data: again } = await db.from("appointment_events").select("id").eq("appointment_id", past.id).throwOnError();
    expect(again).toHaveLength(1);
  });
});

describe("cleanup", () => {
  it("deletes codes after 24 hours and wipes text bodies after 90 days", async () => {
    const mobile = randomMobile("917");
    const code = (created: Date) => ({
      id: randomUUID(),
      mobile,
      ip: "203.0.113.9",
      code_hash: "test",
      booking: {},
      created_at: created.toISOString(),
      expires_at: created.toISOString(),
    });
    await db.from("otp_requests").insert([code(new Date(now.getTime() - 25 * 60 * 60 * 1000)), code(now)]).throwOnError();
    const text = (created: Date) => ({
      clinic_id: seed.clinic.id,
      to_mobile: mobile,
      kind: "confirmed",
      body: "old text",
      credits: 1,
      status: "logged",
      created_at: created.toISOString(),
    });
    await db.from("sms_log").insert([text(new Date(now.getTime() - 91 * DAY)), text(now)]).throwOnError();

    const result = await cleanup(now);

    expect(result.codes).toBeGreaterThanOrEqual(1);
    expect(result.bodies).toBeGreaterThanOrEqual(1);
    const { data: codes } = await db.from("otp_requests").select("id").eq("mobile", mobile).throwOnError();
    expect(codes).toHaveLength(1);
    const { data: texts } = await db.from("sms_log").select("body, credits").eq("to_mobile", mobile).order("created_at").throwOnError();
    expect(texts).toEqual([
      { body: null, credits: 1 },
      { body: "old text", credits: 1 },
    ]);
    await db.from("otp_requests").delete().eq("mobile", mobile).throwOnError();
  });
});

describe("checkCredit", () => {
  const operator = randomMobile("918");
  const saved = process.env.OPERATOR_MOBILE;

  afterAll(async () => {
    if (saved === undefined) delete process.env.OPERATOR_MOBILE;
    else process.env.OPERATOR_MOBILE = saved;
    await db.from("sms_log").delete().eq("to_mobile", operator).throwOnError();
  });

  it("does nothing in log mode", async () => {
    expect(await checkCredit(now, async () => 0, "log")).toEqual({ status: "skipped", balance: null });
  });

  it("texts the operator once per 20 hours when credits run low", async () => {
    process.env.OPERATOR_MOBILE = operator;
    const low = async () => 12;
    expect(await checkCredit(now, low, "live")).toEqual({ status: "texted", balance: 12 });
    expect(await checkCredit(now, low, "live")).toEqual({ status: "recent", balance: 12 });
    const { data } = await db.from("sms_log").select("kind, status, body").eq("to_mobile", operator).throwOnError();
    expect(data).toEqual([
      { kind: "low_credit", status: "logged", body: "BrightSmile: Semaphore balance is 12 credits. Top up before reminders fail." },
    ]);
  });

  it("stays quiet above the threshold and reports a balance it can't read", async () => {
    expect(await checkCredit(now, async () => 5000, "live")).toEqual({ status: "ok", balance: 5000 });
    expect(await checkCredit(now, async () => null, "live")).toEqual({ status: "unknown", balance: null });
  });
});
