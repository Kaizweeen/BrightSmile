import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as transitionsRoute from "@/app/api/v1/appointments/[id]/transitions/route";
import * as appointmentRoute from "@/app/api/v1/appointments/[id]/route";
import * as appointmentsRoute from "@/app/api/v1/appointments/route";
import * as validateRoute from "@/app/api/v1/appointments/validate/route";
import * as conflictsRoute from "@/app/api/v1/chairs/conflicts/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, dentistSchedules, patients, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);

// 08:00 on Monday in Manila, for the whole file: time rules and "now" are deterministic, and PGlite follows it too.
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  const ws = await makeBranch({ code: "westside", name: "Westside" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1, label: "General" },
    { branchId: dt.id, number: 2, label: "Ortho" },
    { branchId: ws.id, number: 1, label: "General" },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id, ws.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values([
    { dentistId: reyes.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dentistId: reyes.id, branchId: ws.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
  ]);
  const [cleaning] = await db.insert(procedures).values({ name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 }).returning();
  const [filling] = await db.insert(procedures).values({ name: "Tooth filling", durationMinutes: 60, bufferMinutes: 15 }).returning();
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana", allergies: ["latex"] }).returning();
  const [ben] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
  const [cyd] = await db.insert(patients).values({ lastName: "Uy", firstName: "Cyd" }).returning();
  const deskDtUser = await makeUser({ role: "manager", branchIds: [dt.id] });
  const deskWs = await makeUser({ role: "manager", branchIds: [ws.id] });
  return {
    dt, ws, reyes, lim, cleaning, filling, ana, ben, cyd, deskDtUser,
    deskDt: await signIn(deskDtUser.username),
    deskWs: await signIn(deskWs.username),
    reyesCookie: await signIn(reyes.username),
    limCookie: await signIn(lim.username),
  };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const book = (cookie: string, body: Record<string, unknown>) =>
  call(appointmentsRoute.POST, request("/api/v1/appointments", { method: "POST", cookie, body }));
const move = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(appointmentRoute.PATCH, request(`/api/v1/appointments/${id}`, { method: "PATCH", cookie, body }), { id });
const change = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(transitionsRoute.POST, request(`/api/v1/appointments/${id}/transitions`, { method: "POST", cookie, body }), { id });
const visitRow = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

/** Runs `meanwhile` just before the next transaction starts, as if another front desk saved first (spec 8.8). */
function beforeNextTransaction(meanwhile: () => Promise<unknown>) {
  const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
  const original = real.transaction.bind(real);
  return vi.spyOn(real, "transaction").mockImplementationOnce((async (run: never, config: never) => {
    await meanwhile();
    return original(run, config);
  }) as never);
}

let first = ""; // Ana with Dr. Reyes, booked in the first test and used by later ones
let requested = "";
let walkIn = "";
let evening = "";

describe("booking", () => {
  it("books a visit and holds its chair through turnover", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ana.id, start: at("10:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(201);
    first = (await res.json()).id;
    const row = await visitRow(first);
    expect(row).toMatchObject({ status: "confirmed", source: "staff", chairNumber: 1 });
    expect(row.endTime.toISOString()).toBe(at("10:45").toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("11:00").toISOString());
    const snapshot = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, first));
    expect(snapshot).toMatchObject([{ position: 0, name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 }]);
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entityId, first), eq(auditLog.action, "appointment.created")));
    expect(log).toHaveLength(1);
  });

  it("answers validation without saving", async () => {
    const w = await world();
    const res = await call(
      validateRoute.POST,
      request("/api/v1/appointments/validate", { method: "POST", cookie: w.deskDt, body: { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("10:30").toISOString(), procedureIds: [w.cleaning.id] } }),
    );
    expect(res.status).toBe(200);
    const check = await res.json();
    expect(check.ok).toBe(false);
    expect(check.errors.map((e: { code: string }) => e.code)).toEqual(["chair_overlap"]);
    expect(check.conflicts).toMatchObject([{ kind: "chair", appointmentId: first, chairNumber: 1, branch: "Downtown" }]);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("refuses a dentist where the schedule puts them at another branch", async () => {
    const w = await world();
    const res = await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("11:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(422);
    const error = (await res.json()).error;
    expect(error.code).toBe("refused");
    expect(error.errors.map((e: { code: string }) => e.code)).toEqual(["dentist_elsewhere"]);
    expect(error.message).toBe("Dr. Reyes works at Downtown from 09:00 to 12:00 on Monday.");
  });

  it("refuses one dentist at two branches at once with 409, naming the visit", async () => {
    const w = await world();
    await db.insert(appointments).values({ patientId: w.cyd.id, dentistId: w.reyes.id, branchId: w.dt.id, chairNumber: 2, startTime: at("13:00"), endTime: at("13:30"), chairFreeAt: at("13:30"), status: "confirmed", source: "staff" });
    const res = await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("13:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(409);
    const error = (await res.json()).error;
    expect(error.code).toBe("conflict");
    expect(error.conflicts).toMatchObject([{ kind: "dentist", branch: "Downtown", dentist: "Dr. Reyes" }]);
  });

  it("asks for a second look outside hours, then books it", async () => {
    const w = await world();
    const body = { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.ben.id, start: at("17:30").toISOString(), procedureIds: [w.filling.id] };
    const first = await book(w.deskDt, body);
    expect(first.status).toBe(422);
    const error = (await first.json()).error;
    expect(error.code).toBe("warnings");
    expect(error.warnings.map((x: { code: string }) => x.code)).toEqual(["outside_dentist_hours", "outside_branch_hours"]);
    const again = await book(w.deskDt, { ...body, acknowledgeWarnings: true });
    expect(again.status).toBe(201);
    evening = (await again.json()).id;
  });

  it("books a walk-in now, as checked in", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.cyd.id, walkIn: true, procedureIds: [w.cleaning.id], acknowledgeWarnings: true });
    expect(res.status).toBe(201);
    walkIn = (await res.json()).id;
    const row = await visitRow(walkIn);
    expect(row).toMatchObject({ status: "checked_in", source: "walk_in" });
    expect(row.startTime.toISOString()).toBe(at("08:00").toISOString());
    expect(row.checkedInAt).not.toBeNull();
  });

  it("books a visit as requested while the patient still has to confirm", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.cyd.id, start: at("11:00").toISOString(), procedureIds: [w.cleaning.id], requested: true });
    expect(res.status).toBe(201);
    requested = (await res.json()).id;
    expect(await visitRow(requested)).toMatchObject({ status: "requested", confirmedAt: null });
  });

  it("refuses another branch's front desk and starts off the grid", async () => {
    const w = await world();
    const body = { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("14:00").toISOString(), procedureIds: [w.cleaning.id] };
    expect((await book(w.deskWs, body)).status).toBe(403);
    const odd = await book(w.deskDt, { ...body, start: at("14:10").toISOString() });
    expect(odd.status).toBe(400);
    expect((await odd.json()).error.fields).toEqual({ start: "Pick a start on the 15-minute grid." });
  });
});

