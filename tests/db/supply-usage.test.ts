import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as transitionsRoute from "@/app/api/v1/appointments/[id]/transitions/route";
import * as supplyRoute from "@/app/api/v1/supplies/[id]/route";
import * as suppliesRoute from "@/app/api/v1/supplies/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, patients, procedures, supplies } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

let n = 0;
/** Two branches, a manager and a dentist at the first, two services, and visits ready to complete. */
async function build() {
  const branch = await makeBranch({ code: "usage-a" });
  const other = await makeBranch({ code: "usage-b" });
  await db.insert(chairs).values({ branchId: branch.id, number: 1, label: "General" });
  const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
  const manager = await makeUser({ role: "manager", branchIds: [branch.id] });
  const [patient] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Lea" }).returning();
  const [filling] = await db.insert(procedures).values({ name: "Usage filling" }).returning();
  const [cleaning] = await db.insert(procedures).values({ name: "Usage cleaning" }).returning();
  return { branch, other, dentistUser: dentist, patient, filling, cleaning, dentist: await signIn(dentist.username), manager: await signIn(manager.username), owner: await signIn((await makeUser({ role: "owner", branchIds: [] })).username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

/** A visit in treatment that did the given services, in order (a service may repeat). */
async function visitInTreatment(w: Awaited<ReturnType<typeof build>>, serviceIds: string[]) {
  n += 1;
  const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000 - (48 + n * 2) * 3_600_000);
  const end = new Date(start.getTime() + 1_800_000);
  const [row] = await db
    .insert(appointments)
    .values({ patientId: w.patient.id, dentistId: w.dentistUser.id, branchId: w.branch.id, chairNumber: 1, startTime: start, endTime: end, chairFreeAt: end, status: "confirmed", source: "staff" })
    .returning();
  await db.insert(appointmentProcedures).values(serviceIds.map((procedureId, i) => ({ appointmentId: row.id, position: i + 1, procedureId, name: "Service" })));
  for (const to of ["checked_in", "in_treatment"] as const) await db.update(appointments).set({ status: to }).where(eq(appointments.id, row.id));
  return row.id;
}

const add = (cookie: string, body: Record<string, unknown>) => call(suppliesRoute.POST, request("/api/v1/supplies", { method: "POST", cookie, body }));
const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(supplyRoute.PATCH, request(`/api/v1/supplies/${id}`, { method: "PATCH", cookie, body }), { id });
const complete = (cookie: string, id: string) =>
  call(transitionsRoute.POST, request(`/api/v1/appointments/${id}/transitions`, { method: "POST", cookie, body: { to: "completed" } }), { id });
const stock = async (id: string) => (await db.select().from(supplies).where(eq(supplies.id, id)))[0].quantity;

describe("supplies used per service", () => {
  it("lets a manager set, list and replace the services that use a supply", async () => {
    const w = await world();
    const res = await add(w.manager, { branch: "usage-a", name: "Composite", quantity: 10, usage: [{ procedureId: w.filling.id, quantity: 2 }] });
    expect(res.status).toBe(201);
    const { id, usage } = await res.json();
    expect(usage).toEqual([{ procedureId: w.filling.id, quantity: 2 }]);
    const changed = await patch(w.manager, id, { usage: [{ procedureId: w.cleaning.id, quantity: 1 }] });
    expect((await changed.json()).usage).toEqual([{ procedureId: w.cleaning.id, quantity: 1 }]);
    const listed = await (await call(suppliesRoute.GET, request("/api/v1/supplies?branch=usage-a", { cookie: w.manager }))).json();
    expect(listed.find((s: { id: string }) => s.id === id).usage).toEqual([{ procedureId: w.cleaning.id, quantity: 1 }]);
    // Other changes leave the services alone.
    expect((await (await patch(w.manager, id, { adjust: 1 })).json()).usage).toEqual([{ procedureId: w.cleaning.id, quantity: 1 }]);
  });

  it("refuses a service listed twice, an unknown service, a zero amount, and a dentist", async () => {
    const w = await world();
    const { id } = await (await add(w.owner, { branch: "usage-a", name: "Etchant" })).json();
    const twice = [{ procedureId: w.filling.id, quantity: 1 }, { procedureId: w.filling.id, quantity: 2 }];
    expect((await patch(w.owner, id, { usage: twice })).status).toBe(400);
    const unknown = await patch(w.owner, id, { usage: [{ procedureId: crypto.randomUUID(), quantity: 1 }] });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.fields.usage).toBe("Pick services from the list.");
    expect((await patch(w.owner, id, { usage: [{ procedureId: w.filling.id, quantity: 0 }] })).status).toBe(400);
    expect((await patch(w.dentist, id, { usage: [{ procedureId: w.filling.id, quantity: 1 }] })).status).toBe(403);
  });

  it("takes each service's supplies out of the branch's stock when the visit is completed, and logs it", async () => {
    const w = await world();
    const gloves = await (await add(w.owner, { branch: "usage-a", name: "Gloves", quantity: 20, usage: [{ procedureId: w.filling.id, quantity: 2 }, { procedureId: w.cleaning.id, quantity: 1 }] })).json();
    const bond = await (await add(w.owner, { branch: "usage-a", name: "Bond", quantity: 5, usage: [{ procedureId: w.filling.id, quantity: 1 }] })).json();
    // The same supply name at another branch is that branch's stock, and stays put.
    const elsewhere = await (await add(w.owner, { branch: "usage-b", name: "Gloves", quantity: 20, usage: [{ procedureId: w.filling.id, quantity: 2 }] })).json();
    const visit = await visitInTreatment(w, [w.filling.id, w.cleaning.id, w.filling.id]);
    const res = await complete(w.dentist, visit);
    expect(res.status).toBe(200);
    expect((await res.json()).shortages).toEqual([]);
    expect(await stock(gloves.id)).toBe(15);
    expect(await stock(bond.id)).toBe(3);
    expect(await stock(elsewhere.id)).toBe(20);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.entityId, gloves.id)).then((rows) => rows.filter((r) => r.action === "supply.used"));
    expect(entry.details).toEqual({ appointmentId: visit, needed: 5, taken: 5 });
  });

  it("completes the visit even when stock runs short, empties the count, and reports the gap", async () => {
    const w = await world();
    const floss = await (await add(w.owner, { branch: "usage-a", name: "Short floss", quantity: 1, usage: [{ procedureId: w.cleaning.id, quantity: 3 }] })).json();
    const visit = await visitInTreatment(w, [w.cleaning.id]);
    const res = await complete(w.dentist, visit);
    expect(res.status).toBe(200);
    expect((await res.json()).shortages).toEqual([{ supplyId: floss.id, name: "Short floss", unit: "pcs", needed: 3, taken: 1 }]);
    expect(await stock(floss.id)).toBe(0);
    expect((await db.select().from(appointments).where(eq(appointments.id, visit)))[0].status).toBe("completed");
  });

  it("leaves retired supplies alone, and takes nothing for other status changes", async () => {
    const w = await world();
    const old = await (await add(w.owner, { branch: "usage-a", name: "Old bibs", quantity: 4, usage: [{ procedureId: w.cleaning.id, quantity: 1 }] })).json();
    await patch(w.owner, old.id, { active: false });
    const live = await (await add(w.owner, { branch: "usage-a", name: "Live bibs", quantity: 4, usage: [{ procedureId: w.cleaning.id, quantity: 1 }] })).json();
    const visit = await visitInTreatment(w, [w.cleaning.id]);
    expect(await stock(live.id)).toBe(4);
    await complete(w.dentist, visit);
    expect(await stock(old.id)).toBe(4);
    expect(await stock(live.id)).toBe(3);
  });

  it("forgets a supply's services when the service is deleted", async () => {
    const w = await world();
    const [temp] = await db.insert(procedures).values({ name: "Usage temp" }).returning();
    const { id } = await (await add(w.owner, { branch: "usage-a", name: "Temp cement", usage: [{ procedureId: temp.id, quantity: 1 }] })).json();
    await db.delete(procedures).where(eq(procedures.id, temp.id));
    expect((await (await patch(w.owner, id, { adjust: 1 })).json()).usage).toEqual([]);
  });
});
