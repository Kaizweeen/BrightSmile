"use client";

import { LoadingRows } from "@/components/loading";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { WEEKDAYS } from "@/lib/hours";
import { useBranches, useDentists, type Branch, type Dentist } from "@/lib/queries";
import type { Block } from "@/lib/schedule";
import { DentistPicker } from "./dentist-picker";
import type { Me } from "./settings-screen";

type WeekBlock = Block & { id: string };
type Draft = Block & { key: string };
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function SchedulePanel({ me, canEdit }: { me: Me; canEdit: boolean }) {
  const dentists = useDentists();
  const branches = useBranches();
  const [picked, setPicked] = useState<string | null>(null);
  const dentist = dentists.data?.find((d) => d.id === picked) ?? dentists.data?.[0];
  const week = useQuery({ queryKey: ["schedule", dentist?.id], queryFn: () => api<WeekBlock[]>(`/dentists/${dentist?.id}/schedule`), enabled: dentist !== undefined });

  if (dentists.isPending || branches.isPending) return <LoadingRows rows={3} label="Loading schedules..." />;
  if (dentists.isError) return <FormAlert message={errorMessage(dentists.error)} />;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  if (!dentist) return <p>No one sees patients yet. Approve a dentist in Staff, or switch on seeing patients for the owner.</p>;
  const editable = new Set(canEdit ? (me.role === "owner" ? branches.data.map((b) => b.id) : me.branchIds) : []);
  return (
    <div className="grid gap-4">
      <DentistPicker dentists={dentists.data} value={dentist.id} onChange={setPicked} />
      {week.isPending ? (
        <LoadingRows rows={3} label="Loading the week..." />
      ) : week.isError ? (
        <FormAlert message={errorMessage(week.error)} />
      ) : (
        // Keyed by the dentist only: a background refresh must not throw away hours being edited.
        <WeekEditor key={dentist.id} dentist={dentist} blocks={week.data} branches={branches.data} editable={editable} />
      )}
    </div>
  );
}

function WeekEditor({ dentist, blocks, branches, editable }: { dentist: Dentist; blocks: WeekBlock[]; branches: Branch[]; editable: Set<string> }) {
  const client = useQueryClient();
  const id = useId();
  const toDrafts = (week: WeekBlock[]) => week.map(({ id: key, ...block }) => ({ key, ...block }));
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(blocks));
  const [problems, setProblems] = useState<Record<number, string>>({});
  const workplaces = branches.filter((b) => b.active && dentist.branchIds.includes(b.id) && editable.has(b.id));
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "A closed branch";
  const change = (next: Draft[]) => {
    setDrafts(next);
    setProblems({});
  };
  const save = useMutation({
    mutationFn: () =>
      api<WeekBlock[]>(`/dentists/${dentist.id}/schedule`, {
        method: "PUT",
        body: { blocks: drafts.map(({ branchId, dayOfWeek, startTime, endTime }) => ({ branchId, dayOfWeek, startTime, endTime })) },
      }),
    onSuccess: (saved) => {
      toast.success(`Saved the week of ${dentist.name}.`);
      setDrafts(toDrafts(saved));
      client.setQueryData(["schedule", dentist.id], saved);
    },
    onError: (error) => {
      // Each broken block comes back as a field error keyed "blocks.<row>".
      const rows = Object.entries(fieldErrors(error)).filter(([key]) => key.startsWith("blocks."));
      if (rows.length > 0) {
        setProblems(Object.fromEntries(rows.map(([key, message]) => [Number(key.slice("blocks.".length)), message])));
        toast.error("Check the highlighted hours.");
      } else toast.error(errorMessage(error));
    },
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {MONDAY_FIRST.map((day) => {
        const rows = drafts.map((draft, index) => ({ draft, index })).filter(({ draft }) => draft.dayOfWeek === day);
        return (
          <fieldset key={day} className="grid gap-2 rounded-xl border bg-card p-3 shadow-xs">
            <legend className="px-1 font-medium">{WEEKDAYS[day]}</legend>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">Not working.</p>}
            {rows.map(({ draft, index }) => {
              const errorId = problems[index] ? `${id}-${index}` : undefined;
              return editable.has(draft.branchId) ? (
                <div key={draft.key} className="grid gap-1">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-sm">
                      Branch
                      <NativeSelect value={draft.branchId} onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, branchId: event.target.value } : d)))} className="w-48">
                        {workplaces.map((b) => (
                          <NativeSelectOption key={b.id} value={b.id}>
                            {b.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="grid gap-1 text-sm">
                      From
                      <Input
                        type="time"
                        step={900}
                        aria-invalid={errorId ? true : undefined}
                        aria-describedby={errorId}
                        value={draft.startTime}
                        onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, startTime: event.target.value } : d)))}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      To
                      <Input
                        type="time"
                        step={900}
                        aria-invalid={errorId ? true : undefined}
                        aria-describedby={errorId}
                        value={draft.endTime}
                        onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, endTime: event.target.value } : d)))}
                      />
                    </label>
                    <Button type="button" variant="ghost" onClick={() => change(drafts.filter((_, i) => i !== index))}>
                      Remove
                    </Button>
                  </div>
                  {errorId && (
                    <p id={errorId} className="text-sm text-destructive">
                      {problems[index]}
                    </p>
                  )}
                </div>
              ) : (
                <p key={draft.key} className="text-sm">
                  {`${branchName(draft.branchId)}, ${draft.startTime} to ${draft.endTime}`}
                </p>
              );
            })}
            {workplaces.length > 0 && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => change([...drafts, { key: `new-${Date.now()}-${drafts.length}`, branchId: workplaces[0].id, dayOfWeek: day, startTime: "09:00", endTime: "12:00" }])}
                >
                  Add hours
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      {editable.size > 0 && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save the week"}
          </Button>
        </div>
      )}
    </form>
  );
}
