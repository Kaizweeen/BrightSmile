import { describe, expect, it } from "vitest";
import type { Visit } from "@/lib/booking-rules";
import { DEFAULT_HOURS } from "@/lib/hours";
import { openTimes, type SlotFacts } from "@/lib/slots";
import { fromMinutes, manilaMinutes } from "@/lib/time";

const MONDAY = "2026-10-05";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);
const DT = "downtown";
const WS = "westside";

function slotFacts(over: Partial<SlotFacts> = {}): SlotFacts {
  return {
    date: MONDAY,
    now: at("08:00"),
    minutes: 45,
    turnover: 15,
    branch: { id: DT, hours: DEFAULT_HOURS },
    chairs: [1, 2],
    dentists: [{ id: "reyes", name: "Dr. Reyes" }],
    blocks: new Map([
      [
        "reyes",
        [
          { branchId: DT, dayOfWeek: 1, startTime: "09:00", endTime: "11:00" },
          { branchId: WS, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
        ],
      ],
    ]),
    timeOff: new Map(),
    visits: [],
    ...over,
  };
}

const visit = (over: Partial<Visit>): Visit => ({
  id: "v",
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

const starts = (f: SlotFacts) => openTimes(f).map((t) => fromMinutes(manilaMinutes(t.start)));

describe("open times", () => {
  it("offers every 15-minute start that fits the block, with the free chairs", () => {
    const times = openTimes(slotFacts());
    expect(times.map((t) => fromMinutes(manilaMinutes(t.start)))).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15"]);
    expect(times[0].dentists).toEqual([{ id: "reyes", name: "Dr. Reyes", chairs: [1, 2] }]);
  });

  it("skips starts that have passed", () => {
    expect(starts(slotFacts({ now: at("09:20") }))).toEqual(["09:30", "09:45", "10:00", "10:15"]);
  });

  it("skips the dentist's own visits and time off", () => {
    const busy = [visit({ dentistId: "reyes", dentistName: "Dr. Reyes", chairNumber: 2, start: at("09:30"), end: at("10:15"), chairFreeAt: at("10:30") })];
    const times = openTimes(slotFacts({ visits: busy }));
    expect(times.map((t) => [fromMinutes(manilaMinutes(t.start)), t.dentists[0].chairs])).toEqual([["10:15", [1]]]);
    expect(starts(slotFacts({ timeOff: new Map([["reyes", [{ startsAt: at("10:00"), endsAt: at("11:00") }]]]) }))).toEqual(["09:00", "09:15"]);
  });

  it("needs a chair that stays free through the turnover", () => {
    const visits = [
      visit({ id: "a", chairNumber: 1, start: at("09:00"), end: at("10:00"), chairFreeAt: at("10:30") }),
      visit({ id: "b", chairNumber: 2, start: at("10:00"), end: at("10:30"), chairFreeAt: at("10:45") }),
    ];
    const times = openTimes(slotFacts({ visits }));
    expect(times.map((t) => [fromMinutes(manilaMinutes(t.start)), t.dentists[0].chairs])).toEqual([["09:00", [2]]]);
  });

  it("groups dentists by start and ignores their blocks at other branches", () => {
    const f = slotFacts({
      dentists: [
        { id: "reyes", name: "Dr. Reyes" },
        { id: "lim", name: "Dr. Lim" },
      ],
      blocks: new Map([
        ["reyes", [{ branchId: DT, dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }]],
        ["lim", [{ branchId: DT, dayOfWeek: 1, startTime: "09:15", endTime: "10:00" }, { branchId: WS, dayOfWeek: 1, startTime: "10:00", endTime: "12:00" }]],
      ]),
    });
    expect(openTimes(f).map((t) => [fromMinutes(manilaMinutes(t.start)), t.dentists.map((d) => d.id)])).toEqual([
      ["09:00", ["reyes"]],
      ["09:15", ["reyes", "lim"]],
    ]);
  });

  it("keeps the patient's other visits free", () => {
    const visits = [visit({ patientId: "ana", branchId: WS, branchName: "Westside", start: at("09:00"), end: at("10:00"), chairFreeAt: at("10:00") })];
    expect(starts(slotFacts({ visits, patientId: "ana" }))).toEqual(["10:00", "10:15"]);
  });

  it("offers nothing on a day the branch is closed", () => {
    expect(openTimes(slotFacts({ date: "2026-10-04" }))).toEqual([]);
  });
});
