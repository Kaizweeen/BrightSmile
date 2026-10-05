import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { welcomeInfo } from "@/server/patient-forms";
import { practiceName } from "@/server/practice";

/** The practice's name in the browser tab (the root layout's template adds " | DentaSync"). */
export async function generateMetadata(): Promise<Metadata> {
  // Request time only: `next build` must never open the database.
  await connection();
  return { title: `Welcome to ${await practiceName()}` };
}

/** Patient forms spec 4: where the branch's patient poster leads, with a button for each thing patients can do online. */
export default async function WelcomePage({ params }: { params: Promise<{ code: string }> }) {
  // Request time only: `next build` must never open the database.
  await connection();
  const { code } = await params;
  const info = await welcomeInfo(code);
  if (!info) notFound();
  if (!info.booking && !info.forms) {
    return <AuthCard title={info.practiceName} description="Please ask at the front desk." />;
  }
  const branch = encodeURIComponent(info.branch.code);
  return (
    <AuthCard title={info.practiceName}>
      <div className="grid gap-3">
        {info.booking && (
          <Link href={`/book?branch=${branch}`} className={buttonVariants({ size: "lg" })}>
            Book a visit
          </Link>
        )}
        {info.forms && (
          <Link href={`/welcome/${branch}/form`} className={buttonVariants({ size: "lg", variant: info.booking ? "outline" : "default" })}>
            Fill in my patient form
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
