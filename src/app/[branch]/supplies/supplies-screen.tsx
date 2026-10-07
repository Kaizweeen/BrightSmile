"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { StateBadge } from "@/components/state-badge";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

type Supply = { id: string; name: string; unit: string; quantity: number; reorderLevel: number; active: boolean };

/** Dental supplies in stock at one branch. Managers add items and record stock in or out; everyone here can look. */
export function SuppliesScreen({ branch, canEdit }: { branch: string; canEdit: boolean }) {
  const queryKey = ["supplies", branch];
  const supplies = useQuery({ queryKey, queryFn: () => api<Supply[]>(`/supplies?branch=${encodeURIComponent(branch)}`) });
  const [dialog, setDialog] = useState<{ supply: Supply | null; mode: "edit" | "adjust" } | null>(null);
  if (supplies.isPending) return <LoadingRows rows={3} label="Loading supplies..." />;
  if (supplies.isError) return <FormAlert message={errorMessage(supplies.error)} />;
  const low = supplies.data.filter((s) => s.active && s.quantity <= s.reorderLevel);
  const close = () => setDialog(null);
  return (
    <div className="grid max-w-5xl gap-4">
      <PageHeader
        title="Supplies"
        description="What is on the shelf at this branch, and what needs ordering."
        actions={
          canEdit && (
            <Button onClick={() => setDialog({ supply: null, mode: "edit" })}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              Add supply
            </Button>
          )
        }
      />
      {low.length > 0 && (
        <div role="status" className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>
            <span className="font-semibold">Running low: </span>
            {low.map((s) => s.name).join(", ")}.
          </p>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supply</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplies.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No supplies yet.
                </TableCell>
              </TableRow>
            )}
            {supplies.data.map((s) => (
              <TableRow key={s.id} className={s.active ? undefined : "text-muted-foreground"}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.quantity} {s.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.reorderLevel}</TableCell>
                <TableCell>
                  {s.active ? <StateBadge on={s.quantity > s.reorderLevel} yes="In stock" no="Low" warn /> : <StateBadge on={false} yes="" no="Retired" />}
                </TableCell>
                <TableCell className="text-right">
                  {canEdit && (
                    <>
                      <Button variant="ghost" onClick={() => setDialog({ supply: s, mode: "adjust" })} disabled={!s.active}>
                        Stock in/out
                      </Button>
                      <Button variant="ghost" onClick={() => setDialog({ supply: s, mode: "edit" })}>
                        Edit
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {dialog?.mode === "edit" && <EditDialog branch={branch} supply={dialog.supply} onClose={close} queryKey={queryKey} />}
      {dialog?.mode === "adjust" && dialog.supply && <AdjustDialog supply={dialog.supply} onClose={close} queryKey={queryKey} />}
    </div>
  );
}

type DialogProps = { onClose: () => void; queryKey: string[] };

/** Runs a save, then refreshes the list; field errors stay in the dialog, anything else is a toast. */
function useSave(body: () => Promise<unknown>, { onClose, queryKey }: DialogProps, done: string) {
  const client = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: body,
    onSuccess: async () => {
      toast.success(done);
      onClose();
      await client.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return { save, errors };
}

function EditDialog({ branch, supply, ...props }: { branch: string; supply: Supply | null } & DialogProps) {
  const [form, setForm] = useState({
    name: supply?.name ?? "",
    unit: supply?.unit ?? "pcs",
    quantity: "0",
    reorderLevel: String(supply?.reorderLevel ?? 0),
    active: supply?.active ?? true,
  });
  const { save, errors } = useSave(
    () =>
      supply
        ? api(`/supplies/${supply.id}`, { method: "PATCH", body: { name: form.name, unit: form.unit, reorderLevel: Number(form.reorderLevel), active: form.active } })
        : api("/supplies", { method: "POST", body: { branch, name: form.name, unit: form.unit, quantity: Number(form.quantity), reorderLevel: Number(form.reorderLevel) } }),
    props,
    `Saved ${form.name}.`,
  );
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supply ? `Edit ${supply.name}` : "Add a supply"}</DialogTitle>
          <DialogDescription>{supply ? "To change how many are in stock, use Stock in/out so the change is logged." : "Count what is on the shelf now."}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} error={errors.name} />
          <TextField label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} maxLength={20} hint="Box, bottle, pcs..." error={errors.unit} />
          {!supply && (
            <TextField label="In stock now" type="number" inputMode="numeric" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} error={errors.quantity} />
          )}
          <TextField
            label="Reorder at"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.reorderLevel}
            onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
            hint="Shown as low when the count falls to this or below."
            error={errors.reorderLevel}
          />
          {supply && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4 accent-primary" />
              In use (untick to retire it)
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ supply, ...props }: { supply: Supply } & DialogProps) {
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<1 | -1>(1);
  const { save, errors } = useSave(
    () => api(`/supplies/${supply.id}`, { method: "PATCH", body: { adjust: direction * Number(amount) } }),
    props,
    `Updated ${supply.name}.`,
  );
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supply.name}</DialogTitle>
          <DialogDescription>
            {supply.quantity} {supply.unit} in stock.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex gap-2">
            <Button type="button" variant={direction === 1 ? "default" : "outline"} onClick={() => setDirection(1)}>
              Stock in
            </Button>
            <Button type="button" variant={direction === -1 ? "default" : "outline"} onClick={() => setDirection(-1)}>
              Used / out
            </Button>
          </div>
          <TextField label={`How many ${supply.unit}`} type="number" inputMode="numeric" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.adjust} autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !Number(amount)}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
