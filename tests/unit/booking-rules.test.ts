import { describe, expect, it } from "vitest";
import { checkBooking, mergeRanges, type BookingFacts, type Visit } from "@/lib/booking-rules";
import { DEFAULT_HOURS } from "@/lib/hours";

const MONDAY = "2026-10-05";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);
const DT = "downtown";
const WS = "westside";

function facts(over: Partial<BookingFacts> = {}): BookingFacts {
  return {
    now: at("08:00"),
    walkIn: false,
    start: at("10:00"),
    end: at("10:45"),
    chairFreeAt: at("11:00"),
    branch: { id: DT, name: "Downtown", active: true, hours: DEFAULT_HOURS },
    chair: { number: 1, active: true },
    dentist: { id: "reyes", name: "Dr. Reyes", active: true, seesPatients: true, worksHere: true },
    patientId: "ana",
    procedures: [{ name: "Oral prophylaxis", active: true }],
    blocks: [
      { branchId: DT, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { branchId: WS, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    ],
    branchNames: new Map([
      [DT, "Downtown"],
      [WS, "Westside"],
    ]),
    timeOff: [],
    visits: [],
    ...over,
  };
}

const visit = (over: Partial<Visit>): Visit => ({
  id: "v1",
  branchId: DT,
  branchName: "Downtown",
  chairNumber: 1,
  dentistId: "lim",
  dentistName: "Dr. Lim",
  patientId: "ben",
  patientName: "Cruz, Ben",
  start: at("09:00"),
  end: at("09:45"),
  chairFreeAt: at("10:00"),
  ...over,
});

const codes = (f: BookingFacts) => {
  const result = checkBooking(f);
  return { errors: result.errors.map((e) => e.code), warnings: result.warnings.map((w) => w.code) };
};

describe("booking checks", () => {
  it("accepts a visit inside the dentist's hours with a free chair", () => {
    expect(codes(facts())).toEqual({ errors: [], warnings: [] });
  });

  it("refuses a clash with the dentist's visit at another branch", () => {
    const f = facts({
      visits: [visit({ dentistId: "reyes", dentistName: "Dr. Reyes", branchId: WS, branchName: "Westside", chairNumber: 3, start: at("10:30"), end: at("11:00"), chairFreeAt: at("11:00") })],
    });
    const result = checkBooking(f);
    expect(result.errors.map((e) => e.code)).toEqual(["dentist_overlap"]);
    expect(result.conflicts).toMatchObject([{ kind: "dentist", appointmentId: "v1", branch: "Westside" }]);
  });

  it("refuses a chair still in turnover and allows it once turnover ends", () => {
    const busy = [visit({ start: at("09:15"), end: at("10:00"), chairFreeAt: at("10:15") })];
    expect(codes(facts({ visits: busy })).errors).toEqual(["chair_overlap"]);
    expect(codes(facts({ visits: busy, start: at("10:15"), end: at("11:00"), chairFreeAt: at("11:15") })).errors).toEqual([]);
  });

  it("lets the dentist start while another chair is in turnover", () => {
    const own = [visit({ dentistId: "reyes", dentistName: "Dr. Reyes", chairNumber: 2, start: at("09:15"), end: at("10:00"), chairFreeAt: at("10:15") })];
    expect(codes(facts({ visits: own })).errors).toEqual([]);
  });

  it("refuses the same patient twice at once", () => {
    const f = facts({ visits: [visit({ patientId: "ana", patientName: "Santos, Ana", branchId: WS, branchName: "Westside", start: at("10:30"), end: at("11:00"), chairFreeAt: at("11:00") })] });
    expect(codes(f).errors).toEqual(["patient_overlap"]);
  });

  it("refuses a time when the schedule puts the dentist at another branch, without an overtime warning", () => {
    const result = checkBooking(facts({ start: at("13:30"), end: at("14:15"), chairFreeAt: at("14:30") }));
    expect(result.errors).toEqual([{ code: "dentist_elsewhere", message: "Dr. Reyes works at Westside from 13:00 to 17:00 on Monday." }]);
    expect(result.warnings).toEqual([]);
  });

  it("refuses time off, inactive things, the past, and visits past midnight", () => {
    expect(codes(facts({ timeOff: [{ startsAt: at("10:00"), endsAt: at("12:00"), reason: "Seminar" }] })).errors).toEqual(["dentist_time_off"]);
    expect(checkBooking(facts({ timeOff: [{ startsAt: at("10:00"), endsAt: at("12:00"), reason: "Seminar" }] })).errors[0].message).toBe(
      "Dr. Reyes is off then (Seminar).",
    );
    expect(codes(facts({ chair: { number: 1, active: false } })).errors).toEqual(["inactive"]);
    expect(codes(facts({ chair: null })).errors).toEqual(["inactive"]);
    expect(codes(facts({ dentist: { id: "reyes", name: "Dr. Reyes", active: true, seesPatients: true, worksHere: false } })).errors).toEqual(["inactive"]);
    expect(codes(facts({ procedures: [{ name: "Old", active: false }] })).errors).toEqual(["inactive"]);
    expect(codes(facts({ branch: { id: DT, name: "Downtown", active: false, hours: DEFAULT_HOURS } })).errors).toEqual(["inactive"]);
    expect(codes(facts({ now: at("11:00") })).errors).toEqual(["past"]);
    expect(codes(facts({ now: at("11:00"), walkIn: true })).errors).toEqual([]);
    const late = facts({ start: at("23:30"), end: new Date(at("23:30").getTime() + 60 * 60_000), chairFreeAt: new Date(at("23:30").getTime() + 60 * 60_000) });
    expect(codes(late).errors).toContain("overnight");
  });

  it("warns outside the dentist's hours and the branch's hours", () => {
    expect(codes(facts({ start: at("18:00"), end: at("18:45"), chairFreeAt: at("19:00") }))).toEqual({
      errors: [],
      warnings: ["outside_dentist_hours", "outside_branch_hours"],
    });
    expect(checkBooking(facts({ start: at("18:00"), end: at("18:45"), chairFreeAt: at("19:00") })).warnings[1].message).toBe(
      "Downtown is open 09:00 to 18:00 on Monday.",
    );
  });

  it("treats back-to-back blocks at one branch as one stretch", () => {
    const blocks = [
      { branchId: DT, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { branchId: DT, dayOfWeek: 1, startTime: "12:00", endTime: "15:00" },
    ];
    expect(codes(facts({ blocks, start: at("11:30"), end: at("12:30"), chairFreeAt: at("12:45") }))).toEqual({ errors: [], warnings: [] });
  });

  it("warns when the branch is closed that day", () => {
    const sunday = "2026-10-04";
    const result = checkBooking(facts({ now: at("08:00", sunday), start: at("10:00", sunday), end: at("10:45", sunday), chairFreeAt: at("11:00", sunday) }));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      { code: "outside_dentist_hours", message: "This is outside the hours Dr. Reyes works at Downtown." },
      { code: "outside_branch_hours", message: "Downtown is closed on Sunday." },
    ]);
  });
});

describe("mergeRanges", () => {
  it("joins touching and overlapping ranges", () => {
    expect(mergeRanges([{ start: 720, end: 900 }, { start: 540, end: 720 }, { start: 950, end: 1000 }, { start: 960, end: 980 }])).toEqual([
      { start: 540, end: 900 },
      { start: 950, end: 1000 },
    ]);
  });
});
