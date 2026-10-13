"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, TriangleAlert, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { StateBadge } from "@/components/state-badge";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

type Usage = { procedureId: string; quantity: number };
type Supply = { id: string; name: string; unit: string; quantity: number; reorderLevel: number; active: boolean; usage: Usage[] };
type Service = { id: string; name: string; active: boolean };

/**
 * Dental supplies in stock at one branch. Managers add items, record stock in or out, and set how much each service
 * uses, which completing a visit takes out; everyone here can look.
 */
export function SuppliesScreen({ branch, canEdit }: { branch: string; canEdit: boolean }) {
  const queryKey = ["supplies", branch];
  const supplies = useQuery({ queryKey, queryFn: () => api<Supply[]>(`/supplies?branch=${encodeURIComponent(branch)}`) });
  const services = useQuery({ queryKey: ["procedures"], queryFn: () => api<Service[]>("/procedures") });
  const serviceName = (id: string) => services.data?.find((p) => p.id === id)?.name ?? "A service";
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
                <TableCell>
                  <div className="font-medium">{s.name}</div>
                  {s.usage.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Per visit: {s.usage.map((u) => `${serviceName(u.procedureId)} ${u.quantity}`).join(", ")}
                    </div>
                  )}
                </TableCell>
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
      {dialog?.mode === "edit" && <EditDialog branch={branch} supply={dialog.supply} services={services.data ?? []} onClose={close} queryKey={queryKey} />}
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

function EditDialog({ branch, supply, services, ...props }: { branch: string; supply: Supply | null; services: Service[] } & DialogProps) {
  const [form, setForm] = useState({
    name: supply?.name ?? "",
    unit: supply?.unit ?? "pcs",
    quantity: "0",
    reorderLevel: String(supply?.reorderLevel ?? 0),
    active: supply?.active ?? true,
  });
  const [usage, setUsage] = useState(() => (supply?.usage ?? []).map((u) => ({ procedureId: u.procedureId, quantity: String(u.quantity) })));
  const usageBody = () => usage.filter((u) => u.procedureId).map((u) => ({ procedureId: u.procedureId, quantity: Number(u.quantity) }));
  const { save, errors } = useSave(
    () =>
      supply
        ? api(`/supplies/${supply.id}`, {
            method: "PATCH",
            body: { name: form.name, unit: form.unit, reorderLevel: Number(form.reorderLevel), active: form.active, usage: usageBody() },
          })
        : api("/supplies", {
            method: "POST",
            body: { branch, name: form.name, unit: form.unit, quantity: Number(form.quantity), reorderLevel: Number(form.reorderLevel), usage: usageBody() },
          }),
    props,
    `Saved ${form.name}.`,
  );
  // Errors on one row arrive as "usage.0.quantity"; show the first one under the list.
  const usageError = Object.entries(errors).find(([key]) => key === "usage" || key.startsWith("usage."))?.[1];
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
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Used per visit</legend>
            <p className="text-sm text-muted-foreground">Completing a visit with one of these services takes this many {form.unit || "units"} out of stock.</p>
            {usage.map((row, i) => {
              const set = (next: Partial<typeof row>) => setUsage(usage.map((u, j) => (j === i ? { ...u, ...next } : u)));
              // Retired services stay listed only where they are already chosen.
              const options = services.filter((p) => (p.active || p.id === row.procedureId) && !usage.some((u, j) => j !== i && u.procedureId === p.id));
              return (
                <div key={i} className="flex items-center gap-2">
                  <NativeSelect className="flex-1" aria-label="Service" value={row.procedureId} onChange={(e) => set({ procedureId: e.target.value })}>
                    <option value="">Pick a service</option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input
                    className="w-20"
                    aria-label={`How many ${form.unit || "units"}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1000}
                    value={row.quantity}
                    onChange={(e) => set({ quantity: e.target.value })}
                  />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => setUsage(usage.filter((_, j) => j !== i))}>
                    <XIcon aria-hidden />
                  </Button>
                </div>
              );
            })}
            {usageError && <p className="text-sm text-destructive">{usageError}</p>}
            <Button type="button" variant="outline" className="justify-self-start" onClick={() => setUsage([...usage, { procedureId: "", quantity: "1" }])}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              Add a service
            </Button>
          </fieldset>
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
