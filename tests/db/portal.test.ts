import { createHmac } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as appointmentRoute from "@/app/api/v1/appointments/[id]/route";
import * as onlineRequestsRoute from "@/app/api/v1/online-requests/route";
import * as bookingsRoute from "@/app/api/v1/portal/bookings/route";
import * as timesRoute from "@/app/api/v1/portal/times/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, chairs, dentistSchedules, patients, practice, procedureDentists, procedures } from "@/db/schema";
import { normalizeMobile } from "@/lib/validation";
import { clientKey } from "@/server/api";
import { portalInfo } from "@/server/portal";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const WEDNESDAY = "2026-10-07";
// The next Monday: nothing is booked then, and both dentists work.
const NEXT_MONDAY = "2026-10-12";
// The Monday after that, for bookings no other test looks at.
const LATER_MONDAY = "2026-10-19";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);
// 08:00 on Monday in Manila: with two hours' notice, the first online start is 10:00.
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  await db.insert(practice).values({ name: "Smile Dental", visitMinutes: 60, cleaningMinutes: 10, onlineBooking: true, privacyNotice: "We keep your details to run your visits." });
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1 },
    { branchId: dt.id, number: 2 },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values(
    [reyes, lim].flatMap((d) => [1, 2].map((dayOfWeek) => ({ dentistId: d.id, branchId: dt.id, dayOfWeek, startTime: "09:00", endTime: "17:00" }))),
  );
  const [cleaning] = await db.insert(procedures).values({ name: "Oral Prophylaxis (Cleaning)" }).returning();
  const [braces] = await db.insert(procedures).values({ name: "Braces and Retainers" }).returning();
  await db.insert(procedureDentists).values({ procedureId: braces.id, dentistId: lim.id });
  const [hidden] = await db.insert(procedures).values({ name: "Odontectomy (Impacted Wisdom Tooth Extraction)", online: false }).returning();
  // Dr. Lim is busy 10:00 to 11:00 on Monday, on chair 2.
  const [seen] = await db.insert(patients).values({ lastName: "Tan", firstName: "Gio" }).returning();
  await db.insert(appointments).values({ patientId: seen.id, dentistId: lim.id, branchId: dt.id, chairNumber: 2, startTime: at("10:00"), endTime: at("11:00"), chairFreeAt: at("11:10"), status: "confirmed", source: "staff" });
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  return { dt, reyes, lim, cleaning, braces, hidden, desk: await signIn(desk.username), reyesCookie: await signIn(reyes.username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const ip = (n: number) => ({ "x-nf-client-connection-ip": `203.0.113.${n}` });
const times = async (service: string, date = MONDAY) =>
  call(timesRoute.GET, request(`/api/v1/portal/times?branch=downtown&service=${service}&date=${date}`));
const bookOnline = (body: Record<string, unknown>, from = 1) =>
  call(bookingsRoute.POST, request("/api/v1/portal/bookings", { method: "POST", body, headers: ip(from) }));
const details = (firstName: string, lastName: string, mobile: string) => ({ firstName, lastName, mobile, consent: true });
/** What the access log holds for the address `ip(n)` sends: a keyed hash of it (src/server/api.ts). */
const clientOf = (n: number) => clientKey(request("/api/v1/portal/bookings", { headers: ip(n) }));

/**
 * A booking, and how many transactions it opened. A booking takes the global lock inside its transaction, so a refusal
 * that opens none never asked for the lock, and a busy lock cannot delay it.
 */
async function bookCountingTransactions(body: Record<string, unknown>, from: number) {
  const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
  const spy = vi.spyOn(real, "transaction");
  try {
    const res = await bookOnline(body, from);
    return { res, transactions: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

describe("open times online", () => {
  it("offers the open starts two hours away at the earliest, and nothing more", async () => {
    const w = await world();
    const res = await times(w.cleaning.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["times"]);
    expect(body.times[0]).toBe(at("10:00").toISOString());
    expect(body.times.at(-1)).toBe(at("16:00").toISOString());
    expect(body.times).toHaveLength(25);
  });

  it("offers a limited service only when its dentists are free", async () => {
    const w = await world();
    const body = await (await times(w.braces.id)).json();
    expect(body.times[0]).toBe(at("11:00").toISOString());
  });

  it("refuses a service that isn't offered online, and days out of range", async () => {
    const w = await world();
    const res = await times(w.hidden.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("That service isn't offered online.");
    expect((await (await times(w.cleaning.id, "2026-12-31")).json()).times).toEqual([]);
  });
});

describe("booking online", () => {
  it("books a Requested online visit with a dentist and chair DentaSync picks", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:00").toISOString(), note: "Tooth pain", ...details("Ana", "Santos", "0917 123 4567") });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ branch: "Downtown", service: "Oral Prophylaxis (Cleaning)", start: at("10:00").toISOString() });
    const [patient] = await db.select().from(patients).where(eq(patients.mobile, "+639171234567"));
    expect(patient).toMatchObject({ firstName: "Ana", lastName: "Santos", homeBranchId: w.dt.id, createdBy: null });
    const [visit] = await db.select().from(appointments).where(eq(appointments.patientId, patient.id));
    // Dr. Lim is busy at 10:00, so Dr. Reyes gets it, on the free chair 1.
    expect(visit).toMatchObject({ status: "requested", source: "portal", dentistId: w.reyes.id, chairNumber: 1, note: "Tooth pain", createdBy: null });
    expect(visit.endTime.toISOString()).toBe(at("11:00").toISOString());
    expect(visit.chairFreeAt.toISOString()).toBe(at("11:10").toISOString());
    const services = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, visit.id));
    expect(services).toMatchObject([{ position: 0, procedureId: w.cleaning.id, name: "Oral Prophylaxis (Cleaning)" }]);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, visit.id), eq(auditLog.action, "appointment.requested_online")));
    expect(log).toMatchObject({ userId: null, details: { client: clientOf(1), privacyNoticeAccepted: true, online: true, start: at("10:00").toISOString() } });
    // The address itself is never stored (RA 10173): the row holds a keyed hash of it.
    expect(clientOf(1)).toBe(createHmac("sha256", process.env.BETTER_AUTH_SECRET as string).update("203.0.113.1").digest("base64url").slice(0, 22));
    expect(log.details).not.toHaveProperty("ip");
    expect(JSON.stringify(log.details)).not.toContain("203.0.113.1");
    // The new patient's own row names no one and holds nothing about them.
    const [created] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, patient.id), eq(auditLog.action, "patient.created")));
    expect(created).toMatchObject({ userId: null, entity: "patient", branchId: w.dt.id });
    expect(created.details).toEqual({ online: true });
    // The front desk sees the visit's history as done by the online booking, not by "Someone".
    const detail = await (await call(appointmentRoute.GET, request(`/api/v1/appointments/${visit.id}`, { cookie: w.desk }), { id: visit.id })).json();
    expect(detail.history).toContainEqual(expect.objectContaining({ by: "Online booking", text: "Booked online, waiting to be confirmed" }));
  });

  it("gives the free dentist with the fewest visits that day, then the first by name", async () => {
    const w = await world();
    // Both are free at 13:00 and each has one visit today: Dr. Lim comes first by name.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("13:00").toISOString(), ...details("Ben", "Cruz", "0918 000 0001") });
    // Now Dr. Lim has two and Dr. Reyes one: 14:00 goes to Dr. Reyes.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("14:00").toISOString(), ...details("Cyd", "Uy", "0918 000 0002") });
    const rows = await db.select().from(appointments).where(eq(appointments.source, "portal"));
    const visitAt = (clock: string) => rows.find((r) => r.startTime.getTime() === at(clock).getTime());
    expect(visitAt("13:00")?.dentistId).toBe(w.lim.id);
    expect(visitAt("14:00")?.dentistId).toBe(w.reyes.id);
    // Both chairs are free at 13:00, so it is the lowest one that is taken.
    expect(visitAt("13:00")?.chairNumber).toBe(1);
  });

  it("puts a returning patient's booking on their record", async () => {
    const w = await world();
    const [dee] = await db.insert(patients).values({ lastName: "Reyes", firstName: "Dee", mobile: "+639181112222" }).returning();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00").toISOString(), ...details(" DEE ", " reyes ", "09181112222") }, 2);
    expect(res.status).toBe(201);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639181112222"))).toHaveLength(1);
    const [visit] = await db.select().from(appointments).where(eq(appointments.patientId, dee.id));
    expect(visit.startTime.toISOString()).toBe(at("15:00").toISOString());
  });

  it("gives another first name on the same mobile number and last name a record of its own", async () => {
    const w = await world();
    // A parent's phone: a child booked from it must not land on the parent's chart.
    const [lorna] = await db.insert(patients).values({ lastName: "Dizon", firstName: "Lorna", mobile: "+639182223333" }).returning();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("13:00", LATER_MONDAY).toISOString(), ...details("Mika", "Dizon", "0918 222 3333") }, 9);
    expect(res.status).toBe(201);
    const onThatNumber = await db.select().from(patients).where(eq(patients.mobile, "+639182223333"));
    expect(onThatNumber.map((p) => p.firstName).sort()).toEqual(["Lorna", "Mika"]);
    const mika = onThatNumber.find((p) => p.firstName === "Mika");
    expect(await db.select().from(appointments).where(eq(appointments.patientId, mika?.id ?? ""))).toHaveLength(1);
    expect(await db.select().from(appointments).where(eq(appointments.patientId, lorna.id))).toEqual([]);
  });

  it("refuses a time that was just taken", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:00").toISOString(), ...details("Eli", "Go", "0918 000 0003") }, 2);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("That time was just taken. Please pick another.");
  });

  it("lets each patient have at most two requests waiting", async () => {
    const w = await world();
    expect((await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00").toISOString(), ...details("Ana", "Santos", "09171234567") }, 3)).status).toBe(201);
    const third = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("09:00", TUESDAY).toISOString(), ...details("Ana", "Santos", "09171234567") }, 3);
    expect(third.status).toBe(429);
    expect((await third.json()).error.message).toBe("You already have 2 requests waiting. The clinic will call you.");
    // A time that is taken is refused as taken, whoever asks: the answer never depends on the patient (spec 7).
    const gone = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:00").toISOString(), ...details("Ana", "Santos", "09171234567") }, 3);
    expect(gone.status).toBe(409);
  });

  it("allows five bookings an hour from one connection", async () => {
    const w = await world();
    for (let i = 0; i < 5; i += 1) {
      const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at(`${10 + i}:00`, TUESDAY).toISOString(), ...details("Guest", `Five${i}`, `0919000000${i}`) }, 4);
      expect(res.status).toBe(201);
    }
    const sixth = await bookCountingTransactions({ branch: "downtown", service: w.cleaning.id, start: at("15:00", TUESDAY).toISOString(), ...details("Guest", "Six", "09190000009") }, 4);
    expect(sixth.res.status).toBe(429);
    expect((await sixth.res.json()).error.message).toBe("Too many bookings from this connection. Please call the clinic.");
    // A connection at its limit is refused before the lock, so it never queues behind other bookings.
    expect(sixth.transactions).toBe(0);
  });

  it("answers a bot as if it booked, and saves nothing", async () => {
    const w = await world();
    const before = (await db.select().from(appointments)).length;
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), website: "http://spam.example", ...details("Bot", "Bot", "09190000008") }, 5);
    expect(res.status).toBe(201);
    expect((await db.select().from(appointments)).length).toBe(before);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639190000008"))).toEqual([]);
  });

  it("needs the privacy notice agreed", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), ...details("Fe", "Lim", "09190000007"), consent: false }, 6);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.consent).toBe("Agree to the privacy notice to book.");
  });

  it("is closed when online booking is off", async () => {
    const w = await world();
    await db.update(practice).set({ onlineBooking: false });
    const res = await times(w.cleaning.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Online booking isn't available right now.");
    const booked = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), ...details("Fe", "Lim", "09190000007") }, 6);
    expect(booked.status).toBe(404);
    await db.update(practice).set({ onlineBooking: true });
  });

  it("refuses a branch that is closed", async () => {
    const w = await world();
    await db.update(branches).set({ active: false }).where(eq(branches.id, w.dt.id));
    try {
      const booked = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), ...details("Fe", "Lim", "09190000007") }, 6);
      expect(booked.status).toBe(404);
      expect((await booked.json()).error.message).toBe("That branch doesn't take online bookings.");
      const open = await times(w.cleaning.id);
      expect(open.status).toBe(404);
      expect((await open.json()).error.message).toBe("That branch doesn't take online bookings.");
    } finally {
      await db.update(branches).set({ active: true }).where(eq(branches.id, w.dt.id));
    }
  });
});

