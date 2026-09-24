import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/routes";
import { serverClient } from "@/lib/supabase/server";

/** Signup confirmation and password reset links land here, then continue to `next`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"), "/app");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const db = await serverClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await db.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await db.auth.exchangeCodeForSession(code)).error;
  }
  redirect(ok ? next : "/login?error=link");
}
