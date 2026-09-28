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

/**
 * Spec 5.3 patient detail: editable details, the patient form read only (booking flow spec 6), appointment history,
 * no-show count, and Delete.
 */
export default async function PatientPage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const detail = await loadPatient(staff, id);
  if (!detail) notFound();
  const { patient, history, noShows, form } = detail;

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

      {!patient.anonymized && (
        <section className="card card-pad mb-3" aria-labelledby="form-h">
          <h2 id="form-h" className="font-display text-[17px] font-bold">
            Patient form
          </h2>
          {form ? (
            <>
              <p className="f-hint">Health information. Only your clinic&apos;s team can see it.</p>
              <div className="cf-box mt-3">
                <div className="cf-row">
                  <span className="k">Allergies</span>
                  <span className="v">{form.allergies.length > 0 ? form.allergies.join(", ") : "None ticked"}</span>
                </div>
                <div className="cf-row">
                  <span className="k">Has or had</span>
                  <span className="v">{form.conditions.length > 0 ? form.conditions.join(", ") : "None ticked"}</span>
                </div>
              </div>
              <div className="mt-3">
                {form.rows.map((r) => (
                  <div key={r.label} className="cf-row">
                    <span className="k">{r.label}</span>
                    <span className="v">{r.value}</span>
                  </div>
                ))}
              </div>
              <p className="f-hint mt-3">
                Waiver signed by {form.signed.name} on {formatDate(new Date(form.signed.at))} {manilaDate(new Date(form.signed.at)).slice(0, 4)} (version{" "}
                {form.signed.version}).
              </p>
            </>
          ) : (
            <p className="f-hint">No patient form on file.</p>
          )}
        </section>
      )}

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
