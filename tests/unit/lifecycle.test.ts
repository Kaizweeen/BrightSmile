import { describe, expect, it } from "vitest";
import { APPOINTMENT_STATUSES } from "@/db/schema";
import { ACTIVE, actionFor, actionLabel, changeProblem, NEXT, STATUSES } from "@/lib/lifecycle";

const start = new Date("2026-10-05T01:00:00Z"); // 09:00 on Monday, Manila

describe("lifecycle", () => {
  it("uses the same statuses as the database", () => {
    expect([...STATUSES]).toEqual([...APPOINTMENT_STATUSES]);
    expect([...ACTIVE]).toEqual(["requested", "confirmed", "checked_in", "in_treatment"]);
  });

  it("allows exactly the changes of spec 8.6", () => {
    const pairs = STATUSES.flatMap((from) => NEXT[from].map((to) => `${from}>${to}`)).sort();
    expect(pairs).toEqual(
      [
        "checked_in>cancelled",
        "checked_in>confirmed",
        "checked_in>in_treatment",
        "confirmed>cancelled",
        "confirmed>checked_in",
        "confirmed>no_show",
        "in_treatment>completed",
        "no_show>checked_in",
        "requested>cancelled",
        "requested>confirmed",
      ].sort(),
    );
  });

  it("explains a change that is not allowed", () => {
    expect(changeProblem("cancelled", "confirmed", start, start)).toBe("A cancelled visit cannot become confirmed.");
    expect(changeProblem("confirmed", "completed", start, start)).toBe("A confirmed visit cannot become completed.");
  });

  it("checks in only on the visit's Manila day", () => {
    expect(changeProblem("confirmed", "checked_in", start, new Date("2026-10-04T23:30:00Z"))).toBeNull(); // 07:30 Monday
    expect(changeProblem("confirmed", "checked_in", start, new Date("2026-10-04T15:30:00Z"))).toBe(
      "Check in on the day of the visit.",
    ); // 23:30 Sunday
    expect(changeProblem("no_show", "checked_in", new Date("2026-10-05T01:00:00Z"), new Date("2026-10-05T15:59:00Z"))).toBeNull(); // 23:59 Monday
  });

  it("marks a no-show only after the start", () => {
    expect(changeProblem("confirmed", "no_show", start, new Date("2026-10-05T00:59:00Z"))).toBe(
      "A visit becomes a no-show only after its start time.",
    );
    expect(changeProblem("confirmed", "no_show", start, new Date("2026-10-05T01:00:00Z"))).toBeNull();
  });

  it("names each action and the permission it needs", () => {
    expect(actionLabel("checked_in", "confirmed")).toBe("Undo check-in");
    expect(actionLabel("no_show", "checked_in")).toBe("Arrived late: check in");
    expect(actionLabel("confirmed", "checked_in")).toBe("Check in");
    expect(actionLabel("checked_in", "in_treatment")).toBe("Start treatment");
    expect(actionFor("in_treatment")).toBe("appointment.treat");
    expect(actionFor("completed")).toBe("appointment.treat");
    expect(actionFor("cancelled")).toBe("appointment.manage");
    expect(actionFor("checked_in")).toBe("appointment.manage");
  });
});
