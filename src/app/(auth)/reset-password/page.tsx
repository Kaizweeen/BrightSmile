import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { setNewPassword } from "../actions";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return <AuthForm mode="reset" action={setNewPassword} />;
}
