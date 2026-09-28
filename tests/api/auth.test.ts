import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients } from "@/db/schema";
import { auth } from "@/lib/auth";
import { endSessions } from "@/server/accounts";
import { json, readJson, staffRoute } from "@/server/api";
import { ApiError } from "@/server/errors";
import { call, makeBranch, makeUser, PASSWORD, request, signIn } from "../helpers";

const whoAmI = staffRoute(async (_req, staff) => json({ id: staff.id, role: staff.role }));

describe("signing in", () => {
  it("signs in with a username and finds the staff member", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const res = await call(whoAmI, request("/api/v1/test", { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ana.id, role: "manager" });
  });

  it("refuses a wrong password", async () => {
    const ana = await makeUser({ role: "manager" });
    await expect(signIn(ana.username, "not the password")).rejects.toThrow();
  });

  it("audits every sign-in, a failed one with the username only", async () => {
    const ben = await makeUser({ role: "manager" });
    await signIn(ben.username);
    await expect(signIn(ben.username, "a wrong password")).rejects.toThrow();
    const rows = (await db.select().from(auditLog)).filter((r) => r.entityId === ben.id || r.details.username === ben.username);
    expect(rows.map((r) => r.action)).toEqual(["auth.signed_in", "auth.sign_in_failed"]);
    expect(JSON.stringify(rows)).not.toContain("a wrong password");
  });

  it("keeps Better Auth's own sign-up closed", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "someone@users.invalid", password: PASSWORD, name: "Someone" } }),
    ).rejects.toThrow();
  });
});

describe("staffRoute", () => {
  it("answers 401 without a session", async () => {
    const res = await call(whoAmI, request("/api/v1/test"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "signed_out", message: "Sign in again." } });
  });

  it("answers 403 to an account that is waiting for approval", async () => {
    const branch = await makeBranch();
    const newcomer = await makeUser({ role: "dentist", status: "pending", requestedBranchId: branch.id });
    const cookie = await signIn(newcomer.username);
    expect((await call(whoAmI, request("/api/v1/test", { cookie }))).status).toBe(403);
  });

  it("signs a person out at once when their sessions end", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    await endSessions(ana.id);
    expect((await call(whoAmI, request("/api/v1/test", { cookie }))).status).toBe(401);
  });

  it("refuses writes from another origin or without JSON", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const write = staffRoute(async () => json({ ok: true }));
    expect((await call(write, request("/x", { method: "POST", cookie, origin: "https://evil.example" }))).status).toBe(403);
    expect((await call(write, request("/x", { method: "POST", cookie, origin: null }))).status).toBe(403);
    expect((await call(write, request("/x", { method: "POST", cookie, contentType: "text/plain" }))).status).toBe(415);
    expect((await call(write, request("/x", { method: "POST", cookie }))).status).toBe(200);
  });

  it("maps thrown errors to the spec's error shape", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const failing = (error: unknown) =>
      staffRoute(async () => {
        throw error;
      });

    let res = await call(failing(new ApiError(422, "nope", "Not allowed.", { fields: { a: "b" } })), request("/x", { cookie }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "nope", message: "Not allowed.", fields: { a: "b" } } });

    const validating = staffRoute(async (req) => json(await readJson(req, z.object({ name: z.string().min(2, "Too short") }))));
    res = await call(validating, request("/x", { method: "POST", cookie, body: { name: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ name: "Too short" });

    res = await call(failing(new Error("boom")), request("/x", { cookie }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
  });

  it("turns an overlap refused by the database into 409", async () => {
    const branch = await makeBranch();
    await db.insert(chairs).values({ branchId: branch.id, number: 1 });
    const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const [ben] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ben" }).returning();
    const start = new Date("2026-10-05T01:00:00Z");
    const end = new Date("2026-10-05T02:00:00Z");
    const row = (patientId: string) => ({
      patientId,
      dentistId: dentist.id,
      branchId: branch.id,
      chairNumber: 1,
      startTime: start,
      endTime: end,
      chairFreeAt: end,
      status: "confirmed",
      source: "staff",
    });
    await db.insert(appointments).values(row(ana.id));
    const booking = staffRoute(async () => {
      await db.insert(appointments).values(row(ben.id));
      return json({ ok: true });
    });
    const cookie = await signIn((await makeUser({ role: "manager", branchIds: [branch.id] })).username);
    const res = await call(booking, request("/x", { method: "POST", cookie }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});
