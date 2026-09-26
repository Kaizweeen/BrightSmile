import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ownMembership } from "@/lib/membership";

type Row = { clinic_id: string; user_id: string; role: string };

/**
 * clinic_members as PostgREST serves it once members can read every membership of their clinic (teams spec 5):
 * each filter narrows the rows, and maybeSingle fails when more than one row is left, as PostgREST does.
 */
function membersTable(rows: Row[]): SupabaseClient {
  return {
    from(table: string) {
      expect(table).toBe("clinic_members");
      let left = rows;
      const query = {
        select: () => query,
        eq: (column: keyof Row, value: string) => {
          left = left.filter((r) => r[column] === value);
          return query;
        },
        maybeSingle: async () =>
          left.length > 1
            ? { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }
            : { data: left[0] ?? null, error: null },
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
});
