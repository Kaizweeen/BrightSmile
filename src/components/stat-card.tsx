import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One number with its label: a day's takings, chairs in use, visits waiting. A light green tile with bold text. */
export function StatCard({ label, value, hint, icon: Icon, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-accent p-4 shadow-xs", className)}>
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="font-heading text-2xl leading-none font-bold tabular-nums">{value}</p>
        {hint && <p className="text-xs font-semibold text-muted-foreground">{hint}</p>}
      </div>
      {Icon && (
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-primary shadow-xs">
          <Icon className="size-5" />
        </span>
      )}
    </div>
  );
}
