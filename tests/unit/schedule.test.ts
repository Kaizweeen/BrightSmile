import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS } from "@/lib/hours";
import { blockProblems } from "@/lib/schedule";

const A = "downtown";
const B = "westside";
const ctx = {
  allowedBranchIds: new Set([A, B]),
  hours: new Map([
    [A, DEFAULT_HOURS],
    [B, { ...DEFAULT_HOURS, "1": { open: "12:00", close: "20:00" } }],
  ]),
};

describe("schedule blocks", () => {
  it("accepts a split day at two branches", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
          { branchId: B, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it("names the first rule each block breaks", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 1, startTime: "12:00", endTime: "09:00" },
          { branchId: A, dayOfWeek: 1, startTime: "09:10", endTime: "10:00" },
          { branchId: "elsewhere", dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
          { branchId: A, dayOfWeek: 0, startTime: "09:00", endTime: "10:00" },
          { branchId: B, dayOfWeek: 1, startTime: "10:00", endTime: "13:00" },
        ],
        ctx,
      ),
    ).toEqual([
      { index: 0, message: "The block must end after it starts." },
      { index: 1, message: "Use 15-minute steps." },
      { index: 2, message: "This dentist does not work at that branch." },
      { index: 3, message: "The branch is closed on Sunday." },
      { index: 4, message: "The branch is open 12:00 to 20:00 on Monday." },
    ]);
  });

  it("flags both blocks of an overlap, even at different branches", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
          { branchId: B, dayOfWeek: 2, startTime: "11:00", endTime: "14:00" },
        ],
        ctx,
      ),
    ).toEqual([
      { index: 0, message: "Overlaps another block on Tuesday." },
      { index: 1, message: "Overlaps another block on Tuesday." },
    ]);
  });
});
