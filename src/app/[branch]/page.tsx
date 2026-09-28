import { redirect } from "next/navigation";
import { navItems } from "@/lib/nav";
import { requireStaff } from "@/server/session";

/** A bare branch URL opens its first section. */
export default async function BranchIndex({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  redirect(navItems(staff, branch)[0].href);
}
