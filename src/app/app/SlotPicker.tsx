"use client";

import { useRef, useState } from "react";
import Field from "@/components/Field";
import { formatTime, manilaInstant, parseClock } from "@/lib/time";
import { openTimes } from "./actions";

export type Slot = { dentistId: string; startsAt: string; custom: boolean };

type Props = {
  dentists: { id: string; name: string }[];
  duration: number;
  today: string;
  initialDentistId?: string;
  ignoreId?: string;
  onChange: (slot: Slot | null) => void;
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Dentist, date, then an open time or a custom time (spec 5.3). The parent remounts it (key) when the
 * duration changes, so nothing here reacts to props in an effect.
 */
export default function SlotPicker({ dentists, duration, today, initialDentistId, ignoreId, onChange }: Props) {
  const [dentistId, setDentistId] = useState(initialDentistId ?? dentists[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [starts, setStarts] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [clock, setClock] = useState("");
  const loads = useRef(0);

  function choose(slot: Slot | null) {
    setPicked(slot && !slot.custom ? slot.startsAt : null);
    onChange(slot);
  }

  async function load(nextDentist: string, nextDate: string) {
    const n = ++loads.current; // drop any answer still in flight for an older choice
    setStarts(null);
    setClock("");
    choose(null);
    if (!nextDentist || !nextDate) return;
    try {
      const list = await openTimes({ dentistId: nextDentist, date: nextDate, duration, ignoreId });
      if (n === loads.current) setStarts(list);
    } catch {
      if (n === loads.current) setStarts([]);
    }
  }

  function setCustomClock(value: string) {
    setClock(value);
    choose(CLOCK.test(value) && date ? { dentistId, startsAt: manilaInstant(date, parseClock(value)).toISOString(), custom: true } : null);
  }

  return (
    <fieldset>
      <legend className="sr-only">Time</legend>
      {dentists.length > 1 && (
        <label className="block">
          <span className="f-label">Dentist</span>
          <select
            className="f-input"
            value={dentistId}
            onChange={(e) => {
              setDentistId(e.target.value);
              void load(e.target.value, date);
            }}
          >
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block">
        <span className="f-label">Date</span>
        <input
          type="date"
          className="f-input"
          min={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            void load(dentistId, e.target.value);
          }}
        />
      </label>

      {date && !custom && (
        <div className="mt-4" aria-live="polite">
          {starts === null && <p className="f-hint">Finding open times...</p>}
          {starts?.length === 0 && <p className="f-hint">No open times on this day. Try another day, or use a custom time.</p>}
          {starts && starts.length > 0 && (
            <div className="slot-grid" role="radiogroup" aria-label="Open times">
              {starts.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={picked === iso}
                  className={`slot${picked === iso ? " sel" : ""}`}
                  onClick={() => choose({ dentistId, startsAt: iso, custom: false })}
                >
                  {formatTime(new Date(iso))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {date && (
        <label className="member-row mt-3">
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => {
              setCustom(e.target.checked);
              setClock("");
              choose(null);
            }}
          />
          <span className="nm">Use a custom time</span>
        </label>
      )}

      {date && custom && (
        <Field label="Start time" hint="A custom time may be outside working hours. It can never overlap another visit.">
          <input type="time" step={300} className="f-input" value={clock} onChange={(e) => setCustomClock(e.target.value)} />
        </Field>
      )}
    </fieldset>
  );
}
