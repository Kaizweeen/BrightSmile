import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOwner } from "@/lib/supabase/server";

/** What the mocked Supabase client answers: signedInStaff's getClaims, then ownMembership's clinic_members read. */
const fake = vi.hoisted(() => ({ userId: null as string | null, row: null as { clinic_id: string; role: string } | null }));

vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
// Like Next's redirect, this throws, so requireStaff's redirect to onboarding shows up as a rejection here.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
// serverClient's only other dependency: a fake client standing in for the cookie-bound one it builds.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: fake.userId ? { sub: fake.userId } : null } }) },
    from: (table: string) => {
      expect(table).toBe("clinic_members");
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fake.row, error: null }) }) }) };
    },
  }),
}));

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const USER = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";

beforeEach(() => {
  fake.userId = USER;
  fake.row = null;
});

describe("requireOwner", () => {
  it("passes the owner through", async () => {
    fake.row = { clinic_id: CLINIC, role: "owner" };
    expect(await requireOwner()).toEqual({ db: expect.anything(), userId: USER, clinicId: CLINIC, role: "owner" });
  });

  it("refuses a staff member the way requireOwner refuses: null, not a redirect or a throw", async () => {
    fake.row = { clinic_id: CLINIC, role: "staff" };
    expect(await requireOwner()).toBeNull();
  });

  it("sends an account with no membership to onboarding, same as requireStaff", async () => {
    fake.row = null;
    await expect(requireOwner()).rejects.toThrow("NEXT_REDIRECT /onboarding");
  });
});
