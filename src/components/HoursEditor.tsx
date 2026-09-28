"use client";

import type { Clock } from "@/lib/onboarding";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A working block, and the branch it is at (booking flow spec 4). Onboarding's blocks name none. */
export type HourBlock = Clock & { branchId?: string };

/**
 * Weekly working hours with several blocks per day (spec 5.3 and 5.4). Used by onboarding and Settings. Given 2 or more
 * branches, each block also says which branch it is at (booking flow spec 4); a new block starts at the branch of the
 * block before it.
 */
export default function HoursEditor({
  hours,
  onChange,
  error,
  branches = [],
}: {
  hours: HourBlock[][];
  onChange: (hours: HourBlock[][]) => void;
  error?: string;
  branches?: { id: string; name: string }[];
}) {
  const many = branches.length > 1;
  function setDay(day: number, blocks: HourBlock[]) {
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
            <div key={k} className="mt-2">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
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
              {many && (
                <select
                  className="f-input mt-2"
                  aria-label={`${DAYS[day]}, block ${k + 1}, branch`}
                  value={b.branchId ?? branches[0].id}
                  onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, branchId: e.target.value } : x)))}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <div className="flex gap-5">
            <button
              type="button"
              className="link py-3"
              onClick={() => {
                const next: HourBlock = blocks.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "17:00" };
                setDay(day, [...blocks, many ? { ...next, branchId: blocks.at(-1)?.branchId ?? branches[0].id } : next]);
              }}
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
