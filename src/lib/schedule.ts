import type { Status } from "@/lib/appointments";

export type StaffAction = "approve" | "decline" | "move" | "cancel" | "completed" | "no_show";

/** Every status carries a word, never colour alone. */
export const STATUS_LABEL: Record<Status, { word: string; chip: string }> = {
  pending: { word: "Pending", chip: "chip-amber" },
  confirmed: { word: "Confirmed", chip: "chip-green" },
  declined: { word: "Declined", chip: "chip-red" },
  cancelled: { word: "Cancelled", chip: "chip-red" },
  completed: { word: "Completed", chip: "chip-blue" },
  no_show: { word: "No-show", chip: "chip-red" },
  expired: { word: "Expired", chip: "chip-gold" },
};

/**
 * The buttons an appointment offers staff (spec 5.3 and 9.2). Matches what changeStatus and
 * moveAppointment accept, so a button never leads to a refusal unless something changed meanwhile.
 */
export function actionsFor(status: Status, startsAt: Date, now: Date): StaffAction[] {
  const started = startsAt <= now;
  switch (status) {
    case "pending":
      return started ? ["decline"] : ["approve", "decline"];
    case "confirmed":
      return started ? ["completed", "no_show"] : ["move", "cancel"];
    case "completed":
      return ["no_show"];
    case "no_show":
      return ["completed"];
    default:
      return [];
  }
}
