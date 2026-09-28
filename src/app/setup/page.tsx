import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { ownerExists } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  // Request time only: `next build` must never open the database.
  await connection();
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
