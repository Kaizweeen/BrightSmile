import { describe, expect, it } from "vitest";
import { durationText } from "@/lib/time";

describe("a length in words", () => {
  it("says minutes and hours the way a person would", () => {
    expect(durationText(5)).toBe("5 minutes");
    expect(durationText(45)).toBe("45 minutes");
    expect(durationText(60)).toBe("1 hour");
    expect(durationText(90)).toBe("1 hour 30 minutes");
    expect(durationText(120)).toBe("2 hours");
    expect(durationText(0)).toBe("0 minutes");
  });
});
