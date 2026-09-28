import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ownMembership } from "@/lib/membership";
import { guardRedirect, keepPlaySource } from "@/lib/routes";

/** Refreshes the staff session and keeps visitors on the right side of /app and /onboarding. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" },
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
  const userId = data?.claims?.sub;
  const signedIn = Boolean(userId);
  const hasClinic = userId ? (await ownMembership(supabase, userId)) !== null : false;

  const target = guardRedirect(request.nextUrl.pathname, { signedIn, hasClinic });
  if (!target) return response;
  // Play Store spec 3.2: a signed-out launch from the Play app hits /login before PlaySource ever runs client
  // side, so this redirect must keep the flag itself, not just rely on the client-side navigations PlaySource covers.
  const redirectUrl = keepPlaySource(new URL(target, request.url), request.nextUrl.searchParams.get("source"));
  const redirect = NextResponse.redirect(redirectUrl);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

// Public pages (the booking page and patient links) never touch the staff session, so they skip the proxy.
// /admin and /join pass through only to keep their sessions fresh: guardRedirect never redirects them; requireOperator
// guards /admin, and a join link works signed in or out (teams spec 6.2).
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup", "/admin", "/join/:path*"],
};
