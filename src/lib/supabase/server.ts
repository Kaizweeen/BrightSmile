import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isOperator } from "@/lib/admin";

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

/** The signed-in staff member and their clinic, or null when nobody is signed in. */
export async function signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null } | null> {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: member } = await db.from("clinic_members").select("clinic_id").maybeSingle();
  return { db, userId, clinicId: (member?.clinic_id as string | undefined) ?? null };
}

/** A signed-in staff member with a clinic. Services take this and query through `db`, so RLS applies. */
export type Staff = { db: SupabaseClient; userId: string; clinicId: string };

/**
 * For dashboard pages and Server Actions: visitors without a session go to log in, accounts without
 * a clinic go to onboarding. Call it outside try blocks, because redirect throws.
 */
export async function requireStaff(): Promise<Staff> {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId) redirect("/onboarding");
  return { db: staff.db, userId: staff.userId, clinicId: staff.clinicId };
}

/**
 * For /admin and its actions (billing spec 7.6): the signed-in user whose confirmed email is in OPERATOR_EMAILS.
 * Everyone else, signed in or not, gets a 404, so the page never reveals itself. getUser asks Supabase Auth, so
 * email_confirmed_at is current. Call it outside try blocks, because notFound throws.
 */
export async function requireOperator(): Promise<{ userId: string }> {
  const db = await serverClient();
  const { data } = await db.auth.getUser();
  if (!data.user || !isOperator(data.user, process.env.OPERATOR_EMAILS)) notFound();
  return { userId: data.user.id };
}
