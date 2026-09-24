"use server";

import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { serverClient } from "@/lib/supabase/server";
import { cleanEmail, passwordProblem } from "@/lib/validate";

export type AuthState = { error?: string; sent?: string; email?: string };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY_EMAILS = "Too many emails were sent. Wait a few minutes and try again.";

export async function signUp(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email) return { error: "Enter a valid email address." };
  const weak = passwordProblem(password);
  if (weak) return { error: weak, email };

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
  if (!data.session) return { sent: `We sent a confirmation link to ${email}. Open it to set up your clinic.` };
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
  // The proxy sends accounts without a clinic on to onboarding.
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
  if (!data?.claims?.sub) return { error: "This reset link has expired. Ask for a new one from the log in page." };
  const { error } = await db.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "Choose a password you have not used here before." : GENERIC };
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const db = await serverClient();
  await db.auth.signOut();
  redirect("/login");
}
