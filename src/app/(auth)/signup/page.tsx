import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";
import { clinicExists } from "@/lib/the-clinic";
import Link from "next/link";

export const metadata: Metadata = { title: "Sign up" };

/**
 * After a join link (teams spec 6.2), sign-up says the account joins a clinic's team instead of setting one up. An
 * open invite decides this, not merely holding the cookie, so a link that expired or was used or revoked while it sat
 * in the browser does not keep calling this a join.
 */
export default async function SignupPage() {
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  const joining = Boolean(token && (await inviteClinicName(token, new Date()).catch(() => null)));
  // One clinic per site (Kai, 2026-09-28): after the owner's one-time setup, accounts come only from a join link.
  if (!joining && (await clinicExists())) {
    return (
      <main className="flow-wrap">
        <div className="flow-card screen-in">
          <h1 className="font-display">Staff accounts are by invitation</h1>
          <p className="sub">Ask the clinic&apos;s owner for a join link. It opens this sign-up for you.</p>
          <Link href="/login" className="btn btn-soft wide-btn mt-4">
            I already have an account
          </Link>
        </div>
      </main>
    );
  }
  return <AuthForm mode={joining ? "join" : "signup"} action={signUp} />;
}