describe("moving", () => {
  it("moves a confirmed visit and keeps its status", async () => {
    const w = await world();
    const res = await move(w.deskDt, first, { start: at("11:15").toISOString(), chairNumber: 2 });
    expect(res.status).toBe(200);
    const row = await visitRow(first);
    expect(row).toMatchObject({ status: "confirmed", chairNumber: 2 });
    expect(row.startTime.toISOString()).toBe(at("11:15").toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("12:15").toISOString());
  });

  it("lets a checked-in visit change only its chair", async () => {
    const w = await world();
    expect((await move(w.deskDt, walkIn, { chairNumber: 1 })).status).toBe(200);
    expect((await visitRow(walkIn)).chairNumber).toBe(1);
    const res = await move(w.deskDt, walkIn, { start: at("09:00").toISOString() });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("A checked-in visit can change only its chair.");
  });

  it("refuses a move that lost a race to another change of the same visit, and keeps dentists from moving visits", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("15:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await move(w.limCookie, id, { chairNumber: 2 })).status).toBe(403);
    // Another front desk moves it to chair 2 after this move read the visit and before it saved (spec 8.8).
    const race = beforeNextTransaction(() => db.update(appointments).set({ chairNumber: 2 }).where(eq(appointments.id, id)));
    const late = await move(w.deskDt, id, { start: at("15:30").toISOString() });
    race.mockRestore();
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe("changed");
    const row = await visitRow(id);
    expect(row.chairNumber).toBe(2);
    expect(row.startTime.toISOString()).toBe(at("15:00").toISOString());
    const bare = await change(w.deskDt, id, { to: "cancelled", reason: null });
    expect((await bare.json()).error.fields).toEqual({ reason: "Give a reason for cancelling." });
  });
});

