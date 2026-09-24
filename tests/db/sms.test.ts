import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sendSms } from "@/lib/sms/send";
import { adminDb, deleteClinic, seedClinic, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  process.env.SMS_MODE = "log";
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

async function lastLog() {
  const { data } = await db
    .from("sms_log")
    .select("kind, to_mobile, body, credits, status, error, provider_message_id")
    .eq("clinic_id", seed.clinic.id)
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return data;
}

describe("sendSms", () => {
  it("logs a text in log mode", async () => {
    const status = await sendSms({
      kind: "patient_cancel_alert",
      to: "+639170000000",
      clinicId: seed.clinic.id,
      vars: { first: "Ana", lastInitial: "C", date: "Thu Sep 24", time: "10:00 AM" },
    });
    expect(status).toBe("logged");
    expect(await lastLog()).toEqual({
      kind: "patient_cancel_alert",
      to_mobile: "+639170000000",
      body: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      credits: 1,
      status: "logged",
      error: null,
      provider_message_id: null,
    });
  });

  it("keeps the real code in log mode", async () => {
    await sendSms({ kind: "otp", to: "+639181112222", clinicId: seed.clinic.id, vars: { clinic: "Seed Clinic", code: "123456" } });
    const row = await lastLog();
    expect(row.body).toBe("Your code for Seed Clinic is 123456. It expires in 5 minutes. Don't share it with anyone.");
    expect(row.credits).toBe(2);
  });

  it("masks the code, records the failure, and does not throw when live sending can't work", async () => {
    const saved = { mode: process.env.SMS_MODE, key: process.env.SEMAPHORE_API_KEY };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.SMS_MODE = "live";
    process.env.SEMAPHORE_API_KEY = "";
    try {
      const status = await sendSms({ kind: "otp", to: "+639181112222", clinicId: seed.clinic.id, vars: { clinic: "Seed Clinic", code: "654321" } });
      expect(status).toBe("failed");
      const row = await lastLog();
      expect(row.body).toContain("******");
      expect(row.body).not.toContain("654321");
      expect(row).toMatchObject({ status: "failed", credits: 0, error: "SEMAPHORE_API_KEY is not set" });
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("semaphore.co"))).toBe(false);
    } finally {
      restoreEnv("SMS_MODE", saved.mode);
      restoreEnv("SEMAPHORE_API_KEY", saved.key);
      fetchSpy.mockRestore();
    }
  });
});
