import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { signedInStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your clinic" };

export default async function OnboardingPage() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (staff.clinicId) redirect("/app");
  return <Onboarding appUrl={process.env.APP_URL ?? "http://localhost:3600"} />;
}
