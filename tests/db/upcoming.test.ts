import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as visitsRoute from "@/app/api/v1/staff/[id]/visits/route";
import { db } from "@/db";
import { appointments, chairs, patients } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

/** Whole hours from the next quarter hour, so visits sit on the grid. */
const inHours = (n: number) => new Date(Math.ceil(Date.now() / 900_000) * 900_000 + n * 3_600_000);

describe("a disabled dentist's upcoming visits", () => {
  it("lists them at every branch for the owner and at their own branches for a manager", async () => {
    const dt = await makeBranch({ code: "dt" });
    const ws = await makeBranch({ code: "ws" });
    await db.insert(chairs).values([
      { branchId: dt.id, number: 1 },
      { branchId: ws.id, number: 1 },
    ]);
    const dentist = await makeUser({ role: "dentist", branchIds: [dt.id, ws.id], status: "disabled" });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const visit = (branchId: string, start: Date) => ({
      patientId: ana.id,
      dentistId: dentist.id,
      branchId,
      chairNumber: 1,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      chairFreeAt: new Date(start.getTime() + 1_800_000),
      status: "confirmed",
      source: "staff",
    });
    const rows = await db
      .insert(appointments)
      .values([visit(dt.id, inHours(24)), visit(ws.id, inHours(48)), visit(dt.id, inHours(-48)), visit(dt.id, inHours(72))])
      .returning({ id: appointments.id });
    await db.update(appointments).set({ status: "cancelled", cancelReason: "Dentist left" }).where(eq(appointments.id, rows[3].id));

    const owner = await makeUser({ role: "owner" });
    const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
    const other = await makeUser({ role: "dentist", branchIds: [dt.id] });
    const get = async (username: string) =>
      call(visitsRoute.GET, request(`/api/v1/staff/${dentist.id}/visits`, { cookie: await signIn(username) }), { id: dentist.id });

    const all = await get(owner.username);
    expect(all.status).toBe(200);
    expect((await all.json()).map((v: { branchCode: string }) => v.branchCode)).toEqual(["dt", "ws"]);
    const mine = await get(desk.username);
    expect((await mine.json()).map((v: { branchCode: string }) => v.branchCode)).toEqual(["dt"]);
    expect((await get(other.username)).status).toBe(403);
  });
});
