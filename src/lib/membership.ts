import type { SupabaseClient } from "@supabase/supabase-js";
import { logError } from "@/lib/log";

/** A member's role in their clinic (teams spec 4). */
export type Role = "owner" | "staff";

/**
 * The signed-in user's own membership, or null when the account has no clinic, or when the query itself fails (logged,
 * never thrown, since a signed-in visitor with an unreadable membership should read as having none rather than crash
 * the page). It filters by the user's id because members can read every membership of their clinic (teams spec 5):
 * unfiltered, a clinic with two members returns two rows and maybeSingle fails. The proxy and signedInStaff both use it.
 */
export async function ownMembership(db: SupabaseClient, userId: string): Promise<{ clinicId: string; role: Role } | null> {
  const { data, error } = await db.from("clinic_members").select("clinic_id, role").eq("user_id", userId).maybeSingle();
  if (error) {
    logError("ownMembership", error);
    return null;
  }
  const row = data as { clinic_id: string; role: Role } | null;
  return row ? { clinicId: row.clinic_id, role: row.role } : null;
}
