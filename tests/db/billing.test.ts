import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as closeRoute from "@/app/api/v1/billing/close/route";
import * as voidRoute from "@/app/api/v1/bills/[id]/void/route";
import * as billsRoute from "@/app/api/v1/bills/route";
import * as qrRoute from "@/app/api/v1/practice/qr/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, bills, chairs, patients, practice, procedures } from "@/db/schema";
import { manilaDate } from "@/lib/time";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

let n = 0;
/** A branch with a front desk, a dentist, a patient and a completed visit that did one service. */
async function setup() {
  const branch = await makeBranch();
  await db.insert(chairs).values({ branchId: branch.id, number: 1, label: "General" });
  const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
  const desk = await makeUser({ role: "manager", branchIds: [branch.id] });
  const [patient] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  const [service] = await db.insert(procedures).values({ name: `Filling ${branch.code}`, price: 150000 }).returning();
  const visit = async (finish: boolean) => {
    n += 1;
    const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000 - (48 + n * 2) * 3_600_000);
    const end = new Date(start.getTime() + 1_800_000);
    const [row] = await db
      .insert(appointments)
      .values({ patientId: patient.id, dentistId: dentist.id, branchId: branch.id, chairNumber: 1, startTime: start, endTime: end, chairFreeAt: end, status: "confirmed", source: "staff" })
      .returning();
    await db.insert(appointmentProcedures).values({ appointmentId: row.id, position: 1, procedureId: service.id, name: service.name });
    for (const to of finish ? (["checked_in", "in_treatment", "completed"] as const) : (["checked_in"] as const)) {
      await db.update(appointments).set({ status: to }).where(eq(appointments.id, row.id));
    }
    return row.id;
  };
  const other = await makeBranch();
  const otherDesk = await makeUser({ role: "manager", branchIds: [other.id] });
  return {
    branch,
    service,
    visit,
    desk: await signIn(desk.username),
    deskUser: desk,
    dentist: await signIn(dentist.username),
    otherDesk: await signIn(otherDesk.username),
  };
}

const lines = (unitPrice = 150000) => [{ name: "Filling", qty: 1, unitPrice }];
const issue = (cookie: string, body: object) => call(billsRoute.POST, request("/api/v1/bills", { method: "POST", cookie, body }));
const cash = (w: { branch: { code: string } }, extra: object = {}) => ({ branch: w.branch.code, method: "cash", lines: lines(), tendered: 200000, ...extra });
const voidIt = (cookie: string, id: string, reason = "Wrong total") =>
  call(voidRoute.POST, request(`/api/v1/bills/${id}/void`, { method: "POST", cookie, body: { reason } }), { id });
const report = (cookie: string, code: string, day = manilaDate(new Date())) =>
  call(billsRoute.GET, request(`/api/v1/bills?branch=${code}&day=${day}`, { cookie }));
const close = (cookie: string, code: string, countedCash: number, day = manilaDate(new Date())) =>
  call(closeRoute.POST, request("/api/v1/billing/close", { method: "POST", cookie, body: { branch: code, day, countedCash } }));

describe("issuing a bill", () => {
  it("takes cash for a completed visit, works out the change, and numbers the receipt", async () => {
    const w = await setup();
    const id = await w.visit(true);
    const res = await issue(w.desk, cash(w, { appointmentId: id }));
    expect(res.status).toBe(201);
    const { id: billId, receiptNo } = await res.json();
    expect(receiptNo).toBe(`OR-${w.branch.code.toUpperCase()}-${manilaDate(new Date()).replaceAll("-", "")}-000001`);
    const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
    expect(bill).toMatchObject({ total: 150000, tendered: 200000, changeDue: 50000, method: "cash", status: "paid", appointmentId: id });
    expect(bill.patientId).not.toBeNull();
    const second = await (await issue(w.desk, cash(w))).json();
    expect(second.receiptNo.endsWith("-000002")).toBe(true);
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.action, "bill.issued"), eq(auditLog.entityId, billId)));
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toEqual({ receiptNo, method: "cash", total: 150000 });
  });

  it("takes a QR payment with a reference and no cash fields", async () => {
    const w = await setup();
    const res = await issue(w.desk, { branch: w.branch.code, method: "qr", lines: lines(), reference: "GCash 0123" });
    expect(res.status).toBe(201);
    const [bill] = await db.select().from(bills).where(eq(bills.id, (await res.json()).id));
    expect(bill).toMatchObject({ method: "qr", tendered: null, changeDue: null, reference: "GCash 0123", appointmentId: null, patientId: null });
    const bad = await issue(w.desk, { branch: w.branch.code, method: "qr", lines: lines(), tendered: 150000 });
    expect(bad.status).toBe(400);
  });

  it("refuses short cash, an empty total, and a visit that is not completed", async () => {
    const w = await setup();
    const short = await issue(w.desk, cash(w, { tendered: 149999 }));
    expect(short.status).toBe(422);
    expect((await short.json()).error.code).toBe("short_cash");
    const free = await issue(w.desk, cash(w, { lines: lines(0), tendered: 0 }));
    expect(free.status).toBe(422);
    expect((await free.json()).error.code).toBe("nothing_to_pay");
    const open = await issue(w.desk, cash(w, { appointmentId: await w.visit(false) }));
    expect(open.status).toBe(422);
    expect((await open.json()).error.code).toBe("not_completed");
    expect((await issue(w.desk, cash(w, { lines: [] }))).status).toBe(400);
  });

  it("refuses a second receipt for the same visit, and points to the first", async () => {
    const w = await setup();
    const id = await w.visit(true);
    const first = await (await issue(w.desk, cash(w, { appointmentId: id }))).json();
    const again = await issue(w.desk, cash(w, { appointmentId: id }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatchObject({ code: "already_billed", billId: first.id });
    // After a void the visit can be billed again.
    expect((await voidIt(w.desk, first.id)).status).toBe(200);
    expect((await issue(w.desk, cash(w, { appointmentId: id }))).status).toBe(201);
  });

  it("is for the owner and the branch's front desk only", async () => {
    const w = await setup();
    expect((await issue(w.dentist, cash(w))).status).toBe(403);
    expect((await issue(w.otherDesk, cash(w))).status).toBe(403);
    expect((await issue(w.desk, cash(w, { branch: "no-such-branch" }))).status).toBe(404);
    const foreignVisit = await (await setup()).visit(true);
    expect((await issue(w.desk, cash(w, { appointmentId: foreignVisit }))).status).toBe(404);
  });

  it("gives every concurrent receipt its own number", async () => {
    const w = await setup();
    const made = await Promise.all(Array.from({ length: 5 }, () => issue(w.desk, cash(w)).then((r) => r.json())));
    const seqs = made.map((m) => Number(m.receiptNo.slice(-6))).sort();
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("voiding a bill", () => {
  it("needs a reason, keeps the record, and works once", async () => {
    const w = await setup();
    const { id } = await (await issue(w.desk, cash(w))).json();
    expect((await voidIt(w.desk, id, "")).status).toBe(400);
    expect((await voidIt(w.dentist, id)).status).toBe(403);
    expect((await voidIt(w.otherDesk, id)).status).toBe(403);
    expect((await voidIt(w.desk, id)).status).toBe(200);
    const [row] = await db.select().from(bills).where(eq(bills.id, id));
    expect(row).toMatchObject({ status: "void", voidReason: "Wrong total" });
    const again = await voidIt(w.desk, id);
    expect(again.status).toBe(422);
    expect((await again.json()).error.code).toBe("already_voided");
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "bill.voided"), eq(auditLog.entityId, id)))).toHaveLength(1);
  });
});

