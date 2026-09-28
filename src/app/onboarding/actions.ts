"use server";

import { redirect } from "next/navigation";
import { parseOnboarding, type OnboardingField } from "@/lib/onboarding";
import { serverClient } from "@/lib/supabase/server";
import { clinicExists } from "@/lib/the-clinic";

export type OnboardingResult = { ok: true; slug: string } | { ok: false; field: OnboardingField | "form"; error: string };

export async function createClinic(input: unknown): Promise<OnboardingResult> {
  const parsed = parseOnboarding(input);
  if (!parsed.ok) return parsed;

  // One clinic per site (Kai, 2026-09-28): the owner sets it up once; nobody can add another.
  if (await clinicExists()) return { ok: false, field: "form", error: "This site already has its clinic. Ask the owner for a join link." };

  const db = await serverClient();
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims?.sub) return { ok: false, field: "form", error: "Your session ended. Log in again to finish." };

  const { error } = await db.rpc("create_clinic", { p: parsed.payload });
  // No join cookie cleanup here: any cookie change in a Server Action re-renders the page, which would send the new
  // owner to /app before onboarding's last screen. A leftover cookie is harmless, since every reader needs an open link.
  if (!error) return { ok: true, slug: parsed.payload.slug };
  if (error.message.includes("clinics_slug_key")) {
    return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
  }
  // Any other unique violation means this account already has a clinic.
  if (error.code === "23505") redirect("/app");
  console.error("create_clinic failed", error.code, error.message);
  return { ok: false, field: "form", error: "Something went wrong. Please try again." };
}
