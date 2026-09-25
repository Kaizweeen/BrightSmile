import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MoveForm from "./MoveForm";
import { loadBookingOptions, loadMoveTarget } from "@/lib/dashboard";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "Move appointment" };

type Props = { params: Promise<{ id: string }> };

/** Move a confirmed visit that has not started to a new time or dentist. */
export default async function MovePage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const [target, options] = await Promise.all([loadMoveTarget(staff, id), loadBookingOptions(staff)]);
  if (!target) notFound();
  const now = new Date();
  const start = new Date(target.startsAt);
  const movable = target.status === "confirmed" && start > now;

  return (
    <>
      <Link href={`/app/schedule?date=${manilaDate(start)}`} className="back-arrow min-h-11">
        Back to the schedule
      </Link>
      <div className="page-head">
        <h1 className="font-display">Move appointment</h1>
      </div>
      <div className="card card-pad mb-3">
        <p className="who font-semibold">{target.patientName}</p>
        <p className="f-hint">
          Now: {formatDate(start)}, {formatTime(start)} ({target.duration} min). {target.procedures.join(", ")}
        </p>
      </div>
      {movable ? (
        <MoveForm id={target.id} dentists={options.dentists} duration={target.duration} dentistId={target.dentistId} today={manilaDate(now)} />
      ) : (
        <p className="note-box warn">Only upcoming confirmed visits can be moved.</p>
      )}
    </>
  );
}
