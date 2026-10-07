"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck } from "lucide-react";
import { AlertMark } from "@/components/alert-mark";
import { DateNav } from "@/components/date-nav";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, statusBar } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { actionLabel, type Status } from "@/lib/lifecycle";
import { addDays, formatDay, formatTime, manilaInstant } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

// Whoever is in the chair first, then who is waiting, then the rest by time; finished visits last.
const ORDER: Record<Status, number> = { in_treatment: 0, checked_in: 1, confirmed: 2, requested: 2, completed: 3, no_show: 3, cancelled: 3 };
const NEXT_STEP: Partial<Record<Status, Status>> = { checked_in: "in_treatment", in_treatment: "completed" };

/** Spec 10, My day: the person's own visits at every branch, next patient first, with Start treatment and Complete. */
export function MyDayScreen({ branch, date, today, staffId }: { branch: string; date: string; today: string; staffId: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  const visits = useQuery({
    queryKey: ["appointments", "mine", from],
    queryFn: () => api<VisitJson[]>(`/appointments?branch=all&dentist=${staffId}&from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
  const change = useMutation({
    mutationFn: ({ id, to: next }: { id: string; to: Status }) => api(`/appointments/${id}/transitions`, { method: "POST", body: { to: next } }),
    onSuccess: async () => {
      toast.success("Saved.");
      await client.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: async (error) => {
      toast.error(errorMessage(error));
      // Someone else may have changed the visit: show the day as it is now.
      await client.invalidateQueries({ queryKey: ["appointments"] });
    },
  });
  const go = (next: string) => router.push(`/${branch}/my-day?date=${next}`);
  const sorted = [...(visits.data ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.start.localeCompare(b.start));

  return (
    <div className="grid max-w-3xl gap-4">
      <PageHeader title="My day" description={`${formatDay(date)}${date === today ? ", today" : ""}`} actions={<DateNav date={date} today={today} onGo={go} />} />
      {visits.isError && <FormAlert message={errorMessage(visits.error)} />}
      {visits.isPending && <LoadingRows rows={3} label="Loading visits..." />}
      {visits.data?.length === 0 && (
        <EmptyState icon={CalendarCheck} title="No visits on this day">
          Pick another day with the arrows above.
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {sorted.map((v) => {
          const next = NEXT_STEP[v.status];
          return (
            <li key={v.id}>
              <Card className="relative">
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", statusBar(v.status))} />
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 tabular-nums">
                    {`${formatTime(new Date(v.start))} ${v.patientName}`}
                    {v.hasAlerts && <AlertMark />}
                  </CardTitle>
                  <CardDescription>{`${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}. ${v.procedures.join(", ")}.`}</CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={v.status} online={v.source === "portal"} />
                  {next && (
                    <Button disabled={change.isPending} onClick={() => change.mutate({ id: v.id, to: next })}>
                      {actionLabel(v.status, next)}
                    </Button>
                  )}
                  <Link href={`/${branch}/patients/${v.patientId}?tab=chart`} className={buttonVariants({ variant: "outline" })}>
                    Open chart
                  </Link>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
