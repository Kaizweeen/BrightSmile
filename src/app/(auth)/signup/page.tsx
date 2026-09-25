import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
