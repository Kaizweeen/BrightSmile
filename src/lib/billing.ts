// Client-safe helpers (no server imports). Money is integer centavos.
export type LineInput = { name: string; qty: number; unitPrice: number };

export const peso = (centavos: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(centavos / 100);

export const billTotal = (lines: { qty: number; unitPrice: number }[]) => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

export function changeDue(total: number, tendered: number): number {
  if (tendered < total) throw new Error("Cash received is less than the total due");
  return tendered - total;
}

/** Pesos typed by staff ("150", "1,250.75") to centavos; null when it is not an amount. */
export function toCentavos(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
}

export const receiptNumber = (branchCode: string, day: string, seq: number) =>
  `OR-${branchCode.toUpperCase()}-${day.replaceAll("-", "")}-${String(seq).padStart(6, "0")}`;
