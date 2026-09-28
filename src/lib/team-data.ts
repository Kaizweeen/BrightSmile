import "server-only";
import { appUrl } from "@/lib/app-url";
import { newToken } from "@/lib/codes";
import { logError } from "@/lib/log";
import type { Role } from "@/lib/membership";
import type { Saved } from "@/lib/staff-input";
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken, joinLink } from "@/lib/team";
import { isUuid } from "@/lib/validate";

export type TeamMember = { userId: string; email: string | null; role: Role; joinedAt: string };
export type OpenInvite = { id: string; createdAt: string; expiresAt: string };
export type NewInvite = { ok: true; link: string; id: string } | { ok: false; error: string };

const GENERIC = "Something went wrong. Please try again.";
const USED = "That link was already used or revoked. Reload the page.";
const GONE = "That person is no longer on your team. Reload the page.";

/**
 * The Team page (teams spec 6.1), through the owner's RLS client: every member, oldest first, and the join links nobody
 * has used, revoked, or outlived, newest first.
 */
export async function loadTeam(owner: Staff, now: Date): Promise<{ members: TeamMember[]; invites: OpenInvite[] }> {
  const [members, invites] = await Promise.all([
    owner.db.from("clinic_members").select("user_id, role, email, created_at").eq("clinic_id", owner.clinicId).order("created_at").throwOnError(),
    owner.db
      .from("clinic_invites")
      .select("id, created_at, expires_at")
      .eq("clinic_id", owner.clinicId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .throwOnError(),
  ]);
  return {
    members: (members.data as { user_id: string; role: Role; email: string | null; created_at: string }[]).map((m) => ({
      userId: m.user_id,
      email: m.email,
      role: m.role,
      joinedAt: m.created_at,
    })),
    invites: (invites.data as { id: string; created_at: string; expires_at: string }[]).map((i) => ({
      id: i.id,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
  };
}

/**
 * A new join link (teams spec 6.1): a random token whose SHA-256 alone is stored, so the link can be shown once and
 * never again. The database sets who made it and the 7 day expiry.
 */
export async function createInvite(owner: Staff): Promise<NewInvite> {
  const token = newToken();
  const { data, error } = await owner.db
    .from("clinic_invites")
    .insert({ clinic_id: owner.clinicId, token_hash: hashInviteToken(token) })
    .select("id")
    .single();
  if (error || !data) {
    logError("createInvite", error);
    return { ok: false, error: GENERIC };
  }
  return { ok: true, link: joinLink(appUrl(), token), id: (data as { id: string }).id };
}

/** Revokes an open join link of this clinic; it stops working at once (teams spec 2.4). */
export async function revokeInvite(owner: Staff, id: string): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: USED };
  const { data, error } = await owner.db
    .from("clinic_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", owner.clinicId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    logError("revokeInvite", error);
    return { ok: false, error: GENERIC };
  }
  return (data ?? []).length > 0 ? { ok: true } : { ok: false, error: USED };
}

/** Removes a staff member and their alerts to this clinic (remove_member). The owner's own row cannot be removed. */
export async function removeMember(owner: Staff, userId: string): Promise<Saved> {
  if (!isUuid(userId)) return { ok: false, error: GONE };
  const { error } = await owner.db.rpc("remove_member", { p_user_id: userId });
  if (!error) return { ok: true };
  if (error.code === "BSNOS") return { ok: false, error: GONE };
  logError("removeMember", error);
  return { ok: false, error: GENERIC };
}

/**
 * The clinic behind an open join link (not used, revoked, or expired), or null (teams spec 6.2, 7). Through the secret
 * key, because the visitor is not a member of that clinic; it finds the link by the token's hash and reveals only the name.
 * Throws on a database error.
 */
export async function inviteClinicName(token: unknown, now: Date): Promise<string | null> {
  if (!isInviteToken(token)) return null;
  const { data, error } = await adminClient()
    .from("clinic_invites")
    .select("clinic:clinics(name)")
    .eq("token_hash", hashInviteToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as { clinic: { name: string } | null } | null)?.clinic?.name ?? null;
}
