import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { manilaDate } from "@/lib/time";
import { welcomeInfo } from "@/server/patient-forms";
import { practiceName } from "@/server/practice";
import { PatientForm } from "./patient-form";

/** The practice's name in the browser tab (the root layout's template adds " | DentaSync"). */
export async function generateMetadata(): Promise<Metadata> {
  // Request time only: `next build` must never open the database.
  await connection();
  return { title: `Patient form at ${await practiceName()}` };
}

/** Patient forms spec 4: the patient's own basic details, for the front desk to check at the visit. */
export default async function PatientFormPage({ params }: { params: Promise<{ code: string }> }) {
  // Request time only: `next build` must never open the database.
  await connection();
  const { code } = await params;
  const info = await welcomeInfo(code);
  if (!info) notFound();
  if (!info.forms) {
    return <AuthCard title={info.practiceName} description="Patient forms aren't available right now. Please ask at the front desk." />;
  }
  return (
    <AuthCard title="Patient form" description={`${info.practiceName}, ${info.branch.name}. The front desk checks it with you at your visit.`}>
      <PatientForm branch={info.branch.code} booking={info.booking} today={manilaDate(new Date())} />
    </AuthCard>
  );
}
