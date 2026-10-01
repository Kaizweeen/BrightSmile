import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { listBranches } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { BillingScreen } from "./billing-screen";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const current = (await listBranches()).find((b) => b.code === branch);
  if (!current || !can(staff, "billing.view", { branchId: current.id })) notFound();
  const target = { branchId: current.id };
  return (
    <BillingScreen branch={branch} canIssue={can(staff, "billing.issue", target)} canVoid={can(staff, "billing.void", target)} canClose={can(staff, "billing.close", target)} />
  );
}
