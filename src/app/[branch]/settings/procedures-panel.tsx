"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

type Procedure = { id: string; name: string; durationMinutes: number; bufferMinutes: number; active: boolean };

export function ProceduresPanel() {
  const procedures = useQuery({ queryKey: ["procedures"], queryFn: () => api<Procedure[]>("/procedures") });
  const [editing, setEditing] = useState<Procedure | "new" | null>(null);
  if (procedures.isPending) return <p className="text-muted-foreground">Loading procedures...</p>;
  if (procedures.isError) return <FormAlert message={errorMessage(procedures.error)} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">A visit lasts as long as its procedures; the longest turnover then keeps the chair free for cleaning.</p>
        <Button onClick={() => setEditing("new")}>Add procedure</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Length</TableHead>
              <TableHead>Turnover</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {procedures.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No procedures yet.
                </TableCell>
              </TableRow>
            )}
            {procedures.data.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{`${p.durationMinutes} min`}</TableCell>
                <TableCell>{`${p.bufferMinutes} min`}</TableCell>
                <TableCell>{p.active ? <Badge variant="secondary">Offered</Badge> : <Badge variant="outline">Retired</Badge>}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <ProcedureDialog procedure={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProcedureDialog({ procedure, onClose }: { procedure: Procedure | null; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: procedure?.name ?? "",
    durationMinutes: String(procedure?.durationMinutes ?? 30),
    bufferMinutes: String(procedure?.bufferMinutes ?? 10),
    active: procedure?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const body = { name: form.name, durationMinutes: Number(form.durationMinutes), bufferMinutes: Number(form.bufferMinutes) };
  const save = useMutation({
    mutationFn: () =>
      procedure ? api(`/procedures/${procedure.id}`, { method: "PATCH", body: { ...body, active: form.active } }) : api("/procedures", { method: "POST", body }),
    onSuccess: async () => {
      toast.success(`Saved ${form.name}.`);
      onClose();
      await client.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{procedure ? `Edit ${procedure.name}` : "Add a procedure"}</DialogTitle>
          <DialogDescription>Lengths use 5-minute steps. Turnover is the chair cleaning time after the visit.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} error={errors.name} />
          <TextField label="Length in minutes" type="number" inputMode="numeric" min={5} max={480} step={5} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} error={errors.durationMinutes} />
          <TextField label="Turnover in minutes" type="number" inputMode="numeric" min={0} max={120} step={5} value={form.bufferMinutes} onChange={(event) => setForm({ ...form, bufferMinutes: event.target.value })} error={errors.bufferMinutes} />
          {procedure && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Offered (retired procedures cannot be booked)
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
