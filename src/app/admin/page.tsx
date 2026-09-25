import type { Metadata } from "next";
import Link from "next/link";
import ClinicActions from "./ClinicActions";
import { billingDate, formatPesos, STATUS_CHIP, STATUS_LABEL } from "@/lib/billing";
import { adminOverview } from "@/lib/billing-data";
import { requireOperator } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };

const monthsText = (months: number) => (months === 1 ? "1 month" : `${months} months`);

/**
 * Billing spec 7.6: every clinic's plan, for the operator only (anyone else gets a 404). Billing and counts,
 * never patient data. The secret-key reads sit behind requireOperator.
 */
export default async function AdminPage() {
  await requireOperator();
  const now = new Date();
  const clinics = await adminOverview(now);

  return (
    <main className="app-main">
      <div className="page-head">
        <h1 className="font-display">Clinics</h1>
        <span className="f-hint">{clinics.length === 1 ? "1 clinic" : `${clinics.length} clinics`}</span>
      </div>
      {clinics.length === 0 && <div className="card empty-note">No clinics yet.</div>}
      {clinics.map((c) => (
        <article key={c.id} className="card appt">
          <p className="who">{c.name}</p>
          <Link href={`/${c.slug}`} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center">
            /{c.slug}
          </Link>
          <div className="chip-row">
            <span className={`chip ${STATUS_CHIP[c.state.status]}`}>{STATUS_LABEL[c.state.status]}</span>
          </div>
          <p className="what">
            Plan ends {billingDate(c.state.endsAt, now)}. {c.activeDentists} active {c.activeDentists === 1 ? "dentist" : "dentists"}.{" "}
            {c.credits} {c.credits === 1 ? "credit" : "credits"} of texts sent this month.
          </p>
          <p className="what">
            {c.lastPayment
              ? `Last payment ${billingDate(new Date(c.lastPayment.paidAt), now)}: ${formatPesos(c.lastPayment.amountCentavos)} for ${monthsText(c.lastPayment.months)} by ${c.lastPayment.method === "gcash" ? "GCash" : "PayMongo"}.`
              : "No payments yet."}
          </p>
          <ClinicActions clinicId={c.id} activeDentists={c.activeDentists} />
        </article>
      ))}
    </main>
  );
}
