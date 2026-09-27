import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { appUrl } from "@/lib/app-url";
import { signedInStaff } from "@/lib/supabase/server";
import { JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";

export const metadata: Metadata = { title: "Set up your clinic" };

export default async function OnboardingPage() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (staff.clinicId) redirect("/app");
  // Teams spec 6.2: an account that came through a join link joins that clinic instead of setting one up. Only a link
  // that still works counts, so a stale cookie never keeps anyone from setting up a clinic.
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  if (token && (await inviteClinicName(token, new Date()))) redirect(`/join/${token}`);
  return <Onboarding appUrl={appUrl()} />;
}
