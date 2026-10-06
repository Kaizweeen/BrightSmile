"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, BanknoteIcon, CircleCheck, PlusIcon, QrCodeIcon, ReceiptIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TextField } from "@/components/text-field";
import { buttonVariants, Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { peso, toCentavos } from "@/lib/billing";
import { api, errorMessage } from "@/lib/fetcher";
import { formatTime, manilaDate } from "@/lib/time";

type Row = { id: string; receiptNo: string; issuedAt: string; patientName: string | null; method: "cash" | "qr"; total: number; status: "paid" | "void"; voidReason: string | null };
type Report = {
  day: string;
  rows: Row[];
  expectedCash: number;
  expectedQr: number;
  close: { countedCash: number; expectedCash: number; expectedQr: number; closedAt: string; closedByName: string } | null;
};

const overShort = (counted: number, expected: number) =>
  counted === expected ? "Balanced" : counted > expected ? `Over by ${peso(counted - expected)}` : `Short by ${peso(expected - counted)}`;

/** The flowchart's end: the day's sales, and reconciling cash and QR before closing. */
export function BillingScreen({ branch, canIssue, canVoid, canClose }: { branch: string; canIssue: boolean; canVoid: boolean; canClose: boolean }) {
  const client = useQueryClient();
  const [day, setDay] = useState(() => manilaDate(new Date()));
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [counted, setCounted] = useState("");
  const [closing, setClosing] = useState(false);
  const report = useQuery({ queryKey: ["bills", branch, day], queryFn: () => api<Report>(`/bills?branch=${branch}&day=${day}`) });
  const refresh = () => client.invalidateQueries({ queryKey: ["bills", branch] });

  const voidBill = useMutation({
    mutationFn: () => api(`/bills/${voiding!.id}/void`, { method: "POST", body: { reason } }),
    onSuccess: async () => {
      toast.success("Receipt voided.");
      setVoiding(null);
      setReason("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const closeDay = useMutation({
    mutationFn: () => api("/billing/close", { method: "POST", body: { branch, day, countedCash: toCentavos(counted) } }),
    onSuccess: async () => {
      toast.success("Day closed.");
      setClosing(false);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const r = report.data;
  const paid = r?.rows.filter((row) => row.status === "paid") ?? [];
  const countedCash = toCentavos(counted);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Billing"
        description="The day's sales, and counting the cash before closing."
        actions={
          <>
            <TextField
              label="Day"
              type="date"
              className="grid-cols-[auto_1fr] items-center gap-2"
              value={day}
              max={manilaDate(new Date())}
              onChange={(e) => {
                if (!e.target.value) return;
                setDay(e.target.value);
                setCounted("");
              }}
            />
            {canIssue && (
              <Link href={`/${branch}/billing/new`} className={buttonVariants()}>
                <PlusIcon aria-hidden data-icon="inline-start" />
                New sale
              </Link>
            )}
          </>
        }
      />

      {report.isPending && <LoadingRows rows={5} label="Loading sales..." />}
      {report.isError && <FormAlert message={errorMessage(report.error)} />}
      {r && (
        <>
          <ul aria-label="Totals for the day" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <li>
              <StatCard className="h-full" label="Sales" value={peso(paid.reduce((n, x) => n + x.total, 0))} hint={`${paid.length} ${paid.length === 1 ? "receipt" : "receipts"}`} icon={ReceiptIcon} />
            </li>
            <li>
              <StatCard className="h-full" label="Cash" value={peso(r.close?.expectedCash ?? r.expectedCash)} hint="expected in the drawer" icon={BanknoteIcon} />
            </li>
            <li>
              <StatCard className="h-full" label="QR" value={peso(r.close?.expectedQr ?? r.expectedQr)} hint="expected in the account" icon={QrCodeIcon} />
            </li>
            <li>
              <StatCard className="h-full" label="Voided" value={r.rows.length - paid.length} hint="receipts" icon={Ban} />
            </li>
          </ul>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="whitespace-normal py-10 text-center text-muted-foreground">
                      No sales on this day.
                    </TableCell>
                  </TableRow>
                )}
                {r.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/${branch}/billing/${row.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {row.receiptNo}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatTime(new Date(row.issuedAt))}</TableCell>
                    <TableCell>{row.patientName ?? "Walk-in"}</TableCell>
                    <TableCell>{row.method === "cash" ? "Cash" : "QR"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{peso(row.total)}</TableCell>
                    <TableCell>
                      {row.status === "void" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          <Ban aria-hidden className="size-3.5" />
                          {`Void: ${row.voidReason}`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-(--status-completed-bg) px-2 py-0.5 text-xs font-medium text-(--status-completed-fg)">
                          <CircleCheck aria-hidden className="size-3.5" />
                          Paid
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canVoid && row.status === "paid" && !r.close && (
                        <Button variant="ghost" onClick={() => setVoiding(row)}>
                          Void
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs" aria-labelledby="reconcile">
            <h2 id="reconcile" className="font-semibold">
              End of day: reconcile cash and QR
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
              <dt>Expected cash</dt>
              <dd className="text-right">{peso(r.close?.expectedCash ?? r.expectedCash)}</dd>
              <dt>Expected QR</dt>
              <dd className="text-right">{peso(r.close?.expectedQr ?? r.expectedQr)}</dd>
            </dl>
            {r.close ? (
              <>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t pt-3 tabular-nums">
                  <dt>Counted cash</dt>
                  <dd className="text-right">{peso(r.close.countedCash)}</dd>
                  <dt>Result</dt>
                  <dd className="text-right font-medium">{overShort(r.close.countedCash, r.close.expectedCash)}</dd>
                </dl>
                <p className="text-sm text-muted-foreground">Closed by {r.close.closedByName} at {formatTime(new Date(r.close.closedAt))}.</p>
              </>
            ) : canClose ? (
              <>
                <TextField label="Counted cash (PHP)" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
                <p aria-live="polite">{countedCash !== null ? overShort(countedCash, r.expectedCash) : ""}</p>
                <div>
                  <Button disabled={countedCash === null} onClick={() => setClosing(true)}>
                    Close day
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">This day is still open.</p>
            )}
          </section>
          </div>
        </>
      )}

      <ConfirmDialog
        open={voiding !== null}
        title={`Void ${voiding?.receiptNo ?? ""}?`}
        description="The receipt stays on record, marked void, and leaves the day's totals. This cannot be undone."
        confirmLabel="Void receipt"
        pending={voidBill.isPending}
        onConfirm={() => voidBill.mutate()}
        onOpenChange={(open) => {
          if (open) return;
          setVoiding(null);
          setReason("");
        }}
      >
        <Textarea aria-label="Reason for voiding" placeholder="Reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={closing}
        title="Close this day?"
        description="Closing locks the day: no new sales and no voids. It cannot be reopened."
        confirmLabel="Close day"
        destructive={false}
        pending={closeDay.isPending}
        onConfirm={() => closeDay.mutate()}
        onOpenChange={setClosing}
      />
    </div>
  );
}
