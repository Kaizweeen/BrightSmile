import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { listBranches } from "@/server/branches";
import { staffFromHeaders } from "@/server/session";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function WaitingPage() {
  const staff = await staffFromHeaders(await headers());
  if (!staff) redirect("/login");
  if (staff.status !== "pending") redirect("/");
  const branch = (await listBranches()).find((b) => b.id === staff.primaryBranchId);
  return (
    <AuthCard brand
      title="Waiting for approval"
      description={`Ask the owner or a manager at ${branch?.name ?? "your branch"} to approve you. Requests expire after 7 days.`}
    >
      <div className="flex flex-wrap gap-3">
        <Link href="/" className={buttonVariants()}>
          Check again
        </Link>
        <SignOutButton />
      </div>
    </AuthCard>
  );
}
