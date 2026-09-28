"use client";

import type { OperatingHours } from "@/db/schema";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/hours";

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** One row per weekday: open or closed, and the opening and closing times on the 15-minute grid. */
export function HoursEditor({ value, onChange, error }: { value: OperatingHours; onChange: (hours: OperatingHours) => void; error?: string }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Opening hours</legend>
      {MONDAY_FIRST.map((day) => {
        const today = value[String(day)];
        const set = (next: { open: string; close: string } | null) => onChange({ ...value, [String(day)]: next });
        return (
          <div key={day} className="flex flex-wrap items-end gap-x-3 gap-y-1 rounded-md border p-2">
            <label className="flex min-h-11 w-40 items-center gap-2 sm:min-h-9">
              <input type="checkbox" checked={today !== null} onChange={(event) => set(event.target.checked ? { open: "09:00", close: "18:00" } : null)} className="size-4 accent-primary" />
              <span className="font-medium">{WEEKDAYS[day]}</span>
            </label>
            {today ? (
              <>
                <label className="grid gap-1 text-sm">
                  Opens
                  <Input type="time" step={900} aria-label={`${WEEKDAYS[day]} opens`} value={today.open} onChange={(event) => set({ ...today, open: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  Closes
                  <Input type="time" step={900} aria-label={`${WEEKDAYS[day]} closes`} value={today.close} onChange={(event) => set({ ...today, close: event.target.value })} />
                </label>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}
