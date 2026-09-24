// Manila is UTC+8 all year with no daylight saving, so a fixed offset is exact.
const OFFSET_MS = 8 * 60 * 60_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** The instant of a Manila wall-clock time: a "YYYY-MM-DD" date plus minutes after midnight. */
export function manilaInstant(date: string, minutes: number): Date {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - OFFSET_MS);
}

/** The Manila calendar date ("YYYY-MM-DD") of an instant. */
export function manilaDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes after Manila midnight of an instant. */
export function manilaMinutes(instant: Date): number {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "09:00" or Postgres "09:00:00" to minutes after midnight. */
export function parseClock(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes after midnight to "HH:MM", the format of time inputs and Postgres. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "Thu Sep 24". Built by hand because Intl output varies by runtime and can contain non-ASCII spaces. */
export function formatDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return `${DAYS[shifted.getUTCDay()]} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}`;
}

/** "10:00 AM". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function formatTime(instant: Date): string {
  return formatMinutes(manilaMinutes(instant));
}

/** Every date of a "YYYY-MM" month. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
