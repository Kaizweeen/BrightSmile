import { TriangleAlert } from "lucide-react";

/** The red banner of allergies and medical alerts at the top of a patient or visit. Nothing when there are none. */
export function AlertBanner({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="note" aria-label="Allergies and medical alerts" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <ul className="grid gap-0.5 font-medium">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
