import { addDays, manilaDate, manilaInstant } from "@/lib/time";

export type Status = "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show" | "expired";
export type Actor = "patient" | "staff" | "system";

// Spec section 9.2. Key is "from>to"; value is who may make that change.
// "confirmed>confirmed" is the moved row: status stays confirmed, only the time or
// dentist changes. Task 12's public.move_appointment writes its own event directly
// and does not call canTransition, so this entry exists for any other caller (for
// example, deciding whether to show a Move action) that wants the spec 9.2 answer.
const ALLOWED: Record<string, Actor[]> = {
  "pending>confirmed": ["staff"],
  "pending>declined": ["staff"],
  "pending>cancelled": ["patient"],
  "pending>expired": ["system"],
  "confirmed>confirmed": ["staff"],
  "confirmed>cancelled": ["staff", "patient"],
  "confirmed>completed": ["staff"],
  "confirmed>no_show": ["staff"],
  "completed>no_show": ["staff"],
  "no_show>completed": ["staff"],
};

export function canTransition(from: Status, to: Status, actor: Actor): boolean {
  return ALLOWED[`${from}>${to}`]?.includes(actor) ?? false;
}

/** The patient's view/cancel link offers Cancel only for future pending or confirmed visits. */
export function isCancellable(a: { status: Status; starts_at: Date }, now: Date): boolean {
  return (a.status === "pending" || a.status === "confirmed") && a.starts_at > now;
}

/** Completed and No-show can be set once the visit has started, and switched to fix mistakes. */
export function canMarkAttendance(a: { status: Status; starts_at: Date }, now: Date): boolean {
  return ["confirmed", "completed", "no_show"].includes(a.status) && a.starts_at <= now;
}

/** Spec section 11: tomorrow's confirmed visits, not yet reminded, confirmed before today (Manila dates). */
export function needsReminder(
  a: { status: Status; starts_at: Date; confirmed_at: Date | null; reminder_sent_at: Date | null },
  now: Date,
): boolean {
  const today = manilaDate(now);
  return (
    a.status === "confirmed" &&
    a.reminder_sent_at === null &&
    a.confirmed_at !== null &&
    manilaDate(a.starts_at) === addDays(today, 1) &&
    a.confirmed_at < manilaInstant(today, 0)
  );
}
