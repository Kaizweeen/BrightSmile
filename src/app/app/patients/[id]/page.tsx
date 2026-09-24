import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PatientEditor from "./PatientEditor";
import { loadPatient } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { STATUS_LABEL } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "Patient" };

type Props = { params: Promise<{ id: string }> };

/** Spec 5.3 patient detail: editable details, appointment history, no-show count, and Delete. */
export default async function PatientPage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const detail = await loadPatient(staff, id);
  if (!detail) notFound();
  const { patient, history, noShows } = detail;

  return (
    <>
      <Link href="/app/patients" className="back-arrow min-h-11">
        Back to patients
      </Link>
      <div className="page-head">
        <h1 className="font-display">
          {patient.first} {patient.last}
        </h1>
        {!patient.anonymized && (
          <Link href={`/app/new?patient=${patient.id}`} className="btn btn-primary">
            New appointment
          </Link>
        )}
      </div>

      <div className="card card-pad mb-3">
        <div className="chip-row mt-0">
          <span className={`chip ${noShows > 0 ? "chip-red" : "chip-green"}`}>{noShows === 1 ? "1 no-show" : `${noShows} no-shows`}</span>
          <span className="chip chip-brand">{history.length === 1 ? "1 appointment" : `${history.length} appointments`}</span>
        </div>
        {patient.mobile && (
          <div className="flex flex-wrap gap-5">
            <a href={`tel:${patient.mobile}`} className="link inline-flex min-h-11 items-center">
              Call {localMobile(patient.mobile)}
            </a>
            <a href={`sms:${patient.mobile}`} className="link inline-flex min-h-11 items-center">
              Text
            </a>
          </div>
        )}
        {patient.anonymized ? (
          <p className="note-box mt-3">This patient was deleted. Their details were removed; past appointments stay for your counts.</p>
        ) : (
          <PatientEditor patient={patient} />
        )}
      </div>

      <section className="card card-pad">
        <h2 className="font-display text-[17px] font-bold">History</h2>
        {history.length === 0 ? (
          <p className="empty-note">No appointments yet.</p>
        ) : (
          <div className="member-list mt-2">
            {history.map((h) => {
              const start = new Date(h.startsAt);
              const label = STATUS_LABEL[h.status];
              return (
                <div key={h.id} className="member-row cursor-default">
                  <span className="nm">
                    {formatDate(start)} {manilaDate(start).slice(0, 4)}, {formatTime(start)}
                    <span className="meta block">
                      {h.procedures.join(", ")} with {h.dentistName}
                    </span>
                  </span>
                  <span className={`chip ${label.chip}`}>{label.word}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
