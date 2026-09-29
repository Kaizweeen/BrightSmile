"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ChartEntryJson } from "@/components/chart/tooth-chart";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { CHART_GROUPS, CHART_LEGEND, codeInfo, describeTooth, needsSurfaces, SURFACES, surfaceName, toothState, type Surface } from "@/lib/chart";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Props = { patientId: string; tooth: number | null; entries: ChartEntryJson[]; staff: Subject; onClose: () => void };

/** Spec 9.1: a tooth's state and history, a form to chart it, and voiding with a reason. */
export function ToothPanel({ patientId, tooth, entries, staff, onClose }: Props) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [note, setNote] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const codeRef = useRef<HTMLSelectElement>(null);
  const history = entries.filter((e) => e.tooth === tooth);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["chart", patientId] });
    // The Visits tab lists the teeth charted during each visit.
    await client.invalidateQueries({ queryKey: ["patient-visits", patientId] });
  };

  const add = useMutation({
    mutationFn: () => api(`/patients/${patientId}/chart-entries`, { method: "POST", body: { tooth, code, surfaces: needsSurfaces(code) ? surfaces : [], note } }),
    onSuccess: async () => {
      toast.success(`Charted tooth ${tooth}.`);
      setCode("");
      setSurfaces([]);
      setNote("");
      codeRef.current?.focus();
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const voidEntry = useMutation({
    mutationFn: (id: string) => api(`/chart-entries/${id}/void`, { method: "POST", body: { reason } }),
    onSuccess: async () => {
      toast.success("Voided.");
      setVoiding(null);
      setReason("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={tooth !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Tooth ${tooth}`}</DialogTitle>
          <DialogDescription>{tooth !== null ? describeTooth(tooth, toothState(history)) : ""}</DialogDescription>
        </DialogHeader>
        {tooth !== null && can(staff, "clinical.write") && (
          <form
            className="grid gap-3 rounded-lg border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Code
              <NativeSelect ref={codeRef} value={code} onChange={(event) => setCode(event.target.value)} className="w-full">
                <NativeSelectOption value="">Pick a code</NativeSelectOption>
                {CHART_GROUPS.map((group) => (
                  <NativeSelectOptGroup key={group} label={group}>
                    {CHART_LEGEND.filter((c) => c.group === group).map((c) => (
                      <NativeSelectOption key={c.code} value={c.code}>
                        {`${c.mark} · ${c.label}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            </label>
            {needsSurfaces(code) && (
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">Surfaces</legend>
                <div className="flex flex-wrap gap-2">
                  {SURFACES.map((s) => (
                    <label key={s} className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm sm:min-h-9">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={surfaces.includes(s)}
                        onChange={(event) => setSurfaces(event.target.checked ? [...surfaces, s] : surfaces.filter((x) => x !== s))}
                      />
                      {surfaceName(tooth, s)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <TextField label="Note (optional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
            <Button type="submit" className="justify-self-start" disabled={!code || (needsSurfaces(code) && surfaces.length === 0) || add.isPending}>
              Add to the chart
            </Button>
          </form>
        )}
        <section className="grid gap-2 text-sm">
          <h3 className="font-medium">History</h3>
          {history.length === 0 ? (
            <p className="text-muted-foreground">Nothing charted on this tooth yet.</p>
          ) : (
            <ol className="grid gap-2">
              {[...history].reverse().map((e) => (
                <li key={e.id} className="grid gap-1 rounded-md border p-2">
                  <span className={cn("font-medium", e.voidedAt && "line-through")}>
                    {[codeInfo(e.code)?.label ?? e.code, e.surfaces.map((s) => surfaceName(e.tooth, s as Surface).toLowerCase()).join(", ")].filter(Boolean).join(", ")}
                    {e.note ? `: ${e.note}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {[formatDateTime(new Date(e.createdAt)), e.authorName, e.branchName, e.visitStart ? `visit of ${formatDate(new Date(e.visitStart))}` : null]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                  {e.voidedAt && <span>{`Voided by ${e.voidedByName ?? "someone"}: ${e.voidReason}`}</span>}
                  {!e.voidedAt &&
                    can(staff, "clinical.write", { dentistId: e.authorId }) &&
                    (voiding === e.id ? (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          voidEntry.mutate(e.id);
                        }}
                      >
                        <TextField label="Why void it?" value={reason} maxLength={200} required autoFocus onChange={(event) => setReason(event.target.value)} className="min-w-48 flex-1" />
                        <Button type="submit" variant="destructive" disabled={!reason.trim() || voidEntry.isPending}>
                          Void
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setVoiding(null)}>
                          Keep it
                        </Button>
                      </form>
                    ) : (
                      <Button
                        variant="outline"
                        className="justify-self-start"
                        onClick={() => {
                          setVoiding(e.id);
                          setReason("");
                        }}
                      >
                        Void this entry
                      </Button>
                    ))}
                </li>
              ))}
            </ol>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
