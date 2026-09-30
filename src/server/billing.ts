import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import {
  appointmentProcedures,
  appointments,
  billCounters,
  billLines,
  bills,
  branches,
  cashCloses,
  patients,
  practice,
  procedures,
  users,
} from "@/db/schema";
import { billTotal, receiptNumber } from "@/lib/billing";
import { fullName } from "@/lib/patients";
import { manilaDate } from "@/lib/time";
import { audit } from "./audit";
import { requireBranch } from "./branches";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import { practiceName } from "./practice";
import type { Staff } from "./session";

const money = z.number().int("Use whole centavos").min(0, "Use 0 or more").max(100_000_000, "That amount is too high");
const dayText = z.iso.date("Use a date like 2026-10-01");

export const lineSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters"),
  qty: z.number().int("Use a whole number").min(1, "At least 1").max(999, "At most 999"),
  unitPrice: money,
  procedureId: z.uuid().nullable().optional(),
});

export const issueSchema = z
  .object({
    branch: z.string().min(1),
    appointmentId: z.uuid().nullable().optional(),
    method: z.enum(["cash", "qr"]),
    lines: z.array(lineSchema).min(1, "Add at least one line").max(30, "At most 30 lines"),
    tendered: money.optional(),
    reference: z.string().trim().max(60, "Use at most 60 characters").optional(),
  })
  .superRefine((b, ctx) => {
    if (b.method === "cash" && b.tendered === undefined) ctx.addIssue({ code: "custom", path: ["tendered"], message: "Enter the cash received" });
    if (b.method === "qr" && b.tendered !== undefined) ctx.addIssue({ code: "custom", path: ["tendered"], message: "Cash received applies to cash only" });
  });

export const voidSchema = z.object({ reason: z.string().trim().min(1, "Enter a reason").max(200, "Use at most 200 characters") });
export const dayQuery = z.object({ branch: z.string().min(1), day: dayText });
export const closeSchema = z.object({ branch: z.string().min(1), day: dayText, countedCash: money });
export const qrSchema = z.object({
  image: z
    .string()
    .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Use a PNG or JPEG image")
    .max(270_000, "Use an image under 200 KB")
    .nullable(),
});

export type BillRow = {
  id: string;
  receiptNo: string;
  issuedAt: Date;
  patientName: string | null;
  method: "cash" | "qr";
  total: number;
  status: "paid" | "void";
  voidReason: string | null;
};
export type CloseView = { countedCash: number; expectedCash: number; expectedQr: number; closedAt: Date; closedByName: string };
export type DayReport = { day: string; rows: BillRow[]; expectedCash: number; expectedQr: number; close: CloseView | null };
export type Draft = {
  appointmentId: string | null;
  patientName: string | null;
  billedId: string | null;
  qrImage: string | null;
  lines: { name: string; qty: number; unitPrice: number; procedureId: string | null }[];
};

/** Takes the day's counter row lock (creating it at 0 when nothing was sold yet), so issuing, voiding and closing run one at a time. */
async function lockDay(tx: Db, branchId: string, day: string): Promise<void> {
  await tx
    .insert(billCounters)
    .values({ branchId, day, lastSeq: 0 })
    .onConflictDoUpdate({ target: [billCounters.branchId, billCounters.day], set: { lastSeq: sql`${billCounters.lastSeq}` } });
}

async function closeOf(tx: Db, branchId: string, day: string): Promise<CloseView | null> {
  const [row] = await tx
    .select({
      countedCash: cashCloses.countedCash,
      expectedCash: cashCloses.expectedCash,
      expectedQr: cashCloses.expectedQr,
      closedAt: cashCloses.closedAt,
      closedByName: users.name,
    })
    .from(cashCloses)
    .innerJoin(users, eq(users.id, cashCloses.closedBy))
    .where(and(eq(cashCloses.branchId, branchId), eq(cashCloses.day, day)));
  return row ?? null;
}

/** What the day's paid bills add up to, by method. */
// ponytail: sum()::int overflows past about ₱21M per branch per day; cast to bigint if a branch ever sells that much.
async function daySums(tx: Db, branchId: string, day: string): Promise<{ cash: number; qr: number }> {
  const rows = await tx
    .select({ method: bills.method, sum: sql<number>`coalesce(sum(${bills.total}), 0)::int` })
    .from(bills)
    .where(and(eq(bills.branchId, branchId), eq(bills.day, day), eq(bills.status, "paid")))
    .groupBy(bills.method);
  return { cash: rows.find((r) => r.method === "cash")?.sum ?? 0, qr: rows.find((r) => r.method === "qr")?.sum ?? 0 };
}

const dayClosed = (status = 422) => new ApiError(status, "day_closed", "That day is closed.");

