import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as chairRoute from "@/app/api/v1/branches/[code]/chairs/[number]/route";
import * as chairsRoute from "@/app/api/v1/branches/[code]/chairs/route";
import * as joinCodeRoute from "@/app/api/v1/branches/[code]/join-code/route";
import * as branchRoute from "@/app/api/v1/branches/[code]/route";
import * as branchesRoute from "@/app/api/v1/branches/route";
import * as practiceRoute from "@/app/api/v1/practice/route";
import * as procedureRoute from "@/app/api/v1/procedures/[id]/route";
import * as proceduresRoute from "@/app/api/v1/procedures/route";
import { db } from "@/db";
import { appointments, branches, patients, practice } from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Staff } from "@/server/session";
import { call, makeUser, request, signIn } from "../helpers";

// A practice has one owner, so the whole file shares one.
let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}
const branchBody = (code: string, name = "Downtown") => ({ code, name, address: "1 Rizal Ave", phone: "02 8123 4567", operatingHours: DEFAULT_HOURS });

describe("practice", () => {
  it("lets the owner rename the practice", async () => {
    await db.insert(practice).values({ name: "Old Name" }).onConflictDoNothing();
    const { cookie } = await ownerCookie();
    const res = await call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body: { name: "Smile Dental Group" } }));
    expect(res.status).toBe(200);
    expect((await db.select().from(practice))[0].name).toBe("Smile Dental Group");
  });
});

describe("branches", () => {
  it("lets the owner add branches and refuses a code in use", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("downtown") }));
    expect(res.status).toBe(201);
    const again = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("downtown", "Other") }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.fields).toEqual({ code: "Another branch uses that code." });
    const bad = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("all") }));
    expect(bad.status).toBe(400);
  });

  it("refuses managers", async () => {
    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const manager = await makeUser({ role: "manager", branchIds: [b.id] });
    const cookie = await signIn(manager.username);
    const res = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("westside") }));
    expect(res.status).toBe(403);
    const list = await call(branchesRoute.GET, request("/api/v1/branches", { cookie }));
    expect(list.status).toBe(200);
  });

  it("lists branches with their active chair count and no join code", async () => {
    const { cookie } = await ownerCookie();
    await call(chairsRoute.POST, request("/api/v1/branches/downtown/chairs", { method: "POST", cookie, body: { label: "General" } }), { code: "downtown" });
    await call(chairsRoute.POST, request("/api/v1/branches/downtown/chairs", { method: "POST", cookie, body: { label: "Ortho" } }), { code: "downtown" });
    const list = await (await call(branchesRoute.GET, request("/api/v1/branches", { cookie }))).json();
    const downtown = list.find((b: { code: string }) => b.code === "downtown");
    expect(downtown.chairCount).toBe(2);
    expect(downtown).not.toHaveProperty("joinCode");
  });

  it("numbers chairs, renames them, and keeps a chair with upcoming visits active", async () => {
    const { cookie } = await ownerCookie();
    const chairs = await (await call(chairsRoute.GET, request("/api/v1/branches/downtown/chairs", { cookie }), { code: "downtown" })).json();
    expect(chairs.map((c: { number: number; label: string }) => [c.number, c.label])).toEqual([
      [1, "General"],
      [2, "Ortho"],
    ]);
    const renamed = await call(chairRoute.PATCH, request("/api/v1/branches/downtown/chairs/2", { method: "PATCH", cookie, body: { label: "Orthodontics" } }), { code: "downtown", number: "2" });
    expect(renamed.status).toBe(200);

    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const dentist = await makeUser({ role: "dentist", branchIds: [b.id] });
    const [p] = await db.insert(patients).values({ lastName: "Reyes", firstName: "Lia" }).returning();
    const start = new Date(Date.now() + 7 * 86_400_000);
    await db.insert(appointments).values({
      patientId: p.id, dentistId: dentist.id, branchId: b.id, chairNumber: 1,
      startTime: start, endTime: new Date(start.getTime() + 3_600_000), chairFreeAt: new Date(start.getTime() + 3_600_000),
      status: "confirmed", source: "staff",
    });
    const off = await call(chairRoute.PATCH, request("/api/v1/branches/downtown/chairs/1", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown", number: "1" });
    expect(off.status).toBe(422);
    expect((await off.json()).error.message).toBe("Chair 1 has 1 upcoming visit. Move it first.");
  });

  it("keeps at least one branch open", async () => {
    const { cookie } = await ownerCookie();
    await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("westside", "Westside") }));
    const off = await call(branchRoute.PATCH, request("/api/v1/branches/westside", { method: "PATCH", cookie, body: { active: false } }), { code: "westside" });
    expect(off.status).toBe(200);
    await db.update(appointments).set({ status: "cancelled", cancelReason: "Test" });
    const lastOff = await call(branchRoute.PATCH, request("/api/v1/branches/downtown", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown" });
    expect(lastOff.status).toBe(422);
    expect((await lastOff.json()).error.code).toBe("last_branch");
  });

  it("replaces a branch's join code", async () => {
    const { cookie } = await ownerCookie();
    const [before] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const res = await call(joinCodeRoute.POST, request("/api/v1/branches/downtown/join-code", { method: "POST", cookie }), { code: "downtown" });
    expect(res.status).toBe(200);
    const [after] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    expect(after.joinCode).not.toBe(before.joinCode);
    expect(after.joinCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("procedures", () => {
  it("adds, validates, and updates procedures", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const dup = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis", durationMinutes: 30, bufferMinutes: 0 } }));
    expect(dup.status).toBe(409);
    const bad = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Odd", durationMinutes: 42, bufferMinutes: 0 } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields.durationMinutes).toBe("Use 5-minute steps");
    const off = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { active: false } }), { id });
    expect(off.status).toBe(200);
    const active = await (await call(proceduresRoute.GET, request("/api/v1/procedures?active=1", { cookie }))).json();
    expect(active).toEqual([]);
  });

  it("keeps a branch with visits not over yet open, counting one in the chair now", async () => {
    const { cookie } = await ownerCookie();
    const on = await call(branchRoute.PATCH, request("/api/v1/branches/westside", { method: "PATCH", cookie, body: { active: true } }), { code: "westside" });
    expect(on.status).toBe(200);
    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const dentist = await makeUser({ role: "dentist", branchIds: [b.id] });
    const [p] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
    const start = new Date(Date.now() - 600_000);
    await db.insert(appointments).values({
      patientId: p.id, dentistId: dentist.id, branchId: b.id, chairNumber: 2,
      startTime: start, endTime: new Date(start.getTime() + 3_600_000), chairFreeAt: new Date(start.getTime() + 3_600_000),
      status: "confirmed", source: "staff",
    });
    const off = await call(branchRoute.PATCH, request("/api/v1/branches/downtown", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown" });
    expect(off.status).toBe(422);
    expect((await off.json()).error).toMatchObject({ code: "has_visits", message: "This branch has 1 upcoming visit. Move or cancel it first." });
  });
});
