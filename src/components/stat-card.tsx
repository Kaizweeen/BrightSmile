import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One number with its label: a day's takings, chairs in use, visits waiting. */
export function StatCard({ label, value, hint, icon: Icon, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-xl border bg-card p-4 shadow-xs", className)}>
      <div className="grid gap-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="font-heading text-2xl leading-none font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
      )}
    </div>
  );
}
