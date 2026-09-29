"use client";

import { Fragment, useState, useSyncExternalStore } from "react";
import { AlertMark } from "@/components/alert-mark";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatTime, manilaInstant } from "@/lib/time";
import { cn } from "@/lib/utils";
import { chairName, placement, ROW_MINUTES, type VisitJson } from "@/lib/visits";

// 30 pixels per 15 minutes: a 30-minute card fits its time and patient, procedure and dentist, and status badge.
const ROW_PX = 30;
const px = (minutes: number) => (minutes / ROW_MINUTES) * ROW_PX;

const everyMinute = (tick: () => void) => {
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
};

/** Minutes since 1970, re-read every minute; null while rendering on the server, so the page hydrates cleanly. */
function useMinute(): number | null {
  return useSyncExternalStore(everyMinute, () => Math.floor(Date.now() / 60_000), () => null);
}

type Props = {
  date: string;
  range: { start: number; end: number };
  chairs: { number: number; label: string }[];
  visits: VisitJson[];
  onOpen: (visit: VisitJson) => void;
  onSlot?: (chairNumber: number, minutes: number) => void;
};

/** Spec 10, the day view: a column per chair, 15-minute rows, cards with their turnover, and a line at the current time. */
export function DayGrid({ date, range, chairs, visits, onOpen, onSlot }: Props) {
  const [shown, setShown] = useState(chairs[0]?.number);
  const minute = useMinute();
  const height = px(range.end - range.start);
  const nowAt = minute === null ? null : minute - manilaInstant(date, 0).getTime() / 60_000 - range.start;
  const labels: number[] = [];
  for (let m = Math.ceil(range.start / 30) * 30; m < range.end; m += 30) labels.push(m);

  return (
    <div className="grid gap-2">
      <div role="group" aria-label="Chair" className="flex gap-1 overflow-x-auto sm:hidden">
        {chairs.map((c) => (
          <Button key={c.number} variant={c.number === shown ? "default" : "outline"} aria-pressed={c.number === shown} onClick={() => setShown(c.number)}>
            {chairName(c.number, c.label)}
          </Button>
        ))}
      </div>
      <div className="flex overflow-x-auto rounded-lg border">
        <div className="w-20 shrink-0 border-r text-xs text-muted-foreground">
          <div className="h-10 border-b" />
          <div className="relative" style={{ height }}>
            {labels.map((m) => (
              <span key={m} className="absolute right-2 pt-0.5" style={{ top: px(m - range.start) }}>
                {formatTime(manilaInstant(date, m))}
              </span>
            ))}
          </div>
        </div>
        {chairs.map((c) => (
          <div key={c.number} className={cn("min-w-40 flex-1 border-r last:border-r-0", c.number !== shown && "hidden sm:block")}>
            <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{chairName(c.number, c.label)}</div>
            <div
              className={cn("relative", onSlot && "cursor-pointer")}
              style={{ height, backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: `100% ${px(30)}px` }}
              onClick={(event) => {
                // Only clicks on the empty column book: cards and turnover strips sit on top of it.
                if (!onSlot || event.target !== event.currentTarget) return;
                const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                onSlot(c.number, range.start + Math.floor(y / ROW_PX) * ROW_MINUTES);
              }}
            >
              {visits
                .filter((v) => v.chairNumber === c.number)
                .map((v) => {
                  const at = placement(v, date, range.start);
                  return (
                    <Fragment key={v.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(v)}
                        className={cn(
                          "absolute inset-x-1 flex min-h-11 flex-col items-start overflow-hidden rounded-md border bg-card px-2 py-1 text-left text-xs shadow-sm outline-none hover:bg-muted focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0",
                          v.status === "completed" && "opacity-70",
                        )}
                        style={{ top: px(at.top), height: Math.max(px(at.height), ROW_PX) }}
                      >
                        <span className="flex w-full items-start justify-between gap-1">
                          <span className="truncate font-medium">{`${formatTime(new Date(v.start))} ${v.patientName}`}</span>
                          {v.hasAlerts && <AlertMark />}
                        </span>
                        <span className="w-full truncate text-muted-foreground">{`${v.procedures.join(", ")} · ${v.dentistName}`}</span>
                        <StatusBadge status={v.status} online={v.source === "portal"} />
                        <span className="sr-only">{`, ${chairName(c.number, c.label)}, chair free at ${formatTime(new Date(v.chairFreeAt))}`}</span>
                      </button>
                      {at.turnover > 0 && (
                        <div
                          aria-hidden
                          title={`Cleaning until ${formatTime(new Date(v.chairFreeAt))}`}
                          className="absolute inset-x-1 rounded-b-md border border-dashed"
                          style={{
                            top: px(at.top + at.height),
                            height: px(at.turnover),
                            backgroundImage: "repeating-linear-gradient(45deg, var(--muted) 0 4px, transparent 4px 8px)",
                          }}
                        />
                      )}
                    </Fragment>
                  );
                })}
              {nowAt !== null && nowAt >= 0 && nowAt <= range.end - range.start && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-destructive" style={{ top: px(nowAt) }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
