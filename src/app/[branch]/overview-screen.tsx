"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/fetcher";
import { STATUSES, type Status } from "@/lib/lifecycle";
import type { Subject } from "@/lib/permissions";
import { addDays, formatDay, formatTime } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

type Summary = { id: string; code: string; name: string; chairs: number; chairsInUse: number; counts: Record<Status, number>; dentistsOnDuty: string[] };

/** Spec 10, All branches: a card per branch (visits by status, chairs in use now, dentists on duty) above the day's visits. */
export function OverviewScreen({ date, today, staff }: { date: string; today: string; staff: Subject }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["appointments", "overview", date],
    queryFn: () => api<{ branches: Summary[]; visits: VisitJson[] }>(`/overview?date=${date}`),
    refetchInterval: 30_000,
  });
  const go = (next: string) => router.push(`/all?date=${next}`);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">All branches</h1>
          <p className="text-sm text-muted-foreground">{`${formatDay(date)}${date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => go(addDays(date, -1))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, 1))}>
            Next
          </Button>
          <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && go(event.target.value)} />
        </div>
      </div>
      {overview.isError && <FormAlert message={errorMessage(overview.error)} />}
      {overview.isPending && <p className="text-muted-foreground">Loading...</p>}
      {overview.data && (
        <>
          <ul className="grid gap-3 md:grid-cols-3">
            {overview.data.branches.map((b) => (
              <li key={b.id}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>{b.name}</CardTitle>
                    <CardDescription>{date === today ? `${b.chairsInUse} of ${b.chairs} chairs in use now` : `${b.chairs} chairs`}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <ul aria-label="Visits by status" className="flex flex-wrap gap-2">
                      {STATUSES.filter((s) => b.counts[s] > 0).map((s) => (
                        <li key={s} className="flex items-center gap-1">
                          <StatusBadge status={s} />
                          {b.counts[s]}
                        </li>
                      ))}
                      {STATUSES.every((s) => b.counts[s] === 0) && <li className="text-muted-foreground">No visits</li>}
                    </ul>
                    <p>{b.dentistsOnDuty.length > 0 ? `On duty: ${b.dentistsOnDuty.join(", ")}` : "No dentist on duty"}</p>
                  </CardContent>
                  <CardFooter>
                    <Link href={`/${b.code}/calendar?date=${date}`} className={buttonVariants({ variant: "outline" })}>
                      Open calendar
                    </Link>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
          <section aria-labelledby="visits-title" className="grid gap-2">
            <h2 id="visits-title" className="text-lg font-semibold">
              Visits
            </h2>
            {overview.data.visits.length === 0 ? (
              <p className="text-muted-foreground">No visits on this day.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Chair</TableHead>
                      <TableHead>Dentist</TableHead>
                      <TableHead>Procedures</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.data.visits.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{formatTime(new Date(v.start))}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setOpenId(v.id)}
                              className="min-h-11 rounded-sm text-left font-medium underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
                            >
                              {v.patientName}
                            </button>
                            {v.hasAlerts && <AlertMark />}
                          </span>
                        </TableCell>
                        <TableCell>{v.branchName}</TableCell>
                        <TableCell>{chairName(v.chairNumber, v.chairLabel)}</TableCell>
                        <TableCell>{v.dentistName}</TableCell>
                        <TableCell className="whitespace-normal">{v.procedures.join(", ")}</TableCell>
                        <TableCell>
                          <StatusBadge status={v.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
      <VisitPanel visitId={openId} branch="all" staff={staff} onClose={() => setOpenId(null)} />
    </div>
  );
}
