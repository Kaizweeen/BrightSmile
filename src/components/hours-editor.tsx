"use client";

import { useId } from "react";
import type { OperatingHours } from "@/db/schema";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/hours";

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/**
 * One row per weekday: open or closed, and the opening and closing times on the 15-minute grid. `errors` is keyed by
 * day ("0" Sunday to "6" Saturday), each shown under its own day and tied to that day's times; "" holds an error about
 * the week as a whole.
 */
export function HoursEditor({
  value,
  onChange,
  errors = {},
}: {
  value: OperatingHours;
  onChange: (hours: OperatingHours) => void;
  errors?: Record<string, string>;
}) {
  const id = useId();
  return (
    <fieldset className="grid gap-2" aria-describedby={errors[""] ? `${id}-week` : undefined}>
      <legend className="mb-1 text-sm font-medium">Opening hours</legend>
      {MONDAY_FIRST.map((day) => {
        const today = value[String(day)];
        const set = (next: { open: string; close: string } | null) => onChange({ ...value, [String(day)]: next });
        const error = errors[String(day)];
        const errorId = error ? `${id}-${day}` : undefined;
        return (
          <div key={day} className="flex flex-wrap items-end gap-x-3 gap-y-1 rounded-lg border bg-muted/40 p-2">
            <label className="flex min-h-11 w-40 items-center gap-2 sm:min-h-9">
              <input type="checkbox" checked={today !== null} onChange={(event) => set(event.target.checked ? { open: "09:00", close: "18:00" } : null)} className="size-4 accent-primary" />
              <span className="font-medium">{WEEKDAYS[day]}</span>
            </label>
            {today ? (
              <>
                <label className="grid gap-1 text-sm">
                  Opens
                  <Input
                    type="time"
                    step={900}
                    aria-label={`${WEEKDAYS[day]} opens`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={errorId}
                    value={today.open}
                    onChange={(event) => set({ ...today, open: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Closes
                  <Input
                    type="time"
                    step={900}
                    aria-label={`${WEEKDAYS[day]} closes`}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={errorId}
                    value={today.close}
                    onChange={(event) => set({ ...today, close: event.target.value })}
                  />
                </label>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
            {error && (
              <p id={errorId} className="w-full text-sm text-destructive">
                {`${WEEKDAYS[day]}: ${error}`}
              </p>
            )}
          </div>
        );
      })}
      {errors[""] && (
        <p id={`${id}-week`} className="text-sm text-destructive">
          {errors[""]}
        </p>
      )}
    </fieldset>
  );
}