/** Billing spec 3: a bill is created paid, and only the server works out the total, the change and the receipt number. */
export async function issueBill(actor: Staff, input: z.infer<typeof issueSchema>): Promise<{ id: string; receiptNo: string }> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "billing.issue", { branchId: branch.id });
  const total = billTotal(input.lines);
  if (total <= 0) throw new ApiError(422, "nothing_to_pay", "The total must be more than zero.");
  if (total > 100_000_000) throw new ApiError(422, "too_much", "That total is too high.");
  if (input.method === "cash" && (input.tendered ?? 0) < total) {
    throw new ApiError(422, "short_cash", "Cash received is less than the total.", { fields: { tendered: "Less than the total due." } });
  }
  const day = manilaDate(new Date());
  return db.transaction(async (tx) => {
    let patientId: string | null = null;
    if (input.appointmentId) {
      const [visit] = await tx.select().from(appointments).where(eq(appointments.id, input.appointmentId));
      if (!visit || visit.branchId !== branch.id) throw notFound("That visit");
      if (visit.status !== "completed") throw new ApiError(422, "not_completed", "Only a completed visit can be billed.");
      patientId = visit.patientId;
    }
    // The counter's row lock comes first, so a close or another receipt for the same day finishes before this checks the visit and the day.
    const [{ seq }] = await tx
      .insert(billCounters)
      .values({ branchId: branch.id, day, lastSeq: 1 })
      .onConflictDoUpdate({ target: [billCounters.branchId, billCounters.day], set: { lastSeq: sql`${billCounters.lastSeq} + 1` } })
      .returning({ seq: billCounters.lastSeq });
    if (input.appointmentId) {
      const [paid] = await tx.select({ id: bills.id }).from(bills).where(and(eq(bills.appointmentId, input.appointmentId), eq(bills.status, "paid")));
      if (paid) throw new ApiError(409, "already_billed", "This visit already has a receipt.", { billId: paid.id });
    }
    if (await closeOf(tx, branch.id, day)) throw dayClosed();
    const receiptNo = receiptNumber(branch.code, day, seq);
    const [bill] = await tx
      .insert(bills)
      .values({
        receiptNo,
        branchId: branch.id,
        patientId,
        appointmentId: input.appointmentId ?? null,
        day,
        method: input.method,
        total,
        tendered: input.method === "cash" ? input.tendered : null,
        changeDue: input.method === "cash" ? (input.tendered ?? 0) - total : null,
        reference: input.reference || null,
        issuedBy: actor.id,
      })
      .returning({ id: bills.id });
    await tx.insert(billLines).values(
      input.lines.map((l, i) => ({ billId: bill.id, position: i + 1, name: l.name, qty: l.qty, unitPrice: l.unitPrice, procedureId: l.procedureId ?? null })),
    );
    await audit({ userId: actor.id, action: "bill.issued", entity: "bill", entityId: bill.id, branchId: branch.id, details: { receiptNo, method: input.method, total } }, tx);
    return { id: bill.id, receiptNo };
  });
}

export async function voidBill(actor: Staff, id: string, input: z.infer<typeof voidSchema>): Promise<void> {
  const [found] = await db.select().from(bills).where(eq(bills.id, id));
  if (!found) throw notFound("That receipt");
  requireCan(actor, "billing.void", { branchId: found.branchId });
  await db.transaction(async (tx) => {
    await lockDay(tx, found.branchId, found.day);
    const [bill] = await tx.select().from(bills).where(eq(bills.id, id));
    if (bill.status === "void") throw new ApiError(422, "already_voided", "This receipt is already voided.");
    if (await closeOf(tx, bill.branchId, bill.day)) throw dayClosed();
    await tx.update(bills).set({ status: "void", voidReason: input.reason, voidedBy: actor.id, voidedAt: new Date() }).where(eq(bills.id, id));
    await audit(
      { userId: actor.id, action: "bill.voided", entity: "bill", entityId: id, branchId: bill.branchId, details: { receiptNo: bill.receiptNo, total: bill.total } },
      tx,
    );
  });
}

/** Billing spec 5: a branch's bills for a day, what cash and QR should add up to, and how the day was closed, if it was. */
export async function dayReport(actor: Staff, q: z.infer<typeof dayQuery>): Promise<DayReport> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "billing.view", { branchId: branch.id });
  const rows = await db
    .select({
      id: bills.id,
      receiptNo: bills.receiptNo,
      issuedAt: bills.issuedAt,
      method: bills.method,
      total: bills.total,
      status: bills.status,
      voidReason: bills.voidReason,
      lastName: patients.lastName,
      firstName: patients.firstName,
    })
    .from(bills)
    .leftJoin(patients, eq(patients.id, bills.patientId))
    .where(and(eq(bills.branchId, branch.id), eq(bills.day, q.day)))
    .orderBy(asc(bills.receiptNo));
  const sums = await daySums(db, branch.id, q.day);
  return {
    day: q.day,
    rows: rows.map(({ lastName, firstName, ...r }) => ({
      ...r,
      method: r.method as "cash" | "qr",
      status: r.status as "paid" | "void",
      patientName: lastName === null || firstName === null ? null : fullName({ lastName, firstName }),
    })),
    expectedCash: sums.cash,
    expectedQr: sums.qr,
    close: await closeOf(db, branch.id, q.day),
  };
}

