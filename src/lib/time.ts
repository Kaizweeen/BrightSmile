/** Manila is UTC+8 all year (no daylight saving), so date math uses a fixed offset; display uses Intl. */
export const ZONE = "Asia/Manila";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the Manila calendar day that contains this instant. */
export function manilaDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since Manila midnight for this instant. */
export function manilaMinutes(instant: Date): number {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The instant at a number of minutes after midnight on a Manila date. */
export function manilaInstant(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS + minutes * 60_000);
}

/** 0 Sunday to 6 Saturday, for a "YYYY-MM-DD" date. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "HH:MM" or "HH:MM:SS" to minutes since midnight. */
export function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:MM". */
export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Reads an <input type="datetime-local"> value ("YYYY-MM-DDTHH:MM") as Manila time. */
export function fromManilaLocal(value: string): Date {
  const [date, clock] = value.split("T");
  return manilaInstant(date, toMinutes(clock));
}

/** Formats an instant for an <input type="datetime-local">, in Manila time. */
export function toManilaLocal(instant: Date): string {
  return `${manilaDate(instant)}T${fromMinutes(manilaMinutes(instant))}`;
}

const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "9:30 AM", Manila time. */
export function formatTime(instant: Date): string {
  return timeFormat.format(instant);
}

/** "Mon, Oct 5, 2026", Manila time. */
export function formatDate(instant: Date): string {
  return dateFormat.format(instant);
}

/** A "YYYY-MM-DD" Manila date, formatted like formatDate. */
export function formatDay(date: string): string {
  return dateFormat.format(manilaInstant(date, 12 * 60));
}

/** "Mon, Oct 5, 2026, 9:30 AM", Manila time. */
export function formatDateTime(instant: Date): string {
  return `${formatDate(instant)}, ${formatTime(instant)}`;
}

/** A length in words: "45 minutes", "1 hour", "1 hour 30 minutes". */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`, rest === 0 ? "" : `${rest} minutes`].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 minutes";
}
