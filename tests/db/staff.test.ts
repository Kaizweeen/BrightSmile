import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as approveRoute from "@/app/api/v1/join-requests/[id]/approve/route";
import * as declineRoute from "@/app/api/v1/join-requests/[id]/decline/route";
import * as requestsRoute from "@/app/api/v1/join-requests/route";
import * as joinRoute from "@/app/api/v1/join/[code]/route";
import * as resetRoute from "@/app/api/v1/reset/[token]/route";
import * as resetLinkRoute from "@/app/api/v1/staff/[id]/reset-link/route";
import * as staffMemberRoute from "@/app/api/v1/staff/[id]/route";
import * as staffListRoute from "@/app/api/v1/staff/route";
import { db } from "@/db";
import { auditLog, branches, dentistSchedules, userBranches, users, verifications } from "@/db/schema";
import { staffById, staffFromHeaders, type Staff } from "@/server/session";
import { call, makeBranch, makeUser, PASSWORD, request, signIn, userRow } from "../helpers";

let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}

const newcomer = (username: string, role = "dentist") => ({ name: "New Person", username, password: PASSWORD, role });
const join = (code: string, body: unknown, ip = "10.0.0.1") =>
  call(joinRoute.POST, request(`/api/v1/join/${code}`, { method: "POST", body, headers: { "x-forwarded-for": ip } }), { code });
const approve = (cookie: string, id: string, body: unknown) =>
  call(approveRoute.POST, request(`/api/v1/join-requests/${id}/approve`, { method: "POST", cookie, body }), { id });
const patch = (cookie: string, id: string, body: unknown) =>
  call(staffMemberRoute.PATCH, request(`/api/v1/staff/${id}`, { method: "PATCH", cookie, body }), { id });
const branchesOf = async (userId: string) =>
  (await db.select().from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.branchId).sort();

describe("joining by QR", () => {
  it("creates a pending account that can sign in but reaches nothing", async () => {
    const branch = await makeBranch();
    const res = await join(branch.joinCode, newcomer("Ana.Cruz"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ username: "ana.cruz" });
    const [row] = await db.select().from(users).where(eq(users.username, "ana.cruz"));
    expect(row).toMatchObject({ status: "pending", role: "dentist", seesPatients: true, requestedBranchId: branch.id });
    const cookie = await signIn("ana.cruz");
    expect((await staffFromHeaders(new Headers({ cookie })))?.status).toBe("pending");
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "staff.join_requested"));
    expect(log.details).toMatchObject({ ip: "10.0.0.1", username: "ana.cruz" });
  });

  it("refuses a replaced code and a taken username", async () => {
    const branch = await makeBranch();
    const replaced = await join("not-a-current-code", newcomer("ben.lim"));
    expect(replaced.status).toBe(404);
    expect((await replaced.json()).error.code).toBe("qr_replaced");
    const taken = await join(branch.joinCode, newcomer("ana.cruz"), "10.0.0.2");
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.fields).toEqual({ username: "That username is taken. Try another." });
  });

  it("allows 5 requests an hour from one connection", async () => {
    const branch = await makeBranch();
    for (let i = 1; i <= 5; i += 1) expect((await join(branch.joinCode, newcomer(`lim.${i}`), "10.0.0.9")).status).toBe(201);
    const sixth = await join(branch.joinCode, newcomer("lim.6"), "10.0.0.9");
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("too_many_requests");
  });

  it("holds at most 20 open requests per branch", async () => {
    const branch = await makeBranch();
    for (let i = 0; i < 20; i += 1) await makeUser({ role: "dentist", status: "pending", requestedBranchId: branch.id });
    const res = await join(branch.joinCode, newcomer("one.more"), "10.0.0.10");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("branch_full");
  });

  it("deletes requests older than 7 days on the next join", async () => {
    const branch = await makeBranch();
    const old = await makeUser({ role: "manager", status: "pending", requestedBranchId: branch.id });
    await db.update(users).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(users.id, old.id));
    expect((await join(branch.joinCode, newcomer("fresh.one"), "10.0.0.11")).status).toBe(201);
    expect(await userRow(old.id)).toBeUndefined();
  });
});

describe("approving", () => {
  it("shows managers their branches' requests and lets them approve there", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const atA = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const atB = await makeUser({ role: "dentist", status: "pending", requestedBranchId: b.id });
    const cookie = await signIn(manager.username);
    const list = await (await call(requestsRoute.GET, request("/api/v1/join-requests", { cookie }))).json();
    const ids = list.map((r: { id: string }) => r.id);
    expect(ids).toContain(atA.id);
    expect(ids).not.toContain(atB.id);

    const res = await approve(cookie, atA.id, { role: "dentist", branchIds: [a.id], title: "Orthodontist" });
    expect(res.status).toBe(200);
    expect(await userRow(atA.id)).toMatchObject({ status: "active", title: "Orthodontist", approvedBy: manager.id, primaryBranchId: a.id });
    expect(await branchesOf(atA.id)).toEqual([a.id]);
  });

  it("refuses approvals outside a manager's branches", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const cookie = await signIn(manager.username);
    const atB = await makeUser({ role: "dentist", status: "pending", requestedBranchId: b.id });
    expect((await approve(cookie, atB.id, { role: "dentist", branchIds: [b.id] })).status).toBe(403);
    const atA = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const wide = await approve(cookie, atA.id, { role: "dentist", branchIds: [a.id, b.id] });
    expect(wide.status).toBe(403);
    expect((await wide.json()).error.message).toBe("You can only give branches you work at.");
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    expect((await call(requestsRoute.GET, request("/api/v1/join-requests", { cookie: dentistCookie }))).status).toBe(403);
  });

  it("lets the owner approve with open branches only", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const b = await makeBranch();
    const closed = await makeBranch();
    await db.update(branches).set({ active: false }).where(eq(branches.id, closed.id));
    const pending = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    expect((await approve(cookie, pending.id, { role: "manager", branchIds: [a.id, closed.id] })).status).toBe(400);
    expect((await approve(cookie, pending.id, { role: "manager", branchIds: [b.id, a.id] })).status).toBe(200);
    expect(await userRow(pending.id)).toMatchObject({ role: "manager", seesPatients: false, primaryBranchId: a.id });
  });

  it("declines by deleting the account", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const pending = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const res = await call(declineRoute.POST, request(`/api/v1/join-requests/${pending.id}/decline`, { method: "POST", cookie }), { id: pending.id });
    expect(res.status).toBe(200);
    expect(await userRow(pending.id)).toBeUndefined();
    const actions = (await db.select().from(auditLog).where(eq(auditLog.entityId, pending.id))).map((row) => row.action);
    expect(actions).toContain("staff.declined");
  });
});

