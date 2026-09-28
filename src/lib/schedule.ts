import type { OperatingHours } from "@/db/schema";
import { hoursOn, WEEKDAYS } from "./hours";
import { fromMinutes, toMinutes } from "./time";

export type Block = { branchId: string; dayOfWeek: number; startTime: string; endTime: string };
export type BlockProblem = { index: number; message: string };

/** Spec 7: blocks on the 15-minute grid, at a branch the dentist works at, inside its hours, never overlapping. */
export function blockProblems(
  blocks: readonly Block[],
  ctx: { allowedBranchIds: ReadonlySet<string>; hours: ReadonlyMap<string, OperatingHours> },
): BlockProblem[] {
  const problems = new Map<number, string>();
  const flag = (index: number, message: string) => {
    if (!problems.has(index)) problems.set(index, message);
  };
  blocks.forEach((block, index) => {
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    const day = WEEKDAYS[block.dayOfWeek];
    if (start >= end) return flag(index, "The block must end after it starts.");
    if (start % 15 !== 0 || end % 15 !== 0) return flag(index, "Use 15-minute steps.");
    const hours = ctx.hours.get(block.branchId);
    if (!ctx.allowedBranchIds.has(block.branchId) || !hours) return flag(index, "This dentist does not work at that branch.");
    const open = hoursOn(hours, block.dayOfWeek);
    if (!open) return flag(index, `The branch is closed on ${day}.`);
    if (start < open.open || end > open.close) {
      return flag(index, `The branch is open ${fromMinutes(open.open)} to ${fromMinutes(open.close)} on ${day}.`);
    }
  });
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      const overlap =
        a.dayOfWeek === b.dayOfWeek &&
        toMinutes(a.startTime) < toMinutes(b.endTime) &&
        toMinutes(b.startTime) < toMinutes(a.endTime);
      if (overlap) {
        flag(i, `Overlaps another block on ${WEEKDAYS[a.dayOfWeek]}.`);
        flag(j, `Overlaps another block on ${WEEKDAYS[b.dayOfWeek]}.`);
      }
    }
  }
  return [...problems.entries()].sort(([a], [b]) => a - b).map(([index, message]) => ({ index, message }));
}
