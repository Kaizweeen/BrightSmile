import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { ApiError } from "@/server/errors";
import { getPatient } from "@/server/patients";
import { requireStaff } from "@/server/session";
import { PatientScreen, type PatientJson } from "./patient-screen";

export const metadata: Metadata = { title: "Patient" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  let patient;
  try {
    patient = await getPatient(staff, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return <PatientScreen patient={JSON.parse(JSON.stringify(patient)) as PatientJson} canEdit={can(staff, "patient.edit")} />;
}
