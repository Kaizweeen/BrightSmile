/** The PDA chart legend (spec 9.1), in the printed order. The database's check constraint lists the same codes. */
export const CHART_LEGEND = [
  { code: "present", mark: "✓", label: "Present teeth", group: "Condition" },
  { code: "D", mark: "D", label: "Decayed (caries indicated for filling)", group: "Condition" },
  { code: "M", mark: "M", label: "Missing due to caries", group: "Condition" },
  { code: "MO", mark: "MO", label: "Missing due to other causes", group: "Condition" },
  { code: "Im", mark: "Im", label: "Impacted tooth", group: "Condition" },
  { code: "Sp", mark: "Sp", label: "Supernumerary tooth", group: "Condition" },
  { code: "Rf", mark: "Rf", label: "Root fragment", group: "Condition" },
  { code: "Un", mark: "Un", label: "Unerupted", group: "Condition" },
  { code: "Am", mark: "Am", label: "Amalgam filling", group: "Restorations and prosthetics" },
  { code: "Co", mark: "Co", label: "Composite filling", group: "Restorations and prosthetics" },
  { code: "JC", mark: "JC", label: "Jacket crown", group: "Restorations and prosthetics" },
  { code: "Ab", mark: "Ab", label: "Abutment", group: "Restorations and prosthetics" },
  { code: "Att", mark: "Att", label: "Attachment", group: "Restorations and prosthetics" },
  { code: "P", mark: "P", label: "Pontic", group: "Restorations and prosthetics" },
  { code: "In", mark: "In", label: "Inlay", group: "Restorations and prosthetics" },
  { code: "Imp", mark: "Imp", label: "Implant", group: "Restorations and prosthetics" },
  { code: "S", mark: "S", label: "Sealants", group: "Restorations and prosthetics" },
  { code: "Rm", mark: "Rm", label: "Removable denture", group: "Restorations and prosthetics" },
  { code: "X", mark: "X", label: "Extraction due to caries", group: "Surgery" },
  { code: "XO", mark: "XO", label: "Extraction due to other causes", group: "Surgery" },
] as const;

export const CHART_GROUPS = ["Condition", "Restorations and prosthetics", "Surgery"] as const;
export type ChartCode = (typeof CHART_LEGEND)[number]["code"];

export function codeInfo(code: string) {
  return CHART_LEGEND.find((c) => c.code === code);
}

export const SURFACES = ["M", "D", "O", "B", "L"] as const;
export type Surface = (typeof SURFACES)[number];

/** D, Am, Co, In, and S mark surfaces; every other code covers the whole tooth (spec 9.1). */
export function needsSurfaces(code: string): boolean {
  return ["D", "Am", "Co", "In", "S"].includes(code);
}

const run = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from < to ? from + i : from - i));

/** The PDA chart from top to bottom, FDI numbers, the patient's right on the viewer's left (spec 9.1). */
export const CHART_ROWS: { teeth: number[]; upper: boolean }[] = [
  { teeth: [...run(55, 51), ...run(61, 65)], upper: true },
  { teeth: [...run(18, 11), ...run(21, 28)], upper: true },
  { teeth: [...run(48, 41), ...run(31, 38)], upper: false },
  { teeth: [...run(85, 81), ...run(71, 75)], upper: false },
];

const TEETH = new Set(CHART_ROWS.flatMap((r) => r.teeth));

export function isTooth(n: number): boolean {
  return TEETH.has(n);
}

const upperTooth = (tooth: number) => [1, 2, 5, 6].includes(Math.floor(tooth / 10));

/**
 * Which surface each side of a tooth's circle shows: the side facing the other arch is lingual, and the side facing the
 * chart's vertical midline is mesial. Quadrants 1, 4, 5, and 8 (the patient's right) sit on the viewer's left.
 */
export function toothSides(tooth: number): { top: Surface; bottom: Surface; left: Surface; right: Surface } {
  const upper = upperTooth(tooth);
  const viewersLeft = [1, 4, 5, 8].includes(Math.floor(tooth / 10));
  return { top: upper ? "B" : "L", bottom: upper ? "L" : "B", left: viewersLeft ? "D" : "M", right: viewersLeft ? "M" : "D" };
}

/** Incisal on incisors and canines (x1 to x3), palatal on upper teeth, labial on front teeth. */
export function surfaceName(tooth: number, surface: Surface): string {
  const front = tooth % 10 <= 3;
  if (surface === "O") return front ? "Incisal" : "Occlusal";
  if (surface === "L") return upperTooth(tooth) ? "Palatal" : "Lingual";
  if (surface === "B") return front ? "Labial" : "Buccal";
  return surface === "M" ? "Mesial" : "Distal";
}

export type EntryLike = { code: string; surfaces: readonly string[]; createdAt: string; voidedAt: string | null };

/** Spec 9.1: on each surface the latest entry that is not voided wins; an entry for the whole tooth covers every surface. */
export function toothState(entries: readonly EntryLike[]): Partial<Record<Surface, string>> {
  const state: Partial<Record<Surface, string>> = {};
  const live = entries.filter((e) => e.voidedAt === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of live) {
    for (const s of e.surfaces.length > 0 ? e.surfaces : SURFACES) state[s as Surface] = e.code;
  }
  return state;
}

/** The codes for a tooth's box on the chart, in surface order, each once. */
export function boxCodes(state: Partial<Record<Surface, string>>): string[] {
  return [...new Set(SURFACES.flatMap((s) => (state[s] ? [state[s]] : [])))];
}

const list = new Intl.ListFormat("en", { type: "conjunction" });

/** A tooth's state in words, for screen readers and the tooth panel: "Tooth 16: Composite filling on occlusal". */
export function describeTooth(tooth: number, state: Partial<Record<Surface, string>>): string {
  const codes = boxCodes(state);
  if (codes.length === 0) return `Tooth ${tooth}, nothing charted`;
  const parts = codes.map((code) => {
    const on = SURFACES.filter((s) => state[s] === code);
    const where = on.length === SURFACES.length ? "" : ` on ${list.format(on.map((s) => surfaceName(tooth, s).toLowerCase()))}`;
    return `${codeInfo(code)?.label ?? code}${where}`;
  });
  return `Tooth ${tooth}: ${parts.join("; ")}`;
}
