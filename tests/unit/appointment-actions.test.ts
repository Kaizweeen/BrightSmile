import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeStatus, rowText, type Row } from "@/lib/appointment-actions";
import { sendSms } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

vi.mock("@/lib/sms/send", () => ({ sendSms: vi.fn(async () => "logged") }));

const row: Row = {
  id: "a1",
  status: "confirmed",
  starts_at: "2026-10-05T02:00:00.000Z",
  ends_at: "2026-10-05T02:30:00.000Z",
  dentist_id: "d1",
  manage_token: "AbCdEfGhIjKl",
  patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
  dentist: { sms_name: "Dr. Reyes" },
  branch: { sms_name: "Makati" },
  clinic: { sms_name: "Bright Dental", slug: "bright-dental" },
};
const start = new Date(row.starts_at);

describe("rowText", () => {
  it("names the appointment's branch after the clinic once the clinic has 2 or more active branches", () => {
    expect(rowText(row, "confirmed", null, start, 1).clinicSmsName).toBe("Bright Dental");
    expect(rowText(row, "confirmed", null, start, 2).clinicSmsName).toBe("Bright Dental Makati");
  });

  it("keeps the reason and has no one to text for a deleted patient", () => {
    const deleted = { ...row, patient: { ...row.patient, anonymized_at: "2026-09-20T00:00:00Z" } };
    expect(rowText(deleted, "cancelled", null, start, 2, "Dentist unavailable")).toMatchObject({ mobile: null, reason: "Dentist unavailable" });
  });
});

// A chainable Postgrest-like fake: every method returns the same object, which is itself awaitable (some callers,
// like showsDentist and activeBranchNames, await the builder directly instead of calling a terminal method).
function chain(result: unknown) {
  const c: Record<string, unknown> = {
    select: () => c,
    eq: () => c,
    order: () => c,
    limit: () => c,
    in: () => c,
    gt: () => c,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };
  return c;
}

describe("changeStatus and the approval race", () => {
  // Status stays "pending" on both reads (change_booking always sends a changed request back to pending), so the
  // set_appointment_status compare-and-set (p_from "pending") succeeds even though the patient's own change, landing
  // between the two reads, moved the time and the dentist underneath it.
  const stale: Row = {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    status: "pending",
    starts_at: "2026-10-05T02:00:00.000Z",
    ends_at: "2026-10-05T02:30:00.000Z",
    dentist_id: "d1",
    manage_token: "AbCdEfGhIjKl",
    patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
    dentist: { sms_name: "Dr. Reyes" },
    branch: { sms_name: "Makati" },
    clinic: { sms_name: "Bright Dental", slug: "bright-dental" },
  };
  const fresh: Row = { ...stale, starts_at: "2026-10-06T03:00:00.000Z", dentist_id: "d2", dentist: { sms_name: "Dr. Cruz" } };

  /** appointments answers rows[0] on the first read and rows[1] (or the last) on every read after. */
  function staffOf(rows: Row[]): Staff {
    let call = 0;
    const db = {
      from: (table: string) => {
        if (table === "appointments") return chain({ data: rows[Math.min(call++, rows.length - 1)], error: null });
        if (table === "dentists") return chain({ count: 2, error: null }); // 2 active dentists: texts name them.
        if (table === "branches") return chain({ data: [{ sms_name: "Makati" }], error: null });
        throw new Error(`unexpected table ${table}`);
      },
      rpc: async () => ({ data: true, error: null }),
    };
    return { db, userId: "u1", clinicId: "c1" } as unknown as Staff;
  }

  beforeEach(() => {
    vi.mocked(sendSms).mockClear();
  });

  it("texts the time and dentist the clinic just approved, not one a patient's change replaced first", async () => {
    const staff = staffOf([stale, fresh]);
    const result = await changeStatus(staff, stale.id, "confirmed", "", new Date("2026-09-01T00:00:00Z"));
    expect(result).toEqual({ ok: true, text: "logged" });
    const sent = vi.mocked(sendSms).mock.calls[0][0];
    expect(sent.vars?.date).toBe(formatDate(new Date(fresh.starts_at)));
    expect(sent.vars?.time).toBe(formatTime(new Date(fresh.starts_at)));
    expect(sent.vars?.dentist).toBe("Dr. Cruz");
  });

  it("texts the decline for the time the clinic actually declined, not the stale one it first read", async () => {
    const staff = staffOf([stale, fresh]);
    await changeStatus(staff, stale.id, "declined", "", new Date("2026-09-01T00:00:00Z"));
    const sent = vi.mocked(sendSms).mock.calls[0][0];
    expect(sent.vars?.date).toBe(formatDate(new Date(fresh.starts_at)));
    expect(sent.vars?.time).toBe(formatTime(new Date(fresh.starts_at)));
  });
});
