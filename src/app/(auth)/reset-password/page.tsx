import type { Metadata } from "next";
import Link from "next/link";
import { hasRecentRecoverySession } from "@/lib/reset-session";
import { serverClient } from "@/lib/supabase/server";
import AuthForm from "../AuthForm";
import { setNewPassword } from "../actions";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage() {
  // Check the link up front so nobody types a new password into a form that will refuse it.
  const { data } = await (await serverClient()).auth.getClaims();
  if (!data?.claims?.sub || !hasRecentRecoverySession(data.claims, new Date())) {
    return (
      <div className="flow-wrap">
        <div className="flow-card screen-in">
          <h1 className="font-display">This reset link has expired</h1>
          <p className="sub">Reset links work for one hour. Ask for a new one.</p>
          <Link href="/forgot" className="btn btn-primary wide-btn">
            Send a new link
          </Link>
        </div>
      </div>
    );
  }
  return <AuthForm mode="reset" action={setNewPassword} />;
}
