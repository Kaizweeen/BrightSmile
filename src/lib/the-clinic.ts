import "server-only";
import { adminClient } from "@/lib/supabase/admin";

/**
 * This site serves one clinic (Kai's, 2026-09-28): the first clinic ever set up, or null before the owner has done the
 * one-time setup. The secret-key client is needed because visitors are not clinic members; only the slug is read.
 */
export async function theClinicSlug(): Promise<string | null> {
  const { data, error } = await adminClient().from("clinics").select("slug").order("created_at").limit(1).maybeSingle();
  if (error) throw error;
  return (data as { slug: string } | null)?.slug ?? null;
}

/** True once the clinic exists. From then on accounts are made only through a join link from the owner. */
export async function clinicExists(): Promise<boolean> {
  return (await theClinicSlug()) !== null;
}
