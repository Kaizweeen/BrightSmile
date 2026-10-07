"use client";

import { LoadingRows } from "@/components/loading";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";
import { formatDateTime, fromManilaLocal } from "@/lib/time";
import { DentistPicker } from "./dentist-picker";

type TimeOff = { id: string; startsAt: string; endsAt: string; reason: string };
type Affected = { id: string; startTime: string; branchName: string; patientName: string };

export function TimeOffPanel({ canEdit }: { canEdit: boolean }) {
  const dentists = useDentists();
  const client = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const dentist = dentists.data?.find((d) => d.id === picked) ?? dentists.data?.[0];
  const list = useQuery({ queryKey: ["time-off", dentist?.id], queryFn: () => api<TimeOff[]>(`/dentists/${dentist?.id}/time-off`), enabled: dentist !== undefined });
  const [form, setForm] = useState({ startsAt: "", endsAt: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [affected, setAffected] = useState<Affected[]>([]);
  const refresh = () => client.invalidateQueries({ queryKey: ["time-off", dentist?.id] });

  const add = useMutation({
    mutationFn: () => {
      if (!form.startsAt || !form.endsAt) throw new Error("Choose when the time off starts and ends.");
      return api<{ id: string; affected: Affected[] }>(`/dentists/${dentist?.id}/time-off`, {
        method: "POST",
        body: { startsAt: fromManilaLocal(form.startsAt).toISOString(), endsAt: fromManilaLocal(form.endsAt).toISOString(), reason: form.reason },
      });
    },
    onSuccess: async (result) => {
      setAffected(result.affected);
      setForm({ startsAt: "", endsAt: "", reason: "" });
      setErrors({});
      toast.success("Time off added.");
      await refresh();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/time-off/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Time off removed.");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (dentists.isPending) return <LoadingRows rows={3} label="Loading..." />;
  if (dentists.isError) return <FormAlert message={errorMessage(dentists.error)} />;
  if (!dentist) return <p>No one sees patients yet.</p>;
  return (
    <div className="grid max-w-2xl gap-4">
      <DentistPicker dentists={dentists.data} value={dentist.id} onChange={(id) => { setPicked(id); setAffected([]); }} />
      {affected.length > 0 && (
        <Alert>
          <AlertTitle>These visits fall in the time off. Move them.</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {affected.map((v) => (
                <li key={v.id}>{`${formatDateTime(new Date(v.startTime))}, ${v.patientName}, ${v.branchName}`}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {list.isPending ? (
        <LoadingRows rows={3} label="Loading time off..." />
      ) : list.isError ? (
        <FormAlert message={errorMessage(list.error)} />
      ) : list.data.length === 0 ? (
        <p className="text-muted-foreground">No time off in the last 30 days or ahead.</p>
      ) : (
        <ul className="grid gap-2">
          {list.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span>{`${formatDateTime(new Date(t.startsAt))} to ${formatDateTime(new Date(t.endsAt))}`}</span>
              {t.reason && <span className="text-muted-foreground">{t.reason}</span>}
              {canEdit && (
                <Button variant="ghost" className="ml-auto" onClick={() => remove.mutate(t.id)} disabled={remove.isPending}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="grid gap-3 rounded-xl border bg-card p-3 shadow-xs"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <h2 className="font-medium">Add time off</h2>
          <div className="flex flex-wrap gap-3">
            <TextField label="Starts" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} error={errors.startsAt} />
            <TextField label="Ends" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} error={errors.endsAt} />
          </div>
          <TextField label="Reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={100} placeholder="Leave, seminar" error={errors.reason} />
          <div>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Adding..." : "Add time off"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
