import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { manilaDate } from "@/lib/time";
import { portalInfo } from "@/server/portal";
import { practiceName } from "@/server/practice";
import { BookForm } from "./book-form";

/** The practice's name in the browser tab (the root layout's template adds " | DentaSync"). */
export async function generateMetadata(): Promise<Metadata> {
  // Request time only: `next build` must never open the database.
  await connection();
  return { title: `Book a visit at ${await practiceName()}` };
}

/** Online booking spec 3: the public booking page, made for phones. */
export default async function BookPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  const info = await portalInfo();
  // Off, or nothing to pick from: the same plain answer, never a form that cannot be finished.
  if (!info.open || info.branches.length === 0 || info.services.length === 0) {
    return <AuthCard title={info.practiceName} description="Online booking isn't available right now. Please call the clinic." />;
  }
  return (
    <AuthCard title={`Book a visit at ${info.practiceName}`} description="Pick a branch, a service, and a time. The clinic will call or text you to confirm.">
      <BookForm
        practiceName={info.practiceName}
        branches={info.branches.map((b) => ({ value: b.code, label: b.name }))}
        services={info.services.map((s) => ({ value: s.id, label: s.name }))}
        today={manilaDate(new Date())}
      />
    </AuthCard>
  );
}
