/** How far ahead patients can book online, in days after today (online booking spec, section 3). */
export const BOOKING_DAYS = 30;

/** How soon an online booking can start (online booking spec, section 6.3). */
export const NOTICE_MS = 2 * 3_600_000;

/**
 * Online booking spec 6.4: among the dentists free at a start, the one with the fewest visits that day; a tie goes to the
 * name that sorts first, then the lower id.
 */
export function chooseDentist<D extends { id: string; name: string }>(free: readonly D[], visitsThatDay: ReadonlyMap<string, number>): D | undefined {
  return [...free].sort(
    (a, b) =>
      (visitsThatDay.get(a.id) ?? 0) - (visitsThatDay.get(b.id) ?? 0) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}
