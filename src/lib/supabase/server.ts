import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ownMembership, type Role } from "@/lib/membership";

/** Cookie-bound client with the publishable key: acts as the signed-in staff member, so RLS applies. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components can't set cookies. src/proxy.ts refreshes the session for staff pages.
        }
      },
    },
  });
}

export type ServerDb = Awaited<ReturnType<typeof serverClient>>;

/** The signed-in user, their clinic, and their role there, or null when nobody is signed in. */
export async function signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null; role: Role | null } | null> {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const member = await ownMembership(db, userId);
  return { db, userId, clinicId: member?.clinicId ?? null, role: member?.role ?? null };
}

/** A signed-in staff member with a clinic. Services take this and query through `db`, so RLS applies. */
export type Staff = { db: SupabaseClient; userId: string; clinicId: string };

/** Staff plus their role in the clinic (teams spec 4). */
export type Member = Staff & { role: Role };

/**
 * For dashboard pages and Server Actions: visitors without a session go to log in, accounts without
 * a clinic go to onboarding. Call it outside try blocks, because redirect throws.
 */
export async function requireStaff(): Promise<Member> {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId || !staff.role) redirect("/onboarding");
  return { db: staff.db, userId: staff.userId, clinicId: staff.clinicId, role: staff.role };
}

/** What an owner-only Server Action answers staff (teams spec 4). RLS refuses their writes regardless. */
export const OWNER_ONLY = "Only the clinic's owner can change this.";

/**
 * For owner-only pages and Server Actions (teams spec 4): requireStaff, then null for staff, so an action can answer
 * OWNER_ONLY and a page can send them elsewhere. Call it outside try blocks, because requireStaff may redirect.
 */
export async function requireOwner(): Promise<Member | null> {
  const member = await requireStaff();
  return member.role === "owner" ? member : null;
}
