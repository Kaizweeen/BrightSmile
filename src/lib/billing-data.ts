import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bannerText, billingFromRow, billingStatus, manilaMonthStart, type Billing, type BillingRow, type BillingState } from "@/lib/billing";
import { logError } from "@/lib/log";
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";

/**
 * Each clinic's billing, with the missing-row rule (billing spec 11). Staff pages pass their RLS client (members
 * read their own clinic and its billing row); the public booking flow and the daily job pass the secret-key client.
 */
export async function loadBillings(db: SupabaseClient, clinicIds: string[]): Promise<Map<string, Billing>> {
  if (clinicIds.length === 0) return new Map();
  const [clinics, rows] = await Promise.all([
    db.from("clinics").select("id, created_at").in("id", clinicIds).throwOnError(),
    db.from("clinic_billing").select("clinic_id, trial_ends_at, paid_through").in("clinic_id", clinicIds).throwOnError(),
  ]);
  const byClinic = new Map((rows.data as (BillingRow & { clinic_id: string })[]).map((r) => [r.clinic_id, r]));
  return new Map(
    (clinics.data as { id: string; created_at: string }[]).map((c) => [c.id, billingFromRow(byClinic.get(c.id) ?? null, c.created_at)]),
  );
}

/** One clinic's billing. Throws when the clinic does not exist (or is not the staff member's). */
export async function loadBilling(db: SupabaseClient, clinicId: string): Promise<Billing> {
  const billing = (await loadBillings(db, [clinicId])).get(clinicId);
  if (!billing) throw new Error("clinic not found");
  return billing;
}

/** Whether a clinic's booking page takes requests now (spec 7.5). The secret key: patients have no session. */
export async function bookingOpen(clinicId: string, now: Date): Promise<boolean> {
  return billingStatus(await loadBilling(adminClient(), clinicId), now).open;
}

/** The dashboard banner, or null. Never throws: a failed billing read must not take the dashboard down. */
export async function billingBanner(staff: Staff, now: Date): Promise<string | null> {
  try {
    return bannerText(billingStatus(await loadBilling(staff.db, staff.clinicId), now), now);
  } catch (e) {
    logError("billingBanner", e);
    return null;
  }
}

/** Active dentists, which set the tier (spec 4). */
export async function activeDentists(db: SupabaseClient, clinicId: string): Promise<number> {
  const { count } = await db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .throwOnError();
  return count ?? 0;
}

type Method = "gcash" | "paymongo";

export type NewPayment = {
  clinicId: string;
  method: Method;
  amountCentavos: number;
  months: number;
  reference: string;
  sessionId: string | null;
  recordedBy: string | null;
};

/** record_payment through the secret key (spec 6), for the admin page and the PayMongo webhook. Throws on a database error. */
export async function recordPayment(p: NewPayment): Promise<{ status: "ok" | "duplicate"; paidThrough: string | null }> {
  const { data, error } = await adminClient().rpc("record_payment", {
    p_clinic_id: p.clinicId,
    p_method: p.method,
    p_amount_centavos: p.amountCentavos,
    p_months: p.months,
    p_reference: p.reference,
    p_session_id: p.sessionId,
    p_recorded_by: p.recordedBy,
  });
  if (error) throw error;
  const result = data as { status: "ok" | "duplicate"; paid_through: string | null };
  return { status: result.status, paidThrough: result.paid_through };
}

export type PaymentItem = { id: string; paidAt: string; months: number; amountCentavos: number; method: Method };

/** The Billing page's payment history, newest first (spec 7.1). Staff pass their RLS client. */
export async function loadPayments(db: SupabaseClient, clinicId: string): Promise<PaymentItem[]> {
  const { data } = await db
    .from("payments")
    .select("id, paid_at, months, amount_centavos, method")
    .eq("clinic_id", clinicId)
    .order("paid_at", { ascending: false })
    .limit(24)
    .throwOnError();
  return (data as { id: string; paid_at: string; months: number; amount_centavos: number; method: Method }[]).map((p) => ({
    id: p.id,
    paidAt: p.paid_at,
    months: p.months,
    amountCentavos: p.amount_centavos,
    method: p.method,
  }));
}

/** extend_trial through the secret key (spec 7.6). Returns the new trial end. */
export async function extendTrial(clinicId: string, days: number): Promise<string> {
  const { data, error } = await adminClient().rpc("extend_trial", { p_clinic_id: clinicId, p_days: days });
  if (error) throw error;
  return data as string;
}

export type AdminClinic = {
  id: string;
  name: string;
  slug: string;
  state: BillingState;
  activeDentists: number;
  credits: number;
  lastPayment: { paidAt: string; months: number; amountCentavos: number; method: Method } | null;
};

type OverviewRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  trial_ends_at: string | null;
  paid_through: string | null;
  active_dentists: number;
  credits: number;
  last_paid_at: string | null;
  last_months: number | null;
  last_amount_centavos: number | null;
  last_method: Method | null;
};

/**
 * Every clinic for the admin page (spec 7.6) in one call to admin_overview: billing and counts only, no patient
 * data. Credits are texts sent since the start of this Manila month.
 * ponytail: the API returns at most 1000 rows; page admin_overview when clinics near that.
 */
export async function adminOverview(now: Date): Promise<AdminClinic[]> {
  const { data, error } = await adminClient().rpc("admin_overview", { p_month_start: manilaMonthStart(now).toISOString() });
  if (error) throw error;
  return (data as OverviewRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    state: billingStatus(billingFromRow(r.trial_ends_at ? { trial_ends_at: r.trial_ends_at, paid_through: r.paid_through } : null, r.created_at), now),
    activeDentists: r.active_dentists,
    credits: r.credits,
    lastPayment:
      r.last_paid_at && r.last_months && r.last_amount_centavos && r.last_method
        ? { paidAt: r.last_paid_at, months: r.last_months, amountCentavos: r.last_amount_centavos, method: r.last_method }
        : null,
  }));
}
