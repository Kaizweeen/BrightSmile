import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthCard brand title="Sign in" description="Use the username and password you chose when you joined.">
      <LoginForm />
      <p className="text-sm text-muted-foreground">Forgot your password? Ask your manager for a reset QR.</p>
    </AuthCard>
  );
}
