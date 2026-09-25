import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { sendReset } from "../actions";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return <AuthForm mode="forgot" action={sendReset} />;
}
