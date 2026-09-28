import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as patientRoute from "@/app/api/v1/patients/[id]/route";
import * as visitsRoute from "@/app/api/v1/patients/[id]/visits/route";
import * as patientsRoute from "@/app/api/v1/patients/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, patients, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

async function frontDesk() {
  const branch = await makeBranch({ name: "Downtown" });
  const manager = await makeUser({ role: "manager", branchIds: [branch.id] });
  return { branch, manager, cookie: await signIn(manager.username) };
}
const add = (cookie: string, body: unknown) => call(patientsRoute.POST, request("/api/v1/patients", { method: "POST", cookie, body }));
const find = async (cookie: string, q: string) =>
  ((await (await call(patientsRoute.GET, request(`/api/v1/patients?q=${encodeURIComponent(q)}`, { cookie }))).json()) as { id: string }[]).map((p) => p.id);

describe("patients", () => {
  it("adds a patient, blanks become empty, and the consent is recorded with who recorded it", async () => {
    const { manager, cookie } = await frontDesk();
    const res = await add(cookie, { lastName: "Santos", firstName: "Ana", middleName: "", birthday: "1990-04-02", mobile: "0917 123 4567", allergies: ["latex"], medicalAlerts: "Hypertension", consent: true });
    expect(res.status).toBe(201);
    const { id, chartNo } = await res.json();
    expect(chartNo).toBeGreaterThan(0);
    const [row] = await db.select().from(patients).where(eq(patients.id, id));
    expect(row).toMatchObject({ middleName: null, mobile: "+639171234567", allergies: ["latex"], consentBy: manager.id, createdBy: manager.id });
    expect(row.consentAt).not.toBeNull();
  });

  it("finds patients by name, chart number, mobile, and birthday", async () => {
    const { cookie } = await frontDesk();
    const { id, chartNo } = await (await add(cookie, { lastName: "Villanueva", firstName: "Carlo", birthday: "1985-12-25", mobile: "09181112222" })).json();
    expect(await find(cookie, "villanu")).toContain(id);
    expect(await find(cookie, "Carlo Villanueva")).toContain(id);
    expect(await find(cookie, String(chartNo))).toContain(id);
    expect(await find(cookie, "0918 111 2222")).toContain(id);
    expect(await find(cookie, "1985-12-25")).toContain(id);
    expect(await find(cookie, "nobody at all")).toEqual([]);
  });

  it("warns about a likely duplicate and adds it when told to", async () => {
    const { cookie } = await frontDesk();
    await add(cookie, { lastName: "Reyes", firstName: "Lia", birthday: "2001-01-01" });
    const again = await add(cookie, { lastName: "reyes", firstName: "LIA", birthday: "2001-01-01" });
    expect(again.status).toBe(409);
    const body = (await again.json()).error;
    expect(body.code).toBe("possible_duplicate");
    expect(body.candidates).toHaveLength(1);
    expect((await add(cookie, { lastName: "Reyes", firstName: "Lia", birthday: "2001-01-01", allowDuplicate: true })).status).toBe(201);
    await add(cookie, { lastName: "Cruz", firstName: "Ben", mobile: "09170000001" });
    expect((await add(cookie, { lastName: "Cruz-Tan", firstName: "Ben", mobile: "09170000001" })).status).toBe(409);
  });

  it("checks the fields", async () => {
    const { cookie } = await frontDesk();
    const res = await add(cookie, { lastName: "", firstName: "Ana", mobile: "12345", email: "not-an-email", allergies: ["peanuts"] });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["allergies.0", "email", "lastName", "mobile"]);
  });

  it("lets dentists read patients and change only allergies and alerts", async () => {
    const { branch, cookie } = await frontDesk();
    const { id } = await (await add(cookie, { lastName: "Lopez", firstName: "Mara" })).json();
    const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
    const dentistCookie = await signIn(dentist.username);
    expect((await add(dentistCookie, { lastName: "New", firstName: "Person" })).status).toBe(403);
    const patch = (body: unknown) => call(patientRoute.PATCH, request(`/api/v1/patients/${id}`, { method: "PATCH", cookie: dentistCookie, body }), { id });
    expect((await patch({ allergies: ["aspirin"], medicalAlerts: "Asthma" })).status).toBe(200);
    expect((await patch({ address: "Somewhere" })).status).toBe(403);
    const [row] = await db.select().from(patients).where(eq(patients.id, id));
    expect(row).toMatchObject({ allergies: ["aspirin"], medicalAlerts: "Asthma", updatedBy: dentist.id });
  });

  it("logs each view of a record, and changed field names without their values", async () => {
    const { manager, cookie } = await frontDesk();
    const { id } = await (await add(cookie, { lastName: "Tan", firstName: "Leo" })).json();
    const res = await call(patientRoute.GET, request(`/api/v1/patients/${id}`, { cookie }), { id });
    expect(res.status).toBe(200);
    expect((await res.json()).lastName).toBe("Tan");
    await call(patientRoute.PATCH, request(`/api/v1/patients/${id}`, { method: "PATCH", cookie, body: { medicalAlerts: "Diabetes" } }), { id });
    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    const view = log.find((l) => l.action === "patient.view");
    expect(view?.userId).toBe(manager.id);
    const update = log.find((l) => l.action === "patient.updated");
    expect(update?.details).toEqual({ fields: ["medicalAlerts"] });
    expect(JSON.stringify(log)).not.toContain("Diabetes");
  });

  it("lists visits at every branch with the next one", async () => {
    const { branch, cookie } = await frontDesk();
    const other = await makeBranch({ name: "Westside" });
    await db.insert(chairs).values([{ branchId: branch.id, number: 1, label: "General" }, { branchId: other.id, number: 1 }]);
    const dentist = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [branch.id, other.id] });
    const [proc] = await db.insert(procedures).values({ name: `Cleaning ${Date.now()}`, durationMinutes: 45, bufferMinutes: 15 }).returning();
    const { id } = await (await add(cookie, { lastName: "Uy", firstName: "Kim" })).json();
    const visit = async (branchId: string, start: Date, status: string) => {
      const [row] = await db
        .insert(appointments)
        .values({ patientId: id, dentistId: dentist.id, branchId, chairNumber: 1, startTime: start, endTime: new Date(start.getTime() + 45 * 60_000), chairFreeAt: new Date(start.getTime() + 60 * 60_000), status, source: "staff" })
        .returning();
      await db.insert(appointmentProcedures).values({ appointmentId: row.id, position: 0, procedureId: proc.id, name: "Cleaning", durationMinutes: 45, bufferMinutes: 15 });
      return row;
    };
    await visit(other.id, new Date(Date.now() - 30 * 86_400_000), "requested");
    const next = await visit(branch.id, new Date(Date.now() + 7 * 86_400_000), "confirmed");
    const res = await (await call(visitsRoute.GET, request(`/api/v1/patients/${id}/visits`, { cookie }), { id })).json();
    expect(res.visits.map((v: { branchName: string }) => v.branchName)).toEqual(["Downtown", "Westside"]);
    expect(res.visits[0]).toMatchObject({ dentistName: "Dr. Reyes", chairNumber: 1, chairLabel: "General", procedures: ["Cleaning"], status: "confirmed" });
    expect(res.next.id).toBe(next.id);
  });
});