describe("refusals on the booking route", () => {
  // The highest chart number before any refusal below: a refused booking must not use one up.
  let chartNoBefore = 0;
  beforeAll(async () => {
    await world();
    chartNoBefore = (await db.select({ n: max(patients.chartNo) }).from(patients))[0].n ?? 0;
  });

  /** A start no list offers, refused as taken before the lock: nothing is saved, and no patient is left for the new mobile number. */
  async function expectTaken(start: Date, firstName: string, lastName: string, mobile: string, from: number) {
    const w = await world();
    const visits = (await db.select().from(appointments)).length;
    const { res, transactions } = await bookCountingTransactions({ branch: "downtown", service: w.cleaning.id, start: start.toISOString(), ...details(firstName, lastName, mobile) }, from);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("That time was just taken. Please pick another.");
    // No transaction, so no global lock.
    expect(transactions).toBe(0);
    expect((await db.select().from(appointments)).length).toBe(visits);
    expect(await db.select().from(patients).where(eq(patients.mobile, normalizeMobile(mobile) ?? ""))).toEqual([]);
  }

  it("refuses a start inside the two hours' notice", async () => {
    await expectTaken(at("09:00"), "Uma", "Notice", "09190000101", 7);
  });

  it("refuses a start off the 15-minute grid", async () => {
    await expectTaken(at("10:07"), "Ollie", "Grid", "09190000102", 7);
    await expectTaken(new Date(at("10:15").getTime() + 30_000), "Ollie", "Seconds", "09190000102", 7);
  });

  it("refuses a start more than 30 days ahead", async () => {
    // 35 days after Monday 2026-10-05, at a time the branch is open.
    await expectTaken(at("10:00", "2026-11-09"), "Vera", "Faraway", "09190000105", 7);
  });

  it("gives a patient no second visit at the same time, though another dentist is free", async () => {
    const w = await world();
    const rosa = { branch: "downtown", service: w.cleaning.id, ...details("Rosa", "Nolasco", "09190000103") };
    expect((await bookOnline({ ...rosa, start: at("10:00", NEXT_MONDAY).toISOString() }, 8)).status).toBe(201);
    // Dr. Reyes is free at 10:30, and the public list offers it: the only one busy is Rosa, who is with Dr. Lim until 11:00.
    expect((await (await times(w.cleaning.id, NEXT_MONDAY)).json()).times).toContain(at("10:30", NEXT_MONDAY).toISOString());
    const visits = (await db.select().from(appointments)).length;
    const again = await bookOnline({ ...rosa, start: at("10:30", NEXT_MONDAY).toISOString() }, 8);
    expect(again.status).toBe(409);
    expect((await again.json()).error.message).toBe("That time was just taken. Please pick another.");
    expect((await db.select().from(appointments)).length).toBe(visits);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639190000103"))).toHaveLength(1);
    // Anyone else can have that 10:30.
    const sam = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:30", NEXT_MONDAY).toISOString(), ...details("Sam", "Ocampo", "09190000104") }, 8);
    expect(sam.status).toBe(201);
    // The two refusals of new patients before this test used no chart number: Rosa's is the one after the highest.
    const [patient] = await db.select().from(patients).where(eq(patients.mobile, "+639190000103"));
    expect(patient.chartNo).toBe(chartNoBefore + 1);
  });

  it("answers busy when the database gives up waiting for the global lock", async () => {
    const w = await world();
    // A real wait needs two connections and PGlite has one, so the database's answer (55P03, lock_not_available) is injected.
    const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
    const spy = vi.spyOn(real, "transaction").mockRejectedValueOnce(Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }));
    try {
      const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00", LATER_MONDAY).toISOString(), ...details("Lock", "Busy", "09190000106") }, 11);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatchObject({ code: "busy", message: "Online booking is busy right now. Please try again in a moment." });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("online requests", () => {
  it("lists the branch's waiting online requests for the front desk", async () => {
    const w = await world();
    // Visits the list must leave out, for people named Excluded: one booked by staff, one already confirmed, and one that has
    // started. They clash with nothing: each is Dr. Reyes on chair 1 at a time when no other visit is.
    for (const [firstName, status, source, start] of [
      ["Staff", "requested", "staff", at("09:00", WEDNESDAY)],
      ["Confirmed", "confirmed", "portal", at("11:00", WEDNESDAY)],
      ["Started", "requested", "portal", at("07:00")],
    ] as const) {
      const [person] = await db.insert(patients).values({ lastName: "Excluded", firstName }).returning();
      const end = new Date(start.getTime() + 3_600_000);
      await db.insert(appointments).values({
        patientId: person.id,
        dentistId: w.reyes.id,
        branchId: w.dt.id,
        chairNumber: 1,
        startTime: start,
        endTime: end,
        chairFreeAt: new Date(end.getTime() + 600_000),
        status,
        source,
      });
    }
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.desk }));
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list).toContainEqual(
      expect.objectContaining({ patientName: "Santos, Ana", mobile: "+639171234567", services: ["Oral Prophylaxis (Cleaning)"], dentistName: "Dr. Reyes", note: "Tooth pain" }),
    );
    expect(list.filter((r: { patientName: string }) => r.patientName.startsWith("Excluded"))).toEqual([]);
  });

  it("is for people who manage the branch's visits", async () => {
    const w = await world();
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.reyesCookie }));
    expect(res.status).toBe(403);
  });
});

