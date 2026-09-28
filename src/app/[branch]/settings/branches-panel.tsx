"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StateBadge } from "@/components/state-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { HoursEditor } from "@/components/hours-editor";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { DEFAULT_HOURS, hoursSummary } from "@/lib/hours";
import { useBranches, type Branch } from "@/lib/queries";

export function BranchesPanel() {
  const branches = useBranches();
  const client = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [replacing, setReplacing] = useState<Branch | null>(null);
  const saved = async () => {
    await client.invalidateQueries({ queryKey: ["branches"] });
    router.refresh();
  };
  const replace = useMutation({
    mutationFn: (b: Branch) => api(`/branches/${b.code}/join-code`, { method: "POST" }),
    onSuccess: (_data, b) => {
      toast.success(`${b.name} has a new QR code. Print the new poster; the old one no longer works.`);
      setReplacing(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (branches.isPending) return <p className="text-muted-foreground">Loading branches...</p>;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Each branch has its own hours, chairs, and staff QR poster.</p>
        <Button onClick={() => setEditing("new")}>Add branch</Button>
      </div>
      {branches.data.length === 0 ? (
        <p>No branches yet. Add the first one.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Chairs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-sm text-muted-foreground">{[b.code, b.address, b.phone].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{hoursSummary(b.operatingHours)}</TableCell>
                  <TableCell>{b.chairCount}</TableCell>
                  <TableCell><StateBadge on={b.active} yes="Open" no="Closed" /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setEditing(b)}>
                        Edit
                      </Button>
                      <Link href={`/poster/${b.code}`} target="_blank" className={buttonVariants({ variant: "ghost" })}>
                        Print QR poster
                      </Link>
                      <Button variant="ghost" onClick={() => setReplacing(b)}>
                        Replace QR
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <BranchDialog branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}
      <ConfirmDialog
        open={replacing !== null}
        title={`Replace the QR code of ${replacing?.name ?? ""}?`}
        description="The printed poster stops working at once. Requests already sent stay open."
        confirmLabel="Replace QR"
        pending={replace.isPending}
        onConfirm={() => replacing && replace.mutate(replacing)}
        onOpenChange={(open) => !open && setReplacing(null)}
      />
    </div>
  );
}

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    code: branch?.code ?? "",
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    operatingHours: branch?.operatingHours ?? DEFAULT_HOURS,
    active: branch?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      branch
        ? api(`/branches/${branch.code}`, { method: "PATCH", body: form })
        : api("/branches", { method: "POST", body: { code: form.code, name: form.name, address: form.address, phone: form.phone, operatingHours: form.operatingHours } }),
    onSuccess: async () => {
      toast.success(branch ? `Saved ${form.name}.` : `Added ${form.name}.`);
      onClose();
      await onSaved();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  // Hours errors come back keyed operatingHours.<day>.<field>; the editor shows each under its day.
  const hoursErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith("operatingHours"))
      .map(([key, message]) => [key.split(".")[1] ?? "", message]),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
          <DialogDescription>The code appears in addresses, such as /downtown/calendar.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={40} error={errors.name} />
          <TextField label="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={24} autoCapitalize="none" error={errors.code} hint="2 to 24 lowercase letters, numbers, or hyphens." />
          <TextField label="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={200} error={errors.address} />
          <TextField label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={20} error={errors.phone} />
          <HoursEditor value={form.operatingHours} onChange={(operatingHours) => setForm({ ...form, operatingHours })} errors={hoursErrors} />
          {branch && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Open (a closed branch takes no bookings)
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
