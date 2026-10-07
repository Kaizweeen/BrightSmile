"use client";

import { LoadingRows } from "@/components/loading";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { InboxIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
        {list.data ? `Online requests (${count})` : "Online requests"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Online requests</DialogTitle>
            <DialogDescription>Call or text each patient, then open the visit to confirm it, change it, or cancel it.</DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <LoadingRows rows={3} label="Loading online requests..." />
          ) : list.isError ? (
            <FormAlert message={errorMessage(list.error)} />
          ) : count === 0 ? (
            <EmptyState icon={InboxIcon} title="No online requests are waiting" />
          ) : (
            <ul className="grid gap-2">
              {list.data.map((r) => (
                <li key={r.id}>
                  {/* wrap-anywhere, not break-words: in this grid only "anywhere" lets a long unbroken word (a pasted link) shrink the row. */}
                  <button
                    type="button"
                    className="grid min-h-11 w-full cursor-pointer gap-1 rounded-xl border bg-card p-3 text-left text-sm wrap-anywhere shadow-xs outline-none transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setOpen(false);
                      onOpen(r.id);
                    }}
                  >
                    <span>{formatDateTime(new Date(r.start))}</span>
                    <span className="font-medium">{r.patientName}</span>
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
