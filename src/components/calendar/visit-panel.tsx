"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBanner } from "@/components/alert-banner";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/fetcher";
import { actionFor, actionLabel, changeProblem, NEXT, type Status } from "@/lib/lifecycle";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime, formatTime } from "@/lib/time";
import { chairName, type VisitDetailJson } from "@/lib/visits";

type Props = {
  visitId: string | null;
  branch: string;
  staff: Subject;
  onClose: () => void;
  onMove?: (visit: VisitDetailJson) => void;
};

/** Spec 10, a visit's panel: details, the status changes allowed right now, Cancel, Open patient, and the history. */
export function VisitPanel({ visitId, branch, staff, onClose, onMove }: Props) {
  const client = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const detail = useQuery({
    queryKey: ["appointment", visitId],
    queryFn: () => api<VisitDetailJson>(`/appointments/${visitId}`),
    enabled: visitId !== null,
  });
  const change = useMutation({
    mutationFn: (body: { to: Status; reason?: string }) => api(`/appointments/${visitId}/transitions`, { method: "POST", body }),
    onSuccess: async () => {
      toast.success("Saved.");
      setCancelling(false);
      setReason("");
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment", visitId] });
    },
    onError: async (error) => {
      toast.error(errorMessage(error));
      // Someone else may have changed the visit: show what it is now.
      await client.invalidateQueries({ queryKey: ["appointment", visitId] });
      await client.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const v = detail.data;
  const now = new Date();
  const allowed = v
    ? NEXT[v.status].filter(
        (to) => changeProblem(v.status, to, new Date(v.start), now) === null && can(staff, actionFor(to), { branchId: v.branchId, dentistId: v.dentistId }),
      )
    : [];
  const canMove = v !== undefined && ["requested", "confirmed", "checked_in"].includes(v.status) && can(staff, "appointment.manage", { branchId: v.branchId });

  return (
    <Dialog
      open={visitId !== null}
      onOpenChange={(open) => {
        if (open) return;
        setCancelling(false);
        setReason("");
        onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {!v ? (
          <DialogHeader>
            <DialogTitle>Visit</DialogTitle>
            {detail.isError ? <FormAlert message={errorMessage(detail.error)} /> : <DialogDescription>Loading...</DialogDescription>}
          </DialogHeader>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{v.patientName}</DialogTitle>
              <DialogDescription>
                {`${formatDateTime(new Date(v.start))} to ${formatTime(new Date(v.end))}, ${chairName(v.chairNumber, v.chairLabel)}, ${v.branchName}`}
              </DialogDescription>
            </DialogHeader>
            <AlertBanner lines={v.alerts} />
            <dl className="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge status={v.status} online={v.source === "portal"} />
              </dd>
              <dt className="text-muted-foreground">Dentist</dt>
              <dd>{v.dentistName}</dd>
              <dt className="text-muted-foreground">Services</dt>
              <dd>{v.procedures.join(", ")}</dd>
              <dt className="text-muted-foreground">Chair free at</dt>
              <dd>{`${formatTime(new Date(v.chairFreeAt))}, after cleaning`}</dd>
              {v.source === "walk_in" && (
                <>
                  <dt className="text-muted-foreground">Booked as</dt>
                  <dd>Walk-in</dd>
                </>
              )}
              {v.note && (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="whitespace-pre-wrap">{v.note}</dd>
                </>
              )}
              {v.cancelReason && (
                <>
                  <dt className="text-muted-foreground">Why cancelled</dt>
                  <dd>{v.cancelReason}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-2">
              {allowed
                .filter((to) => to !== "cancelled")
                .map((to, i) => (
                  <Button key={to} variant={i === 0 ? "default" : "outline"} disabled={change.isPending} onClick={() => change.mutate({ to })}>
                    {actionLabel(v.status, to)}
                  </Button>
                ))}
              {onMove && canMove && (
                <Button variant="outline" onClick={() => onMove(v)}>
                  Move
                </Button>
              )}
              {allowed.includes("cancelled") && !cancelling && (
                <Button variant="outline" onClick={() => setCancelling(true)}>
                  Cancel visit
                </Button>
              )}
              <Link href={`/${branch}/patients/${v.patientId}`} className={buttonVariants({ variant: "outline" })}>
                Open patient
              </Link>
            </div>
            {cancelling && (
              <form
                className="grid gap-2 rounded-lg border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  change.mutate({ to: "cancelled", reason });
                }}
              >
                <label className="grid gap-1.5 text-sm font-medium">
                  Reason for cancelling
                  <Textarea value={reason} maxLength={200} required onChange={(event) => setReason(event.target.value)} />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" disabled={change.isPending || !reason.trim()}>
                    Cancel the visit
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
                    Keep it
                  </Button>
                </div>
              </form>
            )}
            <section className="grid gap-1 text-sm">
              <h3 className="font-medium">History</h3>
              {v.history.length === 0 ? (
                <p className="text-muted-foreground">No changes recorded.</p>
              ) : (
                <ol className="grid gap-1">
                  {v.history.map((h, i) => (
                    <li key={`${h.at}-${i}`}>
                      <span className="text-muted-foreground">{`${formatDateTime(new Date(h.at))}, ${h.by}: `}</span>
                      {h.text}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
