import { beforeEach, describe, expect, it, vi } from "vitest";
import { continueToJoin, joinClinic } from "@/app/join/actions";
import { inviteClinicName } from "@/lib/team-data";
import { INVITE_DAYS, JOIN_COOKIE } from "@/lib/team";

const GONE = "This join link no longer works. Ask the clinic for a new one.";
const TRY_AGAIN = "Something went wrong. Try the link again.";
const TOKEN = "AbCdEfGhIjKl";

// None of continueToJoin, joinClinic, or logOutToJoin reads a cookie back (only sets or deletes bs_join), so get is a
// harmless stub kept only so the fake cookie jar shape matches next/headers'.
const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
const cookieGet = vi.hoisted(() => vi.fn(() => undefined));
const cookieSet = vi.hoisted(() => vi.fn((_name: string, value: string) => void (cookieStore.value = value)));
const cookieDelete = vi.hoisted(() => vi.fn(() => void (cookieStore.value = undefined)));

const auth = vi.hoisted(() => ({ userId: null as string | null, rpcError: null as { code: string; message: string } | null }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet, set: cookieSet, delete: cookieDelete }) }));
// Like Next's redirect, this throws, so a redirect caught by a try block would show up as a returned error.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: auth.userId ? { sub: auth.userId } : null } }),
      signOut: async () => {},
    },
    rpc: async () => ({ error: auth.rpcError }),
  }),
}));
vi.mock("@/lib/team-data", () => ({ inviteClinicName: vi.fn() }));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.value = undefined;
  auth.userId = null;
  auth.rpcError = null;
});

describe("continueToJoin", () => {
  it("sends a malformed token to log in without touching the cookie", async () => {
    await expect(continueToJoin(form({ token: "not-a-token" }))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("remembers a good token for 7 days and goes to sign up by default", async () => {
    await expect(continueToJoin(form({ token: TOKEN }))).rejects.toThrow("NEXT_REDIRECT /signup");
    expect(cookieSet).toHaveBeenCalledWith(
      JOIN_COOKIE,
      TOKEN,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: INVITE_DAYS * 24 * 60 * 60, path: "/" }),
    );
  });

  it("goes to log in instead when asked", async () => {
    await expect(continueToJoin(form({ token: TOKEN, to: "login" }))).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("joinClinic", () => {
  it("remembers the invite and sends a signed-out visitor to log in", async () => {
    auth.userId = null;
    await expect(joinClinic({}, form({ token: TOKEN }))).rejects.toThrow("NEXT_REDIRECT /login");
    expect(cookieSet).toHaveBeenCalledWith(JOIN_COOKIE, TOKEN, expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  it("deletes the cookie and opens Requests on success", async () => {
    auth.userId = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    auth.rpcError = null;
    await expect(joinClinic({}, form({ token: TOKEN }))).rejects.toThrow("NEXT_REDIRECT /app/requests");
    expect(cookieDelete).toHaveBeenCalledWith(JOIN_COOKIE);
  });

  it("deletes the cookie and says the link is gone for an expired, revoked, used, or unknown token", async () => {
    auth.userId = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    auth.rpcError = { code: "BSEXP", message: "this join link expired" };
    expect(await joinClinic({}, form({ token: TOKEN }))).toEqual({ error: GONE });
    expect(cookieDelete).toHaveBeenCalledWith(JOIN_COOKIE);
  });

  it("deletes the cookie and names the clinic when the login already belongs to one", async () => {
    auth.userId = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    auth.rpcError = { code: "23505", message: "this account already has a clinic" };
    vi.mocked(inviteClinicName).mockResolvedValue("Bright Dental");
    expect(await joinClinic({}, form({ token: TOKEN }))).toEqual({
      error: "This account already belongs to a clinic. Log out and use another email to join Bright Dental.",
    });
    expect(inviteClinicName).toHaveBeenCalledWith(TOKEN, expect.any(Date));
    expect(cookieDelete).toHaveBeenCalledWith(JOIN_COOKIE);
  });

  it("falls back to the plain member refusal when the clinic's name can no longer be looked up", async () => {
    auth.userId = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    auth.rpcError = { code: "23505", message: "this account already has a clinic" };
    vi.mocked(inviteClinicName).mockRejectedValue(new Error("connection reset"));
    expect(await joinClinic({}, form({ token: TOKEN }))).toEqual({
      error: "This account already belongs to a clinic. Log out and use another email to join.",
    });
  });

  it("keeps the cookie and asks to try again on an unexpected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cookieStore.value = TOKEN; // as if an earlier step had already remembered it
    auth.userId = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    auth.rpcError = { code: "08006", message: "connection reset" };
    expect(await joinClinic({}, form({ token: TOKEN }))).toEqual({ error: TRY_AGAIN });
    expect(cookieDelete).not.toHaveBeenCalled();
  });
});
