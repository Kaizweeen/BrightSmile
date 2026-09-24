import type { Metadata } from "next";
import Link from "next/link";
import AppointmentActions from "../AppointmentActions";
import { loadRequests } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Requests" };

/** Spec 5.3: pending requests, soonest first, each with Approve and Decline. */
export default async function RequestsPage() {
  const staff = await requireStaff();
  const requests = await loadRequests(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Requests</h1>
        <span className="f-hint">{requests.length === 1 ? "1 waiting" : `${requests.length} waiting`}</span>
      </div>

      {requests.length === 0 && (
        <div className="card empty-note">No requests waiting. New ones from your booking page appear here.</div>
      )}

      {requests.map((r) => {
        const start = new Date(r.startsAt);
        const requested = new Date(r.requestedAt);
        return (
          <article key={r.id} className="card appt">
            <p className="when">
              {formatDate(start)}, {formatTime(start)}
            </p>
            <p className="who">
              <Link href={`/app/patients/${r.patientId}`} className="hover:underline">
                {r.first} {r.last}
              </Link>
            </p>
            <p className="what">
              {r.procedures.join(", ")} with {r.dentistName}
            </p>
            <p className="what">
              Requested {formatDate(requested)}, {formatTime(requested)}
            </p>
            <div className="chip-row">
              <span className="chip chip-amber">Pending</span>
              <span className={`chip ${r.returning ? "chip-blue" : "chip-brand"}`}>{r.returning ? "Returning" : "New"}</span>
            </div>
            {r.mobile && (
              <div className="flex flex-wrap gap-5">
                <a href={`tel:${r.mobile}`} className="link inline-flex min-h-11 items-center">
                  Call {localMobile(r.mobile)}
                </a>
                <a href={`sms:${r.mobile}`} className="link inline-flex min-h-11 items-center">
                  Text
                </a>
              </div>
            )}
            <AppointmentActions id={r.id} actions={r.actions} />
          </article>
        );
      })}
    </>
  );
}
