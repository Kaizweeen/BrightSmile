import { describe, expect, it } from "vitest";
import { activeBranchFilter, type BranchOption } from "@/lib/dashboard";

// Schedule and Requests both filter by ?branch=, but only once there is a real choice to make (booking flow spec 4):
// the query string is untrusted input, so a stale or foreign id must never narrow the list to nothing.
const one: BranchOption[] = [{ id: "b1", name: "Main", active: true }];
const two: BranchOption[] = [
  { id: "b1", name: "Main", active: true },
  { id: "b2", name: "Pasig", active: true },
  { id: "b3", name: "Old", active: false },
];

describe("activeBranchFilter", () => {
  it("never filters while only one branch is active, even with a branch id in the query string", () => {
    expect(activeBranchFilter(one, "b1")).toBeNull();
  });

  it("ignores no id, so all branches show", () => {
    expect(activeBranchFilter(two, null)).toBeNull();
  });

  it("applies an active branch's id once there are 2 or more", () => {
    expect(activeBranchFilter(two, "b2")).toBe("b2");
  });

  it("ignores an id that is not one of the clinic's active branches", () => {
    expect(activeBranchFilter(two, "b3")).toBeNull();
    expect(activeBranchFilter(two, "not-a-real-branch")).toBeNull();
  });
});
