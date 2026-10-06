import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { practiceName } from "@/server/practice";
import { branchForJoinCode } from "@/server/staff";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const branch = await branchForJoinCode(code);
  if (!branch) return <AuthCard brand title="This QR code no longer works" description="Ask the owner for the current one." />;
  return (
    <AuthCard brand
      title="Ask for a staff account"
      description={`${await practiceName()}, ${branch.name}. The owner or a manager here approves your account.`}
    >
      <JoinForm code={code} />
    </AuthCard>
  );
}
