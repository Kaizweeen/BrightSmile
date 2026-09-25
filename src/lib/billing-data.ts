import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bannerText, billingFromRow, billingStatus, type Billing, type BillingRow } from "@/lib/billing";
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
