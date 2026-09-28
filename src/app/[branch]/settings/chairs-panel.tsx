"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage } from "@/lib/fetcher";
import { useBranches } from "@/lib/queries";

type Chair = { branchId: string; number: number; label: string; active: boolean };

export function ChairsPanel({ initialBranch }: { initialBranch: string }) {
  const branches = useBranches();
  const [picked, setPicked] = useState<string | null>(initialBranch === "all" ? null : initialBranch);
  const code = picked ?? branches.data?.find((b) => b.active)?.code ?? null;
  const client = useQueryClient();
  const chairs = useQuery({ queryKey: ["chairs", code], queryFn: () => api<Chair[]>(`/branches/${code}/chairs`), enabled: code !== null });
  const [label, setLabel] = useState("");
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["chairs", code] }), client.invalidateQueries({ queryKey: ["branches"] })]);
  const add = useMutation({
    mutationFn: () => api<Chair>(`/branches/${code}/chairs`, { method: "POST", body: { label } }),
    onSuccess: async (chair) => {
      toast.success(`Added chair ${chair.number}.`);
      setLabel("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (branches.isPending) return <p className="text-muted-foreground">Loading...</p>;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  if (code === null) return <p>Add a branch first.</p>;
  return (
    <div className="grid max-w-2xl gap-4">
      <label className="grid w-fit gap-1 text-sm font-medium">
        Branch
        <NativeSelect value={code} onChange={(event) => setPicked(event.target.value)} className="w-56">
          {branches.data.map((b) => (
            <NativeSelectOption key={b.id} value={b.code}>
              {b.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {chairs.isPending ? (
        <p className="text-muted-foreground">Loading chairs...</p>
      ) : chairs.isError ? (
        <FormAlert message={errorMessage(chairs.error)} />
      ) : (
        <ul className="grid gap-2">
          {chairs.data.length === 0 && <li className="text-muted-foreground">No chairs yet.</li>}
          {chairs.data.map((chair) => (
            <ChairRow key={`${code}-${chair.number}`} code={code} chair={chair} onChanged={refresh} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <label className="grid gap-1 text-sm font-medium">
          New chair label
          <Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} placeholder="General, Ortho, Surgery" className="w-64" />
        </label>
        <Button type="submit" disabled={add.isPending}>
          Add chair
        </Button>
      </form>
    </div>
  );
}

function ChairRow({ code, chair, onChanged }: { code: string; chair: Chair; onChanged: () => Promise<unknown> }) {
  const [label, setLabel] = useState(chair.label);
  const update = useMutation({
    mutationFn: (patch: { label?: string; active?: boolean }) => api(`/branches/${code}/chairs/${chair.number}`, { method: "PATCH", body: patch }),
    onSuccess: async () => {
      toast.success(`Saved chair ${chair.number}.`);
      await onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <span className="w-20 font-medium">{`Chair ${chair.number}`}</span>
      <label className="sr-only" htmlFor={`chair-${chair.number}`}>{`Label of chair ${chair.number}`}</label>
      <Input id={`chair-${chair.number}`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} className="w-48" />
      {label !== chair.label && (
        <Button variant="outline" onClick={() => update.mutate({ label })} disabled={update.isPending}>
          Save
        </Button>
      )}
      <label className="ml-auto flex min-h-11 items-center gap-2 sm:min-h-9">
        <input type="checkbox" checked={chair.active} onChange={(event) => update.mutate({ active: event.target.checked })} className="size-4 accent-primary" />
        In use
      </label>
    </li>
  );
}
