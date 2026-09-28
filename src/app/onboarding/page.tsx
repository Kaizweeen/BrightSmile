import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { appUrl } from "@/lib/app-url";
import { logError } from "@/lib/log";
import { signedInStaff } from "@/lib/supabase/server";
import { JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";
import { clinicExists } from "@/lib/the-clinic";

export const metadata: Metadata = { title: "Set up your clinic" };

export default async function OnboardingPage() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (staff.clinicId) redirect("/app");
  // Teams spec 6.2: an account that came through a join link joins that clinic instead of setting one up. Only a link
  // that still works counts, so a stale cookie never keeps anyone from setting up a clinic. A lookup error is not a
  // reason to block onboarding: log it and fall through to the clinic setup.
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  let clinicName: string | null = null;
  if (token) {
    try {
      clinicName = await inviteClinicName(token, new Date());
    } catch (e) {
      logError("onboarding", e);
    }
  }
  if (clinicName) redirect(`/join/${token}`);
  // One clinic per site (Kai, 2026-09-28): once it exists, an account without a clinic needs the owner's join link.
  if (await clinicExists()) {
    return (
      <main className="flow-wrap">
        <div className="flow-card screen-in">
          <h1 className="font-display">This site already has its clinic</h1>
          <p className="sub">Ask the clinic&apos;s owner for a join link to use this account there.</p>
        </div>
      </main>
    );
  }
  return <Onboarding appUrl={appUrl()} />;
}