describe("lifecycle", () => {
  it("lets each role make only its own changes, in order, on time", async () => {
    const w = await world();
    expect((await change(w.reyesCookie, first, { to: "checked_in" })).status).toBe(403);
    const early = await change(w.deskDt, first, { to: "no_show" });
    expect(early.status).toBe(422);
    expect((await early.json()).error.message).toBe("A visit becomes a no-show only after its start time.");
    expect((await change(w.deskDt, first, { to: "checked_in" })).status).toBe(200);
    expect((await change(w.limCookie, first, { to: "in_treatment" })).status).toBe(403);
    expect((await change(w.reyesCookie, first, { to: "in_treatment" })).status).toBe(200);
    expect((await change(w.reyesCookie, first, { to: "completed" })).status).toBe(200);
    const done = await visitRow(first);
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
  });

  it("needs a reason to cancel and never reopens a cancelled visit", async () => {
    const w = await world();
    const bare = await change(w.deskDt, requested, { to: "cancelled" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.fields).toEqual({ reason: "Give a reason for cancelling." });
    expect((await change(w.deskDt, requested, { to: "cancelled", reason: "Patient called" })).status).toBe(200);
    expect(await visitRow(requested)).toMatchObject({ status: "cancelled", cancelReason: "Patient called" });
    const reopen = await change(w.deskDt, requested, { to: "confirmed" });
    expect(reopen.status).toBe(422);
    expect((await reopen.json()).error.message).toBe("A cancelled visit cannot become confirmed.");
  });

  it("checks in only on the visit's day and marks no-shows after the start", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("10:00", TUESDAY).toISOString(), procedureIds: [w.cleaning.id] });
    const { id } = await res.json();
    const tooSoon = await change(w.deskDt, id, { to: "checked_in" });
    expect(tooSoon.status).toBe(422);
    expect((await tooSoon.json()).error.message).toBe("Check in on the day of the visit.");
    vi.setSystemTime(at("10:30", TUESDAY));
    try {
      // Monday's sessions have expired by Tuesday (12 hours, spec 6.7), so sign in again.
      const desk = await signIn(w.deskDtUser.username);
      expect((await change(desk, id, { to: "no_show" })).status).toBe(200);
      expect((await change(desk, id, { to: "checked_in" })).status).toBe(200);
    } finally {
      vi.setSystemTime(at("08:00"));
    }
  });
});

describe("reading visits", () => {
  it("lists a branch's visits and a dentist's own visits at every branch", async () => {
    const w = await world();
    const range = `from=${encodeURIComponent(at("00:00").toISOString())}&to=${encodeURIComponent(at("00:00", TUESDAY).toISOString())}`;
    const list = async (cookie: string, query: string) => call(appointmentsRoute.GET, request(`/api/v1/appointments?${query}&${range}`, { cookie }));
    const day = await (await list(w.deskDt, "branch=downtown")).json();
    const mine = day.find((v: { id: string }) => v.id === first);
    expect(mine).toMatchObject({ patientName: "Santos, Ana", dentistName: "Dr. Reyes", chairLabel: "Ortho", hasAlerts: true, procedures: ["Oral prophylaxis"], status: "completed", branchCode: "downtown" });

    await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("14:00").toISOString(), procedureIds: [w.cleaning.id] });
    const own = await (await list(w.reyesCookie, `branch=all&dentist=${w.reyes.id}`)).json();
    expect(new Set(own.map((v: { branchName: string }) => v.branchName))).toEqual(new Set(["Downtown", "Westside"]));
    expect((await list(w.reyesCookie, "branch=all")).status).toBe(403);
    expect((await list(w.deskDt, "branch=westside")).status).toBe(403);
  });

  it("shows a visit's alerts, procedures, and history", async () => {
    const w = await world();
    const res = await call(appointmentRoute.GET, request(`/api/v1/appointments/${first}`, { cookie: w.deskDt }), { id: first });
    const detail = await res.json();
    expect(detail.alerts).toEqual(["Allergy: Latex"]);
    expect(detail.procedureIds).toEqual([w.cleaning.id]);
    expect(detail.history.map((h: { text: string }) => h.text)).toEqual([
      "Booked as confirmed",
      expect.stringMatching(/^Moved to .+, chair 2$/),
      "Confirmed to checked in",
      "Checked in to in treatment",
      "In treatment to completed",
    ]);
  });

  it("reports a chair's conflicts, turnover included", async () => {
    const w = await world();
    const ask = async (from: string, until: string) =>
      (
        await (
          await call(conflictsRoute.GET, request(`/api/v1/chairs/conflicts?branch=downtown&chair=2&from=${encodeURIComponent(at(from).toISOString())}&until=${encodeURIComponent(at(until).toISOString())}`, { cookie: w.deskDt }))
        ).json()
      ).map((c: { appointmentId: string }) => c.appointmentId);
    expect(await ask("18:35", "18:40")).toEqual([evening]);
    expect(await ask("18:45", "19:00")).toEqual([]);
  });
});
