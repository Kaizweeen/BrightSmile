import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { roleLabel } from "@/lib/labels";
import { navItems } from "@/lib/nav";
import { can, covers } from "@/lib/permissions";
import { listBranches } from "@/server/branches";
import { homePath } from "@/server/home";
import { practiceName } from "@/server/practice";
import { requireStaff } from "@/server/session";

/** Every signed-in page lives under /{branch}/, a branch code or "all" (spec section 10). */
export default async function BranchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const branches = await listBranches();
  if (branch === "all") {
    if (!can(staff, "overview.view")) redirect(await homePath(staff));
  } else {
    const current = branches.find((b) => b.code === branch);
    if (!current || !covers(staff, current.id)) notFound();
  }
  const options = [
    ...(can(staff, "overview.view") ? [{ code: "all", name: "All branches" }] : []),
    ...branches.filter((b) => (b.active || b.code === branch) && covers(staff, b.id)).map((b) => ({ code: b.code, name: b.name })),
  ];
  return (
    <AppShell
      practice={await practiceName()}
      branch={branch}
      branches={options}
      nav={navItems(staff, branch)}
      user={{ name: staff.name, role: roleLabel(staff.role, staff.title) }}
    >
      {children}
    </AppShell>
  );
}
