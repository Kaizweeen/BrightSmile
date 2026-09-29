import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as onlineRequestsRoute from "@/app/api/v1/online-requests/route";
import * as bookingsRoute from "@/app/api/v1/portal/bookings/route";
import * as timesRoute from "@/app/api/v1/portal/times/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, dentistSchedules, patients, practice, procedureDentists, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
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
    expect(log).toMatchObject({ userId: null, details: { ip: "203.0.113.1", privacyNoticeAccepted: true, online: true } });
  });

  it("gives the free dentist with the fewest visits that day, then the first by name", async () => {
    const w = await world();
    // Both are free at 13:00 and each has one visit today: Dr. Lim comes first by name.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("13:00").toISOString(), ...details("Ben", "Cruz", "0918 000 0001") });
    // Now Dr. Lim has two and Dr. Reyes one: 14:00 goes to Dr. Reyes.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("14:00").toISOString(), ...details("Cyd", "Uy", "0918 000 0002") });
    const rows = await db.select().from(appointments).where(eq(appointments.source, "portal"));
    const dentistAt = (clock: string) => rows.find((r) => r.startTime.getTime() === at(clock).getTime())?.dentistId;
    expect(dentistAt("13:00")).toBe(w.lim.id);
    expect(dentistAt("14:00")).toBe(w.reyes.id);
  });

  it("puts a returning patient's booking on their record", async () => {
    const w = await world();
    const [dee] = await db.insert(patients).values({ lastName: "Reyes", firstName: "Dee", mobile: "+639181112222" }).returning();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00").toISOString(), ...details("Dee", " reyes ", "09181112222") }, 2);
    expect(res.status).toBe(201);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639181112222"))).toHaveLength(1);
    const [visit] = await db.select().from(appointments).where(eq(appointments.patientId, dee.id));
    expect(visit.startTime.toISOString()).toBe(at("15:00").toISOString());
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
  });

  it("allows five bookings an hour from one connection", async () => {
    const w = await world();
    for (let i = 0; i < 5; i += 1) {
      const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at(`${10 + i}:00`, TUESDAY).toISOString(), ...details("Guest", `Five${i}`, `0919000000${i}`) }, 4);
      expect(res.status).toBe(201);
    }
    const sixth = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00", TUESDAY).toISOString(), ...details("Guest", "Six", "09190000009") }, 4);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.message).toBe("Too many bookings from this connection. Please call the clinic.");
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
});

describe("online requests", () => {
  it("lists the branch's waiting online requests for the front desk", async () => {
    const w = await world();
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.desk }));
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list).toContainEqual(
      expect.objectContaining({ patientName: "Santos, Ana", mobile: "+639171234567", services: ["Oral Prophylaxis (Cleaning)"], dentistName: "Dr. Reyes", note: "Tooth pain" }),
    );
  });

  it("is for people who manage the branch's visits", async () => {
    const w = await world();
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.reyesCookie }));
    expect(res.status).toBe(403);
  });
});
