import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { billLines, bills, cashCloses, practice, procedures } from "@/db/schema";
import { makeBranch, makeUser } from "../helpers";

function sqlState(error: unknown): string | undefined {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return sqlState(error);
  }
  return undefined;
}

async function paidBill(over: Partial<typeof bills.$inferInsert> = {}) {
  const branch = await makeBranch();
  const desk = await makeUser({ role: "manager", branchIds: [branch.id] });
  const [bill] = await db
    .insert(bills)
    .values({ receiptNo: `OR-${branch.code}-1`, branchId: branch.id, day: "2026-10-01", method: "cash", total: 1000, tendered: 1000, changeDue: 0, issuedBy: desk.id, ...over })
    .returning();
  return { branch, desk, bill };
}

describe("bills", () => {
  it("checks cash and QR fields", async () => {
    const { branch, desk } = await paidBill();
    const base = { branchId: branch.id, day: "2026-10-01", total: 1000, issuedBy: desk.id };
    await expect(db.insert(bills).values({ ...base, receiptNo: "a", method: "cash", tendered: 500, changeDue: 0 })).rejects.toThrow();
    await expect(db.insert(bills).values({ ...base, receiptNo: "b", method: "cash", tendered: 1500, changeDue: 100 })).rejects.toThrow();
    await expect(db.insert(bills).values({ ...base, receiptNo: "c", method: "qr", tendered: 1000, changeDue: 0 })).rejects.toThrow();
    await expect(db.insert(bills).values({ ...base, receiptNo: "d", method: "qr" })).resolves.toBeDefined();
    await expect(db.insert(bills).values({ ...base, receiptNo: "e", method: "qr", total: 0 })).rejects.toThrow();
  });

  it("refuses an empty payment reference", async () => {
    const { branch, desk } = await paidBill();
    const qr = { branchId: branch.id, day: "2026-10-01", total: 1000, issuedBy: desk.id, method: "qr" };
    await expect(db.insert(bills).values({ ...qr, receiptNo: "r1", reference: "" })).rejects.toThrow();
    await expect(db.insert(bills).values({ ...qr, receiptNo: "r2", reference: "GCash 123" })).resolves.toBeDefined();
  });

  it("can only be voided, once, and never deleted", async () => {
    const { desk, bill } = await paidBill();
    expect(await refusal(db.update(bills).set({ total: 1 }).where(eq(bills.id, bill.id)))).toBe("DS002");
    expect(await refusal(db.delete(bills).where(eq(bills.id, bill.id)))).toBe("DS002");
    await expect(db.update(bills).set({ status: "void" }).where(eq(bills.id, bill.id))).rejects.toThrow(); // void needs its fields
    const voided = { status: "void", voidReason: "Wrong total", voidedBy: desk.id, voidedAt: new Date() };
    await db.update(bills).set(voided).where(eq(bills.id, bill.id));
    expect(await refusal(db.update(bills).set({ voidReason: "again" }).where(eq(bills.id, bill.id)))).toBe("DS002");
  });

  it("refuses a repeated receipt number", async () => {
    const { branch, desk, bill } = await paidBill();
    await expect(
      db.insert(bills).values({ receiptNo: bill.receiptNo, branchId: branch.id, day: "2026-10-01", method: "qr", total: 5, issuedBy: desk.id }),
    ).rejects.toThrow();
  });
});

describe("bill lines and closes", () => {
  it("are never changed or deleted", async () => {
    const { branch, desk, bill } = await paidBill();
    await db.insert(billLines).values({ billId: bill.id, position: 1, name: "Filling", qty: 1, unitPrice: 1000 });
    expect(await refusal(db.update(billLines).set({ qty: 2 }).where(eq(billLines.billId, bill.id)))).toBe("DS002");
    expect(await refusal(db.delete(billLines).where(eq(billLines.billId, bill.id)))).toBe("DS002");
    await db.insert(cashCloses).values({ branchId: branch.id, day: "2026-10-01", expectedCash: 1000, expectedQr: 0, countedCash: 1000, closedBy: desk.id });
    expect(await refusal(db.update(cashCloses).set({ countedCash: 0 }).where(eq(cashCloses.branchId, branch.id)))).toBe("DS002");
    expect(await refusal(db.delete(cashCloses).where(eq(cashCloses.branchId, branch.id)))).toBe("DS002");
  });

  it("checks line bounds", async () => {
    const { bill } = await paidBill();
    await expect(db.insert(billLines).values({ billId: bill.id, position: 1, name: "", qty: 1, unitPrice: 0 })).rejects.toThrow();
    await expect(db.insert(billLines).values({ billId: bill.id, position: 2, name: "x", qty: 0, unitPrice: 0 })).rejects.toThrow();
    await expect(db.insert(billLines).values({ billId: bill.id, position: 3, name: "x", qty: 1, unitPrice: -1 })).rejects.toThrow();
  });
});

describe("prices and the QR image", () => {
  it("bounds a procedure price", async () => {
    await expect(db.insert(procedures).values({ name: "Neg", price: -1 })).rejects.toThrow();
    await expect(db.insert(procedures).values({ name: "Max", price: 100000000 })).resolves.toBeDefined();
    await expect(db.insert(procedures).values({ name: "Over", price: 100000001 })).rejects.toThrow();
  });

  it("accepts only a png or jpeg base64 data URI", async () => {
    await db.insert(practice).values({ name: "x" }).onConflictDoNothing();
    const set = (qrImage: string | null) => db.update(practice).set({ qrImage });
    await expect(set("data:image/png;base64,iVBORw0KGgo=")).resolves.toBeDefined();
    await expect(set("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).resolves.toBeDefined();
    await expect(set("data:image/gif;base64,AAAA")).rejects.toThrow();
    await expect(set("data:text/html;base64,AAAA")).rejects.toThrow();
    await expect(set("data:image/png;base64,AA!A")).rejects.toThrow();
    await expect(set("data:image/png;base64,")).rejects.toThrow();
    await expect(set(`data:image/png;base64,${"A".repeat(270000)}`)).rejects.toThrow();
    await set(null);
  });
});
