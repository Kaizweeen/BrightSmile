import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appUrl } from "@/lib/env";
import { can } from "@/lib/permissions";
import { branchByCode } from "@/server/branches";
import { practiceName } from "@/server/practice";
import { qrSvg } from "@/server/qr";
import { requireStaff } from "@/server/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Staff QR poster" };

/** Spec 6.2: an A4 poster with the branch's join QR. Printed on white whatever the screen's theme. */
export default async function PosterPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff();
  if (!can(staff, "settings.edit")) notFound();
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const joinUrl = `${appUrl()}/join/${branch.joinCode}`;
  const svg = await qrSvg(joinUrl);
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-2xl content-center gap-8 bg-white p-8 text-center text-black">
      <div className="grid gap-2">
        <p className="text-lg">{await practiceName()}</p>
        <h1 className="text-4xl font-semibold">{branch.name}</h1>
      </div>
      <div className="mx-auto w-72 sm:w-80" role="img" aria-label="Staff QR code" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="grid gap-2">
        <p className="text-2xl font-semibold">Staff only</p>
        <p className="text-lg">Scan to ask for a DentaSync account. The owner or a manager approves it.</p>
      </div>
      <p className="text-xs break-all">{joinUrl}</p>
      <p className="text-sm">If the owner replaces this QR code, this poster stops working.</p>
      <div className="print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
