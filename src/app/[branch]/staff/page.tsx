import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { listBranches } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { StaffScreen } from "./staff-screen";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const staff = await requireStaff();
  if (!can(staff, "staff.view")) notFound();
  const branches = (await listBranches()).filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }));
  return <StaffScreen me={{ id: staff.id, role: staff.role, branchIds: [...staff.branchIds] }} branches={branches} />;
}
