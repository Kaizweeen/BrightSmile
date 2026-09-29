"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { StateBadge } from "@/components/state-badge";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";

type Service = { id: string; name: string; online: boolean; active: boolean; dentistIds: string[] };

/** Online booking spec 11: services have no length; each can be offered online and limited to chosen dentists. */
export function ProceduresPanel() {
  const services = useQuery({ queryKey: ["procedures"], queryFn: () => api<Service[]>("/procedures") });
  const dentists = useDentists();
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  if (services.isPending) return <p className="text-muted-foreground">Loading services...</p>;
  if (services.isError) return <FormAlert message={errorMessage(services.error)} />;
  const names = new Map((dentists.data ?? []).map((d) => [d.id, d.name]));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Visits start at the standard length on the Practice tab. Online, a service goes only to its dentists.</p>
        <Button onClick={() => setEditing("new")}>Add service</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Online</TableHead>
              <TableHead>Dentists</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No services yet.
                </TableCell>
              </TableRow>
            )}
            {services.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.online ? "Yes" : "No"}</TableCell>
                <TableCell>{s.dentistIds.length === 0 ? "All" : s.dentistIds.map((id) => names.get(id) ?? "A former dentist").join(", ")}</TableCell>
                <TableCell>
                  <StateBadge on={s.active} yes="Offered" no="Retired" />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <ServiceDialog service={editing === "new" ? null : editing} dentists={dentists.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceDialog({ service, dentists, onClose }: { service: Service | null; dentists: { id: string; name: string }[]; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: service?.name ?? "",
    online: service?.online ?? true,
    active: service?.active ?? true,
    dentistIds: service?.dentistIds ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, online: form.online, dentistIds: form.dentistIds };
      return service ? api(`/procedures/${service.id}`, { method: "PATCH", body: { ...body, active: form.active } }) : api("/procedures", { method: "POST", body });
    },
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
  const toggle = (id: string, on: boolean) =>
    setForm({ ...form, dentistIds: on ? [...form.dentistIds, id] : form.dentistIds.filter((d) => d !== id) });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "Add a service"}</DialogTitle>
          <DialogDescription>Online bookings for this service go only to the dentists ticked here, or to any dentist when none is ticked.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} error={errors.name} />
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={form.online} onChange={(event) => setForm({ ...form, online: event.target.checked })} className="size-4 accent-primary" />
            Offer online
          </label>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Dentists</legend>
            {dentists.length === 0 && <p className="text-sm text-muted-foreground">No dentists yet.</p>}
            {dentists.map((d) => (
              <label key={d.id} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={form.dentistIds.includes(d.id)} onChange={(event) => toggle(d.id, event.target.checked)} className="size-4 accent-primary" />
                {d.name}
              </label>
            ))}
            {errors.dentistIds && <p className="text-sm text-destructive">{errors.dentistIds}</p>}
          </fieldset>
          {service && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Offered (retired services cannot be booked)
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
