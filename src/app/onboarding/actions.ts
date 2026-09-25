"use server";

import { redirect } from "next/navigation";
import { parseOnboarding, type OnboardingField } from "@/lib/onboarding";
import { serverClient } from "@/lib/supabase/server";

export type OnboardingResult = { ok: true; slug: string } | { ok: false; field: OnboardingField | "form"; error: string };

export async function createClinic(input: unknown): Promise<OnboardingResult> {
  const parsed = parseOnboarding(input);
  if (!parsed.ok) return parsed;

  const db = await serverClient();
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims?.sub) return { ok: false, field: "form", error: "Your session ended. Log in again to finish." };

  const { error } = await db.rpc("create_clinic", { p: parsed.payload });
  if (!error) return { ok: true, slug: parsed.payload.slug };
  if (error.message.includes("clinics_slug_key")) {
    return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
  }
  // Any other unique violation means this account already has a clinic.
  if (error.code === "23505") redirect("/app");
  console.error("create_clinic failed", error.code, error.message);
  return { ok: false, field: "form", error: "Something went wrong. Please try again." };
}
