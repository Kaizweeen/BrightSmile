import { describe, expect, it } from "vitest";
import * as dentistsRoute from "@/app/api/v1/dentists/route";
import * as scheduleRoute from "@/app/api/v1/dentists/[id]/schedule/route";
import * as timeOffListRoute from "@/app/api/v1/dentists/[id]/time-off/route";
import * as timeOffRoute from "@/app/api/v1/time-off/[id]/route";
import { db } from "@/db";
import { appointments, chairs, patients } from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import type { Staff } from "@/server/session";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}

async function setting() {
  const a = await makeBranch({ name: "Downtown" });
  const b = await makeBranch({ name: "Westside", hours: { ...DEFAULT_HOURS, "1": { open: "12:00", close: "20:00" } } });
  const dentist = await makeUser({ role: "dentist", branchIds: [a.id, b.id] });
  const manager = await makeUser({ role: "manager", branchIds: [a.id] });
  return { a, b, dentist, manager };
}

const put = (cookie: string, id: string, blocks: unknown[]) =>
  call(scheduleRoute.PUT, request(`/api/v1/dentists/${id}/schedule`, { method: "PUT", cookie, body: { blocks } }), { id });
const get = (cookie: string, id: string) => call(scheduleRoute.GET, request(`/api/v1/dentists/${id}/schedule`, { cookie }), { id });

describe("weekly schedules", () => {
  it("lets the owner set a split week and reads it back in order", async () => {
    const { a, b, dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [
      { branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
      { branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    ]);
    expect(res.status).toBe(200);
    const week = await (await get(cookie, dentist.id)).json();
    expect(week.map((block: { branchId: string; startTime: string }) => [block.branchId, block.startTime])).toEqual([
      [a.id, "09:00"],
      [b.id, "13:00"],
    ]);
  });

  it("names each block that breaks a rule, by the index sent", async () => {
    const { a, b, dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [
      { branchId: a.id, dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 1, startTime: "10:00", endTime: "13:00" },
      { branchId: a.id, dayOfWeek: 0, startTime: "10:00", endTime: "12:00" },
      { branchId: a.id, dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 2, startTime: "11:00", endTime: "14:00" },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({
      "blocks.0": "The branch is open 09:00 to 18:00 on Monday.",
      "blocks.1": "The branch is open 12:00 to 20:00 on Monday.",
      "blocks.2": "The branch is closed on Sunday.",
      "blocks.3": "Overlaps another block on Tuesday.",
      "blocks.4": "Overlaps another block on Tuesday.",
    });
  });

  it("refuses a branch the dentist does not work at", async () => {
    const { dentist } = await setting();
    const other = await makeBranch();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [{ branchId: other.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" }]);
    expect((await res.json()).error.fields).toEqual({ "blocks.0": "This dentist does not work at that branch." });
  });

  it("lets a manager change only the blocks at their branches", async () => {
    const { a, b, dentist, manager } = await setting();
    const { cookie } = await ownerCookie();
    await put(cookie, dentist.id, [
      { branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    ]);
    const mine = await put(await signIn(manager.username), dentist.id, [{ branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "11:00" }]);
    expect(mine.status).toBe(200);
    const week = await (await get(cookie, dentist.id)).json();
    expect(week.map((block: { branchId: string; endTime: string }) => [block.branchId, block.endTime])).toEqual([
      [a.id, "11:00"],
      [b.id, "17:00"],
    ]);
  });

  it("shows a dentist their own week and nothing more", async () => {
    const { a, dentist } = await setting();
    const other = await makeUser({ role: "dentist", branchIds: [a.id] });
    const cookie = await signIn(dentist.username);
    expect((await get(cookie, dentist.id)).status).toBe(200);
    expect((await put(cookie, dentist.id, [])).status).toBe(403);
    expect((await get(cookie, other.id)).status).toBe(403);
  });
});

describe("dentist list", () => {
  it("lists the dentists each person may see", async () => {
    const { dentist, manager } = await setting();
    const elsewhere = await makeUser({ role: "dentist", branchIds: [(await makeBranch()).id] });
    const list = async (cookie: string) =>
      ((await (await call(dentistsRoute.GET, request("/api/v1/dentists", { cookie }))).json()) as { id: string }[]).map((d) => d.id);
    const forManager = await list(await signIn(manager.username));
    expect(forManager).toContain(dentist.id);
    expect(forManager).not.toContain(elsewhere.id);
    expect(await list(await signIn(dentist.username))).toEqual([dentist.id]);
    expect(await list((await ownerCookie()).cookie)).toEqual(expect.arrayContaining([dentist.id, elsewhere.id]));
  });
});

describe("time off", () => {
  it("adds time off, names the visits it covers, and removes it", async () => {
    const { a, dentist, manager } = await setting();
    await db.insert(chairs).values({ branchId: a.id, number: 1 });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const day = addDays(manilaDate(new Date()), 1);
    await db.insert(appointments).values({
      patientId: ana.id, dentistId: dentist.id, branchId: a.id, chairNumber: 1,
      startTime: manilaInstant(day, 10 * 60), endTime: manilaInstant(day, 11 * 60), chairFreeAt: manilaInstant(day, 11 * 60),
      status: "confirmed", source: "staff",
    });
    const cookie = await signIn(manager.username);
    const res = await call(
      timeOffListRoute.POST,
      request(`/api/v1/dentists/${dentist.id}/time-off`, {
        method: "POST",
        cookie,
        body: { startsAt: manilaInstant(day, 9 * 60).toISOString(), endsAt: manilaInstant(day, 12 * 60).toISOString(), reason: "Seminar" },
      }),
      { id: dentist.id },
    );
    expect(res.status).toBe(201);
    const { id, affected } = await res.json();
    expect(affected).toHaveLength(1);
    expect(affected[0].patientName).toBe("Santos, Ana");

    const listed = await (await call(timeOffListRoute.GET, request(`/api/v1/dentists/${dentist.id}/time-off`, { cookie }), { id: dentist.id })).json();
    expect(listed.map((t: { reason: string }) => t.reason)).toEqual(["Seminar"]);
    expect((await call(timeOffRoute.DELETE, request(`/api/v1/time-off/${id}`, { method: "DELETE", cookie }), { id })).status).toBe(200);
    const after = await (await call(timeOffListRoute.GET, request(`/api/v1/dentists/${dentist.id}/time-off`, { cookie }), { id: dentist.id })).json();
    expect(after).toEqual([]);
  });

  it("refuses an end before the start", async () => {
    const { dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await call(
      timeOffListRoute.POST,
      request(`/api/v1/dentists/${dentist.id}/time-off`, {
        method: "POST",
        cookie,
        body: { startsAt: "2026-10-05T12:00:00+08:00", endsAt: "2026-10-05T09:00:00+08:00", reason: "" },
      }),
      { id: dentist.id },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ endsAt: "The end must be after the start" });
  });
});
