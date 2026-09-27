import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import TeamPanel from "./TeamPanel";
import { billingDate } from "@/lib/billing";
import { requireOwner } from "@/lib/supabase/server";
import { loadTeam } from "@/lib/team-data";
import { formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Team" };

/** Teams spec 6.1: the owner's Team page. Staff go back to Settings. */
export default async function TeamPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/app/settings");
  const now = new Date();
  const { members, invites } = await loadTeam(owner, now);
  const at = (iso: string) => `${billingDate(new Date(iso), now)}, ${formatTime(new Date(iso))}`;

  return (
    <>
      <Link href="/app/settings" className="back-arrow min-h-11">
        Back to Settings
      </Link>
      <div className="page-head">
        <h1 className="font-display">Team</h1>
      </div>
      <TeamPanel
        members={members.map((m) => ({ userId: m.userId, email: m.email, owner: m.role === "owner", joined: billingDate(new Date(m.joinedAt), now) }))}
        invites={invites.map((i) => ({ id: i.id, created: at(i.createdAt), expires: at(i.expiresAt) }))}
      />
    </>
  );
}
