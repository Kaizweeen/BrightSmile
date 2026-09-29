import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as availabilityRoute from "@/app/api/v1/availability/route";
import * as overviewRoute from "@/app/api/v1/overview/route";
import { db } from "@/db";
import { appointments, branches, chairs, dentistSchedules, patients, practice, procedures, userBranches } from "@/db/schema";
import { fromMinutes, manilaMinutes } from "@/lib/time";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const at = (clock: string) => new Date(`${MONDAY}T${clock}:00+08:00`);
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  await db.insert(practice).values({ name: "Test Dental", cleaningMinutes: 15 });
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  const ws = await makeBranch({ code: "westside", name: "Westside" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1 },
    { branchId: dt.id, number: 2 },
    { branchId: ws.id, number: 1 },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id, ws.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values([
    { dentistId: reyes.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
    { dentistId: reyes.id, branchId: ws.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:30", endTime: "10:30" },
  ]);
  const [cleaning] = await db.insert(procedures).values({ name: "Oral prophylaxis" }).returning();
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  const [ben] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  const owner = await makeUser({ role: "owner" });
  return { dt, ws, reyes, lim, cleaning, ana, ben, desk: await signIn(desk.username), owner: await signIn(owner.username), dentist: await signIn(lim.username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

type Times = { times: { start: string; dentists: { id: string; chairs: number[] }[] }[] };
const clock = (iso: string) => fromMinutes(manilaMinutes(new Date(iso)));

describe("open times", () => {
  it("lists each start with the dentists and chairs free for it", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&minutes=45`, { cookie: w.desk }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Times & { minutes: number; turnover: number };
    expect(body.minutes).toBe(45);
    expect(body.turnover).toBe(15);
    expect(body.times.map((t) => [clock(t.start), t.dentists.map((d) => d.id)])).toEqual([
      ["09:00", [w.reyes.id]],
      ["09:15", [w.reyes.id]],
      ["09:30", [w.lim.id]],
      ["09:45", [w.lim.id]],
    ]);
  });

  it("leaves out chairs in turnover and a dentist already busy", async () => {
    const w = await world();
    await db.insert(appointments).values({ patientId: w.ana.id, dentistId: w.lim.id, branchId: w.dt.id, chairNumber: 1, startTime: at("09:00"), endTime: at("09:30"), chairFreeAt: at("09:45"), status: "confirmed", source: "staff" });
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&minutes=45&dentist=${w.reyes.id}`, { cookie: w.desk }));
    const body = (await res.json()) as Times;
    expect(body.times.map((t) => [clock(t.start), t.dentists[0].chairs])).toEqual([
      ["09:00", [2]],
      ["09:15", [2]],
    ]);
    const forAna = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&minutes=45&patient=${w.ana.id}`, { cookie: w.desk }));
    expect(((await forAna.json()) as Times).times.map((t) => clock(t.start))).toEqual(["09:30", "09:45"]);
  });

  it("has none at a closed branch", async () => {
    const w = await world();
    const east = await makeBranch({ code: "eastside", name: "Eastside" });
    await db.insert(chairs).values({ branchId: east.id, number: 1 });
    await db.insert(userBranches).values({ userId: w.lim.id, branchId: east.id });
    await db.insert(dentistSchedules).values({ dentistId: w.lim.id, branchId: east.id, dayOfWeek: 1, startTime: "11:00", endTime: "12:00" });
    await db.update(branches).set({ active: false }).where(eq(branches.id, east.id));
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=eastside&date=${MONDAY}&minutes=45`, { cookie: w.owner }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Times).times).toEqual([]);
  });

  it("is for people who book", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&minutes=45`, { cookie: w.dentist }));
    expect(res.status).toBe(403);
  });

  it("uses the practice's standard length when none is given", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&dentist=${w.lim.id}`, { cookie: w.desk }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { minutes: number }).minutes).toBe(60);
  });
});

describe("all branches", () => {
  it("sums up each branch's day for the owner", async () => {
    const w = await world();
    const res = await call(overviewRoute.GET, request(`/api/v1/overview?date=${MONDAY}`, { cookie: w.owner }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const downtown = body.branches.find((b: { code: string }) => b.code === "downtown");
    expect(downtown).toMatchObject({ chairs: 2, chairsInUse: 0, dentistsOnDuty: ["Dr. Lim", "Dr. Reyes"] });
    expect(downtown.counts.confirmed).toBe(1);
    expect(body.branches.find((b: { code: string }) => b.code === "westside").dentistsOnDuty).toEqual(["Dr. Reyes"]);
    expect(body.visits).toHaveLength(1);
  });

  it("is refused to a manager of one branch", async () => {
    const w = await world();
    expect((await call(overviewRoute.GET, request(`/api/v1/overview?date=${MONDAY}`, { cookie: w.desk }))).status).toBe(403);
  });
});
