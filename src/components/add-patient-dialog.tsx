"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EMPTY_PATIENT, PatientFields, type PatientDraft } from "@/components/patient-fields";
import type { PatientHit } from "@/components/patient-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, fieldErrors, RequestError } from "@/lib/fetcher";

type Added = { id: string; name: string };

/** Adds a patient to the practice, warning first about a likely duplicate (spec section 10). */
export function AddPatientDialog({
  open,
  onOpenChange,
  onAdded,
  homeBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (patient: Added) => void;
  homeBranch?: string;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<PatientDraft>(EMPTY_PATIENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<PatientHit[] | null>(null);

  const reset = () => {
    setDraft(EMPTY_PATIENT);
    setErrors({});
    setCandidates(null);
  };
  const finish = (patient: Added) => {
    onAdded(patient);
    reset();
    onOpenChange(false);
  };
  const add = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      api<{ id: string; chartNo: number }>("/patients", { method: "POST", body: { ...draft, allowDuplicate, homeBranch } }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["patients"] });
      toast.success(`Added ${draft.lastName}, ${draft.firstName} as chart ${created.chartNo}.`);
      finish({ id: created.id, name: `${draft.lastName}, ${draft.firstName}` });
    },
    onError: (error) => {
      if (error instanceof RequestError && error.body.code === "possible_duplicate") {
        setCandidates((error.body.candidates ?? []) as PatientHit[]);
        return;
      }
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing without adding starts the next patient fresh, never on an old draft or duplicate warning.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a patient</DialogTitle>
          <DialogDescription>One record for the whole practice, used at every branch.</DialogDescription>
        </DialogHeader>
        {candidates ? (
          <div className="grid gap-3">
            <Alert>
              <AlertTitle>This patient may already be on file</AlertTitle>
              <AlertDescription>Use the existing record if it is the same person.</AlertDescription>
            </Alert>
            <ul className="grid gap-2">
              {candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span>
                    {`${c.lastName}, ${c.firstName}`}
                    <span className="block text-sm text-muted-foreground">{[`Chart ${c.chartNo}`, c.birthday, c.mobile].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button variant="outline" onClick={() => finish({ id: c.id, name: `${c.lastName}, ${c.firstName}` })}>
                    Use this record
                  </Button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCandidates(null)}>
                Go back
              </Button>
              <Button onClick={() => add.mutate(true)} disabled={add.isPending}>
                Add as a new patient
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setErrors({});
              add.mutate(false);
            }}
          >
            <PatientFields value={draft} onChange={setDraft} errors={errors} showConsent />
            <DialogFooter>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? "Adding..." : "Add patient"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
