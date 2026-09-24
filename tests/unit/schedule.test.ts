import { describe, expect, it } from "vitest";
import { actionsFor, assembleDay, failedTexts, hoursByDentist, parseDay, STATUS_LABEL, type DayRow } from "@/lib/schedule";
import { manilaInstant } from "@/lib/time";

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

describe("failedTexts", () => {
  it("flags an appointment whose latest patient text failed", () => {
    const failed = failedTexts([
      { id: 1, appointment_id: "a", kind: "confirmed", status: "failed" },
      { id: 2, appointment_id: "b", kind: "confirmed", status: "failed" },
      { id: 3, appointment_id: "b", kind: "moved", status: "sent" },
      { id: 4, appointment_id: "c", kind: "cancelled", status: "logged" },
    ]);
    expect([...failed]).toEqual(["a"]);
  });

  it("ignores clinic alerts", () => {
    expect(failedTexts([{ id: 1, appointment_id: "a", kind: "request_alert", status: "failed" }]).size).toBe(0);
    expect(failedTexts([{ id: 1, appointment_id: "a", kind: "patient_cancel_alert", status: "failed" }]).size).toBe(0);
  });

  it("uses the newest row, not the order given", () => {
    const failed = failedTexts([
      { id: 9, appointment_id: "a", kind: "reminder", status: "sent" },
      { id: 5, appointment_id: "a", kind: "confirmed", status: "failed" },
    ]);
    expect(failed.size).toBe(0);
  });
});

describe("parseDay", () => {
  it("keeps a real date", () => {
    expect(parseDay("2026-10-01", "2026-09-25")).toBe("2026-10-01");
  });

  it("falls back to today for anything else", () => {
    for (const bad of [undefined, "", "2026-02-30", "2026-9-1", "tomorrow", ["2026-10-01"]]) {
      expect(parseDay(bad, "2026-09-25")).toBe("2026-09-25");
    }
  });
});

describe("hoursByDentist", () => {
  it("builds each dentist's week in minutes, sorted", () => {
    const week = hoursByDentist([
      { dentist_id: "d", weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { dentist_id: "d", weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
    ]).get("d")!;
    expect(week).toHaveLength(7);
    expect(week[1]).toEqual([
      { start: 540, end: 720 },
      { start: 780, end: 1020 },
    ]);
    expect(week[0]).toEqual([]);
  });
});

describe("assembleDay", () => {
  // 2026-09-28 is a Monday.
  const day = "2026-09-28";
  const at = (minutes: number) => manilaInstant(day, minutes).toISOString();
  const row = (id: string, status: DayRow["status"], start: number, end: number): DayRow => ({
    id,
    status,
    starts_at: at(start),
    ends_at: at(end),
    procedure_names: ["Consultation"],
    dentist_id: "d",
    patient_id: "p",
    patient: { first_name: "Ana", last_name: "Cruz", mobile: "+639171112222" },
  });
  const hours = hoursByDentist([
    { dentist_id: "d", weekday: 1, start_time: "09:00", end_time: "12:00" },
    { dentist_id: "d", weekday: 1, start_time: "13:00", end_time: "17:00" },
  ]);
  const timeOff = new Map([["d", [{ start: new Date(at(900)), end: new Date(at(960)) }]]]);
  const now = new Date(at(0));

  it("sorts by time and flags visits outside hours or in time off", () => {
    const items = assembleDay(
      [
        row("late", "confirmed", 1080, 1110),
        row("lunch", "confirmed", 720, 750),
        row("fine", "confirmed", 540, 570),
        row("across", "pending", 690, 750),
        row("off", "confirmed", 900, 930),
      ],
      { hours, timeOff, failed: new Set(), now },
    );
    expect(items.map((i) => [i.id, i.outsideHours])).toEqual([
      ["fine", false],
      ["across", true],
      ["lunch", true],
      ["off", true],
      ["late", true],
    ]);
  });

  it("never flags finished visits as outside hours, and carries text failures and actions", () => {
    const [item] = assembleDay([row("gone", "cancelled", 1080, 1110)], { hours, timeOff, failed: new Set(["gone"]), now });
    expect(item).toMatchObject({ outsideHours: false, textFailed: true, actions: [], patientName: "Ana Cruz" });
  });

  it("treats a dentist with no hours as outside hours", () => {
    const [item] = assembleDay([{ ...row("x", "confirmed", 540, 570), dentist_id: "other" }], { hours, timeOff, failed: new Set(), now });
    expect(item.outsideHours).toBe(true);
    expect(item.actions).toEqual(["move", "cancel"]);
  });
});
