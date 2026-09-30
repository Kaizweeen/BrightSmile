import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { branchByCode } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { SuppliesScreen } from "./supplies-screen";

export const metadata: Metadata = { title: "Supplies" };

export default async function SuppliesPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  // Stock belongs to one branch; switching to "All branches" lands on the overview.
  if (branch === "all") redirect("/all");
  const row = await branchByCode(branch);
  if (!row || !can(staff, "supplies.view", { branchId: row.id })) notFound();
  return <SuppliesScreen branch={branch} canEdit={can(staff, "supplies.edit", { branchId: row.id })} />;
}
