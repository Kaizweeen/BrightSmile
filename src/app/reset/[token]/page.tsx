import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthCard brand title="Set a new password" description="This link works once. Setting a new password signs you out on every device.">
      <ResetForm token={token} />
    </AuthCard>
  );
}
