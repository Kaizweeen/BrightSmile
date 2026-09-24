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
 * The month as Planorama's mini calendar: circular days, purple for the one
 * you chose, an outline on today. Days with nothing open are struck through
 * and say why in their accessible name, so the mark never rests on color.
 */
export default function MonthSheet({ month, today, lastBookable, openDates, selected, onSelect, onMonth }: Props) {
  const dates = monthDates(month);
  const open = new Set(openDates);
  const blanks = weekday(dates[0]);
  const canGoBack = month > today.slice(0, 7);
  const canGoForward = month < lastBookable.slice(0, 7);

  const cells: (string | null)[] = [...Array.from({ length: blanks }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <section aria-label="Choose a day">
      <div className="mini-head">
        <p className="m font-display">{monthLabel(month)}</p>
        <div className="mini-nav">
          <button type="button" onClick={() => onMonth(-1)} disabled={!canGoBack} aria-label="Previous month">
            <span aria-hidden="true">&#8249;</span>
          </button>
          <button type="button" onClick={() => onMonth(1)} disabled={!canGoForward} aria-label="Next month">
            <span aria-hidden="true">&#8250;</span>
          </button>
        </div>
      </div>

      <table className="mini-cal">
        <caption className="sr-only">{`Days in ${monthLabel(month)}. Days with no openings are struck through.`}</caption>
        <thead>
          <tr>
            {DAY_HEADS.map((head) => (
              <th key={head} scope="col">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((date, j) =>
                date === null ? (
                  <td key={`blank-${i}-${j}`} />
                ) : (
                  <td key={date}>
                    <button
                      type="button"
                      disabled={!open.has(date)}
                      aria-pressed={date === selected}
                      aria-label={dayLabel(date, month, open.has(date), today, lastBookable)}
                      onClick={() => onSelect(date)}
                      className={[
                        "mini-day",
                        date === selected ? "sel" : "",
                        date === today && date !== selected ? "today" : "",
                        open.has(date) ? "" : date >= today && date <= lastBookable ? "off" : "muted",
                      ].join(" ")}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="legend">
        <span className="key">
          <span aria-hidden="true" className="dot" style={{ background: "var(--primary)" }} />
          Chosen
        </span>
        <span className="key">
          <span
            aria-hidden="true"
            className="dot"
            style={{ background: "#fff", border: "2px solid var(--primary-mid)", width: 11, height: 11 }}
          />
          Today
        </span>
        <span className="key">
          <span aria-hidden="true" style={{ width: 14, borderTop: "2px solid var(--text-3)" }} />
          Closed or full
        </span>
      </div>

      <p className="sr-only">{`${openDates.length} days are open in ${monthLabel(month)}.`}</p>

      {openDates.length === 0 && (
        <p className="note-box mt-3">
          Nothing open in {monthLabel(month)}.{" "}
          {canGoForward ? (
            <button type="button" onClick={() => onMonth(1)} className="link">
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

function dayLabel(date: string, month: string, isOpen: boolean, today: string, lastBookable: string) {
  const day = Number(date.slice(8));
  const monthName = monthLabel(month).split(" ")[0];
  const why = date < today ? "past" : date > lastBookable ? "too far ahead" : weekday(date) === 0 ? "closed" : "fully booked";
  const parts = [`${DAY_NAMES[weekday(date)]}, ${monthName} ${day}`];
  if (!isOpen) parts.push(why);
  if (date === today) parts.push("today");
  return parts.join(", ");
}