describe("changing staff", () => {
  it("lets a manager disable a dentist at their branch, ending sessions and sign-ins at once", async () => {
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    const res = await patch(await signIn(manager.username), dentist.id, { status: "disabled" });
    expect(res.status).toBe(200);
    expect(await staffFromHeaders(new Headers({ cookie: dentistCookie }))).toBeNull();
    await expect(signIn(dentist.username)).rejects.toThrow();
  });

  it("keeps managers away from the owner and from themselves", async () => {
    const { owner } = await ownerCookie();
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const cookie = await signIn(manager.username);
    expect((await patch(cookie, owner.id, { title: "Boss" })).status).toBe(403);
    expect((await patch(cookie, manager.id, { title: "Head" })).status).toBe(403);
  });

  it("lets the owner switch their own access to patients but not their role", async () => {
    const { owner, cookie } = await ownerCookie();
    expect((await patch(cookie, owner.id, { seesPatients: true, title: "Dentist" })).status).toBe(200);
    expect((await staffById(owner.id))?.seesPatients).toBe(true);
    expect((await patch(cookie, owner.id, { role: "manager" })).status).toBe(403);
  });

  it("keeps a dentist's other branches when a manager changes theirs", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id, b.id] });
    await db.insert(dentistSchedules).values([
      { dentistId: dentist.id, branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { dentistId: dentist.id, branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    ]);
    expect((await patch(await signIn(manager.username), dentist.id, { branchIds: [] })).status).toBe(200);
    expect(await branchesOf(dentist.id)).toEqual([b.id]);
    const left = await db.select().from(dentistSchedules).where(eq(dentistSchedules.dentistId, dentist.id));
    expect(left.map((row) => row.branchId)).toEqual([b.id]);
    const { cookie } = await ownerCookie();
    const none = await patch(cookie, dentist.id, { branchIds: [] });
    expect(none.status).toBe(400);
    expect((await none.json()).error.fields).toEqual({ branchIds: "Keep at least one branch." });
  });

  it("lists the staff each person may see", async () => {
    const a = await makeBranch();
    const c = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const colleague = await makeUser({ role: "dentist", branchIds: [a.id] });
    const elsewhere = await makeUser({ role: "dentist", branchIds: [c.id] });
    const seen = await (await call(staffListRoute.GET, request("/api/v1/staff", { cookie: await signIn(manager.username) }))).json();
    const ids = seen.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([manager.id, colleague.id]));
    expect(ids).not.toContain(elsewhere.id);
    const { cookie } = await ownerCookie();
    const all = await (await call(staffListRoute.GET, request("/api/v1/staff", { cookie }))).json();
    expect(all.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([manager.id, colleague.id, elsewhere.id]));
  });
});

describe("password reset by QR", () => {
  it("works once, for 15 minutes, and signs the person out everywhere", async () => {
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    const res = await call(resetLinkRoute.POST, request(`/api/v1/staff/${dentist.id}/reset-link`, { method: "POST", cookie: await signIn(manager.username) }), { id: dentist.id });
    expect(res.status).toBe(200);
    const link = await res.json();
    expect(link.url).toMatch(/^http:\/\/localhost:3700\/reset\/[A-Za-z0-9_-]{32}$/);
    expect(link.qrSvg).toContain("<svg");
    const minutes = (Date.parse(link.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const token = link.url.split("/reset/")[1];
    const reset = (password: string) => call(resetRoute.POST, request(`/api/v1/reset/${token}`, { method: "POST", body: { password } }), { token });
    const done = await reset("a fresh password 1");
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ username: dentist.username });
    expect(await staffFromHeaders(new Headers({ cookie: dentistCookie }))).toBeNull();
    await signIn(dentist.username, "a fresh password 1");
    const again = await reset("another password 2");
    expect(again.status).toBe(404);
    expect((await again.json()).error.code).toBe("link_expired");
  });

  it("refuses an expired link", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const link = await (await call(resetLinkRoute.POST, request(`/api/v1/staff/${dentist.id}/reset-link`, { method: "POST", cookie }), { id: dentist.id })).json();
    await db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verifications.value, dentist.id));
    const token = link.url.split("/reset/")[1];
    const res = await call(resetRoute.POST, request(`/api/v1/reset/${token}`, { method: "POST", body: { password: "a fresh password 1" } }), { token });
    expect(res.status).toBe(404);
  });

  it("does not let a manager reset the owner", async () => {
    const { owner } = await ownerCookie();
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const res = await call(resetLinkRoute.POST, request(`/api/v1/staff/${owner.id}/reset-link`, { method: "POST", cookie: await signIn(manager.username) }), { id: owner.id });
    expect(res.status).toBe(403);
  });
});
