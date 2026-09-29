"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookingPanel, type BookingIntent } from "@/components/calendar/booking-panel";
import { DayGrid } from "@/components/calendar/day-grid";
import { OnlineRequests } from "@/components/calendar/online-requests";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { WeekGrid } from "@/components/calendar/week-grid";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OperatingHours } from "@/db/schema";
import { api, errorMessage } from "@/lib/fetcher";
import type { Subject } from "@/lib/permissions";
import { addDays, formatDay, formatTime, manilaInstant } from "@/lib/time";
import { dayRange, offGrid, weekDates, type VisitJson } from "@/lib/visits";

export type CalendarProps = {
  branch: { id: string; code: string; name: string; hours: OperatingHours };
  chairs: { number: number; label: string }[];
  date: string;
  view: "day" | "week";
  today: string;
  staff: Subject;
  canBook: boolean;
  canManage: boolean;
};

/** Spec 10: the branch calendar, refreshed every 30 seconds and after every change. */
export function CalendarScreen({ branch, chairs, date, view, today, staff, canBook, canManage }: CalendarProps) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [intent, setIntent] = useState<BookingIntent | null>(null);
  const days = view === "week" ? weekDates(date) : [date];
  const from = manilaInstant(days[0], 0).toISOString();
  const to = manilaInstant(addDays(days[days.length - 1], 1), 0).toISOString();
  const visits = useQuery({
    queryKey: ["appointments", branch.code, from, to],
    queryFn: () => api<VisitJson[]>(`/appointments?branch=${branch.code}&from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
  const go = (nextDate: string, nextView = view) => router.push(`/${branch.code}/calendar?date=${nextDate}&view=${nextView}`);
  const step = view === "week" ? 7 : 1;
  const list = visits.data ?? [];
  const inGrid = list.filter((v) => !offGrid(v.status));
  const off = list.filter((v) => offGrid(v.status));
  // A chair turned off later still shows the visits it held.
  const columns = [...chairs];
  for (const v of inGrid) if (!columns.some((c) => c.number === v.chairNumber)) columns.push({ number: v.chairNumber, label: v.chairLabel });
  columns.sort((a, b) => a.number - b.number);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{view === "week" ? `Week of ${formatDay(days[0])}` : formatDay(date)}</h1>
          <p className="text-sm text-muted-foreground">{`${branch.name}${view === "day" && date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBook && (
            <>
              <Button onClick={() => setIntent({ kind: "new", date: date < today ? today : date })}>New booking</Button>
              <Button variant="outline" onClick={() => setIntent({ kind: "new", date: today, walkIn: true })}>
                Walk-in
              </Button>
            </>
          )}
          {canManage && <OnlineRequests branchCode={branch.code} onOpen={setOpenId} />}
          <Button variant="outline" onClick={() => go(addDays(date, -step))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, step))}>
            Next
          </Button>
          <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && go(event.target.value)} />
          <div role="group" aria-label="View" className="flex gap-1">
            <Button variant={view === "day" ? "default" : "outline"} aria-pressed={view === "day"} onClick={() => go(date, "day")}>
              Day
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} aria-pressed={view === "week"} onClick={() => go(date, "week")}>
              Week
            </Button>
          </div>
        </div>
      </div>
      {visits.isError && <FormAlert message={errorMessage(visits.error)} />}
      {visits.isPending && <p className="text-sm text-muted-foreground">Loading visits...</p>}
      {columns.length === 0 ? (
        <p className="text-muted-foreground">This branch has no chairs yet. The owner adds them in Settings.</p>
      ) : view === "week" ? (
        <WeekGrid days={days} today={today} chairs={chairs} visits={list} onOpen={(v) => setOpenId(v.id)} onDay={(day) => go(day, "day")} />
      ) : (
        <DayGrid
          date={date}
          range={dayRange(branch.hours, date, inGrid)}
          chairs={columns}
          visits={inGrid}
          onOpen={(v) => setOpenId(v.id)}
          onSlot={canBook && date >= today ? (chairNumber, minutes) => setIntent({ kind: "new", date, minutes, chairNumber }) : undefined}
        />
      )}
      {view === "day" && off.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">Cancelled and no-show</h2>
          <ul className="flex flex-wrap gap-2">
            {off.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(v.id)}
                  className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
                >
                  {`${formatTime(new Date(v.start))} ${v.patientName}`}
                  <StatusBadge status={v.status} online={v.source === "portal"} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <VisitPanel
        visitId={openId}
        branch={branch.code}
        staff={staff}
        onClose={() => setOpenId(null)}
        onMove={(visit) => {
          setOpenId(null);
          setIntent({ kind: "move", visit });
        }}
      />
      {intent && <BookingPanel intent={intent} branch={branch} chairs={chairs} today={today} onClose={() => setIntent(null)} />}
    </div>
  );
}
