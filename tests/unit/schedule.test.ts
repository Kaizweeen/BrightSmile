import { describe, expect, it } from "vitest";
import { actionsFor, STATUS_LABEL } from "@/lib/schedule";

const now = new Date("2026-09-25T02:00:00Z");
const later = new Date("2026-09-25T03:00:00Z");
const earlier = new Date("2026-09-25T01:00:00Z");

describe("actionsFor", () => {
  it("offers approve and decline on an upcoming request, decline only once its time passed", () => {
    expect(actionsFor("pending", later, now)).toEqual(["approve", "decline"]);
    expect(actionsFor("pending", earlier, now)).toEqual(["decline"]);
  });

  it("offers move and cancel before a confirmed visit, attendance once it started", () => {
    expect(actionsFor("confirmed", later, now)).toEqual(["move", "cancel"]);
    expect(actionsFor("confirmed", now, now)).toEqual(["completed", "no_show"]);
    expect(actionsFor("confirmed", earlier, now)).toEqual(["completed", "no_show"]);
  });

  it("lets staff switch completed and no-show to fix mistakes", () => {
    expect(actionsFor("completed", earlier, now)).toEqual(["no_show"]);
    expect(actionsFor("no_show", earlier, now)).toEqual(["completed"]);
  });

  it("offers nothing on finished statuses", () => {
    for (const status of ["declined", "cancelled", "expired"] as const) {
      expect(actionsFor(status, later, now)).toEqual([]);
    }
  });
});

describe("STATUS_LABEL", () => {
  it("gives every status a word", () => {
    for (const label of Object.values(STATUS_LABEL)) expect(label.word.length).toBeGreaterThan(0);
  });
});
