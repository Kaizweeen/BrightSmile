"use client";

import { addDays, monthDates, weekday } from "@/lib/time";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  month: string;
  today: string;
  lastBookable: string;
  openDates: string[];
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (delta: number) => void;
};

function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/**
 * The month as a printed calendar sheet. Closed and full days are struck
 * through in red and say so in their accessible name, so the mark never
 * depends on color alone.
 */
export default function MonthSheet({ month, today, lastBookable, openDates, selected, onSelect, onMonth }: Props) {
  const dates = monthDates(month);
  const open = new Set(openDates);
  const blanks = weekday(dates[0]);
  const canGoBack = month > today.slice(0, 7);
  const canGoForward = month < lastBookable.slice(0, 7);

  return (
    <section aria-label="Choose a day">
      <header className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <button
          type="button"
          onClick={() => onMonth(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="grid size-11 place-items-center border border-line text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pending disabled:opacity-30"
        >
          <span aria-hidden="true">&#8592;</span>
        </button>
        <h3 className="display-type text-xl" aria-live="polite">
          {monthLabel(month)}
        </h3>
        <button
          type="button"
          onClick={() => onMonth(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className="grid size-11 place-items-center border border-line text-ink transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pending disabled:opacity-30"
        >
          <span aria-hidden="true">&#8594;</span>
        </button>
      </header>

      <div className="mt-3 grid grid-cols-7 gap-px" role="group" aria-label={`Days in ${monthLabel(month)}`}>
        {DAY_HEADS.map((head, i) => (
          <div key={head} className={`label-type pb-2 text-center ${i === 0 ? "text-danger" : "text-muted"}`}>
            {head}
          </div>
        ))}

        {Array.from({ length: blanks }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}

        {dates.map((date) => {
          const day = Number(date.slice(8));
          const isOpen = open.has(date);
          const isSunday = weekday(date) === 0;
          const isToday = date === today;
          const isSelected = date === selected;
          const beyond = date > lastBookable;
          const past = date < today;
          const why = past ? "past" : beyond ? "too far ahead" : isSunday ? "closed" : "fully booked";

          return (
            <button
              key={date}
              type="button"
              disabled={!isOpen}
              aria-pressed={isSelected}
              aria-label={`${DAY_NAMES[weekday(date)]}, ${monthLabel(month).split(" ")[0]} ${day}${isOpen ? "" : `, ${why}`}${isToday ? ", today" : ""}`}
              onClick={() => onSelect(date)}
              className={[
                "relative grid h-12 place-items-center border border-line text-base transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pending",
                isSelected ? "bg-ink text-surface" : "bg-surface",
                isOpen ? "hover:bg-canvas" : "cursor-not-allowed text-danger/70 line-through",
                !isOpen && !isSunday ? "text-muted line-through" : "",
                isToday && !isSelected ? "ring-2 ring-pending ring-offset-0" : "",
              ].join(" ")}
            >
              <span className={isSelected ? "display-type" : isSunday && isOpen ? "text-danger" : ""}>{day}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 border-2 border-pending" />
          Today
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-3 bg-ink" />
          Chosen
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block w-3 border-t-2 border-danger" />
          Closed or full
        </span>
      </p>
      <p className="sr-only">{`${openDates.length} days are open in ${monthLabel(month)}.`}</p>
      {openDates.length === 0 && (
        <p className="mt-4 border border-line bg-canvas p-4 text-sm">
          Nothing open in {monthLabel(month)}.{" "}
          {canGoForward ? (
            <button type="button" onClick={() => onMonth(1)} className="text-pending underline underline-offset-2">
              Try {monthLabel(addDays(`${month}-01`, 31).slice(0, 7))}
            </button>
          ) : (
            "Try a shorter visit, or call the clinic."
          )}
        </p>
      )}
    </section>
  );
}
