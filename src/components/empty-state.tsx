import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** What to show where a list would be: a short sentence, and the one thing to do next if there is one. */
export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-10 text-center", className)}>
      {Icon && (
        <span aria-hidden className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
