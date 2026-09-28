import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveBranch, saveBranch, saveProfile, setBranchActive } from "@/lib/clinic-settings";
import type { Staff } from "@/lib/supabase/server";

// Settings > Branches through the owner's client (booking flow spec 4). The fake client answers each table from the
// rows below and records every write with its filters, so "saves nothing" is checked, not assumed.
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const MAIN = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const PASIG = "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03";
const CUBAO = "9f4a1b32-5d7e-4a0c-b3f6-4e8b0c2a7d14";

type Row = { id: string; name: string; sms_name: string; address: string; maps_url: string | null; active: boolean; sort: number };
type Write = { table: string; kind: "insert" | "update"; values: Record<string, unknown>; filters: [string, unknown][] };

const fake = {
  clinicSmsName: "Bright Dental",
  branches: [] as Row[],
  updateError: null as { code: string; message: string } | null,
  writes: [] as Write[],
};

function staff(): Staff {
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let writing = false;
      const answer = () => {
        if (writing) return { data: [{ id: "row" }], error: fake.updateError };
        if (table === "clinics") return { data: { sms_name: fake.clinicSmsName }, error: null };
        const onlyActive = filters.some(([column, value]) => column === "active" && value === true);
        return { data: onlyActive ? fake.branches.filter((b) => b.active) : fake.branches, error: null };
      };
      const write = (kind: Write["kind"]) => (values: Record<string, unknown>) => {
        writing = true;
        fake.writes.push({ table, kind, values, filters });
        return chain;
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        single: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        insert: write("insert"),
        update: write("update"),
        throwOnError: async () => {
          const result = answer();
          if (result.error) throw result.error;
          return result;
        },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, userId: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", clinicId: CLINIC } as unknown as Staff;
}

const main = (over: Partial<Row> = {}): Row => ({ id: MAIN, name: "Main", sms_name: "Main", address: "12 Rizal St, Makati", maps_url: null, active: true, sort: 0, ...over });
const pasig = (over: Partial<Row> = {}): Row => ({ id: PASIG, name: "Pasig", sms_name: "Pasig", address: "5 Ortigas Ave, Pasig", maps_url: null, active: true, sort: 1, ...over });
const branch = { name: "Pasig", smsName: "Pasig", address: "5 Ortigas Ave, Pasig", mapsUrl: "" };
const profile = { name: "Bright Smile Dental", smsName: "Bright Smile Dental", slug: "bright-smile", mobile: "0917 123 4567", address: "Makati", mapsUrl: "" };
const FITS = "Use 1 to 6 characters, so the clinic and branch names fit in a text together.";

beforeEach(() => {
  fake.clinicSmsName = "Bright Dental";
  fake.branches = [main()];
  fake.updateError = null;
  fake.writes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveBranch", () => {
  it("adds a branch last and active once its short name fits beside the clinic's text name", async () => {
    expect(await saveBranch(staff(), null, branch)).toEqual({ ok: true });
    expect(fake.writes).toEqual([
      { table: "branches", kind: "insert", values: { clinic_id: CLINIC, name: "Pasig", sms_name: "Pasig", address: "5 Ortigas Ave, Pasig", maps_url: null, sort: 1 }, filters: [] },
    ]);
  });

  it("refuses a second active branch whose short name would push the pair past 20 characters", async () => {
    expect(await saveBranch(staff(), null, { ...branch, smsName: "Quezon City" })).toEqual({ ok: false, field: "smsName", error: FITS });
    expect(fake.writes).toEqual([]);
  });

  it("checks the first branch too when a second becomes active, and names it", async () => {
    fake.branches = [main({ sms_name: "Main Branch" })];
    expect(await saveBranch(staff(), null, branch)).toEqual({ ok: false, error: `Main: ${FITS}` });
    expect(fake.writes).toEqual([]);
  });

  it("lets a clinic's only active branch keep a longer short name, since texts name no branch yet", async () => {
    expect(await saveBranch(staff(), MAIN, { ...branch, name: "Main", smsName: "Main Branch Office" })).toEqual({ ok: true });
    expect(fake.writes).toEqual([
      {
        table: "branches",
        kind: "update",
        values: { name: "Main", sms_name: "Main Branch Office", address: "5 Ortigas Ave, Pasig", maps_url: null },
        filters: [
          ["id", MAIN],
          ["clinic_id", CLINIC],
        ],
      },
    ]);
  });

  it("refuses a branch this clinic does not have, or an id that is not one, before writing", async () => {
    expect(await saveBranch(staff(), PASIG, branch)).toEqual({ ok: false, error: "That item no longer exists. Reload the page." });
    expect(await saveBranch(staff(), "not-an-id", branch)).toMatchObject({ ok: false });
    expect(fake.writes).toEqual([]);
  });
});

describe("setBranchActive", () => {
  it("says in words that the last active branch stays, as the database refuses it", async () => {
    fake.updateError = { code: "BSLAB", message: "a clinic keeps at least one active branch" };
    expect(await setBranchActive(staff(), MAIN, false)).toEqual({ ok: false, error: "Keep at least one active branch, or patients can't book." });
  });

  it("checks every active branch's short name before a second one opens again", async () => {
    fake.branches = [main(), pasig({ sms_name: "Pasig City", active: false })];
    expect(await setBranchActive(staff(), PASIG, true)).toEqual({ ok: false, error: `Pasig: ${FITS}` });
    expect(fake.writes).toEqual([]);
    fake.branches = [main(), pasig({ active: false })];
    expect(await setBranchActive(staff(), PASIG, true)).toEqual({ ok: true });
    expect(fake.writes.map((w) => w.values)).toEqual([{ active: true }]);
  });
});

describe("moveBranch", () => {
  it("moves a branch one place and numbers the order again", async () => {
    // Main and Pasig share sort 0, as the backfill left every first branch.
    fake.branches = [main(), pasig({ sort: 0 }), { ...pasig(), id: CUBAO, name: "Cubao", sms_name: "Cubao", sort: 1 }];
    expect(await moveBranch(staff(), CUBAO, "up")).toEqual({ ok: true });
    // Now Main, Cubao, Pasig: only Pasig's number changes.
    expect(fake.writes.map((w) => [w.filters[0][1], w.values.sort])).toEqual([[PASIG, 2]]);
  });

  it("changes nothing past either end", async () => {
    expect(await moveBranch(staff(), MAIN, "up")).toEqual({ ok: true });
    expect(await moveBranch(staff(), MAIN, "down")).toEqual({ ok: true });
    expect(fake.writes).toEqual([]);
  });
});

describe("saveProfile", () => {
  it("keeps room in the clinic's text name for its active branches' short names", async () => {
    fake.branches = [main({ sms_name: "Makati" }), pasig()];
    expect(await saveProfile(staff(), profile)).toEqual({
      ok: false,
      field: "smsName",
      error: "Texts add the branch's short name after this. Use up to 13 characters, or shorten your branches' short names first.",
    });
    expect(fake.writes).toEqual([]);
  });

  it("saves the clinic only: each branch keeps the address set under Branches", async () => {
    expect(await saveProfile(staff(), profile)).toEqual({ ok: true });
    expect(fake.writes.map((w) => w.table)).toEqual(["clinics"]);
  });
});
