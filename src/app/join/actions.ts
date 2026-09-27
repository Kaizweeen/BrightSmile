"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logError } from "@/lib/log";
import { serverClient } from "@/lib/supabase/server";
import { INVITE_DAYS, isInviteToken, JOIN_COOKIE, joinRefusal } from "@/lib/team";

export type JoinState = { error?: string };

const GONE = "This join link no longer works. Ask the clinic for a new one.";
const MEMBER = "This account already belongs to a clinic. Log out and use another email to join.";
const TRY_AGAIN = "Something went wrong. Try the link again.";

/** Carries the join link through sign-up or log-in: HttpOnly, SameSite=Lax, for 7 days (teams spec 6.2). */
async function rememberInvite(token: string): Promise<void> {
  (await cookies()).set(JOIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: INVITE_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

/** "Create an account" and "I already have an account": remember the link, then sign up or log in. */
export async function continueToJoin(form: FormData): Promise<void> {
  const token = form.get("token");
  if (!isInviteToken(token)) redirect("/login");
  await rememberInvite(token);
  redirect(form.get("to") === "login" ? "/login" : "/signup");
}

/**
 * "Join {clinic}": accept_invite as the signed-in user, then the dashboard. The cookie goes once the link has worked or
 * been refused, so onboarding never sends the account back here; an unexpected error keeps it for another try.
 */
export async function joinClinic(_state: JoinState, form: FormData): Promise<JoinState> {
  const token = form.get("token");
  if (!isInviteToken(token)) return { error: GONE };
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) {
    await rememberInvite(token);
    redirect("/login");
  }
  const { error } = await db.rpc("accept_invite", { p_token: token });
  const refusal = error ? joinRefusal(error.code) : null;
  if (error && !refusal) {
    logError("joinClinic", error);
    return { error: TRY_AGAIN };
  }
  (await cookies()).delete(JOIN_COOKIE);
  if (refusal) return { error: refusal === "member" ? MEMBER : GONE };
  redirect("/app/requests");
}

/** "Log out" for an account that already belongs to a clinic: sign out, then back to the link to sign up or log in. */
export async function logOutToJoin(form: FormData): Promise<void> {
  const token = form.get("token");
  const db = await serverClient();
  await db.auth.signOut();
  redirect(isInviteToken(token) ? `/join/${token}` : "/login");
}
