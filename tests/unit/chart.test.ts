import { describe, expect, it } from "vitest";
import { CHART_CODES } from "@/db/schema";
import { boxCodes, CHART_LEGEND, CHART_ROWS, describeTooth, isTooth, needsSurfaces, surfaceName, toothSides, toothState } from "@/lib/chart";

describe("the PDA chart", () => {
  it("lists the database's codes, in the legend's groups", () => {
    expect(CHART_LEGEND.map((c) => c.code).sort()).toEqual([...CHART_CODES].sort());
    expect(CHART_LEGEND.find((c) => c.code === "present")?.mark).toBe("✓");
    expect(["D", "Am", "Co", "In", "S"].every(needsSurfaces)).toBe(true);
    expect(["present", "M", "JC", "X"].some(needsSurfaces)).toBe(false);
  });

  it("lays teeth out as the PDA chart does, the patient's right on the viewer's left", () => {
    expect(CHART_ROWS.map((r) => [r.teeth[0], r.teeth.at(-1), r.teeth.length, r.upper])).toEqual([
      [55, 65, 10, true],
      [18, 28, 16, true],
      [48, 38, 16, false],
      [85, 75, 10, false],
    ]);
    expect(CHART_ROWS[1].teeth.slice(6, 10)).toEqual([12, 11, 21, 22]);
    expect(isTooth(11)).toBe(true);
    expect(isTooth(19)).toBe(false);
    expect(isTooth(56)).toBe(false);
  });

  it("turns mesial toward the midline and lingual toward the other arch in every quadrant", () => {
    expect(toothSides(16)).toEqual({ top: "B", bottom: "L", left: "D", right: "M" });
    expect(toothSides(26)).toEqual({ top: "B", bottom: "L", left: "M", right: "D" });
    expect(toothSides(36)).toEqual({ top: "L", bottom: "B", left: "M", right: "D" });
    expect(toothSides(46)).toEqual({ top: "L", bottom: "B", left: "D", right: "M" });
    expect(toothSides(55)).toEqual(toothSides(16));
    expect(toothSides(65)).toEqual(toothSides(26));
    expect(toothSides(75)).toEqual(toothSides(36));
    expect(toothSides(85)).toEqual(toothSides(46));
  });

  it("names surfaces as dentists read them", () => {
    expect(surfaceName(11, "O")).toBe("Incisal");
    expect(surfaceName(16, "O")).toBe("Occlusal");
    expect(surfaceName(13, "B")).toBe("Labial");
    expect(surfaceName(16, "B")).toBe("Buccal");
    expect(surfaceName(16, "L")).toBe("Palatal");
    expect(surfaceName(46, "L")).toBe("Lingual");
    expect(surfaceName(52, "O")).toBe("Incisal");
  });

  it("shows the latest entry that is not voided on each surface", () => {
    const entry = (code: string, surfaces: string[], at: string, voided = false) => ({
      code,
      surfaces,
      createdAt: `2026-10-0${at}T02:00:00.000Z`,
      voidedAt: voided ? "2026-10-09T00:00:00.000Z" : null,
    });
    const state = toothState([entry("present", [], "1"), entry("D", ["O", "M"], "2"), entry("Co", ["O"], "3"), entry("Am", ["M"], "4", true)]);
    expect(state).toEqual({ M: "D", D: "present", O: "Co", B: "present", L: "present" });
    expect(boxCodes(state)).toEqual(["D", "present", "Co"]);
    expect(toothState([entry("Co", ["O"], "1"), entry("X", [], "2")])).toEqual({ M: "X", D: "X", O: "X", B: "X", L: "X" });
    expect(toothState([])).toEqual({});
  });

  it("says a tooth's state in words", () => {
    expect(describeTooth(16, { M: "D", D: "present", O: "Co", B: "present", L: "present" })).toBe(
      "Tooth 16: Decayed (caries indicated for filling) on mesial; Present teeth on distal, buccal, and palatal; Composite filling on occlusal",
    );
    expect(describeTooth(46, { M: "X", D: "X", O: "X", B: "X", L: "X" })).toBe("Tooth 46: Extraction due to caries");
    expect(describeTooth(11, {})).toBe("Tooth 11, nothing charted");
  });
});
