"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { billTotal, changeDue, peso, toCentavos } from "@/lib/billing";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import type { Draft } from "@/server/billing";

type Line = { name: string; qty: string; price: string; procedureId: string | null };

/** The flowchart's middle: encode services and items, show the total, take cash or QR, issue the receipt. */
export function CheckoutScreen({ branch, draft }: { branch: string; draft: Draft }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(
    draft.lines.map((l) => ({ name: l.name, qty: String(l.qty), price: (l.unitPrice / 100).toFixed(2), procedureId: l.procedureId })),
  );
  const [method, setMethod] = useState<"cash" | "qr">("cash");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const parsed = lines.map((l) => ({ name: l.name.trim(), qty: Number(l.qty), unitPrice: toCentavos(l.price), procedureId: l.procedureId }));
  const valid = parsed.length > 0 && parsed.every((l) => l.name !== "" && Number.isInteger(l.qty) && l.qty >= 1 && l.unitPrice !== null);
  const total = valid ? billTotal(parsed.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice! }))) : 0;
  const tendered = toCentavos(received);
  const change = method === "cash" && tendered !== null && tendered >= total ? changeDue(total, tendered) : null;
  const canIssue = valid && total > 0 && (method === "qr" || change !== null);

  const issue = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/bills", {
        method: "POST",
        body: {
          branch,
          appointmentId: draft.appointmentId,
          method,
          lines: parsed,
          ...(method === "cash" ? { tendered } : { reference: reference.trim() || undefined }),
        },
      }),
    onSuccess: ({ id }) => router.push(`/${branch}/billing/${id}`),
    onError: (error) => setErrors({ ...fieldErrors(error), _: errorMessage(error) }),
  });
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form
      className="mx-auto grid max-w-3xl gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        issue.mutate();
      }}
    >
      <div>
        <h1 className="text-xl font-semibold">Take payment</h1>
        <p className="text-muted-foreground">{draft.patientName ?? "Walk-in sale"}</p>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Services and items</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_8rem_auto] items-end gap-2">
            <TextField label={`Item ${i + 1}`} value={l.name} maxLength={100} onChange={(e) => set(i, { name: e.target.value })} />
            <TextField label={`Qty ${i + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <TextField label={`Price ${i + 1} (PHP)`} inputMode="decimal" value={l.price} onChange={(e) => set(i, { price: e.target.value })} />
            <Button type="button" variant="ghost" aria-label={`Remove item ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" onClick={() => setLines([...lines, { name: "", qty: "1", price: "0.00", procedureId: null }])}>
            Add item
          </Button>
        </div>
      </fieldset>

      <p className="text-3xl font-semibold" aria-live="polite">
        Total {peso(total)}
      </p>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Payment method</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="method" checked={method === "cash"} onChange={() => setMethod("cash")} className="size-4 accent-primary" />
          Cash
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="radio" name="method" checked={method === "qr"} onChange={() => setMethod("qr")} className="size-4 accent-primary" />
          QR
        </label>
      </fieldset>

      {method === "cash" ? (
        <div className="grid max-w-xs gap-2">
          <TextField label="Cash received (PHP)" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} error={errors.tendered} />
          <p aria-live="polite" className="text-lg">
            {change !== null ? `Change ${peso(change)}` : tendered !== null ? "Not enough cash yet" : ""}
          </p>
        </div>
      ) : (
        <div className="grid max-w-xs gap-3">
          {draft.qrImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.qrImage} alt="The clinic's payment QR code" className="size-64 rounded-lg border bg-white object-contain p-2" />
          ) : (
            <p className="rounded-lg border p-4 text-muted-foreground">No QR code is set up. The owner can upload one in Settings, Billing.</p>
          )}
          <TextField label="Reference number (optional)" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} hint="From the banking or e-wallet app." />
        </div>
      )}

      <FormAlert message={errors._ ?? null} />
      <div>
        <Button type="submit" disabled={!canIssue || issue.isPending}>
          {issue.isPending ? "Issuing..." : method === "qr" ? "Payment received, issue receipt" : "Issue receipt"}
        </Button>
      </div>
    </form>
  );
}