describe("what /book offers", () => {
  it("offers a limited service only at the branches where one of its dentists works", async () => {
    const w = await world();
    await makeBranch({ code: "uptown", name: "Uptown" });
    // The owner works at every branch; Dr. Nowhere at none; Dr. Gone is disabled.
    const owner = await makeUser({ role: "owner", seesPatients: true });
    const nowhere = await makeUser({ role: "dentist", name: "Dr. Nowhere" });
    const gone = await makeUser({ role: "dentist", name: "Dr. Gone", status: "disabled", branchIds: [w.dt.id] });
    const [whitening] = await db.insert(procedures).values({ name: "Laser Teeth Whitening (Bleach)" }).returning();
    const [dentures] = await db.insert(procedures).values({ name: "Dentures (Pustiso)" }).returning();
    const [crowns] = await db.insert(procedures).values({ name: "Veneers and Crowns" }).returning();
    await db.insert(procedureDentists).values([
      { procedureId: whitening.id, dentistId: owner.id },
      { procedureId: dentures.id, dentistId: nowhere.id },
      { procedureId: crowns.id, dentistId: gone.id },
    ]);
    const info = await portalInfo();
    if (!info.open) throw new Error("Online booking should be on.");
    expect(info.branches).toEqual([
      { code: "downtown", name: "Downtown" },
      { code: "uptown", name: "Uptown" },
    ]);
    // Braces: only Dr. Lim, who works at Downtown. Not listed: the service that is not offered online, and the two that
    // no working dentist can take anywhere.
    expect(info.services).toEqual([
      { id: w.braces.id, name: "Braces and Retainers", branches: ["downtown"] },
      { id: whitening.id, name: "Laser Teeth Whitening (Bleach)", branches: ["downtown", "uptown"] },
      { id: w.cleaning.id, name: "Oral Prophylaxis (Cleaning)", branches: null },
    ]);
  });
});

describe("the access log", () => {
  it("holds no client address from any booking above", async () => {
    const rows = await db.select().from(auditLog);
    expect(rows.filter((r) => r.action === "appointment.requested_online").length).toBeGreaterThan(5);
    expect(JSON.stringify(rows.map((r) => r.details))).not.toContain("203.0.113.");
  });
});
