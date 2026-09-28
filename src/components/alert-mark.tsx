import { TriangleAlert } from "lucide-react";

/** The small red mark on a card whose patient has allergies or medical alerts. */
export function AlertMark({ label = "Alerts" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      <TriangleAlert aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
