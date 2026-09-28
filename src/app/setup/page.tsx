import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { ownerExists } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  if (await ownerExists()) redirect("/login");
  return (
    <AuthCard
      title="Set up DentaSync"
      description="Name the practice and create the owner's account. You add the branches next."
    >
      <SetupForm />
    </AuthCard>
  );
}
