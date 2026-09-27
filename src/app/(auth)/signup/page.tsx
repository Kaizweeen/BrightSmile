import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";

export const metadata: Metadata = { title: "Sign up" };

/**
 * After a join link (teams spec 6.2), sign-up says the account joins a clinic's team instead of setting one up. An
 * open invite decides this, not merely holding the cookie, so a link that expired or was used or revoked while it sat
 * in the browser does not keep calling this a join.
 */
export default async function SignupPage() {
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  const joining = Boolean(token && (await inviteClinicName(token, new Date()).catch(() => null)));
  return <AuthForm mode={joining ? "join" : "signup"} action={signUp} />;
}