export async function closeDay(actor: Staff, input: z.infer<typeof closeSchema>): Promise<CloseView> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "billing.close", { branchId: branch.id });
  if (input.day > manilaDate(new Date())) throw new ApiError(422, "future_day", "That day has not happened yet.");
  return db.transaction(async (tx) => {
    await lockDay(tx, branch.id, input.day);
    if (await closeOf(tx, branch.id, input.day)) throw dayClosed(409);
    const sums = await daySums(tx, branch.id, input.day);
    await tx.insert(cashCloses).values({ branchId: branch.id, day: input.day, expectedCash: sums.cash, expectedQr: sums.qr, countedCash: input.countedCash, closedBy: actor.id });
    await audit(
      { userId: actor.id, action: "day.closed", entity: "branch", entityId: branch.id, branchId: branch.id, details: { day: input.day, expectedCash: sums.cash, expectedQr: sums.qr, countedCash: input.countedCash } },
      tx,
    );
    return (await closeOf(tx, branch.id, input.day))!;
  });
}

/** The receipt: the bill as it was sold, with the clinic, branch, patient and cashier. */
export async function getBill(actor: Staff, id: string) {
  const [bill] = await db.select().from(bills).where(eq(bills.id, id));
  if (!bill) throw notFound("That receipt");
  requireCan(actor, "billing.view", { branchId: bill.branchId });
  const [branch] = await db.select().from(branches).where(eq(branches.id, bill.branchId));
  const [patient] = bill.patientId ? await db.select().from(patients).where(eq(patients.id, bill.patientId)) : [];
  const [cashier] = await db.select({ name: users.name }).from(users).where(eq(users.id, bill.issuedBy));
  const lines = await db.select().from(billLines).where(eq(billLines.billId, id)).orderBy(asc(billLines.position));
  return {
    bill,
    lines,
    practiceName: await practiceName(),
    branch: { code: branch.code, name: branch.name, address: branch.address, phone: branch.phone },
    patientName: patient ? fullName(patient) : null,
    issuedByName: cashier?.name ?? "",
  };
}

export async function practiceQr(): Promise<string | null> {
  const [row] = await db.select({ qrImage: practice.qrImage }).from(practice);
  return row?.qrImage ?? null;
}

/** Billing spec 5: what the checkout starts from: the visit's services at their default prices, and the clinic's QR image. */
export async function checkoutDraft(actor: Staff, branchCode: string, appointmentId: string | null): Promise<Draft> {
  const branch = await requireBranch(branchCode);
  requireCan(actor, "billing.issue", { branchId: branch.id });
  const qrImage = await practiceQr();
  if (!appointmentId) return { appointmentId: null, patientName: null, billedId: null, qrImage, lines: [] };
  const [visit] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
  if (!visit || visit.branchId !== branch.id) throw notFound("That visit");
  if (visit.status !== "completed") throw new ApiError(422, "not_completed", "Only a completed visit can be billed.");
  const [paid] = await db.select({ id: bills.id }).from(bills).where(and(eq(bills.appointmentId, visit.id), eq(bills.status, "paid")));
  const [patient] = await db.select().from(patients).where(eq(patients.id, visit.patientId));
  const services = await db
    .select({ procedureId: appointmentProcedures.procedureId, name: appointmentProcedures.name, price: procedures.price })
    .from(appointmentProcedures)
    .innerJoin(procedures, eq(procedures.id, appointmentProcedures.procedureId))
    .where(eq(appointmentProcedures.appointmentId, visit.id))
    .orderBy(asc(appointmentProcedures.position));
  return {
    appointmentId: visit.id,
    patientName: fullName(patient),
    billedId: paid?.id ?? null,
    qrImage,
    lines: services.map((s) => ({ name: s.name, qty: 1, unitPrice: s.price, procedureId: s.procedureId })),
  };
}

export async function setQr(actor: Staff, image: string | null): Promise<void> {
  requireCan(actor, "settings.edit");
  await db.transaction(async (tx) => {
    await tx.update(practice).set({ qrImage: image });
    await audit({ userId: actor.id, action: "practice.qr_changed", entity: "practice", details: { removed: image === null } }, tx);
  });
}
