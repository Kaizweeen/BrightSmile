import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { JOIN_COOKIE } from "@/lib/team";

export const metadata: Metadata = { title: "Sign up" };

/** After a join link (teams spec 6.2), sign-up says the account joins a clinic's team instead of setting one up. */
export default async function SignupPage() {
  const joining = (await cookies()).has(JOIN_COOKIE);
  return <AuthForm mode={joining ? "join" : "signup"} action={signUp} />;
}
