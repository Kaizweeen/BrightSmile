import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cookie-bound client with the publishable key: acts as the signed-in staff member, so RLS applies. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
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
