import { formatDate, manilaDate, manilaInstant } from "@/lib/time";

/** Billing spec 4: the price by active dentists at the time of payment. Change prices here; no migration needed. */
export const TIERS = [
  { name: "Solo", maxDentists: 2, pesos: 399 },
  { name: "Team", maxDentists: 6, pesos: 1299 },
  { name: "Group", maxDentists: Infinity, pesos: 1799 },
] as const;
export type Tier = (typeof TIERS)[number];

/** What the Billing page offers. The database accepts any 1 to 12. */
export const MONTH_CHOICES = [1, 3, 6, 12] as const;
/** Days after the plan ends before the booking page pauses (spec 5). */
export const GRACE_DAYS = 3;
/** The banner and the heads-up start this many days before the end (spec 7.4, 7.5). */
export const NOTICE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A clinic with no active dentists pays the Solo price. */
export function tierFor(activeDentists: number): Tier {
  return TIERS.find((t) => activeDentists <= t.maxDentists) ?? TIERS[TIERS.length - 1];
}

/** Tier price times months, in centavos (spec 4). */
export function amountCentavos(activeDentists: number, months: number): number {
  return tierFor(activeDentists).pesos * 100 * months;
}

/** Whole months from 1 to 12, from a form value or PayMongo metadata, or null. */
export function parseMonths(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/** "₱1,299" or "₱1,299.50". Built by hand, like formatDate, so every runtime prints the same. */
export function formatPesos(centavos: number): string {
  const pesos = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = centavos % 100;
  return `₱${pesos}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

export type Billing = { trialEndsAt: Date; paidThrough: Date | null };
export type BillingRow = { trial_ends_at: string; paid_through: string | null };

/** A clinic_billing row as dates. A missing row counts as a trial that ended at signup (spec 11). */
export function billingFromRow(row: BillingRow | null, clinicCreatedAt: string): Billing {
  if (!row) return { trialEndsAt: new Date(clinicCreatedAt), paidThrough: null };
  return { trialEndsAt: new Date(row.trial_ends_at), paidThrough: row.paid_through ? new Date(row.paid_through) : null };
}

export type BillingStatus = "active" | "trial" | "grace" | "lapsed";
export type BillingState = { status: BillingStatus; endsAt: Date; pausesAt: Date; open: boolean };

/**
 * Spec 5, the one place the rule lives: active while paid_through is ahead, then trial while the trial is,
 * then 3 days of grace after the later of the two, then lapsed. Only lapsed closes the booking page.
 */
export function billingStatus({ trialEndsAt, paidThrough }: Billing, now: Date): BillingState {
  const endsAt = paidThrough && paidThrough > trialEndsAt ? paidThrough : trialEndsAt;
  const pausesAt = new Date(endsAt.getTime() + GRACE_DAYS * DAY_MS);
  const t = now.getTime();
  const status: BillingStatus =
    paidThrough && paidThrough.getTime() > t
      ? "active"
      : trialEndsAt.getTime() > t
        ? "trial"
        : t < pausesAt.getTime()
          ? "grace"
          : "lapsed";
  return { status, endsAt, pausesAt, open: status !== "lapsed" };
}

/** Status words, so a chip never rests on colour alone. */
export const STATUS_LABEL: Record<BillingStatus, string> = { active: "Paid", trial: "Free trial", grace: "Plan ended", lapsed: "Booking paused" };
export const STATUS_CHIP: Record<BillingStatus, string> = { active: "chip-green", trial: "chip-blue", grace: "chip-amber", lapsed: "chip-red" };

/** "Fri Oct 9", with the year when it is not this year ("Thu Sep 30, 2027"). */
export function billingDate(instant: Date, now: Date): string {
  const year = manilaDate(instant).slice(0, 4);
  return year === manilaDate(now).slice(0, 4) ? formatDate(instant) : `${formatDate(instant)}, ${year}`;
}

/** The Billing page's status line (spec 7.1). */
export function statusLine(state: BillingState, now: Date): string {
  const ends = billingDate(state.endsAt, now);
  if (state.status === "active") return `Paid until ${ends}.`;
  if (state.status === "trial") return `Free trial until ${ends}.`;
  if (state.status === "lapsed") return `Your plan ended ${ends}. Online booking reopens when you pay.`;
  const days = Math.max(1, Math.ceil((state.pausesAt.getTime() - now.getTime()) / DAY_MS));
  return `Your plan ended ${ends}. Online booking pauses in ${days} ${days === 1 ? "day" : "days"}.`;
}

/** The dashboard banner (spec 7.5), or null when the plan has more than 3 days left. */
export function bannerText(state: BillingState, now: Date): string | null {
  if (state.status === "lapsed") return "Online booking is paused. Pay to reopen it.";
  if (state.status === "grace") return `Your plan ended. Online booking pauses on ${billingDate(state.pausesAt, now)}.`;
  if (state.endsAt.getTime() - now.getTime() <= NOTICE_DAYS * DAY_MS) return `Your plan ends on ${billingDate(state.endsAt, now)}.`;
  return null;
}

/** What a lapsed clinic's booking page and booking actions say (spec 7.5). */
export function pausedMessage(clinicName: string, phone: string): string {
  return `${clinicName} is not taking online requests right now. Call ${phone} to book.`;
}

/** The first instant of the Manila calendar month (the admin page counts texts from it). */
export function manilaMonthStart(now: Date): Date {
  return manilaInstant(`${manilaDate(now).slice(0, 7)}-01`, 0);
}
