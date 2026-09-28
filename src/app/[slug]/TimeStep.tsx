"use client";

import { startTransition, useEffect, useState } from "react";
import MonthSheet from "./MonthSheet";
import { getOpenDates, getOpenStarts } from "./actions";
import type { PublicDentist } from "@/lib/booking-input";
import { openStarts, type BookingRules } from "@/lib/slots";
import { addDays, formatDate, formatTime, manilaDate, weekday } from "@/lib/time";

type Props = {
  slug: string;
  /** What the server checks the times for: the branch (or the appointment being changed), the dentist, and the services. The caller memoizes it. */
  selection: object;
  dentist: PublicDentist;
  duration: number;
  rules: BookingRules;
  nowIso: string;
  /** The day to open on: the chosen time's, or a time that was just taken. Null opens this month. */
  initialDate: string | null;
  /** The time chosen earlier, shown picked while it is still open. */
  initialStart: string | null;
  onPick: (startsAt: string) => void;
  onBack: () => void;
};

/**
 * Date and time (booking flow spec 3.3 step 6, 3.4 step 3): the month calendar and one day's open times for the dentist
 * at the selection's branch. The server answers dates and times only, never busy times. Each load belongs to the month
 * or day that asked for it, so a late answer for an earlier choice is dropped. Loads run in a transition, as Next's
 * docs call Server Functions from an effect.
 */
export default function TimeStep({ slug, selection, dentist, duration, rules, nowIso, initialDate, initialStart, onPick, onBack }: Props) {
  const now = new Date(nowIso);
  const today = manilaDate(now);
  const [month, setMonth] = useState((initialDate ?? today).slice(0, 7));
  const [monthOpen, setMonthOpen] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(initialDate);
  const [starts, setStarts] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(initialStart ? new Date(initialStart).toISOString() : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      try {
        const open = await getOpenDates(slug, selection, month);
        if (live) setMonthOpen(open);
      } catch {
        if (live) {
          setMonthOpen([]);
          setFailed(true);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [slug, selection, month]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    startTransition(async () => {
      try {
        const list = await getOpenStarts(slug, selection, date);
        if (live) setStarts(list);
      } catch {
        if (live) {
          setStarts([]);
          setFailed(true);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [slug, selection, date]);

  const lastBookable = addDays(today, rules.maxDaysAhead);
  const closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => dentist.hours[d].length === 0);
  // Ignoring bookings: would any time today still fit before the hours or the minimum notice run out?
  const todayOutOfTime = openStarts({ date: today, blocks: dentist.hours[weekday(today)], busy: [], durationMinutes: duration, rules, now }).length === 0;
  const chosen = picked && starts?.includes(picked) ? picked : null;

  function chooseDay(day: string) {
    setDate(day);
    setStarts(null);
    setPicked(null);
  }

  function changeMonth(delta: number) {
    setMonth(addDays(`${month}-01`, delta > 0 ? 31 : -1).slice(0, 7));
    setMonthOpen(null);
    setDate(null);
    setStarts(null);
    setPicked(null);
  }

  return (
    <>
      {failed && (
        <p role="alert" className="note-box warn mb-4">
          Times are not loading right now. Please try again in a few minutes.
        </p>
      )}
      <MonthSheet
        month={month}
        today={today}
        lastBookable={lastBookable}
        openDates={monthOpen ?? []}
        loading={monthOpen === null}
        closedWeekdays={closedWeekdays}
        todayOutOfTime={todayOutOfTime}
        selected={date}
        onSelect={chooseDay}
        onMonth={changeMonth}
      />

      {date && (
        <div className="screen-in mt-6">
          <div className="mini-head">
            <p className="m font-display">{formatDate(new Date(`${date}T00:00:00+08:00`))}</p>
            {starts && (
              <span className="chip chip-brand">
                {starts.length} {starts.length === 1 ? "opening" : "openings"}
              </span>
            )}
          </div>
          {starts === null ? (
            <p className="empty-note" aria-live="polite">
              Checking times...
            </p>
          ) : starts.length === 0 ? (
            <p className="empty-note">Nothing left on this day.</p>
          ) : (
            <div className="slot-grid">
              {starts.map((iso) => (
                <button key={iso} type="button" onClick={() => setPicked(iso)} aria-pressed={iso === chosen} className={`slot ${iso === chosen ? "sel" : ""}`}>
                  {formatTime(new Date(iso))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary flex-1" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
          {chosen ? `Take ${formatTime(new Date(chosen))}` : "Pick a time"}
        </button>
      </div>
    </>
  );
}