describe("bad input", () => {
  it("refuses impossible days and totals with a 400 or 422, never a 500", async () => {
    const w = await setup();
    expect((await report(w.desk, w.branch.code, "2026-02-30")).status).toBe(400);
    expect((await close(w.desk, w.branch.code, 0, "2026-13-45")).status).toBe(400);
    const big = Array.from({ length: 30 }, () => ({ name: "Big", qty: 999, unitPrice: 100_000_000 }));
    for (const method of ["cash", "qr"] as const) {
      const res = await issue(w.desk, { branch: w.branch.code, method, lines: big, ...(method === "cash" ? { tendered: 100_000_000 } : {}) });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("too_much");
    }
  });
});

describe("the day's record and closing it", () => {
  it("totals paid cash and QR per day, leaving voided bills out", async () => {
    const w = await setup();
    await issue(w.desk, cash(w, { lines: lines(100000), tendered: 100000 }));
    const gone = await (await issue(w.desk, cash(w, { lines: lines(99900), tendered: 99900 }))).json();
    await issue(w.desk, { branch: w.branch.code, method: "qr", lines: lines(25000) });
    await voidIt(w.desk, gone.id);
    const body = await (await report(w.desk, w.branch.code)).json();
    expect(body).toMatchObject({ expectedCash: 100000, expectedQr: 25000, close: null });
    expect(body.rows).toHaveLength(3);
    expect(body.rows.filter((r: { status: string }) => r.status === "void")).toHaveLength(1);
    expect((await report(w.dentist, w.branch.code)).status).toBe(403);
  });

  it("closes the day with the counted cash, locks it, and cannot close twice", async () => {
    const w = await setup();
    const { id } = await (await issue(w.desk, cash(w, { lines: lines(100000), tendered: 100000 }))).json();
    await issue(w.desk, { branch: w.branch.code, method: "qr", lines: lines(25000) });
    expect((await close(w.dentist, w.branch.code, 100000)).status).toBe(403);
    expect((await close(w.desk, w.branch.code, -1)).status).toBe(400);
    const closed = await close(w.desk, w.branch.code, 99000);
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ countedCash: 99000, expectedCash: 100000, expectedQr: 25000 });
    const again = await close(w.desk, w.branch.code, 99000);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("day_closed");
    const issued = await issue(w.desk, cash(w));
    expect(issued.status).toBe(422);
    expect((await issued.json()).error.code).toBe("day_closed");
    const voided = await voidIt(w.desk, id);
    expect(voided.status).toBe(422);
    expect((await voided.json()).error.code).toBe("day_closed");
    expect((await (await report(w.desk, w.branch.code)).json()).close).toMatchObject({ countedCash: 99000 });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "day.closed"))).not.toHaveLength(0);
  });

  it("refuses to close a day that has not happened", async () => {
    const w = await setup();
    const res = await close(w.desk, w.branch.code, 0, "2099-01-01");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("future_day");
  });
});

describe("the clinic QR image", () => {
  it("is set and removed by the owner only, and only as a small PNG or JPEG", async () => {
    await db.insert(practice).values({ name: "QR Test Clinic" }).onConflictDoNothing();
    const w = await setup();
    const put = (cookie: string, image: string | null) => call(qrRoute.PUT, request("/api/v1/practice/qr", { method: "PUT", cookie, body: { image } }));
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect((await put(w.desk, png)).status).toBe(403);
    const owner = await makeUser({ role: "owner" });
    const cookie = await signIn(owner.username);
    expect((await put(cookie, "data:text/html;base64,AAAA")).status).toBe(400);
    expect((await put(cookie, `data:image/png;base64,${"A".repeat(270_000)}`)).status).toBe(400);
    expect((await put(cookie, png)).status).toBe(200);
    expect((await db.select().from(practice))[0].qrImage).toBe(png);
    expect((await put(cookie, null)).status).toBe(200);
  });
});
