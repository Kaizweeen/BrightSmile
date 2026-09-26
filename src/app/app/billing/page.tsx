import type { Metadata } from "next";
import PayPanel from "./PayPanel";
import { billingDate, billingStatus, formatPesos, STATUS_CHIP, STATUS_LABEL, statusLine, tierFor } from "@/lib/billing";
import { activeDentists, loadBilling, loadPayments } from "@/lib/billing-data";
import { paymongoKeys } from "@/lib/paymongo";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };

type Props = { searchParams: Promise<{ paid?: string | string[] }> };

/**
 * Billing spec 7.1: when the plan ends, what it costs and why, how to pay, and past payments. The plan shown
 * always comes from the database; ?paid=1 only adds a note after PayMongo checkout.
 */
export default async function BillingPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const now = new Date();
  const [billing, dentists, payments, clinic, { paid }] = await Promise.all([
    loadBilling(staff.db, staff.clinicId),
    activeDentists(staff.db, staff.clinicId),
    loadPayments(staff.db, staff.clinicId),
    staff.db.from("clinics").select("slug").eq("id", staff.clinicId).single().throwOnError(),
    searchParams,
  ]);
  const state = billingStatus(billing, now);
  const tier = tierFor(dentists);
  const gcashName = process.env.BILLING_GCASH_NAME?.trim();
  const gcashNumber = normalizeMobile(process.env.BILLING_GCASH_NUMBER ?? "");

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Billing</h1>
      </div>
      {paid === "1" && (
        <p className="note-box mb-4" role="status">
          Payment received. Your plan updates within a minute.
        </p>
      )}
      <section className="card card-pad settings-section">
        <h2 className="font-display">Your plan</h2>
        <div className="chip-row">
          <span className={`chip ${STATUS_CHIP[state.status]}`}>{STATUS_LABEL[state.status]}</span>
        </div>
        <p className="mt-2">{statusLine(state, now)}</p>
        <p className="f-hint mt-2">
          {tier.name} plan: {formatPesos(tier.pesos * 100)} a month for {dentists} active {dentists === 1 ? "dentist" : "dentists"}. Texts
          to patients are included.
        </p>
      </section>
      <PayPanel
        activeDentists={dentists}
        slug={(clinic.data as { slug: string }).slug}
        gcash={gcashName && gcashNumber ? { name: gcashName, number: localMobile(gcashNumber) } : null}
        online={paymongoKeys() !== null}
      />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Payment history</h2>
        {payments.length === 0 ? (
          <p className="f-hint">No payments yet.</p>
        ) : (
          <div className="mt-2">
            {payments.map((p) => (
              <div key={p.id} className="cf-row">
                <span className="k">
                  {billingDate(new Date(p.paidAt), now)}, {p.months === 1 ? "1 month" : `${p.months} months`}
                </span>
                <span className="v">
                  {formatPesos(p.amountCentavos)} by {p.method === "gcash" ? "GCash" : "PayMongo"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
