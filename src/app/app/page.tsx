import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/(auth)/actions";
import { signedInStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Requests" };

type Pending = {
  id: string;
  starts_at: string;
  procedure_names: string[];
  patient: { first_name: string; last_name: string };
};

/** Interim home until Plan 3 builds the dashboard and /app/requests. */
export default async function AppHome() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId) redirect("/onboarding");

  const [clinic, pending] = await Promise.all([
    staff.db.from("clinics").select("name, slug").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("appointments")
      .select("id, starts_at, procedure_names, patient:patients(first_name, last_name)")
      .eq("clinic_id", staff.clinicId)
      .eq("status", "pending")
      .order("starts_at")
      .limit(50)
      .throwOnError(),
  ]);
  const { name, slug } = clinic.data as { name: string; slug: string };
  const rows = pending.data as unknown as Pending[];

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{name}</h1>
        <p className="sub">
          Your booking link:{" "}
          <Link href={`/${slug}`} className="link">
            /{slug}
          </Link>
        </p>

        <h2 className="font-display text-[17px] font-bold">Waiting for you</h2>
        {rows.length === 0 ? (
          <p className="empty-note">No requests yet.</p>
        ) : (
          <div className="member-list mt-3">
            {rows.map((r) => {
              const start = new Date(r.starts_at);
              return (
                <div key={r.id} className="member-row">
                  <span className="nm">
                    {r.patient.first_name} {r.patient.last_name}
                    <span className="meta block">{r.procedure_names.join(", ")}</span>
                  </span>
                  <span className="chip chip-amber">{`${formatDate(start)}, ${formatTime(start)}`}</span>
                </div>
              );
            })}
          </div>
        )}

        <form action={signOut} className="mt-6">
          <button type="submit" className="btn btn-ghost wide-btn">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
