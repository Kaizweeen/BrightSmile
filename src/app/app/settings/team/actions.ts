"use server";

import { refresh } from "next/cache";
import type { Saved } from "@/lib/staff-input";
import { OWNER_ONLY, requireOwner } from "@/lib/supabase/server";
import { createInvite, removeMember, revokeInvite, type NewInvite } from "@/lib/team-data";

/** Teams spec 6.1: a new join link, for the owner only. The token comes back once and is never stored. */
export async function createInviteAction(): Promise<NewInvite> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await createInvite(owner);
  if (result.ok) refresh();
  return result;
}

/** Revokes an open join link. The id is untrusted: RLS and the clinic filter keep it to the owner's clinic. */
export async function revokeInviteAction(id: unknown): Promise<Saved> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await revokeInvite(owner, String(id));
  if (result.ok) refresh();
  return result;
}

/** Removes a staff member; remove_member itself checks the owner and refuses owner rows. */
export async function removeMemberAction(userId: unknown): Promise<Saved> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await removeMember(owner, String(userId));
  if (result.ok) refresh();
  return result;
}
