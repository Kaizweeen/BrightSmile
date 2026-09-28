import type { Action } from "./permissions";
import { manilaDate } from "./time";

/** The visit statuses, in lifecycle order. The database's check constraint lists the same seven. */
export const STATUSES = ["requested", "confirmed", "checked_in", "in_treatment", "completed", "no_show", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses that hold time; the exclusion constraints use the same four. */
export const ACTIVE: readonly Status[] = ["requested", "confirmed", "checked_in", "in_treatment"];

/** Spec 8.6. The database trigger refuses every other change. */
export const NEXT: Record<Status, readonly Status[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["in_treatment", "cancelled", "confirmed"],
  in_treatment: ["completed"],
  no_show: ["checked_in"],
  completed: [],
  cancelled: [],
};

export const STATUS_LABEL: Record<Status, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_treatment: "In treatment",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

const ACTION_LABEL: Record<Status, string> = {
  requested: "Mark requested",
  confirmed: "Confirm",
  checked_in: "Check in",
  in_treatment: "Start treatment",
  completed: "Complete",
  no_show: "Mark no-show",
  cancelled: "Cancel visit",
};

/** The words on the button that makes a change. */
export function actionLabel(from: Status, to: Status): string {
  if (from === "checked_in" && to === "confirmed") return "Undo check-in";
  if (from === "no_show" && to === "checked_in") return "Arrived late: check in";
  return ACTION_LABEL[to];
}

/** Dentists start and complete their own visits; every other change is the front desk's (spec section 5). */
export function actionFor(to: Status): Action {
  return to === "in_treatment" || to === "completed" ? "appointment.treat" : "appointment.manage";
}

/** Why a change is refused, or null: the allowed pairs, then spec 8.6's date and time rules. */
export function changeProblem(from: Status, to: Status, start: Date, now: Date): string | null {
  if (!NEXT[from].includes(to)) {
    return `A ${STATUS_LABEL[from].toLowerCase()} visit cannot become ${STATUS_LABEL[to].toLowerCase()}.`;
  }
  if (to === "checked_in" && manilaDate(start) !== manilaDate(now)) return "Check in on the day of the visit.";
  if (to === "no_show" && now < start) return "A visit becomes a no-show only after its start time.";
  return null;
}
