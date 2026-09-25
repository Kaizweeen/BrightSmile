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
  /** True while the server is working out this month's open days. */
  loading: boolean;
  /** Weekdays (0 Sunday) the chosen dentist doesn't work, so their days read "closed", not "fully booked". */
  closedWeekdays: number[];
  /** True when today has no slot left only because the day's hours or minimum notice have passed, not because every slot is taken. */
  todayOutOfTime: boolean;
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (delta: number) => void;
};

function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/**
 * The month as a mini calendar: circular days, the primary colour for the one you chose, an outline
 * on today. Days with nothing open are struck through and say why in their accessible name, so the
 * mark never rests on colour. While the month loads, every day is muted and unpickable.
 */
export default function MonthSheet({
  month,
  today,
  lastBookable,
  openDates,
  loading,
  closedWeekdays,
  todayOutOfTime,
  selected,
  onSelect,
  onMonth,
}: Props) {
  const dates = monthDates(month);
  const open = new Set(openDates);
  const blanks = weekday(dates[0]);
  const canGoBack = month > today.slice(0, 7);
  const canGoForward = month < lastBookable.slice(0, 7);

  const cells: (string | null)[] = [...Array.from({ length: blanks }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <section aria-label="Choose a day" aria-busy={loading}>
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
                      disabled={loading || !open.has(date)}
                      aria-pressed={date === selected}
                      aria-label={dayLabel(date, month, open.has(date), loading, today, lastBookable, closedWeekdays, todayOutOfTime)}
                      onClick={() => onSelect(date)}
                      className={[
                        "mini-day",
                        date === selected ? "sel" : "",
                        date === today && date !== selected ? "today" : "",
                        loading ? "muted" : open.has(date) ? "" : date >= today && date <= lastBookable ? "off" : "muted",
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

      {loading ? (
        <p className="empty-note mt-3" aria-live="polite">
          Checking openings...
        </p>
      ) : (
        <p className="sr-only" aria-live="polite">{`${openDates.length} days are open in ${monthLabel(month)}.`}</p>
      )}

      {!loading && openDates.length === 0 && (
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

function dayLabel(
  date: string,
  month: string,
  isOpen: boolean,
  loading: boolean,
  today: string,
  lastBookable: string,
  closedWeekdays: number[],
  todayOutOfTime: boolean,
) {
  const day = Number(date.slice(8));
  const monthName = monthLabel(month).split(" ")[0];
  const why =
    date < today
      ? "past"
      : date > lastBookable
        ? "too far ahead"
        : closedWeekdays.includes(weekday(date))
          ? "closed"
          : date === today && todayOutOfTime
            ? "no more openings today"
            : "fully booked";
  const parts = [`${DAY_NAMES[weekday(date)]}, ${monthName} ${day}`];
  if (!isOpen && !loading) parts.push(why);
  if (date === today) parts.push("today");
  return parts.join(", ");
}
