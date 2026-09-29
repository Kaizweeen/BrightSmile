import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { practiceName } from "@/server/practice";
import { requireStaff } from "@/server/session";
import { SettingsScreen } from "./settings-screen";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const owner = can(staff, "settings.edit");
  return (
    <SettingsScreen
      owner={owner}
      canEditSchedules={staff.role !== "dentist"}
      me={{ id: staff.id, role: staff.role, branchIds: [...staff.branchIds] }}
      currentBranch={branch}
      practice={owner ? await practiceName() : ""}
    />
  );
}
