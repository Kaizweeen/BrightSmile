import { describe, expect, it } from "vitest";
import { chooseDentist } from "@/lib/portal";

const reyes = { id: "b", name: "Dr. Reyes" };
const lim = { id: "c", name: "Dr. Lim" };
const otherLim = { id: "a", name: "Dr. Lim" };

describe("choosing a dentist online", () => {
  it("picks the dentist with the fewest visits that day", () => {
    expect(chooseDentist([reyes, lim], new Map([["c", 3], ["b", 1]]))).toBe(reyes);
  });

  it("breaks a tie by name, then by id", () => {
    expect(chooseDentist([reyes, lim], new Map())).toBe(lim);
    expect(chooseDentist([lim, otherLim], new Map())).toBe(otherLim);
  });

  it("has no one to pick from an empty list", () => {
    expect(chooseDentist([], new Map())).toBeUndefined();
  });
});
