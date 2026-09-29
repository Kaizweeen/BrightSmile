"use client";

import { boxCodes, CHART_ROWS, codeInfo, describeTooth, toothSides, toothState, type EntryLike, type Surface } from "@/lib/chart";
import { cn } from "@/lib/utils";

/** GET /patients/{id}/chart: one entry, voided ones included. */
export type ChartEntryJson = EntryLike & {
  id: string;
  tooth: number;
  note: string;
  authorId: string;
  authorName: string;
  appointmentId: string | null;
  visitStart: string | null;
  branchName: string | null;
  voidedByName: string | null;
  voidReason: string | null;
};

// A tooth's circle (viewBox 0 0 40 40): a centre of radius 8 and a ring to radius 18 cut into four sides.
const OUTER = 18;
const INNER = 8;
const at = (radius: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return `${(20 + radius * Math.cos(a)).toFixed(2)} ${(20 + radius * Math.sin(a)).toFixed(2)}`;
};
const side = (from: number, to: number) =>
  `M ${at(OUTER, from)} A ${OUTER} ${OUTER} 0 0 1 ${at(OUTER, to)} L ${at(INNER, to)} A ${INNER} ${INNER} 0 0 0 ${at(INNER, from)} Z`;
const SIDES = { top: side(225, 315), right: side(315, 405), bottom: side(45, 135), left: side(135, 225) } as const;

const ROW_NAMES = ["Upper temporary teeth", "Upper permanent teeth", "Lower permanent teeth", "Lower temporary teeth"];

/** A surface's fill: decay red, restorations blue, missing or extracted grey. The code box carries the words. */
function fill(code: string | undefined): string {
  if (code === "D") return "fill-red-500/70";
  if (code === "M" || code === "MO" || code === "X" || code === "XO") return "fill-zinc-400 dark:fill-zinc-600";
  if (code && codeInfo(code)?.group === "Restorations and prosthetics") return "fill-sky-500/70";
  return "fill-background";
}

function Tooth({ tooth, upper, state, selected, onPick }: { tooth: number; upper: boolean; state: Partial<Record<Surface, string>>; selected: boolean; onPick: (tooth: number) => void }) {
  const sides = toothSides(tooth);
  const box = (
    <span className="flex min-h-6 w-full flex-wrap items-center justify-center gap-0.5 rounded-sm border px-0.5 text-[11px] leading-tight font-medium">
      {boxCodes(state).map((code) => (
        <span key={code}>{codeInfo(code)?.mark ?? code}</span>
      ))}
    </span>
  );
  const number = <span className="text-[11px] text-muted-foreground">{tooth}</span>;
  return (
    <button
      type="button"
      onClick={() => onPick(tooth)}
      aria-label={describeTooth(tooth, state)}
      aria-pressed={selected}
      className={cn(
        "flex w-10 flex-col items-center gap-0.5 rounded-md p-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-muted",
      )}
    >
      {upper && box}
      {upper && number}
      <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
        {(Object.keys(SIDES) as (keyof typeof SIDES)[]).map((key) => (
          <path key={key} d={SIDES[key]} strokeWidth={1} className={cn("stroke-foreground/60", fill(state[sides[key]]))} />
        ))}
        <circle cx={20} cy={20} r={INNER} strokeWidth={1} className={cn("stroke-foreground/60", fill(state.O))} />
      </svg>
      {!upper && number}
      {!upper && box}
    </button>
  );
}

/** Spec 9.1: the PDA Dental Record Chart, the patient's right on the viewer's left. */
export function ToothChart({ entries, selected, onPick }: { entries: ChartEntryJson[]; selected: number | null; onPick: (tooth: number) => void }) {
  const byTooth = new Map<number, ChartEntryJson[]>();
  for (const e of entries) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e]);
  return (
    <div className="overflow-x-auto rounded-lg border p-3">
      <div className="mx-auto grid w-max gap-3">
        {CHART_ROWS.map((row, i) => {
          const half = row.teeth.length / 2;
          return (
            <div key={ROW_NAMES[i]} role="group" aria-label={ROW_NAMES[i]} className={cn("flex justify-center", i === 2 && "border-t pt-3")}>
              {[row.teeth.slice(0, half), row.teeth.slice(half)].map((teeth, j) => (
                <div key={j} className={cn("flex gap-0.5 px-2", j === 1 && "border-l")}>
                  {teeth.map((tooth) => (
                    <Tooth key={tooth} tooth={tooth} upper={row.upper} state={toothState(byTooth.get(tooth) ?? [])} selected={selected === tooth} onPick={onPick} />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
