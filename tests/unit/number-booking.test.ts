import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingOpen } from "@/lib/billing-data";
import { hashCode } from "@/lib/codes";
import { checkVerification, numberAppointments, numberPatients, startVerification, type Device } from "@/lib/number-booking";
import { sendSms } from "@/lib/sms/send";

// Booking flow spec 8: nothing is shown or changed for a number this phone has not verified. The fake secret-key
// client records every table and function it is asked for, so "touches nothing" is checked, not assumed. Reads
// answer fake.single (maybeSingle) or fake.list (throwOnError); writes answer one updated row.
const fake = vi.hoisted(() => ({
  single: {} as Record<string, unknown>,
  list: {} as Record<string, unknown[]>,
  tables: [] as string[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rpcAnswer: {} as Record<string, { data: unknown; error: { code: string } | null }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => {
      fake.tables.push(table);
      let writing = false;
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        gt: () => query,
        order: () => query,
        limit: () => query,
        update: () => {
          writing = true;
          return query;
        },
        maybeSingle: () => {
          const answer = { data: fake.single[table] ?? null, error: null };
          return Object.assign(Promise.resolve(answer), { throwOnError: async () => answer });
        },
        throwOnError: async () => ({ data: writing ? [{ id: "updated" }] : (fake.list[table] ?? []), error: null }),
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      fake.rpcs.push({ name, args });
      return fake.rpcAnswer[name] ?? { data: { status: "ok" }, error: null };
    },
  }),
}));
vi.mock("@/lib/billing-data", () => ({ bookingOpen: vi.fn(async () => true) }));
vi.mock("@/lib/sms/send", () => ({ sendSms: vi.fn(async () => "logged") }));
vi.mock("@/lib/notify", () => ({ alertClinic: vi.fn(async () => "push") }));

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REQUEST = "5b0d6c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const MOBILE = "+639171112222";
const now = new Date("2026-10-13T02:00:00Z");
const verified: Device = { verifiedMobiles: [MOBILE], now };
const stranger: Device = { verifiedMobiles: ["+639179999999"], now };
const stored = (booking: Record<string, unknown>) => ({
  id: REQUEST,
  mobile: MOBILE,
  code_hash: hashCode(REQUEST, "123456"),
  booking,
  attempts: 0,
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
  verified_at: null,
});

beforeEach(() => {
  vi.stubEnv("APP_SECRET", "a-test-secret-for-hashing-codes-only");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.single = { clinics: { id: CLINIC, sms_name: "Bright Dental", min_notice_minutes: 120 } };
  fake.list = {};
  fake.tables = [];
  fake.rpcs = [];
  fake.rpcAnswer = {};
  vi.mocked(bookingOpen).mockResolvedValue(true);
  vi.mocked(sendSms).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a number this phone has not verified", () => {
  it("sees no patients and no appointments, and nothing is read", async () => {
    for (const device of [stranger, { verifiedMobiles: [], now }]) {
      expect(await numberPatients("bright-dental", "0917 111 2222", device)).toEqual({ status: "unverified" });
      expect(await numberAppointments("bright-dental", "0917 111 2222", device)).toEqual({ status: "unverified" });
    }
    expect(await numberPatients("bright-dental", { mobile: MOBILE }, verified)).toEqual({ status: "unverified" });
    expect(fake.tables).toEqual([]);
  });
});

describe("startVerification", () => {
  it("refuses what is not a Philippine mobile number", async () => {
    expect(await startVerification("bright-dental", "12345", { ...verified, ip: "203.0.113.5" })).toEqual({ status: "invalid" });
    expect(fake.tables).toEqual([]);
  });

  it("goes straight on for a number this phone verified before, without a code", async () => {
    expect(await startVerification("bright-dental", "0917 111 2222", { ...verified, ip: "203.0.113.5" })).toEqual({ status: "verified", mobile: MOBILE });
    expect(fake.rpcs).toEqual([]);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("otherwise texts a code within issue_otp's limits, for the number alone", async () => {
    const outcome = await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" });
    expect(outcome).toEqual({ status: "code", requestId: expect.any(String), mobile: MOBILE });
    expect(fake.rpcs).toEqual([{ name: "issue_otp", args: expect.objectContaining({ p_mobile: MOBILE, p_ip: "203.0.113.5", p_booking: { clinicId: CLINIC, verify: true } }) }]);
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ kind: "otp", to: MOBILE }));
    fake.rpcAnswer.issue_otp = { data: { status: "limited" }, error: null };
    expect(await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" })).toEqual({ status: "limited" });
  });

  it("sends no code for a paused clinic", async () => {
    vi.mocked(bookingOpen).mockResolvedValue(false);
    expect(await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" })).toEqual({ status: "paused" });
    expect(fake.rpcs).toEqual([]);
  });
});

describe("checkVerification", () => {
  it("verifies the number with the right code", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, verify: true });
    expect(await checkVerification(REQUEST, "123456", now)).toEqual({ status: "verified", mobile: MOBILE });
  });

  it("spends an attempt on a wrong code", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, verify: true });
    expect(await checkVerification(REQUEST, "654321", now)).toEqual({ status: "wrong", attemptsLeft: 4 });
  });

  it("never takes a code sent with a booking page request", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, dentistId: "d1", startsAt: "2026-10-20T01:00:00Z", endsAt: "2026-10-20T01:30:00Z" });
    expect(await checkVerification(REQUEST, "123456", now)).toEqual({ status: "expired" });
  });
});
