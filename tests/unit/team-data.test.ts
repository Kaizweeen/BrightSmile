import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "@/lib/team";
import { createInvite, inviteClinicName, removeMember, revokeInvite } from "@/lib/team-data";

const admin = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://bsmile.vercel.app" }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => admin.client }));

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const STAFF_ID = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const owner = (db: object) => ({ db: db as never, userId: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", clinicId: CLINIC });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createInvite", () => {
  it("stores only the token's hash and gives the link back once", async () => {
    const inserted: unknown[] = [];
    const db = {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          inserted.push({ table, row });
          return { error: null };
        },
      }),
    };
    const result = await createInvite(owner(db));
    if (!result.ok) throw new Error(result.error);
    const token = result.link.replace("https://bsmile.vercel.app/join/", "");
    expect(token).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(inserted).toEqual([{ table: "clinic_invites", row: { clinic_id: CLINIC, token_hash: hashInviteToken(token) } }]);
  });

  it("says something went wrong, and logs where, when the link cannot be saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { from: () => ({ insert: async () => ({ error: { message: "JWT expired" } }) }) };
    expect(await createInvite(owner(db))).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    expect(logged.mock.calls).toEqual([["createInvite failed:", "JWT expired"]]);
  });
});

describe("revokeInvite and removeMember", () => {
  it("say the link or the person is gone when nothing matched", async () => {
    type Chain = { update: () => Chain; eq: () => Chain; is: () => Chain; select: () => Promise<{ data: unknown[]; error: null }> };
    const chain: Chain = { update: () => chain, eq: () => chain, is: () => chain, select: async () => ({ data: [], error: null }) };
    expect(await revokeInvite(owner({ from: () => chain }), STAFF_ID)).toEqual({ ok: false, error: "That link was already used or revoked. Reload the page." });
    const db = { rpc: async () => ({ error: { code: "BSNOS", message: "no such staff member" } }) };
    expect(await removeMember(owner(db), STAFF_ID)).toEqual({ ok: false, error: "That person is no longer on your team. Reload the page." });
  });

  it("refuse ids that are not ids before asking the database", async () => {
    const never = () => {
      throw new Error("no query expected");
    };
    const db = { from: never, rpc: never };
    expect((await revokeInvite(owner(db), "not-an-id")).ok).toBe(false);
    expect((await removeMember(owner(db), "not-an-id")).ok).toBe(false);
  });
});

/** The secret-key client, recording each call of the query it builds; maybeSingle answers `row`. */
function recording(row: unknown): unknown[][] {
  const calls: unknown[][] = [];
  const query: Record<string, unknown> = { maybeSingle: async () => ({ data: row, error: null }) };
  for (const name of ["from", "select", "eq", "is", "gt"]) {
    query[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return query;
    };
  }
  admin.client = query;
  return calls;
}

describe("inviteClinicName", () => {
  it("names the clinic only for an open link, found by the token's hash", async () => {
    const calls = recording({ clinic: { name: "Bright Dental" } });
    expect(await inviteClinicName("AbCdEfGhIjKl", new Date("2026-09-26T02:00:00Z"))).toBe("Bright Dental");
    expect(calls).toEqual([
      ["from", "clinic_invites"],
      ["select", "clinic:clinics(name)"],
      ["eq", "token_hash", hashInviteToken("AbCdEfGhIjKl")],
      ["is", "accepted_at", null],
      ["is", "revoked_at", null],
      ["gt", "expires_at", "2026-09-26T02:00:00.000Z"],
    ]);
  });

  it("is null for a link that no longer works, and asks nothing for a malformed token", async () => {
    recording(null);
    expect(await inviteClinicName("AbCdEfGhIjKl", new Date())).toBeNull();
    const calls = recording(null);
    expect(await inviteClinicName("../../admin", new Date())).toBeNull();
    expect(calls).toEqual([]);
  });
});
