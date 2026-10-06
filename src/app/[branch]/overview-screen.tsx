"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CalendarCheck, CalendarDays, CircleCheck, Stethoscope, UserX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { DateNav } from "@/components/date-nav";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/fetcher";
import { STATUSES, type Status } from "@/lib/lifecycle";
import type { Subject } from "@/lib/permissions";
import { formatDay, formatTime } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

type Summary = { id: string; code: string; name: string; chairs: number; chairsInUse: number; counts: Record<Status, number>; dentistsOnDuty: string[] };

const sum = (branches: Summary[], ...statuses: Status[]) => branches.reduce((n, b) => n + statuses.reduce((m, s) => m + b.counts[s], 0), 0);

/** Spec 10, All branches: totals for the day, a card per branch (visits by status, chairs in use now, dentists on duty), then the day's visits. */
export function OverviewScreen({ date, today, staff }: { date: string; today: string; staff: Subject }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["appointments", "overview", date],
    queryFn: () => api<{ branches: Summary[]; visits: VisitJson[] }>(`/overview?date=${date}`),
    refetchInterval: 30_000,
  });
  const go = (next: string) => router.push(`/all?date=${next}`);
  const branches = overview.data?.branches ?? [];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="All branches"
        description={`${formatDay(date)}${date === today ? ", today" : ""}`}
        actions={<DateNav date={date} today={today} onGo={go} />}
      />
      {overview.isError && <FormAlert message={errorMessage(overview.error)} />}
      {overview.isPending && <LoadingRows rows={4} />}
      {overview.data && (
        <>
          <ul aria-label="Totals for the day" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <li>
              <StatCard className="h-full" label="Visits" value={STATUSES.reduce((n, s) => n + sum(branches, s), 0)} hint="across all branches" icon={CalendarDays} />
            </li>
            <li>
              <StatCard className="h-full" label="Waiting or in the chair" value={sum(branches, "checked_in", "in_treatment")} hint="checked in or in treatment" icon={Stethoscope} />
            </li>
            <li>
              <StatCard className="h-full" label="Completed" value={sum(branches, "completed")} hint={`${sum(branches, "requested", "confirmed")} still to come`} icon={CircleCheck} />
            </li>
            <li>
              <StatCard className="h-full" label="No-shows and cancelled" value={sum(branches, "no_show", "cancelled")} hint="for the day" icon={UserX} />
            </li>
          </ul>

          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {branches.map((b) => {
              const use = b.chairs > 0 ? Math.round((b.chairsInUse / b.chairs) * 100) : 0;
              return (
                <li key={b.id}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle>{b.name}</CardTitle>
                      <CardDescription className="tabular-nums">{date === today ? `${b.chairsInUse} of ${b.chairs} chairs in use now` : `${b.chairs} chairs`}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 text-sm">
                      {date === today && (
                        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${use}%` }} />
                        </div>
                      )}
                      <ul aria-label="Visits by status" className="flex flex-wrap gap-x-3 gap-y-2">
                        {STATUSES.filter((s) => b.counts[s] > 0).map((s) => (
                          <li key={s} className="flex items-center gap-1.5">
                            <StatusBadge status={s} />
                            <span className="font-medium tabular-nums">{b.counts[s]}</span>
                          </li>
                        ))}
                        {STATUSES.every((s) => b.counts[s] === 0) && <li className="text-muted-foreground">No visits</li>}
                      </ul>
                      <p className="text-muted-foreground">
                        {b.dentistsOnDuty.length > 0 ? (
                          <>
                            <span className="font-medium text-foreground">On duty: </span>
                            {b.dentistsOnDuty.join(", ")}
                          </>
                        ) : (
                          "No dentist on duty"
                        )}
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Link href={`/${b.code}/calendar?date=${date}`} className={buttonVariants({ variant: "outline" })}>
                        Open calendar
                        <ArrowRightIcon aria-hidden data-icon="inline-end" />
                      </Link>
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ul>

          <section aria-labelledby="visits-title" className="grid gap-3">
            <h2 id="visits-title" className="text-lg font-semibold">
              Visits
            </h2>
            {overview.data.visits.length === 0 ? (
              <EmptyState icon={CalendarCheck} title="No visits on this day">
                Pick another day, or open a branch calendar to book one.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Chair</TableHead>
                      <TableHead>Dentist</TableHead>
                      <TableHead>Services</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.data.visits.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="tabular-nums">{formatTime(new Date(v.start))}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setOpenId(v.id)}
                              className="min-h-11 cursor-pointer rounded-sm text-left font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
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
                          <StatusBadge status={v.status} online={v.source === "portal"} />
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
