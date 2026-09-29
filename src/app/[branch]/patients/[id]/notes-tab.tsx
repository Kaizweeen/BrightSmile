"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/fetcher";
import type { Status } from "@/lib/lifecycle";
import { can, type Subject } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/time";
import { chairName, type PatientVisitJson } from "@/lib/visits";

type NoteJson = {
  id: string;
  body: string;
  amendsId: string | null;
  createdAt: string;
  authorName: string;
  appointmentId: string;
  visitStart: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
};

/** Visits a note can go on: the patient came (the server checks the same). */
const SEEN: readonly Status[] = ["checked_in", "in_treatment", "completed"];

function NoteForm({ patientId, appointmentId, amendsId, onClose }: { patientId: string; appointmentId: string; amendsId?: string; onClose?: () => void }) {
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/notes`, { method: "POST", body: { body, amendsId: amendsId ?? null } }),
    onSuccess: async () => {
      toast.success(amendsId ? "Correction added." : "Note added.");
      setBody("");
      await client.invalidateQueries({ queryKey: ["notes", patientId] });
      onClose?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        {amendsId ? "Correction" : "Note"}
        <Textarea value={body} maxLength={4000} rows={4} onChange={(event) => setBody(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!body.trim() || add.isPending}>
          {amendsId ? "Add the correction" : "Add the note"}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            Go back
          </Button>
        )}
      </div>
    </form>
  );
}

/** Spec 9.3, the patient's Notes tab. Notes are never edited: a correction is a new note naming the one it corrects. */
export function NotesTab({ patientId, staff }: { patientId: string; staff: Subject }) {
  const [visitId, setVisitId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const notes = useQuery({ queryKey: ["notes", patientId], queryFn: () => api<NoteJson[]>(`/patients/${patientId}/notes`) });
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[] }>(`/patients/${patientId}/visits`),
  });
  const all = visits.data?.visits ?? [];
  const writable = all.filter((v) => SEEN.includes(v.status) && can(staff, "clinical.write", { dentistId: v.dentistId }));
  const chosen = visitId ?? writable[0]?.id ?? null;
  const canCorrect = (n: NoteJson) => {
    const dentistId = all.find((v) => v.id === n.appointmentId)?.dentistId;
    return dentistId !== undefined && can(staff, "clinical.write", { dentistId });
  };
  const byId = new Map((notes.data ?? []).map((n) => [n.id, n]));

  return (
    <div className="grid max-w-3xl gap-6">
      {chosen && (
        <section aria-labelledby="new-note-title" className="grid gap-3 rounded-lg border p-3">
          <h2 id="new-note-title" className="font-semibold">
            Add a treatment note
          </h2>
          <label className="grid gap-1.5 text-sm font-medium">
            Visit
            <NativeSelect value={chosen} onChange={(event) => setVisitId(event.target.value)} className="w-full">
              {writable.map((v) => (
                <NativeSelectOption key={v.id} value={v.id}>
                  {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <NoteForm key={chosen} patientId={patientId} appointmentId={chosen} />
        </section>
      )}
      <section aria-labelledby="notes-title" className="grid gap-3">
        <h2 id="notes-title" className="text-lg font-semibold">
          Treatment notes
        </h2>
        {notes.isError ? (
          <FormAlert message={errorMessage(notes.error)} />
        ) : notes.isPending ? (
          <p className="text-muted-foreground">Loading notes...</p>
        ) : notes.data.length === 0 ? (
          <p className="text-muted-foreground">No notes yet.</p>
        ) : (
          <ol className="grid gap-3">
            {notes.data.map((n) => {
              const original = n.amendsId ? byId.get(n.amendsId) : undefined;
              return (
                <li key={n.id} className="grid gap-2 rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">
                    {[formatDateTime(new Date(n.createdAt)), n.authorName, n.branchName, chairName(n.chairNumber, n.chairLabel), `visit of ${formatDate(new Date(n.visitStart))}`].join(", ")}
                  </p>
                  {n.amendsId && (
                    <p className="text-sm font-medium">{`Correction to the note of ${original ? formatDateTime(new Date(original.createdAt)) : "an earlier date"}`}</p>
                  )}
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  {canCorrect(n) &&
                    (correcting === n.id ? (
                      <NoteForm patientId={patientId} appointmentId={n.appointmentId} amendsId={n.id} onClose={() => setCorrecting(null)} />
                    ) : (
                      <Button variant="outline" className="justify-self-start" onClick={() => setCorrecting(n.id)}>
                        Correct this note
                      </Button>
                    ))}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
