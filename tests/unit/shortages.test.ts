import { describe, expect, it } from "vitest";
import { shortageMessage } from "@/lib/shortages";

describe("shortageMessage", () => {
  it("says nothing when stock covered the visit", () => {
    expect(shortageMessage([])).toBeNull();
    expect(shortageMessage(undefined)).toBeNull();
  });

  it("names each supply and how much it was short", () => {
    expect(
      shortageMessage([
        { name: "Gloves", unit: "pcs", needed: 4, taken: 1 },
        { name: "Bond", unit: "bottle", needed: 1, taken: 0 },
      ]),
    ).toBe("Supplies ran out: Gloves (3 pcs short), Bond (1 bottle short). Recount them on the Supplies page.");
  });
});
