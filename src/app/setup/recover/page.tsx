import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Owner password" };

export default function RecoverPage() {
  return (
    <AuthCard brand title="Reset the owner's password" description="Enter the setup code from the server's settings and a new password.">
      <RecoverForm />
    </AuthCard>
  );
}
