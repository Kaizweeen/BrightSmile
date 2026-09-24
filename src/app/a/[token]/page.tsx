import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CancelButton from "./CancelButton";
import type { Status } from "@/lib/appointments";
import { loadPatientView } from "@/lib/patient-link";
import { localMobile } from "@/lib/phone";
import { formatDate, formatTime } from "@/lib/time";

// The status changes over time, so this page is never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your appointment", robots: { index: false, follow: false } };

// Every status carries a word, never colour alone.
const STATUS: Record<Status, { word: string; chip: string }> = {
  pending: { word: "Waiting for the clinic", chip: "chip-amber" },
  confirmed: { word: "Confirmed", chip: "chip-green" },
  cancelled: { word: "Cancelled", chip: "chip-red" },
  declined: { word: "Declined", chip: "chip-red" },
  completed: { word: "Completed", chip: "chip-blue" },
  no_show: { word: "Missed", chip: "chip-red" },
  expired: { word: "Expired", chip: "chip-gold" },
};

type Params = { params: Promise<{ token: string }> };

/** Spec 5.2: the patient's view and cancel link. No login. */
export default async function PatientLinkPage({ params }: Params) {
  const { token } = await params;
  const view = await loadPatientView(token, new Date());
  if (!view) notFound();
  const status = STATUS[view.status];
  const phone = localMobile(view.clinicMobile);
  const rebook = view.status === "cancelled" || view.status === "declined" || view.status === "expired";

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Hi {view.firstName}</h1>
        <p className="sub">Your visit at {view.clinicName}</p>

        <div className="cf-box">
          <p className="big-time">{formatTime(view.startsAt)}</p>
          <p className="font-display text-[15px] font-semibold">{formatDate(view.startsAt)}</p>
          <p className="mt-3">
            <span className={`chip ${status.chip}`}>{status.word}</span>
          </p>
          <div className="mt-4">
            <div className="cf-row">
              <span className="k">With</span>
              <span className="v">{view.dentistName}</span>
            </div>
            <div className="cf-row">
              <span className="k">Clinic</span>
              <span className="v">{view.clinicName}</span>
            </div>
          </div>
        </div>

        {view.cancellable && <CancelButton token={token} />}
        {rebook && (
          <Link href={`/${view.slug}`} className="btn btn-primary wide-btn mt-6">
            Book again
          </Link>
        )}

        <p className="f-hint mt-4">
          Questions? Call{" "}
          <a href={`tel:${view.clinicMobile}`} className="link">
            {phone}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
