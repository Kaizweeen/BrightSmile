import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { practiceSettings } from "@/server/practice";

export const metadata: Metadata = { title: "Privacy notice" };

/** Online booking spec 3: the owner's notice, shown only while online booking is on. */
export default async function PrivacyPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  const settings = await practiceSettings();
  if (!settings.onlineBooking) notFound();
  return (
    <AuthCard title={`${settings.name} privacy notice`}>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{settings.privacyNotice}</div>
    </AuthCard>
  );
}
