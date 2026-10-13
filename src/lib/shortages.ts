/** A supply a completed visit needed more of than the shelf count showed (see takeSuppliesForVisit). */
export type Shortage = { name: string; unit: string; needed: number; taken: number };

/** The warning shown after completing a visit whose supplies ran short, or null when stock covered it. */
export function shortageMessage(shortages: readonly Shortage[] | undefined): string | null {
  if (!shortages || shortages.length === 0) return null;
  const list = shortages.map((s) => `${s.name} (${s.needed - s.taken} ${s.unit} short)`).join(", ");
  return `Supplies ran out: ${list}. Recount them on the Supplies page.`;
}
