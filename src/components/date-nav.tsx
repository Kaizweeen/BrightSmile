"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays } from "@/lib/time";

/** Previous, Today, Next and a date field: one control for moving a day or week screen through time. */
export function DateNav({ date, today, step = 1, unit = "day", onGo }: { date: string; today: string; step?: number; unit?: "day" | "week"; onGo: (date: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={`Move by ${unit}`} className="inline-flex items-center overflow-hidden rounded-lg border border-input bg-card shadow-xs">
        <Button variant="ghost" size="icon" className="rounded-none" onClick={() => onGo(addDays(date, -step))}>
          <ChevronLeftIcon aria-hidden />
          <span className="sr-only">{`Previous ${unit}`}</span>
        </Button>
        <Button variant="ghost" className="rounded-none border-x border-input px-3" onClick={() => onGo(today)} disabled={date === today}>
          Today
        </Button>
        <Button variant="ghost" size="icon" className="rounded-none" onClick={() => onGo(addDays(date, step))}>
          <ChevronRightIcon aria-hidden />
          <span className="sr-only">{`Next ${unit}`}</span>
        </Button>
      </div>
      <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && onGo(event.target.value)} />
    </div>
  );
}
