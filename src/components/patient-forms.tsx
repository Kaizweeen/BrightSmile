"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddPatientDialog, formAttachedMessage } from "@/components/add-patient-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch, type PatientHit } from "@/components/patient-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, RequestError } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type PatientForm = {
  id: string;
  createdAt: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthday: string;
  sex: string;
  mobile: string;
  address: string;
  matches: PatientHit[];
};

type Person = { id: string; lastName: string; firstName: string };

const SEX: Record<string, string> = { female: "Female", male: "Male" };

/**
 * Patient forms spec 5: the branch's waiting forms. Each becomes a new chart, goes to an existing patient's record, or is
 * discarded. A form someone else has just handled answers 404, and the list reloads.
 */
export function PatientForms({ branchCode, onOpenPatient }: { branchCode: string; onOpenPatient: (id: string) => void }) {
  const client = useQueryClient();
  const [listOpen, setListOpen] = useState(false);
  const [chosen, setChosen] = useState<PatientForm | null>(null);
  const [searching, setSearching] = useState(false);
  const [making, setMaking] = useState<PatientForm | null>(null);
  const [discarding, setDiscarding] = useState<PatientForm | null>(null);
  const list = useQuery({
    queryKey: ["patient-forms", branchCode],
    queryFn: () => api<PatientForm[]>(`/patient-forms?branch=${encodeURIComponent(branchCode)}`),
    refetchInterval: 30_000,
  });
  const reload = () => client.invalidateQueries({ queryKey: ["patient-forms"] });
  const choose = (form: PatientForm | null) => {
    setSearching(false);
    setChosen(form);
  };
  const failed = (error: unknown) => {
    toast.error(errorMessage(error));
    if (error instanceof RequestError && error.status === 404) {
      choose(null);
      void reload();
    }
  };
  const attach = useMutation({
    mutationFn: ({ form, person }: { form: PatientForm; person: Person }) =>
      api(`/patient-forms/${form.id}/attach`, { method: "POST", body: { patientId: person.id } }),
    onSuccess: (_done, { person }) => {
      toast.success(formAttachedMessage(person));
      choose(null);
      void reload();
      onOpenPatient(person.id);
    },
    onError: failed,
  });
  const discard = useMutation({
    mutationFn: (form: PatientForm) => api(`/patient-forms/${form.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Form discarded.");
      setDiscarding(null);
      await reload();
    },
    onError: (error) => {
      setDiscarding(null);
      failed(error);
    },
  });
  const count = list.data?.length ?? 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setListOpen(true);
          void list.refetch();
        }}
      >
        {/* The server sends at most the newest 100 (src/server/patient-forms.ts), so a full list may be only some of what waits. */}
        {list.data ? `Patient forms (${count >= 100 ? "100+" : count})` : "Patient forms"}
      </Button>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Patient forms</DialogTitle>
            <DialogDescription>Forms patients sent from this branch&apos;s poster. Check each one with the patient at the desk.</DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading patient forms...</p>
          ) : list.isError ? (
            <FormAlert message={errorMessage(list.error)} />
          ) : count === 0 ? (
            <p className="text-sm text-muted-foreground">No patient forms are waiting.</p>
          ) : (
            <ul className="grid gap-2">
              {list.data.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="grid min-h-11 w-full gap-1 rounded-md border p-3 text-left text-sm wrap-anywhere outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setListOpen(false);
                      choose(f);
                    }}
                  >
                    <span className="font-medium">{`${f.lastName}, ${f.firstName}`}</span>
                    <span>{`Born ${f.birthday}. ${f.mobile}.`}</span>
                    <span className="text-xs text-muted-foreground">{`Sent ${formatDateTime(new Date(f.createdAt))}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={chosen !== null} onOpenChange={(next) => !next && choose(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {chosen && (
            <>
              <DialogHeader>
                <DialogTitle>{`${chosen.lastName}, ${chosen.firstName}`}</DialogTitle>
                <DialogDescription>{`Sent ${formatDateTime(new Date(chosen.createdAt))}. Check it with the patient.`}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{[chosen.firstName, chosen.middleName, chosen.lastName].filter(Boolean).join(" ")}</dd>
                <dt className="text-muted-foreground">Birthday</dt>
                <dd>{chosen.birthday}</dd>
                <dt className="text-muted-foreground">Sex</dt>
                <dd>{SEX[chosen.sex] ?? chosen.sex}</dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd>{chosen.mobile}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="wrap-anywhere">{chosen.address}</dd>
              </dl>
              {searching ? (
                <PatientSearch
                  onPick={(p) => {
                    if (!attach.isPending) attach.mutate({ form: chosen, person: p });
                  }}
                  autoFocus
                />
              ) : (
                chosen.matches.length > 0 && (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium">May already be on file</p>
                    <ul className="grid gap-2">
                      {chosen.matches.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                          <span>
                            {`${m.lastName}, ${m.firstName}`}
                            <span className="block text-sm text-muted-foreground">{[`Chart ${m.chartNo}`, m.birthday, m.mobile].filter(Boolean).join(" · ")}</span>
                          </span>
                          <Button variant="outline" disabled={attach.isPending} onClick={() => attach.mutate({ form: chosen, person: m })}>
                            This is the patient
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDiscarding(chosen);
                    choose(null);
                  }}
                >
                  Discard
                </Button>
                <Button variant="outline" onClick={() => setSearching(!searching)}>
                  {searching ? "Back" : "Existing patient"}
                </Button>
                <Button
                  onClick={() => {
                    setMaking(chosen);
                    choose(null);
                  }}
                >
                  New chart
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {making && (
        <AddPatientDialog
          key={making.id}
          open
          onOpenChange={(next) => !next && setMaking(null)}
          onAdded={(p) => {
            setMaking(null);
            void reload();
            onOpenPatient(p.id);
          }}
          onFormGone={() => {
            setMaking(null);
            void reload();
          }}
          homeBranch={branchCode}
          initial={{
            lastName: making.lastName,
            firstName: making.firstName,
            middleName: making.middleName ?? "",
            birthday: making.birthday,
            sex: making.sex,
            mobile: making.mobile,
            address: making.address,
          }}
          formId={making.id}
        />
      )}
      <ConfirmDialog
        open={discarding !== null}
        title="Discard this form?"
        description="Its details are deleted."
        confirmLabel="Discard"
        pending={discard.isPending}
        onConfirm={() => discarding && discard.mutate(discarding)}
        onOpenChange={(next) => !next && setDiscarding(null)}
      />
    </>
  );
}
