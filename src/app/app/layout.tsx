import type { ReactNode } from "react";
import Link from "next/link";
import AppNav from "./AppNav";
import { billingBanner } from "@/lib/billing-data";
import { requireStaff } from "@/lib/supabase/server";

/** The dashboard shell. Pages and actions still call requireStaff themselves (actions skip layouts). */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const [clinic, pending, banner] = await Promise.all([
    staff.db.from("clinics").select("name, slug").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", staff.clinicId)
      .eq("status", "pending")
      .gt("starts_at", new Date().toISOString())
      .throwOnError(),
    billingBanner(staff, new Date()),
  ]);
  const { name, slug } = clinic.data as { name: string; slug: string };

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-top">
        <span className="font-display app-clinic">{name}</span>
        <Link href={`/${slug}`} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center">
          Booking page
        </Link>
      </header>
      <AppNav pending={pending.count ?? 0} />
      <main id="main" className="app-main">
        {banner && (
          <p className="note-box warn mb-4">
            {banner}{" "}
            <Link href="/app/billing" className="link inline-flex min-h-11 items-center">
              Go to Billing
            </Link>
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
