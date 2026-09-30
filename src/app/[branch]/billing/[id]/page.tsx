import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { peso } from "@/lib/billing";
import { formatDateTime } from "@/lib/time";
import { getBill } from "@/server/billing";
import { ApiError } from "@/server/errors";
import { requireStaff } from "@/server/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Receipt" };

/** Only a missing or forbidden record is a Not Found page; a real failure still surfaces. */
const missing = (error: unknown) => {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
  throw error;
};

export default async function ReceiptPage({ params }: { params: Promise<{ branch: string; id: string }> }) {
  const staff = await requireStaff();
  const { branch, id } = await params;
  const r = await getBill(staff, id).catch(missing);
  if (!r || r.branch.code !== branch) notFound();
  const { bill } = r;
  return (
    <div className="mx-auto grid max-w-md gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton />
        <Link href={`/${branch}/billing`} className={buttonVariants({ variant: "outline" })}>
          Back to billing
        </Link>
      </div>
      <article className="grid gap-3 rounded-lg border p-6 text-sm print:border-0 print:p-0">
        <header className="text-center">
          <h1 className="text-lg font-semibold">{r.practiceName}</h1>
          <p>{r.branch.name}</p>
          {r.branch.address && <p>{r.branch.address}</p>}
          {r.branch.phone && <p>{r.branch.phone}</p>}
          <p className="mt-2 font-medium">Official receipt {bill.receiptNo}</p>
          {bill.status === "void" && <p className="font-semibold text-destructive">VOID: {bill.voidReason}</p>}
        </header>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDateTime(bill.issuedAt)}</dd>
          <dt className="text-muted-foreground">Patient</dt>
          <dd>{r.patientName ?? "Walk-in"}</dd>
          <dt className="text-muted-foreground">Served by</dt>
          <dd>{r.issuedByName}</dd>
        </dl>
        <table className="w-full">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Price</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.position}>
                <td className="py-1">{l.name}</td>
                <td className="py-1 text-right">{l.qty}</td>
                <td className="py-1 text-right">{peso(l.unitPrice)}</td>
                <td className="py-1 text-right">{peso(l.qty * l.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t pt-2">
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">{peso(bill.total)}</dd>
          <dt>Paid by</dt>
          <dd className="text-right">{bill.method === "cash" ? "Cash" : "QR"}</dd>
          {bill.method === "cash" && (
            <>
              <dt>Cash received</dt>
              <dd className="text-right">{peso(bill.tendered ?? 0)}</dd>
              <dt>Change</dt>
              <dd className="text-right">{peso(bill.changeDue ?? 0)}</dd>
            </>
          )}
          {bill.reference && (
            <>
              <dt>Reference</dt>
              <dd className="text-right">{bill.reference}</dd>
            </>
          )}
        </dl>
      </article>
    </div>
  );
}
