import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows while a list loads. Announced once as "Loading" instead of reading every block. */
export function LoadingRows({ rows = 5, label = "Loading..." }: { rows?: number; label?: string }) {
  return (
    <div role="status" className="grid gap-2 rounded-xl border bg-card p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
