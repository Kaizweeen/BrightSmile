"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { hasRecentRecoverySession } from "@/lib/reset-session";
import { serverClient } from "@/lib/supabase/server";
import { isInviteToken, JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";
import { clinicExists } from "@/lib/the-clinic";
import { cleanEmail, passwordProblem } from "@/lib/validate";

export type AuthState = { error?: string; sent?: string; email?: string; expired?: boolean };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY_EMAILS = "Too many emails were sent. Wait a few minutes and try again.";

export async function signUp(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email) return { error: "Enter a valid email address." };
  const weak = passwordProblem(password);
  if (weak) return { error: weak, email };

  // One clinic per site: once it exists, only an open join link may create an account (checked here, not just on the page).
  const joinToken = (await cookies()).get(JOIN_COOKIE)?.value;
  const invited = Boolean(joinToken && (await inviteClinicName(joinToken, new Date()).catch(() => null)));
  if (!invited && (await clinicExists())) return { error: "Staff accounts are by invitation. Ask the clinic's owner for a join link.", email };

  const db = await serverClient();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${appUrl()}/auth/confirm?next=/onboarding` },
  });
  if (error) {
    if (error.code === "user_already_exists") return { error: "That email already has an account. Log in instead.", email };
    if (error.code === "weak_password") return { error: "Choose a stronger password.", email };
    if (error.code === "over_email_send_rate_limit") return { error: TOO_MANY_EMAILS, email };
    return { error: GENERIC, email };
  }
  // With email confirmation on, no session comes back until the link is opened.
  if (!data.session) {
    // Teams spec 6.2: after a join link, the confirmation leads to the clinic's team when opened in this browser.
    // An open invite decides this, not merely holding the cookie (a dead link should not promise a team to join).
    const token = (await cookies()).get(JOIN_COOKIE)?.value;
    const joining = Boolean(token && (await inviteClinicName(token, new Date()).catch(() => null)));
    const next = joining ? "Open it on this device to join your clinic's team." : "Open it to set up your clinic.";
    return { sent: `We sent a confirmation link to ${email}. ${next}` };
  }
  redirect("/onboarding");
}

export async function logIn(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email: email ?? "" };

  const db = await serverClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first. Open the link we sent when you signed up.", email };
    if (error.code === "invalid_credentials") return { error: "That email and password don't match.", email };
    return { error: GENERIC, email };
  }
  // Teams spec 6.2: signing in through a still-open join link returns to it, even for an account that already has a
  // clinic, so it sees why it cannot join instead of landing on /app with no explanation. Otherwise the proxy sends an
  // account without a clinic on to onboarding.
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  if (isInviteToken(token) && (await inviteClinicName(token, new Date()).catch(() => null))) redirect(`/join/${token}`);
  redirect("/app");
}

export async function sendReset(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };

  const db = await serverClient();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error?.code === "over_email_send_rate_limit") return { error: TOO_MANY_EMAILS, email };
  // The same answer whether or not the account exists, so this form can't be used to find accounts.
  return { sent: `If ${email} has an account, we sent it a link to set a new password.` };
}

export async function setNewPassword(_state: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  const weak = passwordProblem(password);
  if (weak) return { error: weak };

  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub || !hasRecentRecoverySession(data.claims, new Date())) {
    return { error: "This reset link has expired.", expired: true };
  }
  const { error } = await db.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "Choose a password you have not used here before." : GENERIC };
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const db = await serverClient();
  await db.auth.signOut();
  redirect("/login");
}
