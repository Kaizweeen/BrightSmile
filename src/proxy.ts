import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { guardRedirect } from "@/lib/routes";

/** Refreshes the staff session and keeps visitors on the right side of /app and /onboarding. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Verifies the session and refreshes it when it is about to expire (new cookies go through setAll).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  let hasClinic = false;
  if (signedIn) {
    const { data: member } = await supabase.from("clinic_members").select("clinic_id").maybeSingle();
    hasClinic = Boolean(member);
  }

  const target = guardRedirect(request.nextUrl.pathname, { signedIn, hasClinic });
  if (!target) return response;
  const redirect = NextResponse.redirect(new URL(target, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

// Public pages (the booking page and patient links) never touch the staff session, so they skip the proxy.
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup"],
};
