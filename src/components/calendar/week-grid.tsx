"use client";

import { useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { StatusBadge } from "@/components/status-badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDay, formatTime, manilaDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { chairName, type VisitJson } from "@/lib/visits";

type Props = {
  days: string[];
  today: string;
  chairs: { number: number; label: string }[];
  visits: VisitJson[];
  onOpen: (visit: VisitJson) => void;
  onDay: (date: string) => void;
};

/** Spec 10, the week view: seven day columns of compact cards, filtered by dentist or chair. */
export function WeekGrid({ days, today, chairs, visits, onOpen, onDay }: Props) {
  const [dentist, setDentist] = useState("");
  const [chair, setChair] = useState("");
  const dentists = [...new Map(visits.map((v) => [v.dentistId, v.dentistName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = visits.filter((v) => (!dentist || v.dentistId === dentist) && (!chair || v.chairNumber === Number(chair)));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Dentist
          <NativeSelect value={dentist} onChange={(event) => setDentist(event.target.value)}>
            <NativeSelectOption value="">All dentists</NativeSelectOption>
            {dentists.map(([id, name]) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Chair
          <NativeSelect value={chair} onChange={(event) => setChair(event.target.value)}>
            <NativeSelectOption value="">All chairs</NativeSelectOption>
            {chairs.map((c) => (
              <NativeSelectOption key={c.number} value={String(c.number)}>
                {chairName(c.number, c.label)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((day) => {
          const list = shown.filter((v) => manilaDate(new Date(v.start)) === day);
          return (
            <section key={day} aria-labelledby={`day-${day}`} className={cn("min-w-0 rounded-lg border p-2", day === today && "border-primary")}>
              <h2 id={`day-${day}`} className="mb-2 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => onDay(day)}
                  className="min-h-11 rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
                >
                  {formatDay(day)}
                </button>
                {day === today && <span className="ml-1 text-xs font-normal text-primary">Today</span>}
              </h2>
              <ul className="grid gap-1">
                {list.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(v)}
                      className="grid w-full gap-0.5 rounded-md border px-2 py-1 text-left text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="font-medium">{formatTime(new Date(v.start))}</span>
                        {v.hasAlerts && <AlertMark />}
                      </span>
                      <span className="truncate">{v.patientName}</span>
                      <StatusBadge status={v.status} className="justify-self-start" />
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="text-xs text-muted-foreground">No visits</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
