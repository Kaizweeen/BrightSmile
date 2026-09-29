import { desc, eq } from "drizzle-orm";
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
import { appointments, auditLog, branches, patients, practice } from "@/db/schema";
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

  it("keeps online booking off until there is a privacy notice", async () => {
    const { cookie } = await ownerCookie();
    const patch = (body: object) => call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body }));
    const refused = await patch({ onlineBooking: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.fields.privacyNotice).toBe("Add the privacy notice first.");
    const ok = await patch({ onlineBooking: true, privacyNotice: "We keep your details to run your visits.", visitMinutes: 45, cleaningMinutes: 5 });
    expect(ok.status).toBe(200);
    const read = await (await call(practiceRoute.GET, request("/api/v1/practice", { cookie }))).json();
    expect(read).toMatchObject({ onlineBooking: true, visitMinutes: 45, cleaningMinutes: 5 });
    const odd = await patch({ visitMinutes: 50 });
    expect(odd.status).toBe(400);
    expect((await odd.json()).error.fields.visitMinutes).toBe("Use 15-minute steps");
    expect((await patch({ privacyNotice: "" })).status).toBe(422);
  });

  it("logs the privacy notice's words when it changes, so the clinic can show which one was in force", async () => {
    const { cookie } = await ownerCookie();
    const patch = (body: object) => call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body }));
    const latest = async () => (await db.select().from(auditLog).where(eq(auditLog.action, "practice.updated")).orderBy(desc(auditLog.id)).limit(1))[0].details;
    const notice = "We keep your details to run your visits. We keep them in Singapore.";
    expect((await patch({ privacyNotice: notice, visitMinutes: 60 })).status).toBe(200);
    expect(await latest()).toEqual({ visitMinutes: 60, privacyNotice: notice });
    // A save that leaves the notice as it is does not repeat it.
    expect((await patch({ privacyNotice: notice, visitMinutes: 45 })).status).toBe(200);
    expect(await latest()).toEqual({ visitMinutes: 45 });
  });

  it("keeps patient forms off until there is a privacy notice", async () => {
    const { cookie } = await ownerCookie();
    const patch = (body: object) => call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body }));
    expect((await patch({ onlineBooking: false, privacyNotice: "" })).status).toBe(200);
    const refused = await patch({ patientForms: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.fields.privacyNotice).toBe("Add the privacy notice first.");
    expect((await patch({ patientForms: true, privacyNotice: "We keep your details to run your visits." })).status).toBe(200);
    const read = await (await call(practiceRoute.GET, request("/api/v1/practice", { cookie }))).json();
    expect(read).toMatchObject({ onlineBooking: false, patientForms: true });
    expect((await patch({ privacyNotice: "" })).status).toBe(422);
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

  it("refuses a code that is one of the app's own pages", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("book", "Booking") }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ code: "That code is reserved" });
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

  it("keeps every active staff member an open branch", async () => {
    const { cookie } = await ownerCookie();
    await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("eastside", "Eastside") }));
    const [east] = await db.select().from(branches).where(eq(branches.code, "eastside"));
    await makeUser({ role: "manager", branchIds: [east.id], name: "Joy Mendoza" });
    const off = await call(branchRoute.PATCH, request("/api/v1/branches/eastside", { method: "PATCH", cookie, body: { active: false } }), { code: "eastside" });
    expect(off.status).toBe(422);
    expect((await off.json()).error).toMatchObject({
      code: "has_staff",
      message: "Joy Mendoza works only at this branch. Give them another branch or disable them first.",
    });
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
  it("adds, validates, and updates services", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis" } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: "Oral prophylaxis", online: true, dentistIds: [] });
    const { id } = created;
    const dup = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis" } }));
    expect(dup.status).toBe(409);
    const stranger = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Braces", dentistIds: [crypto.randomUUID()] } }));
    expect(stranger.status).toBe(400);
    expect((await stranger.json()).error.fields.dentistIds).toBe("Pick dentists who see patients.");
    const off = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { active: false, online: false } }), { id });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ active: false, online: false });
    const active = await (await call(proceduresRoute.GET, request("/api/v1/procedures?active=1", { cookie }))).json();
    expect(active).toEqual([]);
  });

  it("limits a service to chosen dentists", async () => {
    const { cookie } = await ownerCookie();
    const ortho = await makeUser({ role: "dentist", name: "Dr. Ortho" });
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Braces and Retainers", dentistIds: [ortho.id] } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const list = await (await call(proceduresRoute.GET, request("/api/v1/procedures", { cookie }))).json();
    expect(list.find((p: { id: string }) => p.id === id).dentistIds).toEqual([ortho.id]);
    const cleared = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { dentistIds: [] } }), { id });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).dentistIds).toEqual([]);
  });

  it("refuses dentists who are not active, such as a pending join request", async () => {
    const { cookie } = await ownerCookie();
    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    // A pending request as a dentist sees patients, but must not be put on a service: the link would block declining it.
    const pending = await makeUser({ role: "dentist", status: "pending", requestedBranchId: b.id });
    const disabled = await makeUser({ role: "dentist", status: "disabled", branchIds: [b.id] });
    for (const dentist of [pending, disabled]) {
      const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Veneers", dentistIds: [dentist.id] } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.fields.dentistIds).toBe("Pick dentists who see patients.");
    }
    const list = await (await call(proceduresRoute.GET, request("/api/v1/procedures", { cookie }))).json();
    expect(list.map((p: { name: string }) => p.name)).not.toContain("Veneers");
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
