import { parseMonths } from "@/lib/billing";
import { cleanText, isUuid } from "@/lib/validate";

/** OPERATOR_EMAILS as lowercased addresses: comma separated, spaces and empty entries ignored. */
export function operatorEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Billing spec 7.6: a signed-in user whose email is confirmed and listed in OPERATOR_EMAILS. */
export function isOperator(user: { email?: string | null; email_confirmed_at?: string | null }, list: string | undefined): boolean {
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && user.email_confirmed_at && operatorEmails(list).includes(email));
}

/** A peso amount as the operator types it ("1197", "1,197.50", "₱1,197") in centavos: above 0, at most ₱100,000. */
export function parsePesos(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim().replace(/^₱\s*/, "").replace(/,/g, "") : "";
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const centavos = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return centavos > 0 && centavos <= 10_000_000 ? centavos : null;
}

export type GcashPayment = { clinicId: string; months: number; amountCentavos: number; reference: string };

/** The admin page's GCash form, checked on the server (spec 7.2). */
export function parseGcashPayment(input: {
  clinicId: unknown;
  months: unknown;
  amount: unknown;
  reference: unknown;
}): { ok: true; value: GcashPayment } | { ok: false; error: string } {
  if (!isUuid(input.clinicId)) return { ok: false, error: "That clinic no longer exists. Reload the page." };
  const months = parseMonths(input.months);
  if (!months) return { ok: false, error: "Choose 1 to 12 months." };
  const amountCentavos = parsePesos(input.amount);
  if (!amountCentavos) return { ok: false, error: "Enter the amount received, like 1197 or 1,197.50." };
  // GCash shows references with spaces; without them the same transfer always matches the unique index.
  const reference = cleanText(input.reference, 100)?.replace(/\s+/g, "") || null;
  if (!reference) return { ok: false, error: "Enter the GCash reference number, up to 100 characters." };
  return { ok: true, value: { clinicId: input.clinicId, months, amountCentavos, reference } };
}

/** Days to add to a trial: a whole number from 1 to 365, or null. */
export function parseTrialDays(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const days = /^\d{1,3}$/.test(text) ? Number(text) : 0;
  return days >= 1 && days <= 365 ? days : null;
}

const errorCode = (e: unknown) => (e as { code?: unknown } | null)?.code;

/** What the operator reads when record_payment fails. 23505: the GCash reference is already recorded. */
export function gcashFailure(e: unknown): string {
  return errorCode(e) === "23505"
    ? "That GCash reference is already recorded."
    : "The payment may not have been recorded. Reload the page and check the last payment before trying again.";
}

/** What the operator reads when extend_trial fails. P0002: no such clinic. 22023: days outside 1 to 365. */
export function trialFailure(e: unknown): string {
  if (errorCode(e) === "P0002") return "That clinic no longer exists.";
  if (errorCode(e) === "22023") return "Enter 1 to 365 days.";
  return "The trial was not extended. Try again.";
}
