import type { Metadata } from "next";
import Link from "next/link";
import NewAppointment from "./NewAppointment";
import { loadBookingOptions } from "@/lib/dashboard";
import { loadPatient } from "@/lib/patients";
import { requireStaff } from "@/lib/supabase/server";
import { manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "New appointment" };

type Props = { searchParams: Promise<{ patient?: string | string[] }> };

/** Spec 5.3 New appointment. `?patient={id}` starts with that patient chosen (from the patient page). */
export default async function NewAppointmentPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { patient } = await searchParams;
  const [options, detail] = await Promise.all([
    loadBookingOptions(staff),
    typeof patient === "string" ? loadPatient(staff, patient) : Promise.resolve(null),
  ]);
  const initialPatient =
    detail && !detail.patient.anonymized
      ? { id: detail.patient.id, first: detail.patient.first, last: detail.patient.last, mobile: detail.patient.mobile }
      : null;

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">New appointment</h1>
      </div>
      {options.dentists.length === 0 || options.procedures.length === 0 ? (
        <p className="note-box warn">
          Add an active dentist and a procedure in{" "}
          <Link href="/app/settings" className="link">
            Settings
          </Link>{" "}
          first.
        </p>
      ) : (
        <NewAppointment {...options} today={manilaDate(new Date())} initialPatient={initialPatient} />
      )}
    </>
  );
}
