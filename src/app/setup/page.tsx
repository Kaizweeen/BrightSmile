import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { ownerExists } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  // Spec 6.1: once an owner exists, /setup answers 404; the owner's own reset lives at /setup/recover.
  if (await ownerExists()) notFound();
  return (
    <AuthCard
      title="Set up DentaSync"
      description="Name the practice and create the owner's account. You add the branches next."
    >
      <SetupForm />
    </AuthCard>
  );
}
