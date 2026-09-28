import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/server/session";
import { PatientsScreen } from "./patients-screen";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  return <PatientsScreen branch={branch} canAdd={can(staff, "patient.edit")} />;
}
