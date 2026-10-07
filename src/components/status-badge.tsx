import { Ban, CalendarCheck, CircleCheck, Clock, Stethoscope, UserCheck, UserX } from "lucide-react";
import { STATUS_LABEL, type Status } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

// The colours are tokens in globals.css (--status-*), each a tinted chip with text that clears 4.5:1 in both themes.
// Class names are written out in full so Tailwind can see them.
const LOOK: Record<Status, { icon: typeof Clock; tone: string; bar: string }> = {
  requested: { icon: Clock, tone: "bg-(--status-requested-bg) text-(--status-requested-fg)", bar: "bg-(--status-requested-bar)" },
  confirmed: { icon: CalendarCheck, tone: "bg-(--status-confirmed-bg) text-(--status-confirmed-fg)", bar: "bg-(--status-confirmed-bar)" },
  checked_in: { icon: UserCheck, tone: "bg-(--status-checked_in-bg) text-(--status-checked_in-fg)", bar: "bg-(--status-checked_in-bar)" },
  in_treatment: { icon: Stethoscope, tone: "bg-(--status-in_treatment-bg) text-(--status-in_treatment-fg)", bar: "bg-(--status-in_treatment-bar)" },
  completed: { icon: CircleCheck, tone: "bg-(--status-completed-bg) text-(--status-completed-fg)", bar: "bg-(--status-completed-bar)" },
  no_show: { icon: UserX, tone: "bg-(--status-no_show-bg) text-(--status-no_show-fg)", bar: "bg-(--status-no_show-bar)" },
  cancelled: { icon: Ban, tone: "bg-(--status-cancelled-bg) text-(--status-cancelled-fg)", bar: "bg-(--status-cancelled-bar)" },
};

/** The solid colour that marks a status on a calendar card's edge (the word and icon still say it too). */
export const statusBar = (status: Status) => LOOK[status].bar;

/** A visit's status as a word and an icon (spec section 10: never colour alone), and "Online" for an online booking. */
export function StatusBadge({ status, online = false, className }: { status: Status; online?: boolean; className?: string }) {
  const { icon: Icon, tone } = LOOK[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      <span>{STATUS_LABEL[status]}</span>
      {online && <span>· Online</span>}
    </span>
  );
}
