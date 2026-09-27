import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import type { PublicClinic } from "@/lib/booking-input";
import { hashCode } from "@/lib/codes";
import { alertClinic } from "@/lib/notify";
import {
  bookForNumber,
  cancelForNumber,
  changeForNumber,
  checkVerification,
  numberAppointments,
  numberPatients,
  startVerification,
  type Device,
} from "@/lib/number-booking";
import { cancelByPatient } from "@/lib/patient-link";
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

vi.mock("@/lib/availability", () => ({ loadClinic: vi.fn(), dayOpenStarts: vi.fn() }));
vi.mock("@/lib/patient-link", () => ({ cancelByPatient: vi.fn(async () => "cancelled") }));

const BRANCH = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const DENTIST = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
const PROCEDURE = "9e8d7c6b-5a49-4382-a716-151413121110";
const PATIENT = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const VISIT = "2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e";
const START = "2026-10-20T01:00:00.000Z"; // Tuesday 9:00 AM Manila, a week ahead
const clinic: PublicClinic = {
  id: CLINIC,
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: { id: BRANCH, name: "Main", address: "Makati", mapsUrl: null },
  branches: [{ id: BRANCH, name: "Main", address: "Makati", mapsUrl: null }],
  dentists: [{ id: DENTIST, name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: [[], [], [{ start: 540, end: 1020 }], [], [], [], []] }],
  procedures: [{ id: PROCEDURE, name: "Consultation", minutes: 30 }],
};
const request = { mobile: "0917 111 2222", branchId: BRANCH, dentistId: DENTIST, procedureIds: [PROCEDURE], startsAt: START, patientId: PATIENT };
const owned = (startsAt: string) => ({
  id: VISIT,
  status: "confirmed",
  starts_at: startsAt,
  ends_at: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
  dentist_id: DENTIST,
  branch_id: BRANCH,
  patient_id: PATIENT,
  procedure_names: ["Consultation"],
  manage_token: "AbCdEfGhIjKl",
});
const called = (name: string) => fake.rpcs.filter((r) => r.name === name).map((r) => r.args);

describe("booking, changing, and cancelling by number", () => {
  beforeEach(() => {
    vi.mocked(loadClinic).mockReset().mockResolvedValue(clinic);
    vi.mocked(dayOpenStarts).mockReset().mockResolvedValue([new Date(START)]);
    vi.mocked(alertClinic).mockClear();
    vi.mocked(cancelByPatient).mockClear();
    fake.single.patients = { id: PATIENT, first_name: "Ana", last_name: "Cruz" };
  });

  it("answer unverified for a number this phone has not verified, and read nothing", async () => {
    expect(await bookForNumber("bright-dental", request, stranger)).toEqual({ status: "unverified" });
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, stranger)).toEqual({ status: "unverified" });
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, stranger)).toBe("unverified");
    expect(fake.tables).toEqual([]);
    expect(loadClinic).not.toHaveBeenCalled();
  });

  it("book one of the number's patients at the chosen branch after checking the time again, and alert the clinic", async () => {
    fake.rpcAnswer.create_booking = { data: VISIT, error: null };
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "sent", token: expect.any(String) });
    expect(loadClinic).toHaveBeenCalledWith({ slug: "bright-dental" }, BRANCH);
    expect(called("create_booking")).toEqual([
      expect.objectContaining({
        p_branch_id: BRANCH,
        p_patient_id: PATIENT,
        p_mobile: MOBILE,
        p_procedure_names: ["Consultation"],
        p_starts_at: START,
        p_ends_at: "2026-10-20T01:30:00.000Z",
        p_status: "pending",
        p_form: null,
      }),
    ]);
    expect(alertClinic).toHaveBeenCalledWith(expect.objectContaining({ kind: "request_alert", appointmentId: VISIT, first: "Ana", last: "Cruz" }));
  });

  it("book someone new with the form and the verified number", async () => {
    const form = { last: "Cruz", first: "Leo", birthday: "1990-05-17", sex: "male", address: "Makati", agree: true, signature: "Leo Cruz" };
    expect(await bookForNumber("bright-dental", { ...request, patientId: undefined, form }, verified)).toMatchObject({ status: "sent" });
    expect(called("create_booking")).toEqual([
      expect.objectContaining({
        p_patient_id: null,
        p_first_name: "Leo",
        p_last_name: "Cruz",
        p_mobile: MOBILE,
        p_birthday: "1990-05-17",
        p_form: expect.objectContaining({ sex: "male", address: "Makati", waiver_name: "Leo Cruz", waiver_version: "2026-09-26" }),
      }),
    ]);
  });

  it("refuse a patient of another number, a form with problems, and a time that is no longer open", async () => {
    delete fake.single.patients;
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "invalid", errors: { patient: "Choose who the visit is for again." } });
    expect(await bookForNumber("bright-dental", { ...request, patientId: undefined, form: {} }, verified)).toMatchObject({
      status: "invalid",
      errors: { first: expect.any(String), agree: expect.any(String) },
    });
    fake.single.patients = { id: PATIENT, first_name: "Ana", last_name: "Cruz" };
    vi.mocked(dayOpenStarts).mockResolvedValue([new Date("2026-10-20T02:00:00.000Z")]);
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "taken", starts: ["2026-10-20T02:00:00.000Z"] });
    expect(called("create_booking")).toEqual([]);
  });

  it("take no booking and no change while the clinic is paused", async () => {
    vi.mocked(bookingOpen).mockResolvedValue(false);
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "paused" });
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "paused" });
    expect(fake.rpcs).toEqual([]);
  });

  it("send a change back to the clinic for approval, counting the appointment's own time as free", async () => {
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    fake.rpcAnswer.change_booking = { data: true, error: null };
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "sent" });
    expect(loadClinic).toHaveBeenCalledWith({ id: CLINIC }, BRANCH);
    expect(vi.mocked(dayOpenStarts).mock.calls[0][5]).toBe(VISIT);
    expect(called("change_booking")).toEqual([
      expect.objectContaining({ p_clinic_id: CLINIC, p_id: VISIT, p_mobile: MOBILE, p_starts_at: START, p_patient_id: PATIENT, p_form: null }),
    ]);
    expect(alertClinic).toHaveBeenCalledWith(expect.objectContaining({ kind: "change_alert", appointmentId: VISIT }));
  });

  it("do not change an appointment of another number, one within the minimum notice, or one that did not change", async () => {
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "gone" });
    fake.single.appointments = owned(new Date(now.getTime() + 60 * 60_000).toISOString());
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "call_clinic" });
    fake.single.appointments = owned(START);
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "unchanged" });
    expect(fake.rpcs).toEqual([]);
  });

  it("cancel only the number's own appointment, exactly as the patient link does", async () => {
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, verified)).toBe("gone");
    expect(cancelByPatient).not.toHaveBeenCalled();
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, verified)).toBe("cancelled");
    expect(cancelByPatient).toHaveBeenCalledWith("AbCdEfGhIjKl", now);
  });
});
