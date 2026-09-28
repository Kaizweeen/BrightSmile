import { describe, expect, it } from "vitest";
import * as recoverRoute from "@/app/api/v1/setup/recover/route";
import * as setupRoute from "@/app/api/v1/setup/route";
import { db } from "@/db";
import { auditLog, practice } from "@/db/schema";
import { ownerExists } from "@/server/setup";
import { staffFromHeaders } from "@/server/session";
import { call, PASSWORD, request, signIn } from "../helpers";

const SETUP = process.env.SETUP_TOKEN as string;
const owner = { practiceName: "Smile Dental", name: "Dr. Maria Santos", username: "Maria.Santos", password: PASSWORD };
const post = (path: string, body: unknown) => request(path, { method: "POST", body });

describe("first run", () => {
  it("refuses a wrong setup code", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: "wrong" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.fields).toEqual({ setupCode: "That setup code is not right." });
    expect(await ownerExists()).toBe(false);
  });

  it("checks the fields", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP, username: "x", password: "short" }));
    expect(res.status).toBe(400);
    const { fields } = (await res.json()).error;
    expect(Object.keys(fields).sort()).toEqual(["password", "username"]);
  });

  it("creates the practice and its owner, once", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ username: "maria.santos" });
    expect(await ownerExists()).toBe(true);
    expect((await db.select().from(practice))[0].name).toBe("Smile Dental");
    await signIn("maria.santos");

    const again = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP, username: "second.owner" }));
    expect(again.status).toBe(409);
    const actions = (await db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toContain("setup.completed");
  });
});

describe("owner recovery", () => {
  it("refuses a wrong setup code", async () => {
    const res = await call(recoverRoute.POST, post("/api/v1/setup/recover", { setupCode: "wrong", password: "a brand new password" }));
    expect(res.status).toBe(403);
  });

  it("sets a new password with the setup code and signs the owner out", async () => {
    const cookie = await signIn("maria.santos");
    const res = await call(recoverRoute.POST, post("/api/v1/setup/recover", { setupCode: SETUP, password: "a brand new password" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "maria.santos" });
    expect(await staffFromHeaders(new Headers({ cookie }))).toBeNull();
    await signIn("maria.santos", "a brand new password");
    await expect(signIn("maria.santos")).rejects.toThrow();
  });
});
