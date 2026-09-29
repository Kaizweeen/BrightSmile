import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { practiceSettings } from "@/server/practice";

export const metadata: Metadata = { title: "Privacy notice" };

/** Online booking spec 3 and patient forms spec 4: the owner's notice, shown while online booking or patient forms is on. */
export default async function PrivacyPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  const settings = await practiceSettings();
  if (!settings.onlineBooking && !settings.patientForms) notFound();
  return (
    <AuthCard title={`${settings.name} privacy notice`}>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{settings.privacyNotice}</div>
    </AuthCard>
  );
}
