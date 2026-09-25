import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingOpen } from "@/lib/billing-data";
import { requestBooking, resendCode, verifyCode } from "@/lib/booking";
import { hashCode } from "@/lib/codes";
import { sendSms } from "@/lib/sms/send";

// Billing spec 7.5: a lapsed clinic's booking actions answer "paused" before any side effect. Every write, rpc,
// text, and alert below throws, and the booking functions turn a throw into "unavailable", so "paused" proves
// none of them ran. Reading the stored code request is allowed: it changes nothing.
const fake = vi.hoisted(() => ({
  clinicId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  requestId: "5b0d6c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e",
  stored: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/billing-data", () => ({ bookingOpen: vi.fn(async () => false) }));
vi.mock("@/lib/availability", () => ({
  loadClinic: vi.fn(async () => ({ id: fake.clinicId, name: "Bright Dental", smsName: "Bright Dental", dentists: [], procedures: [] })),
  dayOpenStarts: vi.fn(async () => {
    throw new Error("open times read before the pause check");
  }),
}));
vi.mock("@/lib/supabase/admin", () => {
  const refuse = (what: string) => () => {
    throw new Error(`${what} before the pause check`);
  };
  return {
    adminClient: () => ({
      rpc: refuse("rpc"),
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fake.stored, error: null }) }) }),
        insert: refuse("insert"),
        update: refuse("update"),
        upsert: refuse("upsert"),
        delete: refuse("delete"),
      }),
    }),
  };
});
vi.mock("@/lib/sms/send", () => ({
  sendSms: vi.fn(async () => {
    throw new Error("text sent before the pause check");
  }),
}));
vi.mock("@/lib/notify", () => ({
  alertClinic: vi.fn(async () => {
    throw new Error("clinic alerted before the pause check");
  }),
}));

const now = new Date("2026-10-13T02:00:00Z");
const ctx = { ip: "203.0.113.5", now };
const booking = { clinicId: fake.clinicId, dentistId: "d1", startsAt: "2026-10-20T01:00:00Z", endsAt: "2026-10-20T01:30:00Z" };

beforeEach(() => {
  vi.stubEnv("APP_SECRET", "a-test-secret-for-hashing-codes-only");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.stored = {
    id: fake.requestId,
    mobile: "+639171112222",
    code_hash: hashCode(fake.requestId, "123456"),
    booking,
    attempts: 0,
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
    verified_at: null,
  };
  vi.mocked(bookingOpen).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a paused clinic's booking actions", () => {
  it("refuse a new request, even from a verified mobile", async () => {
    for (const verifiedMobiles of [[], ["+639171112222"]]) {
      expect(await requestBooking("bright-dental", { mobile: "09171112222" }, { ...ctx, verifiedMobiles })).toEqual({ status: "paused" });
    }
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuse to send a new code", async () => {
    expect(await resendCode(fake.requestId, ctx)).toEqual({ status: "paused" });
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuse a right code without spending an attempt, using the code, or remembering the mobile", async () => {
    expect(await verifyCode(fake.requestId, "123456", now)).toEqual({ outcome: { status: "paused" }, verifiedMobile: null });
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
  });
});
