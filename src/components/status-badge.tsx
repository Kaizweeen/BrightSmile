import { Ban, CalendarCheck, CircleCheck, Clock, Stethoscope, UserCheck, UserX } from "lucide-react";
import { STATUS_LABEL, type Status } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

const LOOK: Record<Status, { icon: typeof Clock; tone: string }> = {
  requested: { icon: Clock, tone: "bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-100" },
  confirmed: { icon: CalendarCheck, tone: "bg-sky-100 text-sky-950 dark:bg-sky-400/20 dark:text-sky-100" },
  checked_in: { icon: UserCheck, tone: "bg-violet-100 text-violet-950 dark:bg-violet-400/20 dark:text-violet-100" },
  in_treatment: { icon: Stethoscope, tone: "bg-teal-100 text-teal-950 dark:bg-teal-400/20 dark:text-teal-100" },
  completed: { icon: CircleCheck, tone: "bg-emerald-100 text-emerald-950 dark:bg-emerald-400/20 dark:text-emerald-100" },
  no_show: { icon: UserX, tone: "bg-rose-100 text-rose-950 dark:bg-rose-400/20 dark:text-rose-100" },
  cancelled: { icon: Ban, tone: "bg-zinc-200 text-zinc-900 dark:bg-zinc-400/20 dark:text-zinc-100" },
};

/** A visit's status as a word and an icon (spec section 10: never colour alone), and "Online" for an online booking. */
export function StatusBadge({ status, online = false, className }: { status: Status; online?: boolean; className?: string }) {
  const { icon: Icon, tone } = LOOK[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      <span>{STATUS_LABEL[status]}</span>
      {online && <span>· Online</span>}
    </span>
  );
}
