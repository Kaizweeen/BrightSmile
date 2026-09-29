import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { ApiError } from "@/server/errors";
import { getPatient } from "@/server/patients";
import { requireStaff } from "@/server/session";
import { PatientScreen, type PatientJson } from "./patient-screen";

export const metadata: Metadata = { title: "Patient" };

const TABS = ["details", "visits", "chart"];

/** `?tab=` opens a tab directly, such as My day's "Open chart". */
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { tab } = await searchParams;
  let patient;
  try {
    patient = await getPatient(staff, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <PatientScreen
      patient={JSON.parse(JSON.stringify(patient)) as PatientJson}
      canEdit={can(staff, "patient.edit")}
      staff={staff}
      initialTab={typeof tab === "string" && TABS.includes(tab) ? tab : "details"}
    />
  );
}
