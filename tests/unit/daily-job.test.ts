import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenewalRow, WeeklyRow } from "@/lib/daily";
import { sendRenewalNotices, sendWeeklyReports } from "@/lib/daily-job";
import { alertPlanEnding } from "@/lib/notify";
import { sendPush } from "@/lib/push";
import type { WeekStatsRow } from "@/lib/reports";
import { manilaInstant } from "@/lib/time";

type Answer<T> = { data: T | null; error: { message: string } | null };

// The claims' compare-and-set runs in SQL; here the client answers each clinic's claim, and its weekly counts, as the
// test says. clinic_billing reads answer db.rows, clinics reads answer db.clinics.
const db = vi.hoisted(() => ({
  rows: [] as RenewalRow[],
  clinics: [] as WeeklyRow[],
  claims: new Map<string, Answer<unknown[]>>(),
  stats: new Map<string, Answer<WeekStatsRow[]>>(),
  counted: [] as unknown[],
}));

vi.mock("@/lib/notify", () => ({ alertPlanEnding: vi.fn() }));
vi.mock("@/lib/push", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/push")>()), sendPush: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => ({
      select: async () => ({ data: table === "clinics" ? db.clinics : db.rows, error: null }),
      update: () => ({ eq: (_column: string, clinicId: string) => ({ or: () => ({ select: async () => db.claims.get(clinicId) }) }) }),
    }),
    rpc: async (_name: string, args: { p_clinic_id: string }) => {
      db.counted.push(args);
      return db.stats.get(args.p_clinic_id) ?? { data: [], error: null };
    },
  }),
}));

const alert = vi.mocked(alertPlanEnding);
const push = vi.mocked(sendPush);
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

describe("sendWeeklyReports", () => {
  const monday = manilaInstant("2026-10-05", 9 * 60); // every clinic's trial runs to Oct 9 (db.rows)
  const week = (dentist_id: string, completed: number, no_show: number): WeekStatsRow => ({
    week_start: "2026-09-28",
    dentist_id,
    completed,
    no_show,
    cancelled: 0,
    declined: 0,
    expired: 0,
    unmarked: 0,
    upcoming: 0,
    online: completed + no_show,
    manual: 0,
  });

  beforeEach(() => {
    db.clinics = ["c1", "c2", "c3"].map((id) => ({ id, name: `Clinic ${id}`, created_at: "2026-09-01T00:00:00Z", weekly_report_for: null }));
    db.stats.clear();
    db.counted = [];
    push.mockReset();
  });

  it("pushes last week's counts to each clinic it claims, and skips a week without appointments", async () => {
    db.stats.set("c1", { data: [week("d1", 9, 3), week("d2", 2, 0)], error: null }).set("c2", { data: [week("d1", 4, 0)], error: null });
    db.claims.set("c1", claimed("c1")).set("c2", { data: [], error: null });
    push.mockResolvedValue(1);
    expect(await sendWeeklyReports(monday)).toBe(1);
    // c2 was claimed by another run; c3 had no appointments last week, so it was never claimed.
    expect(push.mock.calls).toEqual([
      ["c1", { title: "Last week at Clinic c1", body: "11 visits, 3 no-shows (21%). Tap to see Reports.", url: "/app/reports", type: "weekly" }],
    ]);
    expect(db.counted).toContainEqual({ p_clinic_id: "c1", p_from: "2026-09-28", p_weeks: 1 });
  });

  it("does nothing on other days", async () => {
    expect(await sendWeeklyReports(manilaInstant("2026-10-06", 9 * 60))).toBe(0);
    expect(db.counted).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("tries every clinic, then fails the run when a count or a claim fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.stats
      .set("c1", { data: null, error: { message: "connection reset" } })
      .set("c2", { data: [week("d1", 1, 0)], error: null })
      .set("c3", { data: [week("d1", 2, 1)], error: null });
    db.claims.set("c2", { data: null, error: { message: "timeout" } }).set("c3", claimed("c3"));
    push.mockResolvedValue(0); // c3 has no device with push on: not a failure, and not counted
    await expect(sendWeeklyReports(monday)).rejects.toThrow("2 weekly summaries failed, 0 sent (clinics c1, c2)");
    expect(push.mock.calls.map(([clinicId]) => clinicId)).toEqual(["c3"]);
  });

  it("counts a clinic as failed, not sent, when its subscriptions cannot even be read (sendPush below 0)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.stats.set("c1", { data: [week("d1", 5, 1)], error: null }).set("c2", { data: [week("d1", 1, 0)], error: null }).set("c3", { data: [], error: null });
    db.claims.set("c1", claimed("c1")).set("c2", claimed("c2"));
    push.mockResolvedValueOnce(-1).mockResolvedValueOnce(2);
    await expect(sendWeeklyReports(monday)).rejects.toThrow("1 weekly summaries failed, 1 sent (clinics c1)");
    // c3 had no appointments last week, so it was never claimed or pushed.
    expect(push.mock.calls.map(([clinicId]) => clinicId)).toEqual(["c1", "c2"]);
  });
});
