import { describe, expect, it } from "vitest";
import * as auditRoute from "@/app/api/v1/audit-log/route";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

describe("the access log", () => {
  it("lists entries newest first, 50 at a time, by patient and by staff member", async () => {
    const owner = await makeUser({ role: "owner" });
    const desk = await makeUser({ role: "manager", name: "Liza Ramos" });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    await db.insert(auditLog).values(
      Array.from({ length: 55 }, (_, i) => ({
        userId: i % 2 === 1 ? desk.id : owner.id,
        action: "patient.view",
        entity: "patient",
        entityId: ana.id,
        details: { part: "details" },
      })),
    );
    await db.insert(auditLog).values({ userId: owner.id, action: "branch.created", entity: "branch", entityId: "some-branch" });
    const cookie = await signIn(owner.username);
    const get = async (query: string) => (await call(auditRoute.GET, request(`/api/v1/audit-log${query}`, { cookie }))).json();

    const newest = await get("");
    expect(newest).toHaveLength(50);
    expect(newest[0]).toMatchObject({ action: "auth.signed_in", userName: owner.name });
    const aboutAna = await get(`?patient=${ana.id}`);
    expect(aboutAna).toHaveLength(50);
    expect(aboutAna[0]).toMatchObject({ action: "patient.view", patientName: "Santos, Ana", details: { part: "details" } });
    expect(await get(`?patient=${ana.id}&before=${aboutAna[49].id}`)).toHaveLength(5);
    const byDesk = await get(`?user=${desk.id}`);
    expect(byDesk).toHaveLength(27);
    expect(new Set(byDesk.map((r: { userName: string }) => r.userName))).toEqual(new Set(["Liza Ramos"]));
    // Rows about the person count too, such as someone failing to sign in as them.
    await expect(signIn(desk.username, "not the password")).rejects.toThrow();
    const aboutDesk = await get(`?user=${desk.id}`);
    expect(aboutDesk).toHaveLength(28);
    expect(aboutDesk[0]).toMatchObject({ action: "auth.sign_in_failed", entityId: desk.id, userName: null });
    // Filtering by a patient also finds their visits' rows (booked, moved, status changes).
    const branch = await makeBranch();
    await db.insert(chairs).values({ branchId: branch.id, number: 1 });
    const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
    const start = new Date("2026-10-05T01:00:00Z");
    const end = new Date("2026-10-05T01:30:00Z");
    const [visit] = await db
      .insert(appointments)
      .values({ patientId: ana.id, dentistId: dentist.id, branchId: branch.id, chairNumber: 1, startTime: start, endTime: end, chairFreeAt: end, status: "confirmed", source: "staff" })
      .returning();
    await db.insert(auditLog).values({ userId: desk.id, action: "appointment.created", entity: "appointment", entityId: visit.id, details: { status: "confirmed" } });
    const visitRows = await get(`?patient=${ana.id}`);
    expect(visitRows[0]).toMatchObject({ action: "appointment.created", patientName: "Santos, Ana", userName: "Liza Ramos" });
  });

  it("is for the owner only", async () => {
    const desk = await makeUser({ role: "manager" });
    expect((await call(auditRoute.GET, request("/api/v1/audit-log", { cookie: await signIn(desk.username) }))).status).toBe(403);
  });
});
