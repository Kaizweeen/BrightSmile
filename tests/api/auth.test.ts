import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients, sessions } from "@/db/schema";
import { auth, SESSION_SECONDS } from "@/lib/auth";
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

  it("keeps a failed sign-in's username only when it names an account", async () => {
    await expect(signIn("ghost.person", "my secret phrase")).rejects.toThrow();
    const failed = await db.select().from(auditLog).where(eq(auditLog.action, "auth.sign_in_failed"));
    expect(failed.some((r) => r.entityId === null && r.details.username === null)).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("ghost.person");
  });

  it("refuses a disabled account exactly like a wrong password, so its password is never confirmed", async () => {
    const ana = await makeUser({ role: "manager", status: "disabled" });
    const attempt = (password: string) => auth.api.signInUsername({ body: { username: ana.username, password }, asResponse: true });
    const right = await attempt(PASSWORD);
    const wrong = await attempt("not the password");
    expect(right.status).toBe(401);
    expect(await right.json()).toEqual(await wrong.json());
  });

  it("ends every session 12 hours after sign-in, even one asked for without remember me", async () => {
    const ana = await makeUser({ role: "manager" });
    await auth.api.signInUsername({ body: { username: ana.username, password: PASSWORD, rememberMe: false } });
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, ana.id));
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_SECONDS * 1000);
  });

  it("audits a password change, without the password", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    await auth.api.changePassword({ body: { currentPassword: PASSWORD, newPassword: "another good password" }, headers: new Headers({ cookie }) });
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.action, "auth.password_changed"), eq(auditLog.entityId, ana.id)));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("another good password");
  });

  it("keeps Better Auth's own sign-up and its other unused doors closed, even to someone signed in", async () => {
    const cookie = await signIn((await makeUser({ role: "manager" })).username);
    for (const path of ["/sign-up/email", "/sign-in/email", "/update-user", "/is-username-available", "/delete-user"]) {
      const res = await auth.handler(
        new Request(`http://localhost:3700/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3700", cookie },
          body: JSON.stringify({ email: "someone@users.invalid", password: PASSWORD, name: "Someone", username: "someone" }),
        }),
      );
      expect(res.status, path).toBe(404);
    }
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

  it("logs an unexpected failure by its kind and SQL, never the values it was given", async () => {
    const cookie = await signIn((await makeUser({ role: "manager" })).username);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The check on first_name (1 to 50 characters) refuses this row, and Postgres quotes the whole row back.
      const failing = staffRoute(async () => {
        await db.insert(patients).values({ lastName: "Privado", firstName: "x".repeat(51), medicalAlerts: "Takes warfarin" });
        return json({ ok: true });
      });
      expect((await call(failing, request("/x", { method: "POST", cookie }))).status).toBe(500);
      const text = JSON.stringify(logged.mock.calls);
      expect(text).toContain("patients_first_name");
      expect(text).not.toContain("Privado");
      expect(text).not.toContain("warfarin");
    } finally {
      logged.mockRestore();
    }
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
