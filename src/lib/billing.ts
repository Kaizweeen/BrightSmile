// Client-safe helpers (no server imports). Money = integer centavos.
export type LineInput = { name: string; qty: number; unitPrice: number; inventoryItemId?: string };
export type VatMode = "none" | "inclusive";
export type Totals = { subtotal: number; discount: number; vat: number; total: number };
export type Method = "CASH" | "QR";
export type ReceiptData = {
  number: string; issuedAt: string; branchId: string; method: Method;
  items: { name: string; qty: number; unitPrice: number }[];
  totals: Totals; tendered?: number | null; change?: number | null; reference?: string | null;
};

export const VAT_RATE = 0.12;
export const peso = (c: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(c / 100);

export function calculateBill(lines: LineInput[], o: { discount?: number; vatMode?: VatMode } = {}): Totals {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const discount = Math.min(o.discount ?? 0, subtotal);
  const total = subtotal - discount;
  const vat = o.vatMode === "inclusive" ? Math.round(total - total / (1 + VAT_RATE)) : 0;
  return { subtotal, discount, vat, total };
}

export function computeChange(total: number, tendered: number) {
  if (tendered < total) throw new Error("Cash received is less than the total due");
  return tendered - total;
}

export const manilaDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d); // YYYY-MM-DD
export const dayRange = (day: string) => {
  const start = new Date(`${day}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 864e5) };
};
export const receiptNumber = (branch: string, day: string, seq: number) =>
  `OR-${branch.toUpperCase()}-${day.replaceAll("-", "")}-${String(seq).padStart(6, "0")}`;
