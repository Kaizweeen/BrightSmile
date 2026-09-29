"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type OnlineRequest = { id: string; start: string; createdAt: string; note: string; mobile: string | null; dentistName: string; patientName: string; services: string[] };

/** Online booking spec 4: the branch's online requests waiting for a call. Choosing one opens its visit panel. */
export function OnlineRequests({ branchCode, onOpen }: { branchCode: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  // Under "appointments", so every change to a visit refreshes it too.
  const list = useQuery({
    queryKey: ["appointments", "online", branchCode],
    queryFn: () => api<OnlineRequest[]>(`/online-requests?branch=${branchCode}`),
    refetchInterval: 30_000,
  });
  const count = list.data?.length ?? 0;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          void list.refetch();
        }}
      >
        {`Online requests (${count})`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Online requests</DialogTitle>
            <DialogDescription>Call or text each patient, then open the visit to confirm it, change it, or cancel it.</DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading online requests...</p>
          ) : list.isError ? (
            <FormAlert message={errorMessage(list.error)} />
          ) : count === 0 ? (
            <p className="text-sm text-muted-foreground">No online requests are waiting.</p>
          ) : (
            <ul className="grid gap-2">
              {list.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="grid min-h-11 w-full gap-1 rounded-md border p-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setOpen(false);
                      onOpen(r.id);
                    }}
                  >
                    <span className="font-medium">{`${formatDateTime(new Date(r.start))}, ${r.patientName}`}</span>
                    <span>{`${r.mobile ?? "No mobile number"}. ${r.services.join(", ")}, with ${r.dentistName}.`}</span>
                    {r.note && <span className="text-muted-foreground">{r.note}</span>}
                    <span className="text-xs text-muted-foreground">{`Came in ${formatDateTime(new Date(r.createdAt))}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
