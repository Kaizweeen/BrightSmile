import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenewalRow } from "@/lib/daily";
import { sendRenewalNotices } from "@/lib/daily-job";
import { alertPlanEnding } from "@/lib/notify";
import { manilaInstant } from "@/lib/time";

// The claim's compare-and-set itself runs in SQL; here the client answers each clinic's claim as the test says.
const db = vi.hoisted(() => ({
  rows: [] as RenewalRow[],
  claims: new Map<string, { data: { clinic_id: string }[] | null; error: { message: string } | null }>(),
}));

vi.mock("@/lib/notify", () => ({ alertPlanEnding: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: () => ({
      select: async () => ({ data: db.rows, error: null }),
      update: () => ({ eq: (_column: string, clinicId: string) => ({ or: () => ({ select: async () => db.claims.get(clinicId) }) }) }),
    }),
  }),
}));

const alert = vi.mocked(alertPlanEnding);
const now = manilaInstant("2026-10-07", 9 * 60);
const ending = (clinic_id: string): RenewalRow => ({
  clinic_id,
  trial_ends_at: manilaInstant("2026-10-09", 600).toISOString(), // 2 days away: due a heads-up
  paid_through: null,
  renewal_notice_for: null,
});
const claimed = (clinicId: string) => ({ data: [{ clinic_id: clinicId }], error: null });

beforeEach(() => {
  db.rows = ["c1", "c2", "c3"].map(ending);
  db.claims.clear();
  alert.mockReset();
  vi.restoreAllMocks();
});

describe("sendRenewalNotices", () => {
  it("alerts each clinic it claims and counts the heads-ups sent", async () => {
    db.claims.set("c1", claimed("c1")).set("c2", { data: [], error: null }).set("c3", claimed("c3"));
    alert.mockResolvedValueOnce("push").mockResolvedValueOnce("sms");
    expect(await sendRenewalNotices(now)).toBe(2);
    expect(alert.mock.calls.map(([clinicId]) => clinicId)).toEqual(["c1", "c3"]); // c2 was claimed by another run
  });

  it("tries every clinic, then fails the run when a claim errors or an alert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.claims.set("c1", { data: null, error: { message: "connection reset" } }).set("c2", claimed("c2")).set("c3", claimed("c3"));
    alert.mockResolvedValueOnce("failed").mockResolvedValueOnce("sms");
    await expect(sendRenewalNotices(now)).rejects.toThrow(/^2 heads-ups failed, 1 sent \(clinics [0-9a-f-]+, [0-9a-f-]+\)$/);
    expect(alert.mock.calls.map(([clinicId]) => clinicId)).toEqual(["c2", "c3"]);
  });
});
