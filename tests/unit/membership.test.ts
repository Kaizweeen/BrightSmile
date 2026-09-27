import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { logError } from "@/lib/log";
import { ownMembership } from "@/lib/membership";

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

type Row = { clinic_id: string; user_id: string; role: string };

/**
 * clinic_members as PostgREST serves it to an owner, who reads every membership of their clinic (teams spec 5):
 * each filter narrows the rows, and maybeSingle fails when more than one row is left, as PostgREST does. Only the
 * columns named in select() come back, as PostgREST does, so a query that leans on an unselected column would fail here.
 */
function membersTable(rows: Row[]): SupabaseClient {
  return {
    from(table: string) {
      expect(table).toBe("clinic_members");
      let left = rows;
      let columns: (keyof Row)[] = [];
      const query = {
        select: (cols: string) => {
          columns = cols.split(",").map((c) => c.trim()) as (keyof Row)[];
          return query;
        },
        eq: (column: keyof Row, value: string) => {
          left = left.filter((r) => r[column] === value);
          return query;
        },
        maybeSingle: async () => {
          if (left.length > 1) {
            return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
          }
          const row = left[0];
          if (!row) return { data: null, error: null };
          return { data: Object.fromEntries(columns.map((c) => [c, row[c]])), error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const clinic = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const owner = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
const staff = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const team = membersTable([
  { clinic_id: clinic, user_id: owner, role: "owner" },
  { clinic_id: clinic, user_id: staff, role: "staff" },
]);

describe("ownMembership", () => {
  it("finds the signed-in member's own row when their clinic has two members", async () => {
    expect(await ownMembership(team, owner)).toEqual({ clinicId: clinic, role: "owner" });
    expect(await ownMembership(team, staff)).toEqual({ clinicId: clinic, role: "staff" });
  });

  it("is null for an account without a clinic", async () => {
    expect(await ownMembership(team, "9e8d7c6b-5a49-4382-a716-151413121110")).toBeNull();
  });

  it("logs where and returns null when the query errors, instead of throwing", async () => {
    const failing = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "JWT expired" } }) }) }) }),
    } as unknown as SupabaseClient;
    expect(await ownMembership(failing, owner)).toBeNull();
    expect(vi.mocked(logError)).toHaveBeenCalledWith("ownMembership", { message: "JWT expired" });
  });
});
