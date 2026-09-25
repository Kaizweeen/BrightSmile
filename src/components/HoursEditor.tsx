"use client";

import type { Clock } from "@/lib/onboarding";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekly working hours with several blocks per day (spec 5.3 and 5.4). Used by onboarding and Settings. */
export default function HoursEditor({ hours, onChange, error }: { hours: Clock[][]; onChange: (hours: Clock[][]) => void; error?: string }) {
  function setDay(day: number, blocks: Clock[]) {
    onChange(hours.map((b, d) => (d === day ? blocks : b)));
  }

  return (
    <fieldset className="mt-5">
      <legend className="f-label">Working hours</legend>
      {hours.map((blocks, day) => (
        <div key={day} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="font-semibold">
            {DAYS[day]}
            {blocks.length === 0 && <span className="meta"> (closed)</span>}
          </p>
          {blocks.map((b, k) => (
            <div key={k} className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input
                type="time"
                step={900}
                className="f-input"
                aria-label={`${DAYS[day]}, block ${k + 1}, starts`}
                value={b.start}
                onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)))}
              />
              <span className="meta">to</span>
              <input
                type="time"
                step={900}
                className="f-input"
                aria-label={`${DAYS[day]}, block ${k + 1}, ends`}
                value={b.end}
                onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)))}
              />
            </div>
          ))}
          <div className="flex gap-5">
            <button
              type="button"
              className="link py-3"
              onClick={() => setDay(day, [...blocks, blocks.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "17:00" }])}
            >
              Add hours
            </button>
            {blocks.length > 0 && (
              <button type="button" className="link py-3" onClick={() => setDay(day, blocks.slice(0, -1))}>
                {blocks.length === 1 ? "Mark closed" : "Remove last"}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <p className="field-err">{error}</p>}
    </fieldset>
  );
}
