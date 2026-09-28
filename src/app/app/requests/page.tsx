import type { Metadata } from "next";
import Link from "next/link";
import AppointmentActions from "../AppointmentActions";
import { loadBranches, loadRequests } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "Requests" };

type Props = { searchParams: Promise<{ branch?: string | string[] }> };

/**
 * Spec 5.3: pending requests, soonest first, each with Approve and Decline. With 2 or more active branches, each names
 * its branch and a branch filter shows one at a time (booking flow spec 4).
 */
export default async function RequestsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { branch } = await searchParams;
  const branchId = isUuid(branch) ? branch : null;
  const [requests, branches] = await Promise.all([loadRequests(staff, new Date(), branchId), loadBranches(staff)]);
  const open = branches.filter((b) => b.active);
  const branchOf = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Requests</h1>
        <span className="f-hint">{requests.length === 1 ? "1 waiting" : `${requests.length} waiting`}</span>
      </div>

      {open.length > 1 && (
        <div className="chip-row mb-3" role="group" aria-label="Branch">
          <Link href="/app/requests" className={`btn ${branchId ? "btn-ghost" : "btn-primary"}`} aria-current={branchId ? undefined : "true"}>
            All branches
          </Link>
          {open.map((b) => (
            <Link
              key={b.id}
              href={`/app/requests?branch=${b.id}`}
              className={`btn ${branchId === b.id ? "btn-primary" : "btn-ghost"}`}
              aria-current={branchId === b.id ? "true" : undefined}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {requests.length === 0 && (
        <div className="card empty-note">
          {branchId ? "No requests waiting at this branch." : "No requests waiting. New ones from your booking page appear here."}
        </div>
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
              {open.length > 1 && ` at ${branchOf.get(r.branchId) ?? "a former branch"}`}
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
