# DentaSync Plan B: Scheduling and patients

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The front desk books patients into a dentist and a chair on a per-branch calendar, the database and the rules refuse every clash (across branches, and through chair turnover), visits move through their lifecycle, dentists see their day across branches, and the owner sees all branches at once.

**Architecture:** The booking rules are pure functions (`src/lib/booking-rules.ts`, `src/lib/slots.ts`, `src/lib/lifecycle.ts`) fed by one fact-gathering module (`src/server/booking.ts`), so every rule is unit tested without a database. Services and REST routes follow plan A's patterns (`staffRoute`, `requireCan`, `audit`). Screens use TanStack Query against `/api/v1`, refreshing the calendar every 30 seconds.

**Tech Stack:** as plan A (Next.js 16.3.6, React 19.2, Tailwind 4, shadcn/ui on Base UI, TanStack Query 5, Zod 4, Drizzle 0.45 on PGlite 0.4.6 or Postgres 17, Better Auth 1.7, Vitest 5), plus the lucide-react icons shadcn installed.

**Spec:** `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`, sections 8 (scheduling rules), 10 (screens), and 11 (API). Plan A (`2026-09-29-plan-a-foundation.md`) is merged into this branch's history; its files and interfaces are the starting point.

## Global Constraints

- Repository `D:\dentasync`, branch `plan-b-scheduling`. Commit after each task with a conventional prefix, an imperative subject, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/` (async `params` and `searchParams`; `error.tsx` receives `retry`).
- Times are `timestamptz`; every day boundary, schedule block, grid step, and display uses Asia/Manila through `src/lib/time.ts`, never the server's time zone. Starts sit on a 15-minute grid, except walk-ins, which start at the current minute.
- "Active" statuses (they hold time) are exactly requested, confirmed, checked in, and in treatment.
- Every route goes through `staffRoute` (`src/server/api.ts`); every permission check uses `can()` or `requireCan()`; writes carry the app's Origin and JSON.
- Errors have one shape: `{ "error": { "code", "message", "fields"?, "conflicts"?, "warnings"? } }`; a clash is `409`, a broken rule or unacknowledged warnings `422`.
- Health information (allergies, medical alerts, the medical form) never goes into the audit log, logs, or error messages; the audit log records patient views and the names of changed fields only.
- Copy is plain and direct, with no em dashes or en dashes. No SMS or email is sent.
- WCAG 2.2 AA: status badges show a word and an icon, never colour alone; every action is reachable by keyboard; fields and errors are labelled; touch targets are at least 44 pixels tall on phones.
- Add no runtime dependency. (Task 5 adds `tsx` as an exactly pinned dev dependency, to run the seed script.)

---

## File structure (plan B)

```
src/lib/lifecycle.ts          statuses, allowed changes, labels, time rules
src/lib/booking-rules.ts      hard stops, warnings, conflicts (pure)
src/lib/slots.ts              open times (pure)
src/lib/patients.ts           allergy labels, ages, alert lines (client-safe)
src/lib/visits.ts             the visit JSON the screens read, calendar layout, the ?date= param
src/server/booking.ts         gathers the facts the rules need
src/server/patients.ts        patients: search, create, view, edit, visits
src/server/appointments.ts    validate, book, move, change status, list, detail, chair conflicts, upcoming visits
src/server/availability.ts    open times for a branch and day
src/server/overview.ts        the All branches summary
src/server/seed.ts, scripts/seed.mts   development data (npm run seed)
src/components/status-badge.tsx, alert-mark.tsx, alert-banner.tsx, patient-search.tsx, patient-fields.tsx, add-patient-dialog.tsx
src/components/calendar/      day-grid, week-grid, visit-panel, booking-panel
src/app/[branch]/             page.tsx + overview-screen.tsx (All branches), calendar/, my-day/, patients/, patients/[id]/
```

Tasks 1 to 4 build and test the rules and the API; Task 5 adds development data, which the screens' browser checks in Tasks 6 to 9 sign in to.

---

### Task 1: Visit rules: lifecycle, booking checks, and open times

**Files:**
- Create: `src/lib/lifecycle.ts`, `src/lib/booking-rules.ts`, `src/lib/slots.ts`
- Test: `tests/unit/lifecycle.test.ts`, `tests/unit/booking-rules.test.ts`, `tests/unit/slots.test.ts`

**Interfaces:**
- Consumes: `OperatingHours` (`@/db/schema`), `hoursOn`, `WEEKDAYS`, `DEFAULT_HOURS` (`@/lib/hours`), time helpers (`@/lib/time`), `Action` (`@/lib/permissions`).
- Produces:
  - `@/lib/lifecycle`: `STATUSES`, `type Status`, `ACTIVE`, `NEXT: Record<Status, readonly Status[]>`, `STATUS_LABEL`, `actionLabel(from, to)`, `actionFor(to): Action`, `changeProblem(from, to, start, now): string | null`.
  - `@/lib/booking-rules`: `type Visit`, `type WeeklyBlock`, `type Finding = { code; message }`, `type Conflict = { kind: "dentist" | "chair" | "patient"; appointmentId; start; end; chairFreeAt; branch; chairNumber; patient; dentist }`, `type BookingFacts`, `overlaps(aStart, aEnd, bStart, bEnd)`, `mergeRanges(ranges)`, `conflictFor(kind, visit)`, `checkBooking(facts): { errors; warnings; conflicts }`.
  - `@/lib/slots`: `type SlotFacts`, `type OpenTime = { start: Date; dentists: { id; name; chairs: number[] }[] }`, `openTimes(facts): OpenTime[]`.

- [ ] **Step 1: Write the failing lifecycle test, `tests/unit/lifecycle.test.ts`**

```ts
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
    expect(changeProblem("no_show", "checked_in", start, new Date("2026-10-05T15:59:00Z"))).toBeNull(); // 23:59 Monday
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
```

- [ ] **Step 2: Write `src/lib/lifecycle.ts`**

```ts
import type { Action } from "./permissions";
import { manilaDate } from "./time";

/** The visit statuses, in lifecycle order. The database's check constraint lists the same seven. */
export const STATUSES = ["requested", "confirmed", "checked_in", "in_treatment", "completed", "no_show", "cancelled"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses that hold time; the exclusion constraints use the same four. */
export const ACTIVE: readonly Status[] = ["requested", "confirmed", "checked_in", "in_treatment"];

/** Spec 8.6. The database trigger refuses every other change. */
export const NEXT: Record<Status, readonly Status[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "no_show", "cancelled"],
  checked_in: ["in_treatment", "cancelled", "confirmed"],
  in_treatment: ["completed"],
  no_show: ["checked_in"],
  completed: [],
  cancelled: [],
};

export const STATUS_LABEL: Record<Status, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  checked_in: "Checked in",
  in_treatment: "In treatment",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

const ACTION_LABEL: Record<Status, string> = {
  requested: "Mark requested",
  confirmed: "Confirm",
  checked_in: "Check in",
  in_treatment: "Start treatment",
  completed: "Complete",
  no_show: "Mark no-show",
  cancelled: "Cancel visit",
};

/** The words on the button that makes a change. */
export function actionLabel(from: Status, to: Status): string {
  if (from === "checked_in" && to === "confirmed") return "Undo check-in";
  if (from === "no_show" && to === "checked_in") return "Arrived late: check in";
  return ACTION_LABEL[to];
}

/** Dentists start and complete their own visits; every other change is the front desk's (spec section 5). */
export function actionFor(to: Status): Action {
  return to === "in_treatment" || to === "completed" ? "appointment.treat" : "appointment.manage";
}

/** Why a change is refused, or null: the allowed pairs, then spec 8.6's date and time rules. */
export function changeProblem(from: Status, to: Status, start: Date, now: Date): string | null {
  if (!NEXT[from].includes(to)) {
    return `A ${STATUS_LABEL[from].toLowerCase()} visit cannot become ${STATUS_LABEL[to].toLowerCase()}.`;
  }
  if (to === "checked_in" && manilaDate(start) !== manilaDate(now)) return "Check in on the day of the visit.";
  if (to === "no_show" && now < start) return "A visit becomes a no-show only after its start time.";
  return null;
}
```

- [ ] **Step 3: Run the lifecycle test**

```powershell
npx vitest run tests/unit/lifecycle.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 4: Write the failing booking-rules test, `tests/unit/booking-rules.test.ts`**

```ts
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
```

- [ ] **Step 5: Write `src/lib/booking-rules.ts`**

```ts
import type { OperatingHours } from "@/db/schema";
import { hoursOn, WEEKDAYS } from "./hours";
import { formatTime, fromMinutes, manilaDate, manilaMinutes, toMinutes, weekday } from "./time";

/** An active visit as the rules see it. */
export type Visit = {
  id: string;
  branchId: string;
  branchName: string;
  chairNumber: number;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
};

export type WeeklyBlock = { branchId: string; dayOfWeek: number; startTime: string; endTime: string };
export type Finding = { code: string; message: string };
export type Conflict = {
  kind: "dentist" | "chair" | "patient";
  appointmentId: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  branch: string;
  chairNumber: number;
  patient: string;
  dentist: string;
};

/** Everything checkBooking needs, gathered by src/server/booking.ts. */
export type BookingFacts = {
  now: Date;
  walkIn: boolean;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  branch: { id: string; name: string; active: boolean; hours: OperatingHours };
  chair: { number: number; active: boolean } | null;
  dentist: { id: string; name: string; active: boolean; seesPatients: boolean; worksHere: boolean };
  patientId: string;
  procedures: readonly { name: string; active: boolean }[];
  blocks: readonly WeeklyBlock[];
  branchNames: ReadonlyMap<string, string>;
  timeOff: readonly { startsAt: Date; endsAt: Date; reason: string }[];
  visits: readonly Visit[];
};

/** Two [start, end) spans overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Joins touching or overlapping [start, end) minute ranges. */
export function mergeRanges(ranges: readonly { start: number; end: number }[]): { start: number; end: number }[] {
  const merged: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function conflictFor(kind: Conflict["kind"], v: Visit): Conflict {
  return {
    kind,
    appointmentId: v.id,
    start: v.start,
    end: v.end,
    chairFreeAt: v.chairFreeAt,
    branch: v.branchName,
    chairNumber: v.chairNumber,
    patient: v.patientName,
    dentist: v.dentistName,
  };
}

function clashMessage(c: Conflict): string {
  if (c.kind === "chair") return `Chair ${c.chairNumber} is taken until ${formatTime(c.chairFreeAt)}, turnover included.`;
  const who = c.kind === "dentist" ? c.dentist : c.patient;
  return `${who} has a visit from ${formatTime(c.start)} to ${formatTime(c.end)} at ${c.branch}.`;
}

/** Spec 8.3 and 8.4: the hard stops, the warnings, and the visits a booking clashes with. */
export function checkBooking(f: BookingFacts): { errors: Finding[]; warnings: Finding[]; conflicts: Conflict[] } {
  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const conflicts: Conflict[] = [];
  const day = weekday(manilaDate(f.start));
  const startMin = manilaMinutes(f.start);
  const endMin = startMin + Math.round((f.end.getTime() - f.start.getTime()) / 60_000);

  if (!f.branch.active) errors.push({ code: "inactive", message: `${f.branch.name} takes no bookings.` });
  if (!f.chair) errors.push({ code: "inactive", message: `That chair does not exist at ${f.branch.name}.` });
  else if (!f.chair.active) errors.push({ code: "inactive", message: `Chair ${f.chair.number} is not in use.` });
  if (!f.dentist.active || !f.dentist.seesPatients) {
    errors.push({ code: "inactive", message: `${f.dentist.name} does not see patients.` });
  } else if (!f.dentist.worksHere) {
    errors.push({ code: "inactive", message: `${f.dentist.name} does not work at ${f.branch.name}.` });
  }
  for (const p of f.procedures) if (!p.active) errors.push({ code: "inactive", message: `${p.name} is no longer offered.` });
  if (endMin > 24 * 60) errors.push({ code: "overnight", message: "A visit must end on the day it starts." });
  if (!f.walkIn && f.start < f.now) errors.push({ code: "past", message: "That time has passed." });

  const today = f.blocks.filter((b) => b.dayOfWeek === day);
  const elsewhere = today.find(
    (b) => b.branchId !== f.branch.id && toMinutes(b.startTime) < endMin && startMin < toMinutes(b.endTime),
  );
  if (elsewhere) {
    const where = f.branchNames.get(elsewhere.branchId) ?? "another branch";
    errors.push({
      code: "dentist_elsewhere",
      message: `${f.dentist.name} works at ${where} from ${elsewhere.startTime} to ${elsewhere.endTime} on ${WEEKDAYS[day]}.`,
    });
  }
  const off = f.timeOff.find((t) => overlaps(f.start, f.end, t.startsAt, t.endsAt));
  if (off) errors.push({ code: "dentist_time_off", message: `${f.dentist.name} is off then${off.reason ? ` (${off.reason})` : ""}.` });

  for (const v of f.visits) {
    if (v.dentistId === f.dentist.id && overlaps(f.start, f.end, v.start, v.end)) conflicts.push(conflictFor("dentist", v));
    if (f.chair && v.branchId === f.branch.id && v.chairNumber === f.chair.number && overlaps(f.start, f.chairFreeAt, v.start, v.chairFreeAt)) {
      conflicts.push(conflictFor("chair", v));
    }
    if (v.patientId === f.patientId && overlaps(f.start, f.end, v.start, v.end)) conflicts.push(conflictFor("patient", v));
  }
  for (const c of conflicts) errors.push({ code: `${c.kind}_overlap`, message: clashMessage(c) });

  if (!elsewhere) {
    const here = mergeRanges(
      today.filter((b) => b.branchId === f.branch.id).map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
    );
    if (!here.some((r) => r.start <= startMin && endMin <= r.end)) {
      warnings.push({ code: "outside_dentist_hours", message: `This is outside the hours ${f.dentist.name} works at ${f.branch.name}.` });
    }
  }
  const open = hoursOn(f.branch.hours, day);
  if (!open) {
    warnings.push({ code: "outside_branch_hours", message: `${f.branch.name} is closed on ${WEEKDAYS[day]}.` });
  } else if (startMin < open.open || endMin > open.close) {
    warnings.push({
      code: "outside_branch_hours",
      message: `${f.branch.name} is open ${fromMinutes(open.open)} to ${fromMinutes(open.close)} on ${WEEKDAYS[day]}.`,
    });
  }
  return { errors, warnings, conflicts };
}
```

- [ ] **Step 6: Run the booking-rules test**

```powershell
npx vitest run tests/unit/booking-rules.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Write the failing slots test, `tests/unit/slots.test.ts`**

```ts
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
```

- [ ] **Step 8: Write `src/lib/slots.ts`**

```ts
import type { OperatingHours } from "@/db/schema";
import { mergeRanges, overlaps, type Visit, type WeeklyBlock } from "./booking-rules";
import { hoursOn } from "./hours";
import { manilaInstant, toMinutes, weekday } from "./time";

const STEP = 15;

export type SlotFacts = {
  date: string;
  now: Date;
  minutes: number;
  turnover: number;
  branch: { id: string; hours: OperatingHours };
  chairs: readonly number[];
  dentists: readonly { id: string; name: string }[];
  blocks: ReadonlyMap<string, readonly WeeklyBlock[]>;
  timeOff: ReadonlyMap<string, readonly { startsAt: Date; endsAt: Date }[]>;
  visits: readonly Visit[];
  patientId?: string;
};

export type OpenTime = { start: Date; dentists: { id: string; name: string; chairs: number[] }[] };

/**
 * Spec 8.5: every start on the grid where a dentist's block at this branch covers the whole visit, the dentist and the
 * patient are free, and at least one chair is free for the visit plus turnover.
 */
export function openTimes(f: SlotFacts): OpenTime[] {
  const day = weekday(f.date);
  const hours = hoursOn(f.branch.hours, day);
  if (!hours) return [];
  const byStart = new Map<number, OpenTime>();
  for (const dentist of f.dentists) {
    const ranges = mergeRanges(
      (f.blocks.get(dentist.id) ?? [])
        .filter((b) => b.dayOfWeek === day && b.branchId === f.branch.id)
        .map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) })),
    );
    const off = f.timeOff.get(dentist.id) ?? [];
    for (const range of ranges) {
      const from = Math.max(range.start, hours.open);
      const until = Math.min(range.end, hours.close);
      for (let minute = Math.ceil(from / STEP) * STEP; minute + f.minutes <= until; minute += STEP) {
        const start = manilaInstant(f.date, minute);
        if (start < f.now) continue;
        const end = new Date(start.getTime() + f.minutes * 60_000);
        const freeAt = new Date(end.getTime() + f.turnover * 60_000);
        if (off.some((t) => overlaps(start, end, t.startsAt, t.endsAt))) continue;
        if (f.visits.some((v) => v.dentistId === dentist.id && overlaps(start, end, v.start, v.end))) continue;
        if (f.patientId && f.visits.some((v) => v.patientId === f.patientId && overlaps(start, end, v.start, v.end))) continue;
        const chairs = f.chairs.filter(
          (n) => !f.visits.some((v) => v.branchId === f.branch.id && v.chairNumber === n && overlaps(start, freeAt, v.start, v.chairFreeAt)),
        );
        if (chairs.length === 0) continue;
        const slot = byStart.get(minute) ?? { start, dentists: [] };
        slot.dentists.push({ id: dentist.id, name: dentist.name, chairs });
        byStart.set(minute, slot);
      }
    }
  }
  return [...byStart.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot);
}
```

- [ ] **Step 9: Run the unit tests and commit**

```powershell
npx vitest run --project unit
git add -A
git commit -m "feat: add the visit lifecycle, booking checks, and open times as pure rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: every unit test passes, including 6 lifecycle, 11 booking-rules, and 7 slots tests.

---

### Task 2: Patients

**Files:**
- Create: `src/lib/patients.ts`, `src/server/patients.ts`, `src/app/api/v1/patients/route.ts`, `src/app/api/v1/patients/[id]/route.ts`, `src/app/api/v1/patients/[id]/visits/route.ts`
- Modify: `src/lib/fetcher.ts` (`ErrorBody` gains `candidates`)
- Test: `tests/unit/patients.test.ts`, `tests/db/patients.test.ts`

**Interfaces:**
- Consumes: `ALLERGIES`, tables (`@/db/schema`); `mobileSchema` (`@/lib/validation`); `requireCan`, `forbidden`, `notFound`, `ApiError`, `audit`, `staffRoute`, `readJson`, `json`; `manilaDate`.
- Produces:
  - `@/lib/patients` (browser-safe): `ALLERGY_KEYS`, `type Allergy`, `ALLERGY_LABELS`, `ageOn(birthday, date): number`, `alertLines({ allergies, allergiesOther, medicalAlerts }): string[]`, `fullName({ lastName, firstName, middleName? }): string`.
  - `@/server/patients`: `patientSchema`, `createPatientSchema`, `updatePatientSchema`, `type PatientSummary = { id; chartNo; lastName; firstName; birthday; mobile; hasAlerts }`, `searchPatients(actor, q)`, `createPatient(actor, input): Promise<{ id; chartNo }>`, `getPatient(actor, id)`, `updatePatient(actor, id, patch)`, `type PatientVisit`, `patientVisits(actor, id): Promise<{ visits: PatientVisit[]; next: PatientVisit | null }>`.
  - Routes: `GET /patients?q` (20 results), `POST /patients` (201 `{ id, chartNo }`; 409 `possible_duplicate` with `candidates`), `GET /patients/{id}`, `PATCH /patients/{id}`, `GET /patients/{id}/visits`.

- [ ] **Step 1: Write the failing unit test, `tests/unit/patients.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ALLERGIES } from "@/db/schema";
import { ageOn, ALLERGY_KEYS, alertLines, fullName } from "@/lib/patients";

describe("patient helpers", () => {
  it("lists the same allergies as the database", () => {
    expect([...ALLERGY_KEYS]).toEqual([...ALLERGIES]);
  });

  it("counts whole years", () => {
    expect(ageOn("2010-10-05", "2026-10-05")).toBe(16);
    expect(ageOn("2010-10-06", "2026-10-05")).toBe(15);
    expect(ageOn("2012-02-29", "2026-02-28")).toBe(13);
    expect(ageOn("2012-02-29", "2026-03-01")).toBe(14);
  });

  it("puts allergies and alerts in words", () => {
    expect(alertLines({ allergies: ["latex", "penicillin"], allergiesOther: "Shellfish", medicalAlerts: " On warfarin " })).toEqual([
      "Allergy: Latex",
      "Allergy: Penicillin or other antibiotics",
      "Allergy: Shellfish",
      "On warfarin",
    ]);
    expect(alertLines({ allergies: [], allergiesOther: null, medicalAlerts: "" })).toEqual([]);
  });

  it("writes names last name first", () => {
    expect(fullName({ lastName: "Santos", firstName: "Ana", middleName: "Reyes" })).toBe("Santos, Ana Reyes");
    expect(fullName({ lastName: "Santos", firstName: "Ana" })).toBe("Santos, Ana");
  });
});
```

- [ ] **Step 2: Write `src/lib/patients.ts` and run the unit test**

```ts
/** The allergies the PDA form lists (src/db/schema.ts keeps the same keys for its check constraint). */
export const ALLERGY_KEYS = ["local_anesthetic", "penicillin", "sulfa", "aspirin", "latex"] as const;
export type Allergy = (typeof ALLERGY_KEYS)[number];

export const ALLERGY_LABELS: Record<Allergy, string> = {
  local_anesthetic: "Local anesthetic (for example lidocaine)",
  penicillin: "Penicillin or other antibiotics",
  sulfa: "Sulfa drugs",
  aspirin: "Aspirin",
  latex: "Latex",
};

/** Whole years from a birthday to a date, both "YYYY-MM-DD". */
export function ageOn(birthday: string, date: string): number {
  const [by, bm, bd] = birthday.split("-").map(Number);
  const [y, m, d] = date.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/** Allergies and medical alerts in words, for the red banner. Empty when there are none. */
export function alertLines(p: { allergies: readonly string[]; allergiesOther: string | null; medicalAlerts: string }): string[] {
  const lines = p.allergies.map((a) => `Allergy: ${ALLERGY_LABELS[a as Allergy] ?? a}`);
  if (p.allergiesOther) lines.push(`Allergy: ${p.allergiesOther}`);
  if (p.medicalAlerts.trim()) lines.push(p.medicalAlerts.trim());
  return lines;
}

export function fullName(p: { lastName: string; firstName: string; middleName?: string | null }): string {
  return `${p.lastName}, ${p.firstName}${p.middleName ? ` ${p.middleName}` : ""}`;
}
```

```powershell
npx vitest run tests/unit/patients.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 3: Write the failing database test, `tests/db/patients.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as patientRoute from "@/app/api/v1/patients/[id]/route";
import * as visitsRoute from "@/app/api/v1/patients/[id]/visits/route";
import * as patientsRoute from "@/app/api/v1/patients/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, patients, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

async function frontDesk() {
  const branch = await makeBranch({ name: "Downtown" });
  const manager = await makeUser({ role: "manager", branchIds: [branch.id] });
  return { branch, manager, cookie: await signIn(manager.username) };
}
const add = (cookie: string, body: unknown) => call(patientsRoute.POST, request("/api/v1/patients", { method: "POST", cookie, body }));
const find = async (cookie: string, q: string) =>
  ((await (await call(patientsRoute.GET, request(`/api/v1/patients?q=${encodeURIComponent(q)}`, { cookie }))).json()) as { id: string }[]).map((p) => p.id);

describe("patients", () => {
  it("adds a patient, blanks become empty, and the consent is recorded with who recorded it", async () => {
    const { manager, cookie } = await frontDesk();
    const res = await add(cookie, { lastName: "Santos", firstName: "Ana", middleName: "", birthday: "1990-04-02", mobile: "0917 123 4567", allergies: ["latex"], medicalAlerts: "Hypertension", consent: true });
    expect(res.status).toBe(201);
    const { id, chartNo } = await res.json();
    expect(chartNo).toBeGreaterThan(0);
    const [row] = await db.select().from(patients).where(eq(patients.id, id));
    expect(row).toMatchObject({ middleName: null, mobile: "+639171234567", allergies: ["latex"], consentBy: manager.id, createdBy: manager.id });
    expect(row.consentAt).not.toBeNull();
  });

  it("finds patients by name, chart number, mobile, and birthday", async () => {
    const { cookie } = await frontDesk();
    const { id, chartNo } = await (await add(cookie, { lastName: "Villanueva", firstName: "Carlo", birthday: "1985-12-25", mobile: "09181112222" })).json();
    expect(await find(cookie, "villanu")).toContain(id);
    expect(await find(cookie, "Carlo Villanueva")).toContain(id);
    expect(await find(cookie, String(chartNo))).toContain(id);
    expect(await find(cookie, "0918 111 2222")).toContain(id);
    expect(await find(cookie, "1985-12-25")).toContain(id);
    expect(await find(cookie, "nobody at all")).toEqual([]);
  });

  it("warns about a likely duplicate and adds it when told to", async () => {
    const { cookie } = await frontDesk();
    await add(cookie, { lastName: "Reyes", firstName: "Lia", birthday: "2001-01-01" });
    const again = await add(cookie, { lastName: "reyes", firstName: "LIA", birthday: "2001-01-01" });
    expect(again.status).toBe(409);
    const body = (await again.json()).error;
    expect(body.code).toBe("possible_duplicate");
    expect(body.candidates).toHaveLength(1);
    expect((await add(cookie, { lastName: "Reyes", firstName: "Lia", birthday: "2001-01-01", allowDuplicate: true })).status).toBe(201);
    await add(cookie, { lastName: "Cruz", firstName: "Ben", mobile: "09170000001" });
    expect((await add(cookie, { lastName: "Cruz-Tan", firstName: "Ben", mobile: "09170000001" })).status).toBe(409);
  });

  it("checks the fields", async () => {
    const { cookie } = await frontDesk();
    const res = await add(cookie, { lastName: "", firstName: "Ana", mobile: "12345", email: "not-an-email", allergies: ["peanuts"] });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["allergies.0", "email", "lastName", "mobile"]);
  });

  it("lets dentists read patients and change only allergies and alerts", async () => {
    const { branch, cookie } = await frontDesk();
    const { id } = await (await add(cookie, { lastName: "Lopez", firstName: "Mara" })).json();
    const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
    const dentistCookie = await signIn(dentist.username);
    expect((await add(dentistCookie, { lastName: "New", firstName: "Person" })).status).toBe(403);
    const patch = (body: unknown) => call(patientRoute.PATCH, request(`/api/v1/patients/${id}`, { method: "PATCH", cookie: dentistCookie, body }), { id });
    expect((await patch({ allergies: ["aspirin"], medicalAlerts: "Asthma" })).status).toBe(200);
    expect((await patch({ address: "Somewhere" })).status).toBe(403);
    const [row] = await db.select().from(patients).where(eq(patients.id, id));
    expect(row).toMatchObject({ allergies: ["aspirin"], medicalAlerts: "Asthma", updatedBy: dentist.id });
  });

  it("logs each view of a record, and changed field names without their values", async () => {
    const { manager, cookie } = await frontDesk();
    const { id } = await (await add(cookie, { lastName: "Tan", firstName: "Leo" })).json();
    const res = await call(patientRoute.GET, request(`/api/v1/patients/${id}`, { cookie }), { id });
    expect(res.status).toBe(200);
    expect((await res.json()).lastName).toBe("Tan");
    await call(patientRoute.PATCH, request(`/api/v1/patients/${id}`, { method: "PATCH", cookie, body: { medicalAlerts: "Diabetes" } }), { id });
    const log = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    const view = log.find((l) => l.action === "patient.view");
    expect(view?.userId).toBe(manager.id);
    const update = log.find((l) => l.action === "patient.updated");
    expect(update?.details).toEqual({ fields: ["medicalAlerts"] });
    expect(JSON.stringify(log)).not.toContain("Diabetes");
  });

  it("lists visits at every branch with the next one", async () => {
    const { branch, cookie } = await frontDesk();
    const other = await makeBranch({ name: "Westside" });
    await db.insert(chairs).values([{ branchId: branch.id, number: 1, label: "General" }, { branchId: other.id, number: 1 }]);
    const dentist = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [branch.id, other.id] });
    const [proc] = await db.insert(procedures).values({ name: `Cleaning ${Date.now()}`, durationMinutes: 45, bufferMinutes: 15 }).returning();
    const { id } = await (await add(cookie, { lastName: "Uy", firstName: "Kim" })).json();
    const visit = async (branchId: string, start: Date, status: string) => {
      const [row] = await db
        .insert(appointments)
        .values({ patientId: id, dentistId: dentist.id, branchId, chairNumber: 1, startTime: start, endTime: new Date(start.getTime() + 45 * 60_000), chairFreeAt: new Date(start.getTime() + 60 * 60_000), status, source: "staff" })
        .returning();
      await db.insert(appointmentProcedures).values({ appointmentId: row.id, position: 0, procedureId: proc.id, name: "Cleaning", durationMinutes: 45, bufferMinutes: 15 });
      return row;
    };
    await visit(other.id, new Date(Date.now() - 30 * 86_400_000), "requested");
    const next = await visit(branch.id, new Date(Date.now() + 7 * 86_400_000), "confirmed");
    const res = await (await call(visitsRoute.GET, request(`/api/v1/patients/${id}/visits`, { cookie }), { id })).json();
    expect(res.visits.map((v: { branchName: string }) => v.branchName)).toEqual(["Downtown", "Westside"]);
    expect(res.visits[0]).toMatchObject({ dentistName: "Dr. Reyes", chairNumber: 1, chairLabel: "General", procedures: ["Cleaning"], status: "confirmed" });
    expect(res.next.id).toBe(next.id);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

```powershell
npx vitest run tests/db/patients.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 5: Let failed calls carry duplicate candidates, in `src/lib/fetcher.ts`**

Add `candidates?: unknown[];` to the `ErrorBody` type, after `warnings`.

- [ ] **Step 6: Write `src/server/patients.ts`**

```ts
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ALLERGIES, appointmentProcedures, appointments, branches, chairs, patients, users } from "@/db/schema";
import { ACTIVE, type Status } from "@/lib/lifecycle";
import { can } from "@/lib/permissions";
import { manilaDate } from "@/lib/time";
import { mobileSchema, normalizeMobile } from "@/lib/validation";
import { audit } from "./audit";
import { branchByCode } from "./branches";
import { ApiError, forbidden, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

/** Form fields arrive as strings; an empty one means "nothing". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();
const text = (max: number) => optional(z.string().trim().max(max, `Use at most ${max} characters`));
const isoDate = z.iso.date("Use a date like 1990-04-02");

export const patientSchema = z.object({
  lastName: z.string().trim().min(1, "Enter the last name").max(50, "Use at most 50 characters"),
  firstName: z.string().trim().min(1, "Enter the first name").max(50, "Use at most 50 characters"),
  middleName: text(50),
  birthday: optional(isoDate.refine((d) => d >= "1900-01-01" && d <= manilaDate(new Date()), "Use a real birthday")),
  sex: optional(z.enum(["female", "male"])),
  mobile: optional(mobileSchema),
  email: optional(z.string().trim().max(254, "Use at most 254 characters").pipe(z.email("Use an email like name@example.com"))),
  address: text(200),
  occupation: text(60),
  guardianName: text(100),
  emergencyName: text(100),
  emergencyMobile: optional(mobileSchema),
  hmoProvider: text(60),
  hmoMemberNo: text(40),
  insuranceEffective: optional(isoDate),
  allergies: z.array(z.enum(ALLERGIES)).max(ALLERGIES.length).optional(),
  allergiesOther: text(100),
  medicalAlerts: z.string().trim().max(500, "Use at most 500 characters").optional(),
  consent: z.boolean().optional(),
});

export const createPatientSchema = patientSchema.extend({
  allowDuplicate: z.boolean().optional(),
  homeBranch: z.string().optional(),
});

export const updatePatientSchema = patientSchema.partial();

export type PatientSummary = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  birthday: string | null;
  mobile: string | null;
  hasAlerts: boolean;
};

const hasAlerts = sql<boolean>`(cardinality(${patients.allergies}) > 0 or ${patients.allergiesOther} is not null or ${patients.medicalAlerts} <> '')`;
const summary = {
  id: patients.id,
  chartNo: patients.chartNo,
  lastName: patients.lastName,
  firstName: patients.firstName,
  birthday: patients.birthday,
  mobile: patients.mobile,
  hasAlerts,
};

const likeTerm = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Search by name, chart number, mobile, or birthday (YYYY-MM-DD). An empty search lists the latest updated patients. */
export async function searchPatients(actor: Staff, q: string): Promise<PatientSummary[]> {
  requireCan(actor, "patient.view");
  const term = q.trim().slice(0, 80);
  const query = db.select(summary).from(patients);
  if (!term) return query.orderBy(desc(patients.updatedAt)).limit(20);
  const pattern = likeTerm(term);
  const matches: (SQL | undefined)[] = [
    ilike(sql`${patients.lastName} || ', ' || ${patients.firstName}`, pattern),
    ilike(sql`${patients.firstName} || ' ' || ${patients.lastName}`, pattern),
  ];
  if (/^\d{1,9}$/.test(term)) matches.push(eq(patients.chartNo, Number(term)));
  const mobile = normalizeMobile(term);
  if (mobile) matches.push(eq(patients.mobile, mobile));
  if (/^\d{4}-\d{2}-\d{2}$/.test(term)) matches.push(eq(patients.birthday, term));
  return query.where(or(...matches)).orderBy(asc(patients.lastName), asc(patients.firstName)).limit(20);
}

async function duplicates(p: { lastName: string; firstName: string; birthday?: string | null; mobile?: string | null }): Promise<PatientSummary[]> {
  const sameName = and(sql`lower(${patients.lastName}) = lower(${p.lastName})`, sql`lower(${patients.firstName}) = lower(${p.firstName})`);
  const checks: SQL[] = [];
  if (p.birthday) checks.push(and(sameName, eq(patients.birthday, p.birthday)) as SQL);
  if (p.mobile) checks.push(and(eq(patients.mobile, p.mobile), sql`lower(${patients.firstName}) = lower(${p.firstName})`) as SQL);
  if (checks.length === 0) return [];
  return db.select(summary).from(patients).where(or(...checks)).limit(5);
}

/** Spec 10: a patient with the same name and birthday, or the same mobile and first name, is probably already on file. */
export async function createPatient(actor: Staff, input: z.infer<typeof createPatientSchema>): Promise<{ id: string; chartNo: number }> {
  requireCan(actor, "patient.edit");
  const { allowDuplicate, homeBranch, consent, ...fields } = input;
  if (!allowDuplicate) {
    const candidates = await duplicates(fields);
    if (candidates.length > 0) {
      throw new ApiError(409, "possible_duplicate", "This patient may already be on file.", { candidates });
    }
  }
  const home = homeBranch ? await branchByCode(homeBranch) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(patients)
      .values({
        ...fields,
        allergies: fields.allergies ?? [],
        medicalAlerts: fields.medicalAlerts ?? "",
        consentAt: consent ? new Date() : null,
        consentBy: consent ? actor.id : null,
        homeBranchId: home?.id ?? null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning({ id: patients.id, chartNo: patients.chartNo });
    await audit({ userId: actor.id, action: "patient.created", entity: "patient", entityId: row.id, branchId: home?.id ?? null }, tx);
    return row;
  });
}

/** One patient record. Every view is written to the audit log (spec 13). */
export async function getPatient(actor: Staff, id: string) {
  requireCan(actor, "patient.view");
  const [row] = await db
    .select({ patient: patients, consentByName: users.name, homeBranchName: branches.name })
    .from(patients)
    .leftJoin(users, eq(users.id, patients.consentBy))
    .leftJoin(branches, eq(branches.id, patients.homeBranchId))
    .where(eq(patients.id, id));
  if (!row) throw notFound("That patient");
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: id, details: { part: "details" } });
  return { ...row.patient, consentByName: row.consentByName, homeBranchName: row.homeBranchName };
}

const ALERT_FIELDS = new Set(["allergies", "allergiesOther", "medicalAlerts"]);

/** Owner and front desk change everything; a dentist changes allergies and medical alerts only (spec 5). */
export async function updatePatient(actor: Staff, id: string, patch: z.infer<typeof updatePatientSchema>): Promise<void> {
  const changed = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  if (changed.length === 0) throw new ApiError(400, "invalid", "Nothing to change.");
  if (!can(actor, "patient.edit")) {
    if (changed.some((key) => !ALERT_FIELDS.has(key))) throw forbidden("You can change allergies and medical alerts only.");
    requireCan(actor, "patient.editAlerts");
  }
  const { consent, ...fields } = patch;
  await db.transaction(async (tx) => {
    const [current] = await tx.select({ consentAt: patients.consentAt }).from(patients).where(eq(patients.id, id)).for("update");
    if (!current) throw notFound("That patient");
    await tx
      .update(patients)
      .set({
        ...fields,
        ...(consent && !current.consentAt ? { consentAt: new Date(), consentBy: actor.id } : {}),
        updatedAt: new Date(),
        updatedBy: actor.id,
      })
      .where(eq(patients.id, id));
    await audit({ userId: actor.id, action: "patient.updated", entity: "patient", entityId: id, details: { fields: changed } }, tx);
  });
}

export type PatientVisit = {
  id: string;
  start: Date;
  end: Date;
  status: Status;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistName: string;
  procedures: string[];
};

/** Every visit of a patient, newest first, at every branch (spec 9.3), and their next active visit. */
export async function patientVisits(actor: Staff, id: string): Promise<{ visits: PatientVisit[]; next: PatientVisit | null }> {
  requireCan(actor, "patient.view");
  const rows = await db
    .select({
      id: appointments.id,
      start: appointments.startTime,
      end: appointments.endTime,
      status: appointments.status,
      branchCode: branches.code,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
      dentistName: users.name,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(eq(appointments.patientId, id))
    .orderBy(desc(appointments.startTime));
  const ids = rows.map((r) => r.id);
  const procs = ids.length
    ? await db.select().from(appointmentProcedures).where(inArray(appointmentProcedures.appointmentId, ids)).orderBy(asc(appointmentProcedures.position))
    : [];
  const visits = rows.map((r) => ({
    ...r,
    status: r.status as Status,
    chairLabel: r.chairLabel ?? "",
    procedures: procs.filter((p) => p.appointmentId === r.id).map((p) => p.name),
  }));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: id, details: { part: "visits" } });
  const now = Date.now();
  const upcoming = visits
    .filter((v) => ACTIVE.includes(v.status) && v.start.getTime() > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return { visits, next: upcoming[0] ?? null };
}
```

- [ ] **Step 7: Write the routes**

`src/app/api/v1/patients/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { createPatient, createPatientSchema, searchPatients } from "@/server/patients";

export const GET = staffRoute(async (req, staff) => json(await searchPatients(staff, req.nextUrl.searchParams.get("q") ?? "")));

export const POST = staffRoute(async (req, staff) => json(await createPatient(staff, await readJson(req, createPatientSchema)), 201));
```

`src/app/api/v1/patients/[id]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { getPatient, updatePatient, updatePatientSchema } from "@/server/patients";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await getPatient(staff, id)));

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await updatePatient(staff, id, await readJson(req, updatePatientSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/patients/[id]/visits/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { patientVisits } from "@/server/patients";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientVisits(staff, id)));
```

- [ ] **Step 8: Run the tests**

```powershell
npx vitest run tests/db/patients.test.ts tests/unit/patients.test.ts
```

Expected: PASS, 7 and 4 tests.

- [ ] **Step 9: Commit**

```powershell
npm run lint; npm run typecheck
git add -A
git commit -m "feat: add patients with search, duplicate warnings, alerts, and audited views" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Booking, moving, and the visit lifecycle

**Files:**
- Create: `src/server/booking.ts`, `src/server/appointments.ts`
- Create routes: `src/app/api/v1/appointments/route.ts`, `src/app/api/v1/appointments/validate/route.ts`, `src/app/api/v1/appointments/[id]/route.ts`, `src/app/api/v1/appointments/[id]/transitions/route.ts`, `src/app/api/v1/chairs/conflicts/route.ts`
- Test: `tests/db/appointments.test.ts`

**Interfaces:**
- Consumes: Task 1's `checkBooking`, `conflictFor`, `ACTIVE`, `STATUSES`, `NEXT`, `actionFor`, `changeProblem`, `STATUS_LABEL`; Task 2's `alertLines`; plan A's `requireBranch`, `requireCan`, `audit`, `ApiError`, `forbidden`, `notFound`, `pgCode`, `staffRoute`, `readJson`, `json`.
- Produces:
  - `@/server/booking`: `activeVisits(tx, from, until, where?)`, `type BookingRequest = { branchId; chairNumber; dentistId; patientId; start: Date; procedureIds: string[]; walkIn: boolean; excludeId?: string | null }`, `type ProcedureSnapshot`, `bookingFacts(tx, request, now)`.
  - `@/server/appointments`: `bookingSchema`, `validateSchema`, `moveSchema`, `transitionSchema`, `listSchema`, `conflictsSchema`, `type Check`, `type VisitView`, `validateBooking(actor, input): Promise<Check>`, `createAppointment(actor, input): Promise<{ id }>`, `moveAppointment(actor, id, input)`, `transitionAppointment(actor, id, input)`, `listAppointments(actor, query): Promise<VisitView[]>`, `appointmentDetail(actor, id)`, `chairConflicts(actor, query)`.
  - Routes (spec 11): `GET /appointments?branch&from&to&dentist`, `POST /appointments` (201 `{ id }`; 409 `conflict` or 422 `refused` with `errors`, `warnings`, `conflicts`; 422 `warnings` until `acknowledgeWarnings`), `POST /appointments/validate` (200 `Check`), `GET /appointments/{id}`, `PATCH /appointments/{id}`, `POST /appointments/{id}/transitions` (`{ to, reason? }`), `GET /chairs/conflicts?branch&chair&from&until&exclude`.

- [ ] **Step 1: Write the failing test, `tests/db/appointments.test.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as transitionsRoute from "@/app/api/v1/appointments/[id]/transitions/route";
import * as appointmentRoute from "@/app/api/v1/appointments/[id]/route";
import * as appointmentsRoute from "@/app/api/v1/appointments/route";
import * as validateRoute from "@/app/api/v1/appointments/validate/route";
import * as conflictsRoute from "@/app/api/v1/chairs/conflicts/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, dentistSchedules, patients, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);

// 08:00 on Monday in Manila, for the whole file: time rules and "now" are deterministic, and PGlite follows it too.
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  const ws = await makeBranch({ code: "westside", name: "Westside" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1, label: "General" },
    { branchId: dt.id, number: 2, label: "Ortho" },
    { branchId: ws.id, number: 1, label: "General" },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id, ws.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values([
    { dentistId: reyes.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    { dentistId: reyes.id, branchId: ws.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
  ]);
  const [cleaning] = await db.insert(procedures).values({ name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 }).returning();
  const [filling] = await db.insert(procedures).values({ name: "Tooth filling", durationMinutes: 60, bufferMinutes: 15 }).returning();
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana", allergies: ["latex"] }).returning();
  const [ben] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
  const [cyd] = await db.insert(patients).values({ lastName: "Uy", firstName: "Cyd" }).returning();
  const deskDtUser = await makeUser({ role: "manager", branchIds: [dt.id] });
  const deskWs = await makeUser({ role: "manager", branchIds: [ws.id] });
  return {
    dt, ws, reyes, lim, cleaning, filling, ana, ben, cyd, deskDtUser,
    deskDt: await signIn(deskDtUser.username),
    deskWs: await signIn(deskWs.username),
    reyesCookie: await signIn(reyes.username),
    limCookie: await signIn(lim.username),
  };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const book = (cookie: string, body: Record<string, unknown>) =>
  call(appointmentsRoute.POST, request("/api/v1/appointments", { method: "POST", cookie, body }));
const move = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(appointmentRoute.PATCH, request(`/api/v1/appointments/${id}`, { method: "PATCH", cookie, body }), { id });
const change = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(transitionsRoute.POST, request(`/api/v1/appointments/${id}/transitions`, { method: "POST", cookie, body }), { id });
const visitRow = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

/** Runs `meanwhile` just before the next transaction starts, as if another front desk saved first (spec 8.8). */
function beforeNextTransaction(meanwhile: () => Promise<unknown>) {
  const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
  const original = real.transaction.bind(real);
  return vi.spyOn(real, "transaction").mockImplementationOnce((async (run: never, config: never) => {
    await meanwhile();
    return original(run, config);
  }) as never);
}

let first = ""; // Ana with Dr. Reyes, booked in the first test and used by later ones
let requested = "";
let walkIn = "";
let evening = "";

describe("booking", () => {
  it("books a visit and holds its chair through turnover", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ana.id, start: at("10:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(201);
    first = (await res.json()).id;
    const row = await visitRow(first);
    expect(row).toMatchObject({ status: "confirmed", source: "staff", chairNumber: 1 });
    expect(row.endTime.toISOString()).toBe(at("10:45").toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("11:00").toISOString());
    const snapshot = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, first));
    expect(snapshot).toMatchObject([{ position: 0, name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 }]);
    const log = await db.select().from(auditLog).where(and(eq(auditLog.entityId, first), eq(auditLog.action, "appointment.created")));
    expect(log).toHaveLength(1);
  });

  it("answers validation without saving", async () => {
    const w = await world();
    const res = await call(
      validateRoute.POST,
      request("/api/v1/appointments/validate", { method: "POST", cookie: w.deskDt, body: { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("10:30").toISOString(), procedureIds: [w.cleaning.id] } }),
    );
    expect(res.status).toBe(200);
    const check = await res.json();
    expect(check.ok).toBe(false);
    expect(check.errors.map((e: { code: string }) => e.code)).toEqual(["chair_overlap"]);
    expect(check.conflicts).toMatchObject([{ kind: "chair", appointmentId: first, chairNumber: 1, branch: "Downtown" }]);
    expect(await db.select().from(appointments)).toHaveLength(1);
  });

  it("refuses a dentist where the schedule puts them at another branch", async () => {
    const w = await world();
    const res = await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("11:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(422);
    const error = (await res.json()).error;
    expect(error.code).toBe("refused");
    expect(error.errors.map((e: { code: string }) => e.code)).toEqual(["dentist_elsewhere"]);
    expect(error.message).toBe("Dr. Reyes works at Downtown from 09:00 to 12:00 on Monday.");
  });

  it("refuses one dentist at two branches at once with 409, naming the visit", async () => {
    const w = await world();
    await db.insert(appointments).values({ patientId: w.cyd.id, dentistId: w.reyes.id, branchId: w.dt.id, chairNumber: 2, startTime: at("13:00"), endTime: at("13:30"), chairFreeAt: at("13:30"), status: "confirmed", source: "staff" });
    const res = await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("13:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(409);
    const error = (await res.json()).error;
    expect(error.code).toBe("conflict");
    expect(error.conflicts).toMatchObject([{ kind: "dentist", branch: "Downtown", dentist: "Dr. Reyes" }]);
  });

  it("asks for a second look outside hours, then books it", async () => {
    const w = await world();
    const body = { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.ben.id, start: at("17:30").toISOString(), procedureIds: [w.filling.id] };
    const first = await book(w.deskDt, body);
    expect(first.status).toBe(422);
    const error = (await first.json()).error;
    expect(error.code).toBe("warnings");
    expect(error.warnings.map((x: { code: string }) => x.code)).toEqual(["outside_dentist_hours", "outside_branch_hours"]);
    const again = await book(w.deskDt, { ...body, acknowledgeWarnings: true });
    expect(again.status).toBe(201);
    evening = (await again.json()).id;
  });

  it("books a walk-in now, as checked in", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.cyd.id, walkIn: true, procedureIds: [w.cleaning.id], acknowledgeWarnings: true });
    expect(res.status).toBe(201);
    walkIn = (await res.json()).id;
    const row = await visitRow(walkIn);
    expect(row).toMatchObject({ status: "checked_in", source: "walk_in" });
    expect(row.startTime.toISOString()).toBe(at("08:00").toISOString());
    expect(row.checkedInAt).not.toBeNull();
  });

  it("books a visit as requested while the patient still has to confirm", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.cyd.id, start: at("11:00").toISOString(), procedureIds: [w.cleaning.id], requested: true });
    expect(res.status).toBe(201);
    requested = (await res.json()).id;
    expect(await visitRow(requested)).toMatchObject({ status: "requested", confirmedAt: null });
  });

  it("refuses another branch's front desk and starts off the grid", async () => {
    const w = await world();
    const body = { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("14:00").toISOString(), procedureIds: [w.cleaning.id] };
    expect((await book(w.deskWs, body)).status).toBe(403);
    const odd = await book(w.deskDt, { ...body, start: at("14:10").toISOString() });
    expect(odd.status).toBe(400);
    expect((await odd.json()).error.fields).toEqual({ start: "Pick a start on the 15-minute grid." });
  });
});

describe("moving", () => {
  it("moves a confirmed visit and keeps its status", async () => {
    const w = await world();
    const res = await move(w.deskDt, first, { start: at("11:15").toISOString(), chairNumber: 2 });
    expect(res.status).toBe(200);
    const row = await visitRow(first);
    expect(row).toMatchObject({ status: "confirmed", chairNumber: 2 });
    expect(row.startTime.toISOString()).toBe(at("11:15").toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("12:15").toISOString());
  });

  it("lets a checked-in visit change only its chair", async () => {
    const w = await world();
    expect((await move(w.deskDt, walkIn, { chairNumber: 1 })).status).toBe(200);
    expect((await visitRow(walkIn)).chairNumber).toBe(1);
    const res = await move(w.deskDt, walkIn, { start: at("09:00").toISOString() });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("A checked-in visit can change only its chair.");
  });

  it("refuses a move that lost a race to another change of the same visit, and keeps dentists from moving visits", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("15:00").toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await move(w.limCookie, id, { chairNumber: 2 })).status).toBe(403);
    // Another front desk moves it to chair 2 after this move read the visit and before it saved (spec 8.8).
    const race = beforeNextTransaction(() => db.update(appointments).set({ chairNumber: 2 }).where(eq(appointments.id, id)));
    const late = await move(w.deskDt, id, { start: at("15:30").toISOString() });
    race.mockRestore();
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe("changed");
    const row = await visitRow(id);
    expect(row.chairNumber).toBe(2);
    expect(row.startTime.toISOString()).toBe(at("15:00").toISOString());
    const bare = await change(w.deskDt, id, { to: "cancelled", reason: null });
    expect((await bare.json()).error.fields).toEqual({ reason: "Give a reason for cancelling." });
  });
});

describe("lifecycle", () => {
  it("lets each role make only its own changes, in order, on time", async () => {
    const w = await world();
    expect((await change(w.reyesCookie, first, { to: "checked_in" })).status).toBe(403);
    const early = await change(w.deskDt, first, { to: "no_show" });
    expect(early.status).toBe(422);
    expect((await early.json()).error.message).toBe("A visit becomes a no-show only after its start time.");
    expect((await change(w.deskDt, first, { to: "checked_in" })).status).toBe(200);
    expect((await change(w.limCookie, first, { to: "in_treatment" })).status).toBe(403);
    expect((await change(w.reyesCookie, first, { to: "in_treatment" })).status).toBe(200);
    expect((await change(w.reyesCookie, first, { to: "completed" })).status).toBe(200);
    const done = await visitRow(first);
    expect(done.status).toBe("completed");
    expect(done.completedAt).not.toBeNull();
  });

  it("needs a reason to cancel and never reopens a cancelled visit", async () => {
    const w = await world();
    const bare = await change(w.deskDt, requested, { to: "cancelled" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.fields).toEqual({ reason: "Give a reason for cancelling." });
    expect((await change(w.deskDt, requested, { to: "cancelled", reason: "Patient called" })).status).toBe(200);
    expect(await visitRow(requested)).toMatchObject({ status: "cancelled", cancelReason: "Patient called" });
    const reopen = await change(w.deskDt, requested, { to: "confirmed" });
    expect(reopen.status).toBe(422);
    expect((await reopen.json()).error.message).toBe("A cancelled visit cannot become confirmed.");
  });

  it("checks in only on the visit's day and marks no-shows after the start", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 1, dentistId: w.lim.id, patientId: w.ben.id, start: at("10:00", TUESDAY).toISOString(), procedureIds: [w.cleaning.id] });
    const { id } = await res.json();
    const tooSoon = await change(w.deskDt, id, { to: "checked_in" });
    expect(tooSoon.status).toBe(422);
    expect((await tooSoon.json()).error.message).toBe("Check in on the day of the visit.");
    vi.setSystemTime(at("10:30", TUESDAY));
    try {
      // Monday's sessions have expired by Tuesday (12 hours, spec 6.7), so sign in again.
      const desk = await signIn(w.deskDtUser.username);
      expect((await change(desk, id, { to: "no_show" })).status).toBe(200);
      expect((await change(desk, id, { to: "checked_in" })).status).toBe(200);
    } finally {
      vi.setSystemTime(at("08:00"));
    }
  });
});

describe("reading visits", () => {
  it("lists a branch's visits and a dentist's own visits at every branch", async () => {
    const w = await world();
    const range = `from=${encodeURIComponent(at("00:00").toISOString())}&to=${encodeURIComponent(at("00:00", TUESDAY).toISOString())}`;
    const list = async (cookie: string, query: string) => call(appointmentsRoute.GET, request(`/api/v1/appointments?${query}&${range}`, { cookie }));
    const day = await (await list(w.deskDt, "branch=downtown")).json();
    const mine = day.find((v: { id: string }) => v.id === first);
    expect(mine).toMatchObject({ patientName: "Santos, Ana", dentistName: "Dr. Reyes", chairLabel: "Ortho", hasAlerts: true, procedures: ["Oral prophylaxis"], status: "completed", branchCode: "downtown" });

    await book(w.deskWs, { branch: "westside", chairNumber: 1, dentistId: w.reyes.id, patientId: w.ben.id, start: at("14:00").toISOString(), procedureIds: [w.cleaning.id] });
    const own = await (await list(w.reyesCookie, `branch=all&dentist=${w.reyes.id}`)).json();
    expect(new Set(own.map((v: { branchName: string }) => v.branchName))).toEqual(new Set(["Downtown", "Westside"]));
    expect((await list(w.reyesCookie, "branch=all")).status).toBe(403);
    expect((await list(w.deskDt, "branch=westside")).status).toBe(403);
  });

  it("shows a visit's alerts, procedures, and history", async () => {
    const w = await world();
    const res = await call(appointmentRoute.GET, request(`/api/v1/appointments/${first}`, { cookie: w.deskDt }), { id: first });
    const detail = await res.json();
    expect(detail.alerts).toEqual(["Allergy: Latex"]);
    expect(detail.procedureIds).toEqual([w.cleaning.id]);
    expect(detail.history.map((h: { text: string }) => h.text)).toEqual([
      "Booked as confirmed",
      expect.stringMatching(/^Moved to .+, chair 2$/),
      "Confirmed to checked in",
      "Checked in to in treatment",
      "In treatment to completed",
    ]);
  });

  it("reports a chair's conflicts, turnover included", async () => {
    const w = await world();
    const ask = async (from: string, until: string) =>
      (
        await (
          await call(conflictsRoute.GET, request(`/api/v1/chairs/conflicts?branch=downtown&chair=2&from=${encodeURIComponent(at(from).toISOString())}&until=${encodeURIComponent(at(until).toISOString())}`, { cookie: w.deskDt }))
        ).json()
      ).map((c: { appointmentId: string }) => c.appointmentId);
    expect(await ask("18:35", "18:40")).toEqual([evening]);
    expect(await ask("18:45", "19:00")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/db/appointments.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 3: Write `src/server/booking.ts`**

```ts
import { and, eq, gt, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { appointments, branches, chairs, dentistSchedules, dentistTimeOff, patients, procedures, userBranches, users } from "@/db/schema";
import type { BookingFacts, Visit } from "@/lib/booking-rules";
import { ACTIVE } from "@/lib/lifecycle";
import { ApiError, notFound } from "./errors";

/** Active visits whose chair time overlaps [from, until), narrowed by `where`. */
export async function activeVisits(tx: Db, from: Date, until: Date, where?: SQL): Promise<Visit[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      branchId: appointments.branchId,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      dentistId: appointments.dentistId,
      dentistName: users.name,
      patientId: appointments.patientId,
      lastName: patients.lastName,
      firstName: patients.firstName,
      start: appointments.startTime,
      end: appointments.endTime,
      chairFreeAt: appointments.chairFreeAt,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(inArray(appointments.status, [...ACTIVE]), lt(appointments.startTime, until), gt(appointments.chairFreeAt, from), where));
  return rows.map(({ lastName, firstName, ...visit }) => ({ ...visit, patientName: `${lastName}, ${firstName}` }));
}

export type BookingRequest = {
  branchId: string;
  chairNumber: number;
  dentistId: string;
  patientId: string;
  start: Date;
  procedureIds: string[];
  walkIn: boolean;
  excludeId?: string | null;
};

export type ProcedureSnapshot = { id: string; name: string; durationMinutes: number; bufferMinutes: number };

/** Everything the booking rules need (spec 8.2 to 8.4), read in one place so the rules stay pure. */
export async function bookingFacts(tx: Db, req: BookingRequest, now: Date): Promise<{ facts: BookingFacts; procedures: ProcedureSnapshot[] }> {
  // Shared locks on the branch and the chair: closing either one waits for this booking, and a closing that committed
  // first is seen here (src/server/branches.ts locks them before counting visits).
  const [branch] = await tx.select().from(branches).where(eq(branches.id, req.branchId)).for("share");
  if (!branch) throw notFound("That branch");
  const [dentist] = await tx.select().from(users).where(eq(users.id, req.dentistId));
  if (!dentist) throw notFound("That dentist");
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, req.patientId));
  if (!patient) throw notFound("That patient");
  const picked = await tx.select().from(procedures).where(inArray(procedures.id, req.procedureIds));
  if (new Set(req.procedureIds).size !== req.procedureIds.length || picked.length !== req.procedureIds.length) {
    throw new ApiError(400, "invalid", "Pick each procedure once, from the list.", {
      fields: { procedureIds: "Pick each procedure once, from the list." },
    });
  }
  const ordered = req.procedureIds.map((id) => picked.find((p) => p.id === id) as (typeof picked)[number]);
  const minutes = ordered.reduce((sum, p) => sum + p.durationMinutes, 0);
  const turnover = Math.max(0, ...ordered.map((p) => p.bufferMinutes));
  const end = new Date(req.start.getTime() + minutes * 60_000);
  const chairFreeAt = new Date(end.getTime() + turnover * 60_000);

  const [chair] = await tx.select().from(chairs).where(and(eq(chairs.branchId, branch.id), eq(chairs.number, req.chairNumber))).for("share");
  const link = await tx
    .select({ id: userBranches.branchId })
    .from(userBranches)
    .where(and(eq(userBranches.userId, dentist.id), eq(userBranches.branchId, branch.id)));
  const blocks = await tx
    .select({ branchId: dentistSchedules.branchId, dayOfWeek: dentistSchedules.dayOfWeek, startTime: dentistSchedules.startTime, endTime: dentistSchedules.endTime })
    .from(dentistSchedules)
    .where(eq(dentistSchedules.dentistId, dentist.id));
  const names = await tx.select({ id: branches.id, name: branches.name }).from(branches);
  const timeOff = await tx
    .select({ startsAt: dentistTimeOff.startsAt, endsAt: dentistTimeOff.endsAt, reason: dentistTimeOff.reason })
    .from(dentistTimeOff)
    .where(and(eq(dentistTimeOff.dentistId, dentist.id), lt(dentistTimeOff.startsAt, end), gt(dentistTimeOff.endsAt, req.start)));
  const visits = await activeVisits(
    tx,
    req.start,
    chairFreeAt,
    and(
      req.excludeId ? ne(appointments.id, req.excludeId) : undefined,
      or(
        eq(appointments.dentistId, dentist.id),
        and(eq(appointments.branchId, branch.id), eq(appointments.chairNumber, req.chairNumber)),
        eq(appointments.patientId, req.patientId),
      ),
    ),
  );

  return {
    procedures: ordered.map(({ id, name, durationMinutes, bufferMinutes }) => ({ id, name, durationMinutes, bufferMinutes })),
    facts: {
      now,
      walkIn: req.walkIn,
      start: req.start,
      end,
      chairFreeAt,
      branch: { id: branch.id, name: branch.name, active: branch.active, hours: branch.operatingHours },
      chair: chair ? { number: chair.number, active: chair.active } : null,
      dentist: {
        id: dentist.id,
        name: dentist.name,
        active: dentist.status === "active",
        seesPatients: dentist.seesPatients,
        worksHere: dentist.role === "owner" || link.length > 0,
      },
      patientId: req.patientId,
      procedures: ordered.map((p) => ({ name: p.name, active: p.active })),
      blocks: blocks.map((b) => ({ ...b, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) })),
      branchNames: new Map(names.map((n) => [n.id, n.name])),
      timeOff,
      visits,
    },
  };
}
```

- [ ] **Step 4: Write `src/server/appointments.ts`**

```ts
import { and, asc, eq, gt, inArray, lt, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, chairs, patients, users } from "@/db/schema";
import { checkBooking, conflictFor, type Conflict, type Finding } from "@/lib/booking-rules";
import { actionFor, changeProblem, STATUS_LABEL, STATUSES, type Status } from "@/lib/lifecycle";
import { alertLines } from "@/lib/patients";
import { can } from "@/lib/permissions";
import { formatDateTime, formatTime, manilaMinutes } from "@/lib/time";
import { audit } from "./audit";
import { activeVisits, bookingFacts, type BookingRequest, type ProcedureSnapshot } from "./booking";
import { requireBranch } from "./branches";
import { ApiError, forbidden, notFound, pgCode } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const instant = z.iso.datetime({ offset: true });

export const bookingSchema = z.object({
  branch: z.string().min(1),
  chairNumber: z.number().int().min(1).max(99),
  dentistId: z.uuid(),
  patientId: z.uuid(),
  start: instant.nullable().optional(),
  procedureIds: z.array(z.uuid()).min(1, "Pick at least one procedure").max(10, "Pick at most 10 procedures"),
  walkIn: z.boolean().optional().default(false),
  requested: z.boolean().optional().default(false),
  note: z.string().trim().max(500, "Use at most 500 characters").optional().default(""),
  acknowledgeWarnings: z.boolean().optional().default(false),
});

export const validateSchema = bookingSchema.extend({ excludeAppointmentId: z.uuid().nullable().optional() });

export const moveSchema = z.object({
  chairNumber: z.number().int().min(1).max(99).optional(),
  dentistId: z.uuid().optional(),
  start: instant.optional(),
  procedureIds: z.array(z.uuid()).min(1).max(10).optional(),
  acknowledgeWarnings: z.boolean().optional().default(false),
});

export const transitionSchema = z.object({
  to: z.enum(STATUSES),
  reason: z.string().trim().min(1, "Give a reason").max(200, "Use at most 200 characters").nullish(),
});

export const listSchema = z.object({ branch: z.string().min(1), from: instant, to: instant, dentist: z.uuid().optional() });

export const conflictsSchema = z.object({
  branch: z.string().min(1),
  chair: z.coerce.number().int().min(1).max(99),
  from: instant,
  until: instant,
  exclude: z.uuid().optional(),
});

export type Check = { ok: boolean; end: Date; chairFreeAt: Date; errors: Finding[]; warnings: Finding[]; conflicts: Conflict[] };

/** A walk-in starts at the current minute; anything else needs a start on the 15-minute grid (spec 8.1). */
function startOf(input: { start?: string | null; walkIn: boolean }, now: Date): Date {
  if (input.walkIn) return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  if (!input.start) throw new ApiError(400, "invalid", "Pick a start time.", { fields: { start: "Pick a start time." } });
  const start = new Date(input.start);
  if (start.getTime() % 60_000 !== 0 || manilaMinutes(start) % 15 !== 0) {
    throw new ApiError(400, "invalid", "Pick a start on the 15-minute grid.", { fields: { start: "Pick a start on the 15-minute grid." } });
  }
  return start;
}

async function check(tx: Db, req: BookingRequest, now: Date): Promise<{ result: Check; procedures: ProcedureSnapshot[] }> {
  const { facts, procedures } = await bookingFacts(tx, req, now);
  const found = checkBooking(facts);
  return { result: { ...found, ok: found.errors.length === 0, end: facts.end, chairFreeAt: facts.chairFreeAt }, procedures };
}

function refuse(result: Check): never {
  const clash = result.conflicts.length > 0;
  throw new ApiError(clash ? 409 : 422, clash ? "conflict" : "refused", result.errors[0].message, {
    errors: result.errors,
    warnings: result.warnings,
    conflicts: result.conflicts,
  });
}

function askToConfirm(result: Check): never {
  throw new ApiError(422, "warnings", "This booking needs a second look. Book it anyway?", { warnings: result.warnings });
}

/** Two desks at once (spec 8.8): the database refused the second booking, so say which visit won. */
async function explainClash(req: BookingRequest): Promise<never> {
  const { result } = await check(db, req, new Date());
  if (result.conflicts.length > 0) refuse(result);
  throw new ApiError(409, "conflict", "That time was just taken. Refresh and try again.");
}

async function saveProcedures(tx: Db, appointmentId: string, list: ProcedureSnapshot[]): Promise<void> {
  await tx.delete(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, appointmentId));
  await tx.insert(appointmentProcedures).values(
    list.map((p, position) => ({ appointmentId, position, procedureId: p.id, name: p.name, durationMinutes: p.durationMinutes, bufferMinutes: p.bufferMinutes })),
  );
}

/** POST /appointments/validate (spec 11.1): the booking check, answered without saving. */
export async function validateBooking(actor: Staff, input: z.infer<typeof validateSchema>): Promise<Check> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const now = new Date();
  const { result } = await check(
    db,
    {
      branchId: branch.id,
      chairNumber: input.chairNumber,
      dentistId: input.dentistId,
      patientId: input.patientId,
      start: startOf(input, now),
      procedureIds: input.procedureIds,
      walkIn: input.walkIn,
      excludeId: input.excludeAppointmentId,
    },
    now,
  );
  return result;
}

export async function createAppointment(actor: Staff, input: z.infer<typeof bookingSchema>): Promise<{ id: string }> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const now = new Date();
  const req: BookingRequest = {
    branchId: branch.id,
    chairNumber: input.chairNumber,
    dentistId: input.dentistId,
    patientId: input.patientId,
    start: startOf(input, now),
    procedureIds: input.procedureIds,
    walkIn: input.walkIn,
  };
  try {
    return await db.transaction(async (tx) => {
      const { result, procedures } = await check(tx, req, now);
      if (!result.ok) refuse(result);
      if (result.warnings.length > 0 && !input.acknowledgeWarnings) askToConfirm(result);
      const status: Status = input.walkIn ? "checked_in" : input.requested ? "requested" : "confirmed";
      const [row] = await tx
        .insert(appointments)
        .values({
          patientId: req.patientId,
          dentistId: req.dentistId,
          branchId: req.branchId,
          chairNumber: req.chairNumber,
          startTime: req.start,
          endTime: result.end,
          chairFreeAt: result.chairFreeAt,
          status,
          source: input.walkIn ? "walk_in" : "staff",
          note: input.note,
          createdBy: actor.id,
        })
        .returning({ id: appointments.id });
      await saveProcedures(tx, row.id, procedures);
      await audit(
        { userId: actor.id, action: "appointment.created", entity: "appointment", entityId: row.id, branchId: req.branchId, details: { status, start: req.start.toISOString() } },
        tx,
      );
      return row;
    });
  } catch (error) {
    if (pgCode(error) === "23P01") return explainClash(req);
    throw error;
  }
}

/** Spec 8.8: locks the visit for the move, and refuses it when the visit changed after it was read (a check-in, another move). */
async function lockUnchanged(tx: Db, visit: typeof appointments.$inferSelect): Promise<void> {
  const [now] = await tx.select().from(appointments).where(eq(appointments.id, visit.id)).for("update");
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  const unchanged =
    now &&
    now.status === visit.status &&
    now.dentistId === visit.dentistId &&
    now.chairNumber === visit.chairNumber &&
    same(now.startTime, visit.startTime) &&
    same(now.endTime, visit.endTime);
  if (!unchanged) throw new ApiError(409, "changed", "Someone just changed this visit. Refresh to see it, then try again.");
}

/** Spec 8.7: a requested or confirmed visit moves through the same checks as a new booking; a checked-in one changes chair only. */
export async function moveAppointment(actor: Staff, id: string, input: z.infer<typeof moveSchema>): Promise<void> {
  const [visit] = await db.select().from(appointments).where(eq(appointments.id, id));
  if (!visit) throw notFound("That visit");
  requireCan(actor, "appointment.manage", { branchId: visit.branchId });
  const status = visit.status as Status;
  const chairNumber = input.chairNumber ?? visit.chairNumber;

  if (status === "checked_in") {
    if ((input.dentistId && input.dentistId !== visit.dentistId) || input.start || input.procedureIds) {
      throw new ApiError(422, "checked_in", "A checked-in visit can change only its chair.");
    }
    await db.transaction(async (tx) => {
      await lockUnchanged(tx, visit);
      const [chair] = await tx.select().from(chairs).where(and(eq(chairs.branchId, visit.branchId), eq(chairs.number, chairNumber))).for("share");
      if (!chair?.active) throw new ApiError(422, "refused", `Chair ${chairNumber} is not in use.`);
      const clashes = await activeVisits(
        tx,
        visit.startTime,
        visit.chairFreeAt,
        and(ne(appointments.id, id), eq(appointments.branchId, visit.branchId), eq(appointments.chairNumber, chairNumber)),
      );
      if (clashes.length > 0) {
        throw new ApiError(409, "conflict", `Chair ${chairNumber} is taken until ${formatTime(clashes[0].chairFreeAt)}, turnover included.`, {
          conflicts: clashes.map((c) => conflictFor("chair", c)),
        });
      }
      await tx.update(appointments).set({ chairNumber, updatedAt: new Date() }).where(eq(appointments.id, id));
      await audit(
        { userId: actor.id, action: "appointment.moved", entity: "appointment", entityId: id, branchId: visit.branchId, details: { start: visit.startTime.toISOString(), chair: chairNumber } },
        tx,
      );
    });
    return;
  }
  if (status !== "requested" && status !== "confirmed") {
    throw new ApiError(422, "cannot_move", "Only a requested, confirmed, or checked-in visit can move.");
  }

  const now = new Date();
  const current = await db
    .select({ id: appointmentProcedures.procedureId })
    .from(appointmentProcedures)
    .where(eq(appointmentProcedures.appointmentId, id))
    .orderBy(asc(appointmentProcedures.position));
  const req: BookingRequest = {
    branchId: visit.branchId,
    chairNumber,
    dentistId: input.dentistId ?? visit.dentistId,
    patientId: visit.patientId,
    start: input.start ? startOf({ start: input.start, walkIn: false }, now) : visit.startTime,
    procedureIds: input.procedureIds ?? current.map((p) => p.id),
    walkIn: false,
    excludeId: id,
  };
  try {
    await db.transaction(async (tx) => {
      await lockUnchanged(tx, visit);
      const { result, procedures } = await check(tx, req, now);
      if (!result.ok) refuse(result);
      if (result.warnings.length > 0 && !input.acknowledgeWarnings) askToConfirm(result);
      await tx
        .update(appointments)
        .set({ chairNumber, dentistId: req.dentistId, startTime: req.start, endTime: result.end, chairFreeAt: result.chairFreeAt, updatedAt: new Date() })
        .where(eq(appointments.id, id));
      await saveProcedures(tx, id, procedures);
      await audit(
        { userId: actor.id, action: "appointment.moved", entity: "appointment", entityId: id, branchId: visit.branchId, details: { start: req.start.toISOString(), chair: chairNumber, dentistId: req.dentistId } },
        tx,
      );
    });
  } catch (error) {
    if (pgCode(error) === "23P01") return explainClash(req);
    throw error;
  }
}

/** Spec 8.6. The database trigger enforces the allowed pairs too, and stamps the time of each change. */
export async function transitionAppointment(actor: Staff, id: string, input: z.infer<typeof transitionSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const [visit] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update");
    if (!visit) throw notFound("That visit");
    requireCan(actor, actionFor(input.to), { branchId: visit.branchId, dentistId: visit.dentistId });
    const problem = changeProblem(visit.status as Status, input.to, visit.startTime, new Date());
    if (problem) throw new ApiError(422, "status_change", problem);
    if (input.to === "cancelled" && !input.reason) {
      throw new ApiError(400, "invalid", "Give a reason for cancelling.", { fields: { reason: "Give a reason for cancelling." } });
    }
    await tx
      .update(appointments)
      .set({ status: input.to, ...(input.to === "cancelled" ? { cancelReason: input.reason } : {}) })
      .where(eq(appointments.id, id));
    await audit(
      {
        userId: actor.id,
        action: "appointment.status_changed",
        entity: "appointment",
        entityId: id,
        branchId: visit.branchId,
        details: { from: visit.status, to: input.to, ...(input.reason ? { reason: input.reason } : {}) },
      },
      tx,
    );
  });
}

export type VisitView = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  chartNo: number;
  hasAlerts: boolean;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  status: Status;
  source: string;
  note: string;
  cancelReason: string | null;
  procedures: string[];
};

async function visitViews(where: SQL | undefined): Promise<VisitView[]> {
  const rows = await db
    .select({
      id: appointments.id,
      branchId: appointments.branchId,
      branchCode: branches.code,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
      dentistId: appointments.dentistId,
      dentistName: users.name,
      patientId: appointments.patientId,
      lastName: patients.lastName,
      firstName: patients.firstName,
      chartNo: patients.chartNo,
      allergies: patients.allergies,
      allergiesOther: patients.allergiesOther,
      medicalAlerts: patients.medicalAlerts,
      start: appointments.startTime,
      end: appointments.endTime,
      chairFreeAt: appointments.chairFreeAt,
      status: appointments.status,
      source: appointments.source,
      note: appointments.note,
      cancelReason: appointments.cancelReason,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(where)
    .orderBy(asc(appointments.startTime));
  const ids = rows.map((r) => r.id);
  const procs = ids.length
    ? await db.select().from(appointmentProcedures).where(inArray(appointmentProcedures.appointmentId, ids)).orderBy(asc(appointmentProcedures.position))
    : [];
  return rows.map(({ lastName, firstName, chairLabel, allergies, allergiesOther, medicalAlerts, ...row }) => ({
    ...row,
    chairLabel: chairLabel ?? "",
    patientName: `${lastName}, ${firstName}`,
    hasAlerts: alertLines({ allergies, allergiesOther, medicalAlerts }).length > 0,
    status: row.status as Status,
    procedures: procs.filter((p) => p.appointmentId === row.id).map((p) => p.name),
  }));
}

/**
 * The calendar's visits (every status) in [from, to). `branch` is a code or "all"; "all" needs the All branches view,
 * except for a dentist asking for their own visits, which they see at every branch (spec section 5).
 */
export async function listAppointments(actor: Staff, q: z.infer<typeof listSchema>): Promise<VisitView[]> {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (!(from < to) || to.getTime() - from.getTime() > 42 * 86_400_000) {
    throw new ApiError(400, "invalid", "Ask for at most six weeks at a time.");
  }
  const own = q.dentist !== undefined && q.dentist === actor.id;
  let scope: SQL | undefined;
  if (q.branch === "all") {
    if (!own && !can(actor, "overview.view")) throw forbidden();
    if (!own && actor.role !== "owner") scope = inArray(appointments.branchId, [...actor.branchIds]);
  } else {
    const branch = await requireBranch(q.branch);
    requireCan(actor, "calendar.view", { branchId: branch.id, dentistId: q.dentist });
    scope = eq(appointments.branchId, branch.id);
  }
  return visitViews(and(scope, q.dentist ? eq(appointments.dentistId, q.dentist) : undefined, lt(appointments.startTime, to), gt(appointments.endTime, from)));
}

function historyText(action: string, details: Record<string, unknown>): string {
  const label = (status: unknown) => STATUS_LABEL[status as Status]?.toLowerCase() ?? String(status);
  if (action === "appointment.created") return `Booked as ${label(details.status)}`;
  if (action === "appointment.moved") return `Moved to ${formatDateTime(new Date(String(details.start)))}, chair ${String(details.chair)}`;
  if (action === "appointment.status_changed") {
    const text = `${STATUS_LABEL[details.from as Status] ?? String(details.from)} to ${label(details.to)}`;
    return details.reason ? `${text}: ${String(details.reason)}` : text;
  }
  return action;
}

/** One visit with its patient's alerts, procedures, and history (spec section 10, the visit panel). */
export async function appointmentDetail(actor: Staff, id: string) {
  const [view] = await visitViews(eq(appointments.id, id));
  if (!view) throw notFound("That visit");
  requireCan(actor, "calendar.view", { branchId: view.branchId, dentistId: view.dentistId });
  const [patient] = await db
    .select({ allergies: patients.allergies, allergiesOther: patients.allergiesOther, medicalAlerts: patients.medicalAlerts })
    .from(patients)
    .where(eq(patients.id, view.patientId));
  const procedureIds = (
    await db
      .select({ id: appointmentProcedures.procedureId })
      .from(appointmentProcedures)
      .where(eq(appointmentProcedures.appointmentId, id))
      .orderBy(asc(appointmentProcedures.position))
  ).map((p) => p.id);
  const history = await db
    .select({ at: auditLog.at, action: auditLog.action, details: auditLog.details, by: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));
  return {
    ...view,
    procedureIds,
    alerts: alertLines(patient),
    history: history.map((h) => ({ at: h.at, by: h.by ?? "Someone", text: historyText(h.action, h.details) })),
  };
}

/** Spec 11.2: active visits on a chair whose time plus turnover overlaps [from, until). */
export async function chairConflicts(actor: Staff, q: z.infer<typeof conflictsSchema>): Promise<Conflict[]> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "calendar.view", { branchId: branch.id });
  const clashes = await activeVisits(
    db,
    new Date(q.from),
    new Date(q.until),
    and(eq(appointments.branchId, branch.id), eq(appointments.chairNumber, q.chair), q.exclude ? ne(appointments.id, q.exclude) : undefined),
  );
  return clashes.map((c) => conflictFor("chair", c));
}
```

- [ ] **Step 5: Write the routes**

`src/app/api/v1/appointments/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { bookingSchema, createAppointment, listAppointments, listSchema } from "@/server/appointments";

export const GET = staffRoute(async (req, staff) =>
  json(await listAppointments(staff, listSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);

export const POST = staffRoute(async (req, staff) => json(await createAppointment(staff, await readJson(req, bookingSchema)), 201));
```

`src/app/api/v1/appointments/validate/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { validateBooking, validateSchema } from "@/server/appointments";

export const POST = staffRoute(async (req, staff) => json(await validateBooking(staff, await readJson(req, validateSchema))));
```

`src/app/api/v1/appointments/[id]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { appointmentDetail, moveAppointment, moveSchema } from "@/server/appointments";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await appointmentDetail(staff, id)));

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await moveAppointment(staff, id, await readJson(req, moveSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/appointments/[id]/transitions/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { transitionAppointment, transitionSchema } from "@/server/appointments";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await transitionAppointment(staff, id, await readJson(req, transitionSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/chairs/conflicts/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { chairConflicts, conflictsSchema } from "@/server/appointments";

export const GET = staffRoute(async (req, staff) =>
  json(await chairConflicts(staff, conflictsSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
```

- [ ] **Step 6: Run the tests**

```powershell
npx vitest run tests/db/appointments.test.ts
```

Expected: PASS, 16 tests.

- [ ] **Step 7: Commit**

```powershell
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add booking, moving, and the visit lifecycle with conflict checks across branches" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Open times and the All branches summary

**Files:**
- Create: `src/server/availability.ts`, `src/server/overview.ts`, `src/app/api/v1/availability/route.ts`, `src/app/api/v1/overview/route.ts`
- Test: `tests/db/availability.test.ts`

**Interfaces:**
- Consumes: `openTimes` (Task 1), `activeVisits` (Task 3), `listAppointments`, `type VisitView` (Task 3), `listBranches`, `requireBranch` (plan A), `STATUSES`, `type Status`.
- Produces:
  - `@/server/availability`: `availabilitySchema`, `availability(actor, query): Promise<{ date; minutes; turnover; times: OpenTime[] }>`.
  - `@/server/overview`: `type BranchSummary = { id; code; name; chairs; chairsInUse; counts: Record<Status, number>; dentistsOnDuty: string[] }`, `overview(actor, date): Promise<{ date; branches: BranchSummary[]; visits: VisitView[] }>`.
  - Routes: `GET /availability?branch&date&procedures=<id,id>&dentist&patient` (spec 11.3), `GET /overview?date`.

- [ ] **Step 1: Write the failing test, `tests/db/availability.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as availabilityRoute from "@/app/api/v1/availability/route";
import * as overviewRoute from "@/app/api/v1/overview/route";
import { db } from "@/db";
import { appointments, branches, chairs, dentistSchedules, patients, procedures, userBranches } from "@/db/schema";
import { fromMinutes, manilaMinutes } from "@/lib/time";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const at = (clock: string) => new Date(`${MONDAY}T${clock}:00+08:00`);
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  const ws = await makeBranch({ code: "westside", name: "Westside" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1 },
    { branchId: dt.id, number: 2 },
    { branchId: ws.id, number: 1 },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id, ws.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values([
    { dentistId: reyes.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
    { dentistId: reyes.id, branchId: ws.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    { dentistId: lim.id, branchId: dt.id, dayOfWeek: 1, startTime: "09:30", endTime: "10:30" },
  ]);
  const [cleaning] = await db.insert(procedures).values({ name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 }).returning();
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  const [ben] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  const owner = await makeUser({ role: "owner" });
  return { dt, ws, reyes, lim, cleaning, ana, ben, desk: await signIn(desk.username), owner: await signIn(owner.username), dentist: await signIn(lim.username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

type Times = { times: { start: string; dentists: { id: string; chairs: number[] }[] }[] };
const clock = (iso: string) => fromMinutes(manilaMinutes(new Date(iso)));

describe("open times", () => {
  it("lists each start with the dentists and chairs free for it", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&procedures=${w.cleaning.id}`, { cookie: w.desk }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Times & { minutes: number; turnover: number };
    expect(body.minutes).toBe(45);
    expect(body.turnover).toBe(15);
    expect(body.times.map((t) => [clock(t.start), t.dentists.map((d) => d.id)])).toEqual([
      ["09:00", [w.reyes.id]],
      ["09:15", [w.reyes.id]],
      ["09:30", [w.lim.id]],
      ["09:45", [w.lim.id]],
    ]);
  });

  it("leaves out chairs in turnover and a dentist already busy", async () => {
    const w = await world();
    await db.insert(appointments).values({ patientId: w.ana.id, dentistId: w.lim.id, branchId: w.dt.id, chairNumber: 1, startTime: at("09:00"), endTime: at("09:30"), chairFreeAt: at("09:45"), status: "confirmed", source: "staff" });
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&procedures=${w.cleaning.id}&dentist=${w.reyes.id}`, { cookie: w.desk }));
    const body = (await res.json()) as Times;
    expect(body.times.map((t) => [clock(t.start), t.dentists[0].chairs])).toEqual([
      ["09:00", [2]],
      ["09:15", [2]],
    ]);
    const forAna = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&procedures=${w.cleaning.id}&patient=${w.ana.id}`, { cookie: w.desk }));
    expect(((await forAna.json()) as Times).times.map((t) => clock(t.start))).toEqual(["09:30", "09:45"]);
  });

  it("has none at a closed branch", async () => {
    const w = await world();
    const east = await makeBranch({ code: "eastside", name: "Eastside" });
    await db.insert(chairs).values({ branchId: east.id, number: 1 });
    await db.insert(userBranches).values({ userId: w.lim.id, branchId: east.id });
    await db.insert(dentistSchedules).values({ dentistId: w.lim.id, branchId: east.id, dayOfWeek: 1, startTime: "11:00", endTime: "12:00" });
    await db.update(branches).set({ active: false }).where(eq(branches.id, east.id));
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=eastside&date=${MONDAY}&procedures=${w.cleaning.id}`, { cookie: w.owner }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Times).times).toEqual([]);
  });

  it("is for people who book", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&procedures=${w.cleaning.id}`, { cookie: w.dentist }));
    expect(res.status).toBe(403);
  });
});

describe("all branches", () => {
  it("sums up each branch's day for the owner", async () => {
    const w = await world();
    const res = await call(overviewRoute.GET, request(`/api/v1/overview?date=${MONDAY}`, { cookie: w.owner }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const downtown = body.branches.find((b: { code: string }) => b.code === "downtown");
    expect(downtown).toMatchObject({ chairs: 2, chairsInUse: 0, dentistsOnDuty: ["Dr. Lim", "Dr. Reyes"] });
    expect(downtown.counts.confirmed).toBe(1);
    expect(body.branches.find((b: { code: string }) => b.code === "westside").dentistsOnDuty).toEqual(["Dr. Reyes"]);
    expect(body.visits).toHaveLength(1);
  });

  it("is refused to a manager of one branch", async () => {
    const w = await world();
    expect((await call(overviewRoute.GET, request(`/api/v1/overview?date=${MONDAY}`, { cookie: w.desk }))).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/db/availability.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 3: Write `src/server/availability.ts`**

```ts
import { and, asc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, chairs, dentistSchedules, dentistTimeOff, procedures, userBranches, users } from "@/db/schema";
import type { WeeklyBlock } from "@/lib/booking-rules";
import { openTimes, type OpenTime } from "@/lib/slots";
import { addDays, manilaInstant } from "@/lib/time";
import { activeVisits } from "./booking";
import { requireBranch } from "./branches";
import { ApiError } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const availabilitySchema = z.object({
  branch: z.string().min(1),
  date: z.iso.date(),
  procedures: z
    .string()
    .min(1)
    .transform((value) => value.split(","))
    .pipe(z.array(z.uuid()).min(1).max(10)),
  dentist: z.uuid().optional(),
  patient: z.uuid().optional(),
});

/** Spec 8.5: the open times at a branch on a day, for a set of procedures (and optionally a dentist and a patient). */
export async function availability(
  actor: Staff,
  q: z.infer<typeof availabilitySchema>,
): Promise<{ date: string; minutes: number; turnover: number; times: OpenTime[] }> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const picked = await db
    .select()
    .from(procedures)
    .where(and(inArray(procedures.id, q.procedures), eq(procedures.active, true)));
  if (picked.length !== new Set(q.procedures).size) {
    throw new ApiError(400, "invalid", "Pick procedures that are offered.", { fields: { procedures: "Pick procedures that are offered." } });
  }
  const minutes = picked.reduce((sum, p) => sum + p.durationMinutes, 0);
  const turnover = Math.max(0, ...picked.map((p) => p.bufferMinutes));
  const empty = { date: q.date, minutes, turnover, times: [] };
  // A closed branch takes no bookings (spec 8.3), so it has no open times.
  if (!branch.active) return empty;

  const chairNumbers = (
    await db
      .select({ number: chairs.number })
      .from(chairs)
      .where(and(eq(chairs.branchId, branch.id), eq(chairs.active, true)))
      .orderBy(asc(chairs.number))
  ).map((c) => c.number);
  const links = await db.select({ userId: userBranches.userId }).from(userBranches).where(eq(userBranches.branchId, branch.id));
  const dentists = (
    await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
  ).filter((d) => (d.role === "owner" || links.some((l) => l.userId === d.id)) && (!q.dentist || d.id === q.dentist));
  if (chairNumbers.length === 0 || dentists.length === 0) return empty;

  const ids = dentists.map((d) => d.id);
  const dayStart = manilaInstant(q.date, 0);
  const dayEnd = manilaInstant(addDays(q.date, 1), 0);
  const blockRows = await db.select().from(dentistSchedules).where(inArray(dentistSchedules.dentistId, ids));
  const offRows = await db
    .select()
    .from(dentistTimeOff)
    .where(and(inArray(dentistTimeOff.dentistId, ids), lt(dentistTimeOff.startsAt, dayEnd), gt(dentistTimeOff.endsAt, dayStart)));
  const visits = await activeVisits(
    db,
    dayStart,
    dayEnd,
    or(inArray(appointments.dentistId, ids), eq(appointments.branchId, branch.id), q.patient ? eq(appointments.patientId, q.patient) : undefined),
  );

  const blocks = new Map<string, WeeklyBlock[]>();
  for (const b of blockRows) {
    blocks.set(b.dentistId, [
      ...(blocks.get(b.dentistId) ?? []),
      { branchId: b.branchId, dayOfWeek: b.dayOfWeek, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) },
    ]);
  }
  const timeOff = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const t of offRows) timeOff.set(t.dentistId, [...(timeOff.get(t.dentistId) ?? []), { startsAt: t.startsAt, endsAt: t.endsAt }]);

  const times = openTimes({
    date: q.date,
    now: new Date(),
    minutes,
    turnover,
    branch: { id: branch.id, hours: branch.operatingHours },
    chairs: chairNumbers,
    dentists: dentists.map(({ id, name }) => ({ id, name })),
    blocks,
    timeOff,
    visits,
    patientId: q.patient,
  });
  return { ...empty, times };
}
```

- [ ] **Step 4: Write `src/server/overview.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dentistSchedules, users } from "@/db/schema";
import { STATUSES, type Status } from "@/lib/lifecycle";
import { covers } from "@/lib/permissions";
import { addDays, manilaInstant, weekday } from "@/lib/time";
import { listAppointments, type VisitView } from "./appointments";
import { listBranches } from "./branches";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export type BranchSummary = {
  id: string;
  code: string;
  name: string;
  chairs: number;
  chairsInUse: number;
  counts: Record<Status, number>;
  dentistsOnDuty: string[];
};

/** Spec 10, All branches: each branch's day (visits by status, chairs in use now, dentists on duty) and every visit. */
export async function overview(actor: Staff, date: string): Promise<{ date: string; branches: BranchSummary[]; visits: VisitView[] }> {
  requireCan(actor, "overview.view");
  const branches = (await listBranches()).filter((b) => b.active && covers(actor, b.id));
  const visits = await listAppointments(actor, {
    branch: "all",
    from: manilaInstant(date, 0).toISOString(),
    to: manilaInstant(addDays(date, 1), 0).toISOString(),
  });
  const onDuty = await db
    .select({ branchId: dentistSchedules.branchId, name: users.name })
    .from(dentistSchedules)
    .innerJoin(users, eq(users.id, dentistSchedules.dentistId))
    .where(and(eq(dentistSchedules.dayOfWeek, weekday(date)), eq(users.status, "active"), eq(users.seesPatients, true)));
  const now = Date.now();
  return {
    date,
    visits,
    branches: branches.map((b) => {
      const here = visits.filter((v) => v.branchId === b.id);
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        chairs: b.chairCount,
        chairsInUse: new Set(
          here.filter((v) => v.status === "in_treatment" && v.start.getTime() <= now && now < v.chairFreeAt.getTime()).map((v) => v.chairNumber),
        ).size,
        counts: Object.fromEntries(STATUSES.map((s) => [s, here.filter((v) => v.status === s).length])) as Record<Status, number>,
        dentistsOnDuty: [...new Set(onDuty.filter((d) => d.branchId === b.id).map((d) => d.name))].sort(),
      };
    }),
  };
}
```

- [ ] **Step 5: Write the routes**

`src/app/api/v1/availability/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { availability, availabilitySchema } from "@/server/availability";

export const GET = staffRoute(async (req, staff) =>
  json(await availability(staff, availabilitySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
```

`src/app/api/v1/overview/route.ts`:

```ts
import { z } from "zod";
import { json, staffRoute } from "@/server/api";
import { overview } from "@/server/overview";

export const GET = staffRoute(async (req, staff) => json(await overview(staff, z.iso.date().parse(req.nextUrl.searchParams.get("date")))));
```

- [ ] **Step 6: Run the tests and commit**

```powershell
npx vitest run tests/db/availability.test.ts
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add open times per branch and the All branches summary" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 5 tests pass, then the whole suite.

---

### Task 5: Development data

**Files:**
- Create: `src/server/seed.ts`, `scripts/seed.mts`, `tests/db/seed.test.ts`
- Modify: `package.json` (the `tsx` dev dependency and the `seed` script), `README.md`

**Interfaces:**
- Consumes: every table in `@/db/schema`; `createCredentialUser` (`@/server/accounts`); `DEFAULT_HOURS` (`@/lib/hours`); `randomToken` (`@/lib/tokens`); time helpers (`@/lib/time`); `type Status` (`@/lib/lifecycle`).
- Produces: `seed(now?: Date): Promise<{ password: string; accounts: string[] }>` (`@/server/seed`), and `npm run seed`, which fills an empty development database (spec section 15). The later tasks' browser checks sign in with these accounts.

The seed writes rows directly, the way the services would, and walks visits through the lifecycle with real status changes, so every row passes the database rules (Task 2 of plan A). It is deterministic: the same `now` gives the same data.

- [ ] **Step 1: Add the script runner**

```powershell
npm install --save-dev --save-exact tsx@4.23.15
```

Then add this line to the `scripts` block of `package.json`, after `"db:migrate"`:

```json
    "seed": "tsx --env-file-if-exists=.env.local scripts/seed.mts"
```

(`tsx` runs TypeScript with the `@/` paths from `tsconfig.json`. The script is `.mts` so it may use top-level `await`.)

- [ ] **Step 2: Write the failing test, `tests/db/seed.test.ts`**

```ts
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { appointments, branches, chairs, dentistSchedules, patients, procedures, users } from "@/db/schema";
import { STATUSES } from "@/lib/lifecycle";
import { seed } from "@/server/seed";

const total = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;

describe("development data", () => {
  it("fills the practice with visits in every status, within the database rules", async () => {
    const { password, accounts } = await seed(new Date("2026-10-07T10:20:00+08:00"));
    expect(password.length).toBeGreaterThanOrEqual(10);
    expect(accounts).toHaveLength(9);
    expect(await total(branches)).toBe(3);
    expect(await total(chairs)).toBe(10);
    expect(await total(procedures)).toBe(7);
    expect(await total(users)).toBe(9);
    expect(await total(patients)).toBe(40);
    expect(await total(dentistSchedules)).toBeGreaterThan(0);
    const statuses = await db.selectDistinct({ status: appointments.status }).from(appointments);
    expect(statuses.map((s) => s.status).sort()).toEqual([...STATUSES].sort());
  });

  it("refuses a database that already has data", async () => {
    await expect(seed()).rejects.toThrow("already has data");
  });
});
```

```powershell
npx vitest run tests/db/seed.test.ts
```

Expected: FAIL, because `@/server/seed` does not exist.

- [ ] **Step 3: Write the seed, `src/server/seed.ts`**

```ts
import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  appointmentProcedures,
  appointments,
  branches,
  chairs,
  dentistSchedules,
  patients,
  practice,
  procedures,
  userBranches,
  users,
} from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Status } from "@/lib/lifecycle";
import type { Role } from "@/lib/permissions";
import { addDays, manilaDate, manilaInstant, toMinutes, weekday } from "@/lib/time";
import { randomToken } from "@/lib/tokens";
import { createCredentialUser } from "./accounts";

const BRANCHES = [
  { code: "downtown", name: "Downtown", chairs: ["General", "General", "Ortho", "Surgery"] },
  { code: "westside", name: "Westside", chairs: ["General", "General", "Ortho"] },
  { code: "metro-north", name: "Metro North", chairs: ["General", "General", "Pedo"] },
];

/** Spec 15's placeholders, for the dentists to correct: name, minutes, turnover minutes. */
const PROCEDURES: [string, number, number][] = [
  ["Consultation", 30, 10],
  ["Oral prophylaxis", 45, 15],
  ["Tooth filling", 60, 15],
  ["Tooth extraction", 45, 20],
  ["Root canal treatment", 90, 20],
  ["Orthodontic adjustment", 30, 10],
  ["Fluoride application", 30, 10],
];

const MON_SAT = [1, 2, 3, 4, 5, 6];
const MON_FRI = [1, 2, 3, 4, 5];

/** A weekly block: branch code, weekdays, start, end. */
type Block = [string, number[], string, string];
type Person = { name: string; username: string; role: Role; title: string | null; branch?: string; blocks?: Block[] };

/** An owner who sees patients, a front desk per branch, and 5 dentists (one a hygienist) with split days. */
const STAFF: Person[] = [
  { name: "Dr. Maria Santos", username: "owner", role: "owner", title: "Dentist", blocks: [["downtown", MON_FRI, "13:00", "18:00"]] },
  { name: "Liza Ramos", username: "downtown.desk", role: "manager", title: null, branch: "downtown" },
  { name: "Joy Mendoza", username: "westside.desk", role: "manager", title: null, branch: "westside" },
  { name: "Carlo Dizon", username: "metronorth.desk", role: "manager", title: null, branch: "metro-north" },
  {
    name: "Dr. Jose Reyes",
    username: "dr.reyes",
    role: "dentist",
    title: "Dentist",
    blocks: [
      ["downtown", MON_SAT, "09:00", "12:00"],
      ["metro-north", MON_SAT, "13:00", "18:00"],
    ],
  },
  { name: "Dr. Ana Cruz", username: "dr.cruz", role: "dentist", title: "Dentist", blocks: [["westside", MON_FRI, "09:00", "18:00"]] },
  {
    name: "Dr. Paolo Garcia",
    username: "dr.garcia",
    role: "dentist",
    title: "Orthodontist",
    blocks: [
      ["downtown", [1, 3, 5], "09:00", "18:00"],
      ["westside", [2, 4], "09:00", "18:00"],
    ],
  },
  {
    name: "Dr. Bea Villanueva",
    username: "dr.villanueva",
    role: "dentist",
    title: "Oral surgeon",
    blocks: [
      ["metro-north", [1, 3, 5], "09:00", "12:00"],
      ["downtown", [2, 4, 6], "13:00", "18:00"],
    ],
  },
  { name: "Kim Lim", username: "hyg.lim", role: "dentist", title: "Hygienist", blocks: [["metro-north", MON_SAT, "09:00", "18:00"]] },
];

// Even positions are women's names and odd positions men's, so a patient's sex follows their index.
const FIRST = ["Ana", "Jose", "Maria", "Juan", "Rosa", "Pedro", "Liza", "Mark", "Grace", "Paolo", "Joy", "Carlo", "Bea", "Miguel", "Andrea", "Rafael", "Nina", "Luis", "Carmen", "Ramon"];
const LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores", "Ramos", "Aquino", "Castillo", "Villanueva", "Dizon", "Navarro", "Salazar", "Rivera", "Domingo", "Soriano", "Pascual", "Mercado"];

/** A small seeded random generator (mulberry32), so the same `now` always gives the same data. */
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPLETED: Status[] = ["checked_in", "in_treatment", "completed"];

type Planned = {
  branchId: string;
  chairNumber: number;
  dentistId: string;
  patientId: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  procedure: { id: string; name: string; durationMinutes: number; bufferMinutes: number };
  status: "requested" | "confirmed";
  path: Status[];
};

/** Spec 15: fills an empty database with a practice to try things on. Returns the one password every account uses. */
export async function seed(now = new Date()): Promise<{ password: string; accounts: string[] }> {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) throw new Error("This database already has data. To start over, delete its folder (.data/dev by default) and run npm run seed again.");
  const password = randomToken(12);
  const passwordHash = await hashPassword(password);
  const random = randomFrom(20261005);

  await db.transaction(async (tx) => {
    await tx.insert(practice).values({ name: "Sample Dental Group" });
    const branchRows = await tx
      .insert(branches)
      .values(BRANCHES.map((b, sort) => ({ code: b.code, name: b.name, operatingHours: DEFAULT_HOURS, joinCode: randomToken(16), sort })))
      .returning({ id: branches.id, code: branches.code });
    const branchId = (code: string) => branchRows.find((b) => b.code === code)!.id;
    await tx.insert(chairs).values(BRANCHES.flatMap((b) => b.chairs.map((label, i) => ({ branchId: branchId(b.code), number: i + 1, label }))));
    const procedureRows = await tx
      .insert(procedures)
      .values(PROCEDURES.map(([name, durationMinutes, bufferMinutes], sort) => ({ name, durationMinutes, bufferMinutes, sort })))
      .returning();

    let ownerId = "";
    const people: { id: string; person: Person }[] = [];
    for (const person of STAFF) {
      const codes = person.branch ? [person.branch] : [...new Set((person.blocks ?? []).map(([code]) => code))];
      const user = await createCredentialUser(
        {
          name: person.name,
          username: person.username,
          role: person.role,
          status: "active",
          seesPatients: person.role !== "manager",
          title: person.title,
          primaryBranchId: person.role === "owner" ? null : branchId(codes[0]),
        },
        passwordHash,
        tx,
      );
      if (person.role === "owner") ownerId = user.id;
      else {
        await tx.update(users).set({ approvedBy: ownerId, approvedAt: now }).where(eq(users.id, user.id));
        await tx.insert(userBranches).values(codes.map((code) => ({ userId: user.id, branchId: branchId(code) })));
      }
      people.push({ id: user.id, person });
    }
    const blocks = people.flatMap(({ id, person }) =>
      (person.blocks ?? []).flatMap(([code, days, startTime, endTime]) =>
        days.map((dayOfWeek) => ({ dentistId: id, branchId: branchId(code), dayOfWeek, startTime, endTime })),
      ),
    );
    await tx.insert(dentistSchedules).values(blocks);

    const patientRows = await tx
      .insert(patients)
      .values(
        Array.from({ length: 40 }, (_, i) => {
          const born = 1955 + Math.floor(random() * 65);
          return {
            lastName: LAST[(i * 7 + Math.floor(i / 20)) % 20],
            firstName: FIRST[i % 20],
            birthday: `${born}-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}`,
            sex: i % 2 === 0 ? "female" : "male",
            mobile: `+63917${String(1_000_000 + i * 104_729).slice(-7)}`,
            guardianName: born >= 2010 ? `${FIRST[(i + 2) % 20]} ${LAST[(i * 7) % 20]}` : null,
            hmoProvider: i % 4 === 0 ? "Sample HMO" : null,
            hmoMemberNo: i % 4 === 0 ? `SH-${1000 + i}` : null,
            allergies: i % 9 === 0 ? ["penicillin"] : i % 13 === 5 ? ["latex"] : [],
            medicalAlerts: i % 6 === 2 ? "Hypertension, on maintenance medicine" : i % 11 === 4 ? "Diabetic" : "",
            consentAt: now,
            consentBy: ownerId,
            homeBranchId: branchRows[i % 3].id,
            createdBy: ownerId,
            updatedBy: ownerId,
          };
        }),
      )
      .returning({ id: patients.id });

    // Two weeks of visits: each dentist's blocks filled in order with a random procedure, a free chair (turnover
    // included), and a patient not yet seen that day, so nothing overlaps.
    const today = manilaDate(now);
    const planned: Planned[] = [];
    for (let offset = -7; offset <= 7; offset += 1) {
      const date = addDays(today, offset);
      const unused = patientRows.map((p) => p.id).sort(() => random() - 0.5);
      for (const branch of branchRows) {
        const chairNumbers = BRANCHES.find((b) => b.code === branch.code)!.chairs.map((_, i) => i + 1);
        const freeAt = new Map<number, number>();
        const todays = blocks.filter((b) => b.branchId === branch.id && b.dayOfWeek === weekday(date));
        for (const block of todays) {
          const nextOf: Planned[] = [];
          for (let t = toMinutes(block.startTime); t < toMinutes(block.endTime); ) {
            // About a third of the day stays open, in gaps of 15 to 45 minutes, so there is room to book.
            if (random() < 0.35) {
              t += 15 * (1 + Math.floor(random() * 3));
              continue;
            }
            const procedure = procedureRows[Math.floor(random() * procedureRows.length)];
            if (t + procedure.durationMinutes > toMinutes(block.endTime)) break;
            const chairNumber = chairNumbers.find((n) => (freeAt.get(n) ?? 0) <= t);
            if (chairNumber === undefined) {
              t += 15;
              continue;
            }
            const patientId = unused.pop();
            if (patientId === undefined) break;
            freeAt.set(chairNumber, t + procedure.durationMinutes + procedure.bufferMinutes);
            const start = manilaInstant(date, t);
            const end = manilaInstant(date, t + procedure.durationMinutes);
            const visit: Planned = {
              branchId: branch.id,
              chairNumber,
              dentistId: block.dentistId,
              patientId,
              start,
              end,
              chairFreeAt: manilaInstant(date, t + procedure.durationMinutes + procedure.bufferMinutes),
              procedure,
              status: "confirmed",
              path: [],
            };
            const roll = random();
            if (offset < 0) visit.path = roll < 0.7 ? COMPLETED : roll < 0.85 ? ["no_show"] : ["cancelled"];
            else if (offset > 0) {
              if (roll < 0.2) visit.status = "requested";
              else if (roll < 0.25) visit.path = ["cancelled"];
            } else if (end <= now) visit.path = roll < 0.9 ? COMPLETED : ["no_show"];
            else if (start <= now) visit.path = ["checked_in", "in_treatment"];
            else nextOf.push(visit);
            planned.push(visit);
            t += procedure.durationMinutes;
          }
          // The dentist's next patient today, if due within the hour, is already in the waiting room.
          const next = nextOf[0];
          if (next && next.start.getTime() - now.getTime() <= 3_600_000) next.path = ["checked_in"];
        }
      }
    }

    const saved = await tx
      .insert(appointments)
      .values(
        planned.map((v) => ({
          patientId: v.patientId,
          dentistId: v.dentistId,
          branchId: v.branchId,
          chairNumber: v.chairNumber,
          startTime: v.start,
          endTime: v.end,
          chairFreeAt: v.chairFreeAt,
          status: v.status,
          source: "staff",
          createdBy: ownerId,
        })),
      )
      .returning({ id: appointments.id });
    await tx.insert(appointmentProcedures).values(
      planned.map((v, i) => ({
        appointmentId: saved[i].id,
        position: 0,
        procedureId: v.procedure.id,
        name: v.procedure.name,
        durationMinutes: v.procedure.durationMinutes,
        bufferMinutes: v.procedure.bufferMinutes,
      })),
    );
    // Real status changes, one step at a time, so the lifecycle trigger checks each one and stamps its time.
    for (let step = 0; step < COMPLETED.length; step += 1) {
      for (const status of new Set(planned.map((v) => v.path[step]).filter(Boolean))) {
        const ids = saved.filter((_, i) => planned[i].path[step] === status).map((s) => s.id);
        await tx
          .update(appointments)
          .set({ status, ...(status === "cancelled" ? { cancelReason: "Asked to move to another day" } : {}) })
          .where(inArray(appointments.id, ids));
      }
    }
  });

  return {
    password,
    accounts: STAFF.map((p) => {
      const role = p.role === "owner" ? "owner" : p.role === "manager" ? `front desk at ${p.branch}` : p.title;
      return `${p.username.padEnd(16)} ${p.name}, ${role}`;
    }),
  };
}
```

- [ ] **Step 4: Run the test**

```powershell
npx vitest run tests/db/seed.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Write the script, `scripts/seed.mts`**

```ts
import { ready } from "@/db";
import { seed } from "@/server/seed";

// Spec 15: development data only, and only in a PGlite folder, never a real Postgres.
const url = process.env.DATABASE_URL || "pglite:.data/dev";
if (process.env.NODE_ENV === "production" || !url.startsWith("pglite:") || url === "pglite:memory") {
  console.error("npm run seed only fills a development database (DATABASE_URL=pglite:<folder>).");
  process.exit(1);
}

try {
  await ready();
  const { password, accounts } = await seed();
  console.log(`Development data is ready in ${url.slice("pglite:".length)}. Sign in with any of these usernames:`);
  for (const line of accounts) console.log(`  ${line}`);
  console.log(`Every account uses the password ${password} (shown only now).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
```

- [ ] **Step 6: Document it in `README.md`**

In `## Run it`, replace step 3 with:

```markdown
3. `npm run seed` fills `.data/dev` with 3 branches, staff, 40 patients, and two weeks of visits, and prints the sign-in usernames and password once. Run it while the dev server is stopped. To start over, delete `.data/dev` and run it again.
4. `npm run dev`, then open http://localhost:3700. The database migrates itself. Without the seed, open `/setup` to create the owner.
```

In the `## Scripts` table, add this row after `npm run dev`:

```markdown
| `npm run seed` | Development data (PGlite only) |
```

- [ ] **Step 7: Try it**

Stop the dev server if it is running, then:

```powershell
if (Test-Path .data/dev) { Write-Output "Delete .data/dev first if you want fresh data" }
npm run seed
```

Expected: the usernames (owner, 3 front desk accounts, 5 dentists) and one password, printed once. Running it again prints "This database already has data..." and exits with an error.

- [ ] **Step 8: Commit**

```powershell
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add a development seed with three branches, staff, patients, and two weeks of visits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Patients screens

**Files:**
- Create: `src/components/status-badge.tsx`, `src/components/alert-mark.tsx`, `src/components/alert-banner.tsx`, `src/components/patient-search.tsx`, `src/components/patient-fields.tsx`, `src/components/add-patient-dialog.tsx`, `src/app/[branch]/patients/page.tsx`, `src/app/[branch]/patients/patients-screen.tsx`, `src/app/[branch]/patients/[id]/page.tsx`, `src/app/[branch]/patients/[id]/patient-screen.tsx`
- Modify: `src/lib/nav.ts`, `tests/unit/shell.test.ts`

**Interfaces:**
- Consumes: Task 2's routes and `@/lib/patients`; Task 1's `STATUS_LABEL`, `type Status`; plan A's `TextField`, `FormAlert`, `api`, `RequestError`, `errorMessage`, `fieldErrors`, shadcn components.
- Produces:
  - `StatusBadge({ status, className? })`: a word and an icon per status, never colour alone.
  - `AlertMark({ label? })`, `AlertBanner({ lines })`.
  - `PatientSearch({ onPick, autoFocus? })`, `type PatientHit`.
  - `PatientFields({ value, onChange, errors, alertsOnly?, showConsent? })`, `type PatientDraft`, `EMPTY_PATIENT`.
  - `AddPatientDialog({ open, onOpenChange, onAdded, homeBranch? })`, where `onAdded` receives `{ id, name }`.
  - `type PatientJson` and `PatientScreen({ patient, canEdit })` (from `patient-screen.tsx`; plan C adds the Chart and Notes tabs).

- [ ] **Step 1: Add Patients to the navigation**

Replace `src/lib/nav.ts`:

```ts
import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch (or "all"). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = [{ href: `/${branch}/patients`, label: "Patients" }];
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
```

In `tests/unit/shell.test.ts`, replace the test "builds the navigation for each role" with:

```ts
  it("builds the navigation for each role", () => {
    expect(navItems({ role: "owner", seesPatients: false }, "all").map((i) => i.label)).toEqual(["Patients", "Staff", "Settings"]);
    expect(navItems({ role: "manager", seesPatients: false }, "downtown").map((i) => i.href)).toEqual([
      "/downtown/patients",
      "/downtown/staff",
      "/downtown/settings",
    ]);
    expect(navItems({ role: "dentist", seesPatients: true }, "downtown").map((i) => i.label)).toEqual(["Patients", "Schedules"]);
  });
```

```powershell
npx vitest run tests/unit/shell.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 2: Write the badges and alerts**

`src/components/status-badge.tsx`:

```tsx
import { Ban, CalendarCheck, CircleCheck, Clock, Stethoscope, UserCheck, UserX } from "lucide-react";
import { STATUS_LABEL, type Status } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

const LOOK: Record<Status, { icon: typeof Clock; tone: string }> = {
  requested: { icon: Clock, tone: "bg-amber-100 text-amber-950 dark:bg-amber-400/20 dark:text-amber-100" },
  confirmed: { icon: CalendarCheck, tone: "bg-sky-100 text-sky-950 dark:bg-sky-400/20 dark:text-sky-100" },
  checked_in: { icon: UserCheck, tone: "bg-violet-100 text-violet-950 dark:bg-violet-400/20 dark:text-violet-100" },
  in_treatment: { icon: Stethoscope, tone: "bg-teal-100 text-teal-950 dark:bg-teal-400/20 dark:text-teal-100" },
  completed: { icon: CircleCheck, tone: "bg-emerald-100 text-emerald-950 dark:bg-emerald-400/20 dark:text-emerald-100" },
  no_show: { icon: UserX, tone: "bg-rose-100 text-rose-950 dark:bg-rose-400/20 dark:text-rose-100" },
  cancelled: { icon: Ban, tone: "bg-zinc-200 text-zinc-900 dark:bg-zinc-400/20 dark:text-zinc-100" },
};

/** A visit's status as a word and an icon (spec section 10: never colour alone). */
export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const { icon: Icon, tone } = LOOK[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}
```

`src/components/alert-mark.tsx`:

```tsx
import { TriangleAlert } from "lucide-react";

/** The small red mark on a card whose patient has allergies or medical alerts. */
export function AlertMark({ label = "Alerts" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      <TriangleAlert aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
```

`src/components/alert-banner.tsx`:

```tsx
import { TriangleAlert } from "lucide-react";

/** The red banner of allergies and medical alerts at the top of a patient or visit. Nothing when there are none. */
export function AlertBanner({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div role="note" aria-label="Allergies and medical alerts" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <ul className="grid gap-0.5 font-medium">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Write the patient search, `src/components/patient-search.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

export type PatientHit = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  birthday: string | null;
  mobile: string | null;
  hasAlerts: boolean;
};

/** Find a patient by name, mobile, birthday, or chart number; an empty search lists the latest updated patients. */
export function PatientSearch({ onPick, autoFocus }: { onPick: (patient: PatientHit) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const hits = useQuery({ queryKey: ["patients", term], queryFn: () => api<PatientHit[]>(`/patients?q=${encodeURIComponent(term)}`) });
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm font-medium">
        Find a patient
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Name, mobile, birthday (YYYY-MM-DD), or chart number"
          autoFocus={autoFocus}
        />
      </label>
      {hits.isError && <p className="text-sm text-destructive">The search did not work. Try again.</p>}
      <ul className="grid max-h-80 gap-1 overflow-y-auto">
        {hits.data?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span>
                <span className="font-medium">{`${p.lastName}, ${p.firstName}`}</span>
                <span className="block text-sm text-muted-foreground">{[`Chart ${p.chartNo}`, p.birthday, p.mobile].filter(Boolean).join(" · ")}</span>
              </span>
              {p.hasAlerts && <AlertMark />}
            </button>
          </li>
        ))}
        {hits.data?.length === 0 && <li className="text-sm text-muted-foreground">{term ? "No patient matches." : "No patients yet."}</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Write the patient fields, `src/components/patient-fields.tsx`**

```tsx
"use client";

import { useId } from "react";
import { TextField } from "@/components/text-field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ALLERGY_KEYS, ALLERGY_LABELS } from "@/lib/patients";

export type PatientDraft = {
  lastName: string;
  firstName: string;
  middleName: string;
  birthday: string;
  sex: string;
  mobile: string;
  email: string;
  address: string;
  occupation: string;
  guardianName: string;
  emergencyName: string;
  emergencyMobile: string;
  hmoProvider: string;
  hmoMemberNo: string;
  insuranceEffective: string;
  allergies: string[];
  allergiesOther: string;
  medicalAlerts: string;
  consent: boolean;
};

export const EMPTY_PATIENT: PatientDraft = {
  lastName: "",
  firstName: "",
  middleName: "",
  birthday: "",
  sex: "",
  mobile: "",
  email: "",
  address: "",
  occupation: "",
  guardianName: "",
  emergencyName: "",
  emergencyMobile: "",
  hmoProvider: "",
  hmoMemberNo: "",
  insuranceEffective: "",
  allergies: [],
  allergiesOther: "",
  medicalAlerts: "",
  consent: false,
};

type TextKey = Exclude<keyof PatientDraft, "allergies" | "consent">;

/** The patient form (spec 7 `patients`). Empty text fields are sent as empty strings; the server stores them as empty. */
export function PatientFields({
  value,
  onChange,
  errors,
  alertsOnly = false,
  showConsent = false,
}: {
  value: PatientDraft;
  onChange: (next: PatientDraft) => void;
  errors: Record<string, string>;
  alertsOnly?: boolean;
  showConsent?: boolean;
}) {
  const alertsError = `${useId()}-error`;
  const text = (key: TextKey, label: string, props: React.ComponentProps<"input"> = {}) => (
    <TextField label={label} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} error={errors[key]} {...props} />
  );
  const alerts = (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Allergies and medical alerts</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {ALLERGY_KEYS.map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm sm:min-h-9">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.allergies.includes(key)}
              onChange={(event) =>
                onChange({ ...value, allergies: event.target.checked ? [...value.allergies, key] : value.allergies.filter((a) => a !== key) })
              }
            />
            {ALLERGY_LABELS[key]}
          </label>
        ))}
      </div>
      {text("allergiesOther", "Other allergy", { maxLength: 100 })}
      <label className="grid gap-1.5 text-sm font-medium">
        Medical alerts
        <Textarea
          value={value.medicalAlerts}
          maxLength={500}
          aria-invalid={errors.medicalAlerts ? true : undefined}
          aria-describedby={errors.medicalAlerts ? alertsError : undefined}
          onChange={(event) => onChange({ ...value, medicalAlerts: event.target.value })}
          placeholder="For example: hypertension, on blood thinners, pregnant"
        />
        {errors.medicalAlerts && (
          <span id={alertsError} className="text-destructive">
            {errors.medicalAlerts}
          </span>
        )}
      </label>
    </fieldset>
  );
  if (alertsOnly) return alerts;
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Name</legend>
        {text("lastName", "Last name", { maxLength: 50, autoComplete: "off" })}
        {text("firstName", "First name", { maxLength: 50, autoComplete: "off" })}
        {text("middleName", "Middle name", { maxLength: 50, autoComplete: "off" })}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {text("birthday", "Birthday", { type: "date" })}
        <label className="grid gap-1.5 text-sm font-medium">
          Sex
          <NativeSelect value={value.sex} onChange={(event) => onChange({ ...value, sex: event.target.value })} className="w-full">
            <NativeSelectOption value="">Not given</NativeSelectOption>
            <NativeSelectOption value="female">Female</NativeSelectOption>
            <NativeSelectOption value="male">Male</NativeSelectOption>
          </NativeSelect>
        </label>
        {text("mobile", "Mobile", { type: "tel", inputMode: "tel", placeholder: "0917 123 4567" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("email", "Email", { type: "email" })}
        {text("occupation", "Occupation", { maxLength: 60 })}
      </div>
      {text("address", "Home address", { maxLength: 200 })}
      <div className="grid gap-3 sm:grid-cols-3">
        {text("guardianName", "Parent or guardian (minors)", { maxLength: 100 })}
        {text("emergencyName", "Emergency contact", { maxLength: 100 })}
        {text("emergencyMobile", "Emergency mobile", { type: "tel", inputMode: "tel" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {text("hmoProvider", "HMO or dental insurance", { maxLength: 60 })}
        {text("hmoMemberNo", "Member number", { maxLength: 40 })}
        {text("insuranceEffective", "Effective date", { type: "date" })}
      </div>
      {alerts}
      {showConsent && (
        <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={value.consent} onChange={(event) => onChange({ ...value, consent: event.target.checked })} />
          The patient signed the data privacy consent form.
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the add-patient dialog, `src/components/add-patient-dialog.tsx`**

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EMPTY_PATIENT, PatientFields, type PatientDraft } from "@/components/patient-fields";
import type { PatientHit } from "@/components/patient-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, fieldErrors, RequestError } from "@/lib/fetcher";

type Added = { id: string; name: string };

/** Adds a patient to the practice, warning first about a likely duplicate (spec section 10). */
export function AddPatientDialog({
  open,
  onOpenChange,
  onAdded,
  homeBranch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (patient: Added) => void;
  homeBranch?: string;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<PatientDraft>(EMPTY_PATIENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<PatientHit[] | null>(null);

  const reset = () => {
    setDraft(EMPTY_PATIENT);
    setErrors({});
    setCandidates(null);
  };
  const finish = (patient: Added) => {
    onAdded(patient);
    reset();
    onOpenChange(false);
  };
  const add = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      api<{ id: string; chartNo: number }>("/patients", { method: "POST", body: { ...draft, allowDuplicate, homeBranch } }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["patients"] });
      toast.success(`Added ${draft.lastName}, ${draft.firstName} as chart ${created.chartNo}.`);
      finish({ id: created.id, name: `${draft.lastName}, ${draft.firstName}` });
    },
    onError: (error) => {
      if (error instanceof RequestError && error.body.code === "possible_duplicate") {
        setCandidates((error.body.candidates ?? []) as PatientHit[]);
        return;
      }
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing without adding starts the next patient fresh, never on an old draft or duplicate warning.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a patient</DialogTitle>
          <DialogDescription>One record for the whole practice, used at every branch.</DialogDescription>
        </DialogHeader>
        {candidates ? (
          <div className="grid gap-3">
            <Alert>
              <AlertTitle>This patient may already be on file</AlertTitle>
              <AlertDescription>Use the existing record if it is the same person.</AlertDescription>
            </Alert>
            <ul className="grid gap-2">
              {candidates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span>
                    {`${c.lastName}, ${c.firstName}`}
                    <span className="block text-sm text-muted-foreground">{[`Chart ${c.chartNo}`, c.birthday, c.mobile].filter(Boolean).join(" · ")}</span>
                  </span>
                  <Button variant="outline" onClick={() => finish({ id: c.id, name: `${c.lastName}, ${c.firstName}` })}>
                    Use this record
                  </Button>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCandidates(null)}>
                Go back
              </Button>
              <Button onClick={() => add.mutate(true)} disabled={add.isPending}>
                Add as a new patient
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setErrors({});
              add.mutate(false);
            }}
          >
            <PatientFields value={draft} onChange={setDraft} errors={errors} showConsent />
            <DialogFooter>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? "Adding..." : "Add patient"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Write the Patients list**

`src/app/[branch]/patients/page.tsx`:

```tsx
import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/server/session";
import { PatientsScreen } from "./patients-screen";

export const metadata: Metadata = { title: "Patients" };

export default async function PatientsPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  return <PatientsScreen branch={branch} canAdd={can(staff, "patient.edit")} />;
}
```

`src/app/[branch]/patients/patients-screen.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { PatientSearch } from "@/components/patient-search";
import { Button } from "@/components/ui/button";

export function PatientsScreen({ branch, canAdd }: { branch: string; canAdd: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = (id: string) => router.push(`/${branch}/patients/${id}`);
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Patients</h1>
        {canAdd && <Button onClick={() => setAdding(true)}>Add patient</Button>}
      </div>
      <PatientSearch onPick={(p) => open(p.id)} autoFocus />
      {canAdd && (
        <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={(p) => open(p.id)} homeBranch={branch === "all" ? undefined : branch} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the patient page**

`src/app/[branch]/patients/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { ApiError } from "@/server/errors";
import { getPatient } from "@/server/patients";
import { requireStaff } from "@/server/session";
import { PatientScreen, type PatientJson } from "./patient-screen";

export const metadata: Metadata = { title: "Patient" };

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  let patient;
  try {
    patient = await getPatient(staff, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return <PatientScreen patient={JSON.parse(JSON.stringify(patient)) as PatientJson} canEdit={can(staff, "patient.edit")} />;
}
```

`src/app/[branch]/patients/[id]/patient-screen.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBanner } from "@/components/alert-banner";
import { FormAlert } from "@/components/form-alert";
import { EMPTY_PATIENT, PatientFields, type PatientDraft } from "@/components/patient-fields";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import type { Status } from "@/lib/lifecycle";
import { ageOn, ALLERGY_LABELS, alertLines, fullName, type Allergy } from "@/lib/patients";
import { formatDateTime, manilaDate } from "@/lib/time";

export type PatientJson = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthday: string | null;
  sex: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  guardianName: string | null;
  emergencyName: string | null;
  emergencyMobile: string | null;
  hmoProvider: string | null;
  hmoMemberNo: string | null;
  insuranceEffective: string | null;
  allergies: string[];
  allergiesOther: string | null;
  medicalAlerts: string;
  consentAt: string | null;
  consentByName: string | null;
  homeBranchName: string | null;
};

type PatientVisitJson = {
  id: string;
  start: string;
  status: Status;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistName: string;
  procedures: string[];
};

export function PatientScreen({ patient, canEdit }: { patient: PatientJson; canEdit: boolean }) {
  const age = patient.birthday ? ageOn(patient.birthday, manilaDate(new Date())) : null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{fullName(patient)}</h1>
        <p className="text-muted-foreground">
          {[`Chart ${patient.chartNo}`, age !== null ? `${age} years old` : null, patient.hmoProvider ? `HMO: ${patient.hmoProvider}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <AlertBanner lines={alertLines(patient)} />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <DetailsPanel patient={patient} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="visits" className="pt-4">
          <VisitsPanel patientId={patient.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function draftOf(p: PatientJson): PatientDraft {
  const text = (value: string | null) => value ?? "";
  return {
    ...EMPTY_PATIENT,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: text(p.middleName),
    birthday: text(p.birthday),
    sex: text(p.sex),
    mobile: text(p.mobile),
    email: text(p.email),
    address: text(p.address),
    occupation: text(p.occupation),
    guardianName: text(p.guardianName),
    emergencyName: text(p.emergencyName),
    emergencyMobile: text(p.emergencyMobile),
    hmoProvider: text(p.hmoProvider),
    hmoMemberNo: text(p.hmoMemberNo),
    insuranceEffective: text(p.insuranceEffective),
    allergies: p.allergies,
    allergiesOther: text(p.allergiesOther),
    medicalAlerts: p.medicalAlerts,
    consent: p.consentAt !== null,
  };
}

function DetailsPanel({ patient, canEdit }: { patient: PatientJson; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(() => draftOf(patient));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Only changed fields are sent, so the audit log names only what changed (spec 13).
  const changes = () => {
    const before = draftOf(patient);
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof PatientDraft])));
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/patients/${patient.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(false);
      setErrors({});
      router.refresh();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });

  if (editing) {
    return (
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = changes();
          if (Object.keys(body).length === 0) setEditing(false);
          else save.mutate(body);
        }}
      >
        <PatientFields value={draft} onChange={setDraft} errors={errors} alertsOnly={!canEdit} showConsent={canEdit && patient.consentAt === null} />
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            Go back
          </Button>
        </div>
      </form>
    );
  }
  const row = (label: string, value: string | null | undefined) => (
    <div className="grid gap-0.5 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{value || "Not given"}</dd>
    </div>
  );
  return (
    <div className="grid max-w-3xl gap-4">
      <dl className="grid gap-2">
        {row("Birthday", patient.birthday)}
        {row("Sex", patient.sex === "female" ? "Female" : patient.sex === "male" ? "Male" : null)}
        {row("Mobile", patient.mobile)}
        {row("Email", patient.email)}
        {row("Home address", patient.address)}
        {row("Occupation", patient.occupation)}
        {row("Parent or guardian", patient.guardianName)}
        {row("Emergency contact", [patient.emergencyName, patient.emergencyMobile].filter(Boolean).join(", "))}
        {row("HMO or insurance", [patient.hmoProvider, patient.hmoMemberNo, patient.insuranceEffective && `effective ${patient.insuranceEffective}`].filter(Boolean).join(", "))}
        {row("Allergies", [...patient.allergies.map((a) => ALLERGY_LABELS[a as Allergy] ?? a), patient.allergiesOther].filter(Boolean).join(", "))}
        {row("Medical alerts", patient.medicalAlerts)}
        {row("Privacy consent", patient.consentAt ? `Signed, recorded ${formatDateTime(new Date(patient.consentAt))} by ${patient.consentByName ?? "staff"}` : "Not recorded yet")}
        {row("First registered at", patient.homeBranchName)}
      </dl>
      <div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          {canEdit ? "Edit details" : "Edit allergies and alerts"}
        </Button>
      </div>
    </div>
  );
}

function VisitsPanel({ patientId }: { patientId: string }) {
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[]; next: PatientVisitJson | null }>(`/patients/${patientId}/visits`),
  });
  if (visits.isPending) return <p className="text-muted-foreground">Loading visits...</p>;
  if (visits.isError) return <FormAlert message={errorMessage(visits.error)} />;
  const { next } = visits.data;
  return (
    <div className="grid gap-3">
      <p>{next ? `Next visit: ${formatDateTime(new Date(next.start))} at ${next.branchName} with ${next.dentistName}.` : "No upcoming visit."}</p>
      {visits.data.visits.length === 0 ? (
        <p className="text-muted-foreground">No visits yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Chair</TableHead>
                <TableHead>Dentist</TableHead>
                <TableHead>Procedures</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.data.visits.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{formatDateTime(new Date(v.start))}</TableCell>
                  <TableCell>{v.branchName}</TableCell>
                  <TableCell>{v.chairLabel ? `${v.chairNumber}, ${v.chairLabel}` : v.chairNumber}</TableCell>
                  <TableCell>{v.dentistName}</TableCell>
                  <TableCell className="whitespace-normal">{v.procedures.join(", ")}</TableCell>
                  <TableCell>
                    <StatusBadge status={v.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Check it in the browser**

With `npm run dev` and a signed-in owner (plan A), open `/all/patients`:

Expected: the list says "No patients yet."; Add patient opens the form. Adding "Santos, Ana" with a latex allergy opens her page: the red banner reads "Allergy: Latex", Details lists the fields, Visits says "No upcoming visit." and "No visits yet." Adding "santos, ana" again with the same birthday shows "This patient may already be on file" with "Use this record". Searching "sant" finds her. At 375px wide the form stacks into one column. The browser console shows no errors.

- [ ] **Step 9: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the Patients screens with search, duplicate warnings, and alert banners" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The calendar

**Files:**
- Create: `src/lib/visits.ts`, `tests/unit/visits.test.ts`, `src/components/calendar/day-grid.tsx`, `src/components/calendar/week-grid.tsx`, `src/components/calendar/visit-panel.tsx`, `src/app/[branch]/calendar/page.tsx`, `src/app/[branch]/calendar/calendar-screen.tsx`
- Modify: `src/lib/nav.ts`, `tests/unit/shell.test.ts`, `src/server/home.ts`

**Interfaces:**
- Consumes: `GET /appointments`, `GET /appointments/{id}`, `POST /appointments/{id}/transitions` (Task 3); `NEXT`, `actionFor`, `actionLabel`, `changeProblem`, `type Status` (Task 1); `StatusBadge`, `AlertMark`, `AlertBanner` (Task 6); plan A's `can`, `type Subject`, `hoursOn`, `branchByCode`, `listChairs`, `requireStaff`, time helpers, shadcn components.
- Produces:
  - `@/lib/visits`: `type VisitJson` (a `VisitView` after JSON), `type VisitDetailJson`, `chairName(number, label)`, `offGrid(status)`, `ROW_MINUTES`, `dayRange(hours, date, visits)`, `weekDates(date)`, `placement(visit, date, rangeStart)`, `dateParam(value, today)`.
  - `DayGrid({ date, range, chairs, visits, onOpen, onSlot? })`: `onSlot(chairNumber, minutes)` fires on a click in an empty part of a chair column (Task 8 opens the booking panel with it).
  - `WeekGrid({ days, today, chairs, visits, onOpen, onDay })`, `VisitPanel({ visitId, branch, staff, onClose, onMove? })` (Task 8 passes `onMove`).
  - `CalendarScreen` with `type CalendarProps` (Task 8 adds booking to it).

- [ ] **Step 1: Write the failing test, `tests/unit/visits.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS } from "@/lib/hours";
import { dateParam, dayRange, placement, weekDates } from "@/lib/visits";

const at = (clock: string) => `2026-10-05T${clock}:00+08:00`;

describe("calendar layout", () => {
  it("shows the branch's hours, widened to every visit and its turnover", () => {
    expect(dayRange(DEFAULT_HOURS, "2026-10-05", [])).toEqual({ start: 540, end: 1080 });
    expect(dayRange(DEFAULT_HOURS, "2026-10-05", [{ start: at("08:10"), chairFreeAt: at("18:20") }])).toEqual({ start: 480, end: 1110 });
  });

  it("shows 8:00 to 18:00 on a closed day with no visits", () => {
    expect(dayRange(DEFAULT_HOURS, "2026-10-04", [])).toEqual({ start: 480, end: 1080 });
  });

  it("starts weeks on Monday", () => {
    expect(weekDates("2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(weekDates("2026-10-05")[0]).toBe("2026-10-05");
    expect(weekDates("2026-10-11")[0]).toBe("2026-10-05");
  });

  it("places a visit and its turnover in minutes from the top of the grid", () => {
    expect(placement({ start: at("10:00"), end: at("11:30"), chairFreeAt: at("11:50") }, "2026-10-05", 540)).toEqual({ top: 60, height: 90, turnover: 20 });
  });

  it("reads a page's date, falling back to today", () => {
    expect(dateParam("2026-10-05", "2026-09-29")).toBe("2026-10-05");
    expect(dateParam("2026-02-31", "2026-09-29")).toBe("2026-09-29");
    expect(dateParam(["2026-10-05"], "2026-09-29")).toBe("2026-09-29");
    expect(dateParam(undefined, "2026-09-29")).toBe("2026-09-29");
  });
});
```

```powershell
npx vitest run tests/unit/visits.test.ts
```

Expected: FAIL, because `@/lib/visits` does not exist.

- [ ] **Step 2: Write `src/lib/visits.ts`**

```ts
import { z } from "zod";
import type { OperatingHours } from "@/db/schema";
import { hoursOn } from "./hours";
import type { Status } from "./lifecycle";
import { addDays, manilaInstant, weekday } from "./time";

/** A visit as GET /appointments and GET /overview send it (`VisitView` in src/server/appointments.ts, dates as strings). */
export type VisitJson = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  chartNo: number;
  hasAlerts: boolean;
  start: string;
  end: string;
  chairFreeAt: string;
  status: Status;
  source: string;
  note: string;
  cancelReason: string | null;
  procedures: string[];
};

/** GET /appointments/{id}: the visit, its procedure ids, the patient's alerts, and its history. */
export type VisitDetailJson = VisitJson & {
  procedureIds: string[];
  alerts: string[];
  history: { at: string; by: string; text: string }[];
};

/** "Chair 2 · Ortho", or "Chair 2" without a label. */
export function chairName(number: number, label: string): string {
  return label ? `Chair ${number} · ${label}` : `Chair ${number}`;
}

/** Cancelled and no-show visits no longer hold their chair, so the day grid lists them under it instead. */
export function offGrid(status: Status): boolean {
  return status === "cancelled" || status === "no_show";
}

export const ROW_MINUTES = 15;

/** The minutes a day grid shows: the branch's hours, widened to every visit and its turnover (8:00 to 18:00 when closed). */
export function dayRange(
  hours: OperatingHours,
  date: string,
  visits: readonly { start: string; chairFreeAt: string }[],
): { start: number; end: number } {
  const open = hoursOn(hours, weekday(date));
  const midnight = manilaInstant(date, 0).getTime();
  let start = open?.open ?? 8 * 60;
  let end = open?.close ?? 18 * 60;
  for (const v of visits) {
    start = Math.min(start, (Date.parse(v.start) - midnight) / 60_000);
    end = Math.max(end, (Date.parse(v.chairFreeAt) - midnight) / 60_000);
  }
  return {
    start: Math.max(0, Math.floor(start / ROW_MINUTES) * ROW_MINUTES),
    end: Math.min(24 * 60, Math.ceil(end / ROW_MINUTES) * ROW_MINUTES),
  };
}

/** The seven dates of the week (Monday first) that holds a date. */
export function weekDates(date: string): string[] {
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Where a visit sits in a day grid, in minutes from the grid's first row: the visit, then its turnover. */
export function placement(
  v: { start: string; end: string; chairFreeAt: string },
  date: string,
  rangeStart: number,
): { top: number; height: number; turnover: number } {
  const midnight = manilaInstant(date, 0).getTime();
  const minutes = (iso: string) => (Date.parse(iso) - midnight) / 60_000;
  return { top: minutes(v.start) - rangeStart, height: minutes(v.end) - minutes(v.start), turnover: minutes(v.chairFreeAt) - minutes(v.end) };
}

/** A page's `?date=`: a real "YYYY-MM-DD" date, or today. */
export function dateParam(value: string | string[] | undefined, today: string): string {
  return typeof value === "string" && z.iso.date().safeParse(value).success ? value : today;
}
```

```powershell
npx vitest run tests/unit/visits.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 3: Put Calendar first in the navigation, and land the staff on it**

Replace `src/lib/nav.ts`:

```ts
import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch (or "all", which has no calendar: chairs belong to one branch). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = branch === "all" ? [] : [{ href: `/${branch}/calendar`, label: "Calendar" }];
  items.push({ href: `/${branch}/patients`, label: "Patients" });
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
```

In `tests/unit/shell.test.ts`, replace the test "builds the navigation for each role" with:

```ts
  it("builds the navigation for each role", () => {
    expect(navItems({ role: "owner", seesPatients: false }, "all").map((i) => i.label)).toEqual(["Patients", "Staff", "Settings"]);
    expect(navItems({ role: "manager", seesPatients: false }, "downtown").map((i) => i.href)).toEqual([
      "/downtown/calendar",
      "/downtown/patients",
      "/downtown/staff",
      "/downtown/settings",
    ]);
    expect(navItems({ role: "dentist", seesPatients: true }, "downtown").map((i) => i.label)).toEqual(["Calendar", "Patients", "Schedules"]);
  });
```

In `src/server/home.ts`, replace the doc comment and the last line of `homePath` so staff land on their calendar:

```ts
/** Where each person lands after signing in: the owner at All branches, everyone else at their branch's calendar. */
```

```ts
  return `/${branch.code}/calendar`;
```

```powershell
npx vitest run tests/unit/shell.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Write the day grid, `src/components/calendar/day-grid.tsx`**

```tsx
"use client";

import { Fragment, useState, useSyncExternalStore } from "react";
import { AlertMark } from "@/components/alert-mark";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatTime, manilaInstant } from "@/lib/time";
import { cn } from "@/lib/utils";
import { chairName, placement, ROW_MINUTES, type VisitJson } from "@/lib/visits";

// 30 pixels per 15 minutes: a 30-minute card fits its time and patient, procedure and dentist, and status badge.
const ROW_PX = 30;
const px = (minutes: number) => (minutes / ROW_MINUTES) * ROW_PX;

const everyMinute = (tick: () => void) => {
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
};

/** Minutes since 1970, re-read every minute; null while rendering on the server, so the page hydrates cleanly. */
function useMinute(): number | null {
  return useSyncExternalStore(everyMinute, () => Math.floor(Date.now() / 60_000), () => null);
}

type Props = {
  date: string;
  range: { start: number; end: number };
  chairs: { number: number; label: string }[];
  visits: VisitJson[];
  onOpen: (visit: VisitJson) => void;
  onSlot?: (chairNumber: number, minutes: number) => void;
};

/** Spec 10, the day view: a column per chair, 15-minute rows, cards with their turnover, and a line at the current time. */
export function DayGrid({ date, range, chairs, visits, onOpen, onSlot }: Props) {
  const [shown, setShown] = useState(chairs[0]?.number);
  const minute = useMinute();
  const height = px(range.end - range.start);
  const nowAt = minute === null ? null : minute - manilaInstant(date, 0).getTime() / 60_000 - range.start;
  const labels: number[] = [];
  for (let m = Math.ceil(range.start / 30) * 30; m < range.end; m += 30) labels.push(m);

  return (
    <div className="grid gap-2">
      <div role="group" aria-label="Chair" className="flex gap-1 overflow-x-auto sm:hidden">
        {chairs.map((c) => (
          <Button key={c.number} variant={c.number === shown ? "default" : "outline"} aria-pressed={c.number === shown} onClick={() => setShown(c.number)}>
            {chairName(c.number, c.label)}
          </Button>
        ))}
      </div>
      <div className="flex overflow-x-auto rounded-lg border">
        <div className="w-20 shrink-0 border-r text-xs text-muted-foreground">
          <div className="h-10 border-b" />
          <div className="relative" style={{ height }}>
            {labels.map((m) => (
              <span key={m} className="absolute right-2 pt-0.5" style={{ top: px(m - range.start) }}>
                {formatTime(manilaInstant(date, m))}
              </span>
            ))}
          </div>
        </div>
        {chairs.map((c) => (
          <div key={c.number} className={cn("min-w-40 flex-1 border-r last:border-r-0", c.number !== shown && "hidden sm:block")}>
            <div className="flex h-10 items-center border-b px-2 text-sm font-medium">{chairName(c.number, c.label)}</div>
            <div
              className={cn("relative", onSlot && "cursor-pointer")}
              style={{ height, backgroundImage: "linear-gradient(to bottom, var(--border) 1px, transparent 1px)", backgroundSize: `100% ${px(30)}px` }}
              onClick={(event) => {
                // Only clicks on the empty column book: cards and turnover strips sit on top of it.
                if (!onSlot || event.target !== event.currentTarget) return;
                const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                onSlot(c.number, range.start + Math.floor(y / ROW_PX) * ROW_MINUTES);
              }}
            >
              {visits
                .filter((v) => v.chairNumber === c.number)
                .map((v) => {
                  const at = placement(v, date, range.start);
                  return (
                    <Fragment key={v.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(v)}
                        className={cn(
                          "absolute inset-x-1 flex min-h-11 flex-col items-start overflow-hidden rounded-md border bg-card px-2 py-1 text-left text-xs shadow-sm outline-none hover:bg-muted focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0",
                          v.status === "completed" && "opacity-70",
                        )}
                        style={{ top: px(at.top), height: Math.max(px(at.height), ROW_PX) }}
                      >
                        <span className="flex w-full items-start justify-between gap-1">
                          <span className="truncate font-medium">{`${formatTime(new Date(v.start))} ${v.patientName}`}</span>
                          {v.hasAlerts && <AlertMark />}
                        </span>
                        <span className="w-full truncate text-muted-foreground">{`${v.procedures.join(", ")} · ${v.dentistName}`}</span>
                        <StatusBadge status={v.status} />
                        <span className="sr-only">{`, ${chairName(c.number, c.label)}, chair free at ${formatTime(new Date(v.chairFreeAt))}`}</span>
                      </button>
                      {at.turnover > 0 && (
                        <div
                          aria-hidden
                          title={`Turnover until ${formatTime(new Date(v.chairFreeAt))}`}
                          className="absolute inset-x-1 rounded-b-md border border-dashed"
                          style={{
                            top: px(at.top + at.height),
                            height: px(at.turnover),
                            backgroundImage: "repeating-linear-gradient(45deg, var(--muted) 0 4px, transparent 4px 8px)",
                          }}
                        />
                      )}
                    </Fragment>
                  );
                })}
              {nowAt !== null && nowAt >= 0 && nowAt <= range.end - range.start && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-destructive" style={{ top: px(nowAt) }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the week grid, `src/components/calendar/week-grid.tsx`**

```tsx
"use client";

import { useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { StatusBadge } from "@/components/status-badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDay, formatTime, manilaDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { chairName, type VisitJson } from "@/lib/visits";

type Props = {
  days: string[];
  today: string;
  chairs: { number: number; label: string }[];
  visits: VisitJson[];
  onOpen: (visit: VisitJson) => void;
  onDay: (date: string) => void;
};

/** Spec 10, the week view: seven day columns of compact cards, filtered by dentist or chair. */
export function WeekGrid({ days, today, chairs, visits, onOpen, onDay }: Props) {
  const [dentist, setDentist] = useState("");
  const [chair, setChair] = useState("");
  const dentists = [...new Map(visits.map((v) => [v.dentistId, v.dentistName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = visits.filter((v) => (!dentist || v.dentistId === dentist) && (!chair || v.chairNumber === Number(chair)));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Dentist
          <NativeSelect value={dentist} onChange={(event) => setDentist(event.target.value)}>
            <NativeSelectOption value="">All dentists</NativeSelectOption>
            {dentists.map(([id, name]) => (
              <NativeSelectOption key={id} value={id}>
                {name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Chair
          <NativeSelect value={chair} onChange={(event) => setChair(event.target.value)}>
            <NativeSelectOption value="">All chairs</NativeSelectOption>
            {chairs.map((c) => (
              <NativeSelectOption key={c.number} value={String(c.number)}>
                {chairName(c.number, c.label)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((day) => {
          const list = shown.filter((v) => manilaDate(new Date(v.start)) === day);
          return (
            <section key={day} aria-labelledby={`day-${day}`} className={cn("min-w-0 rounded-lg border p-2", day === today && "border-primary")}>
              <h2 id={`day-${day}`} className="mb-2 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => onDay(day)}
                  className="min-h-11 rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
                >
                  {formatDay(day)}
                </button>
                {day === today && <span className="ml-1 text-xs font-normal text-primary">Today</span>}
              </h2>
              <ul className="grid gap-1">
                {list.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(v)}
                      className="grid w-full gap-0.5 rounded-md border px-2 py-1 text-left text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="font-medium">{formatTime(new Date(v.start))}</span>
                        {v.hasAlerts && <AlertMark />}
                      </span>
                      <span className="truncate">{v.patientName}</span>
                      <StatusBadge status={v.status} className="justify-self-start" />
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="text-xs text-muted-foreground">No visits</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the visit panel, `src/components/calendar/visit-panel.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBanner } from "@/components/alert-banner";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/fetcher";
import { actionFor, actionLabel, changeProblem, NEXT, type Status } from "@/lib/lifecycle";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime, formatTime } from "@/lib/time";
import { chairName, type VisitDetailJson } from "@/lib/visits";

type Props = {
  visitId: string | null;
  branch: string;
  staff: Subject;
  onClose: () => void;
  onMove?: (visit: VisitDetailJson) => void;
};

/** Spec 10, a visit's panel: details, the status changes allowed right now, Cancel, Open patient, and the history. */
export function VisitPanel({ visitId, branch, staff, onClose, onMove }: Props) {
  const client = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const detail = useQuery({
    queryKey: ["appointment", visitId],
    queryFn: () => api<VisitDetailJson>(`/appointments/${visitId}`),
    enabled: visitId !== null,
  });
  const change = useMutation({
    mutationFn: (body: { to: Status; reason?: string }) => api(`/appointments/${visitId}/transitions`, { method: "POST", body }),
    onSuccess: async () => {
      toast.success("Saved.");
      setCancelling(false);
      setReason("");
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment", visitId] });
    },
    onError: async (error) => {
      toast.error(errorMessage(error));
      // Someone else may have changed the visit: show what it is now.
      await client.invalidateQueries({ queryKey: ["appointment", visitId] });
      await client.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const v = detail.data;
  const now = new Date();
  const allowed = v
    ? NEXT[v.status].filter(
        (to) => changeProblem(v.status, to, new Date(v.start), now) === null && can(staff, actionFor(to), { branchId: v.branchId, dentistId: v.dentistId }),
      )
    : [];
  const canMove = v !== undefined && ["requested", "confirmed", "checked_in"].includes(v.status) && can(staff, "appointment.manage", { branchId: v.branchId });

  return (
    <Dialog
      open={visitId !== null}
      onOpenChange={(open) => {
        if (open) return;
        setCancelling(false);
        setReason("");
        onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {!v ? (
          <DialogHeader>
            <DialogTitle>Visit</DialogTitle>
            {detail.isError ? <FormAlert message={errorMessage(detail.error)} /> : <DialogDescription>Loading...</DialogDescription>}
          </DialogHeader>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{v.patientName}</DialogTitle>
              <DialogDescription>
                {`${formatDateTime(new Date(v.start))} to ${formatTime(new Date(v.end))}, ${chairName(v.chairNumber, v.chairLabel)}, ${v.branchName}`}
              </DialogDescription>
            </DialogHeader>
            <AlertBanner lines={v.alerts} />
            <dl className="grid gap-x-3 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge status={v.status} />
              </dd>
              <dt className="text-muted-foreground">Dentist</dt>
              <dd>{v.dentistName}</dd>
              <dt className="text-muted-foreground">Procedures</dt>
              <dd>{v.procedures.join(", ")}</dd>
              <dt className="text-muted-foreground">Chair free at</dt>
              <dd>{`${formatTime(new Date(v.chairFreeAt))}, after turnover`}</dd>
              {v.source === "walk_in" && (
                <>
                  <dt className="text-muted-foreground">Booked as</dt>
                  <dd>Walk-in</dd>
                </>
              )}
              {v.note && (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="whitespace-pre-wrap">{v.note}</dd>
                </>
              )}
              {v.cancelReason && (
                <>
                  <dt className="text-muted-foreground">Why cancelled</dt>
                  <dd>{v.cancelReason}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap gap-2">
              {allowed
                .filter((to) => to !== "cancelled")
                .map((to, i) => (
                  <Button key={to} variant={i === 0 ? "default" : "outline"} disabled={change.isPending} onClick={() => change.mutate({ to })}>
                    {actionLabel(v.status, to)}
                  </Button>
                ))}
              {onMove && canMove && (
                <Button variant="outline" onClick={() => onMove(v)}>
                  Move
                </Button>
              )}
              {allowed.includes("cancelled") && !cancelling && (
                <Button variant="outline" onClick={() => setCancelling(true)}>
                  Cancel visit
                </Button>
              )}
              <Link href={`/${branch}/patients/${v.patientId}`} className={buttonVariants({ variant: "outline" })}>
                Open patient
              </Link>
            </div>
            {cancelling && (
              <form
                className="grid gap-2 rounded-lg border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  change.mutate({ to: "cancelled", reason });
                }}
              >
                <label className="grid gap-1.5 text-sm font-medium">
                  Reason for cancelling
                  <Textarea value={reason} maxLength={200} required onChange={(event) => setReason(event.target.value)} />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" disabled={change.isPending || !reason.trim()}>
                    Cancel the visit
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
                    Keep it
                  </Button>
                </div>
              </form>
            )}
            <section className="grid gap-1 text-sm">
              <h3 className="font-medium">History</h3>
              {v.history.length === 0 ? (
                <p className="text-muted-foreground">No changes recorded.</p>
              ) : (
                <ol className="grid gap-1">
                  {v.history.map((h, i) => (
                    <li key={`${h.at}-${i}`}>
                      <span className="text-muted-foreground">{`${formatDateTime(new Date(h.at))}, ${h.by}: `}</span>
                      {h.text}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Write the calendar page**

`src/app/[branch]/calendar/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { branchByCode, listChairs } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { CalendarScreen } from "./calendar-screen";

export const metadata: Metadata = { title: "Calendar" };

/** `?date=YYYY-MM-DD&view=day|week`, so a shared link opens the same day. The layout already checked the branch. */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { branch: code } = await params;
  if (code === "all") redirect("/all");
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const query = await searchParams;
  const today = manilaDate(new Date());
  const date = dateParam(query.date, today);
  const chairs = (await listChairs(branch.id)).filter((c) => c.active).map((c) => ({ number: c.number, label: c.label }));
  return (
    <CalendarScreen
      branch={{ code: branch.code, name: branch.name, hours: branch.operatingHours }}
      chairs={chairs}
      date={date}
      view={query.view === "week" ? "week" : "day"}
      today={today}
      staff={staff}
    />
  );
}
```

`src/app/[branch]/calendar/calendar-screen.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DayGrid } from "@/components/calendar/day-grid";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { WeekGrid } from "@/components/calendar/week-grid";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OperatingHours } from "@/db/schema";
import { api, errorMessage } from "@/lib/fetcher";
import type { Subject } from "@/lib/permissions";
import { addDays, formatDay, formatTime, manilaInstant } from "@/lib/time";
import { dayRange, offGrid, weekDates, type VisitJson } from "@/lib/visits";

export type CalendarProps = {
  branch: { code: string; name: string; hours: OperatingHours };
  chairs: { number: number; label: string }[];
  date: string;
  view: "day" | "week";
  today: string;
  staff: Subject;
};

/** Spec 10: the branch calendar, refreshed every 30 seconds and after every change. */
export function CalendarScreen({ branch, chairs, date, view, today, staff }: CalendarProps) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const days = view === "week" ? weekDates(date) : [date];
  const from = manilaInstant(days[0], 0).toISOString();
  const to = manilaInstant(addDays(days[days.length - 1], 1), 0).toISOString();
  const visits = useQuery({
    queryKey: ["appointments", branch.code, from, to],
    queryFn: () => api<VisitJson[]>(`/appointments?branch=${branch.code}&from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
  const go = (nextDate: string, nextView = view) => router.push(`/${branch.code}/calendar?date=${nextDate}&view=${nextView}`);
  const step = view === "week" ? 7 : 1;
  const list = visits.data ?? [];
  const inGrid = list.filter((v) => !offGrid(v.status));
  const off = list.filter((v) => offGrid(v.status));
  // A chair turned off later still shows the visits it held.
  const columns = [...chairs];
  for (const v of inGrid) if (!columns.some((c) => c.number === v.chairNumber)) columns.push({ number: v.chairNumber, label: v.chairLabel });
  columns.sort((a, b) => a.number - b.number);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{view === "week" ? `Week of ${formatDay(days[0])}` : formatDay(date)}</h1>
          <p className="text-sm text-muted-foreground">{`${branch.name}${view === "day" && date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => go(addDays(date, -step))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, step))}>
            Next
          </Button>
          <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && go(event.target.value)} />
          <div role="group" aria-label="View" className="flex gap-1">
            <Button variant={view === "day" ? "default" : "outline"} aria-pressed={view === "day"} onClick={() => go(date, "day")}>
              Day
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} aria-pressed={view === "week"} onClick={() => go(date, "week")}>
              Week
            </Button>
          </div>
        </div>
      </div>
      {visits.isError && <FormAlert message={errorMessage(visits.error)} />}
      {visits.isPending && <p className="text-sm text-muted-foreground">Loading visits...</p>}
      {columns.length === 0 ? (
        <p className="text-muted-foreground">This branch has no chairs yet. The owner adds them in Settings.</p>
      ) : view === "week" ? (
        <WeekGrid days={days} today={today} chairs={chairs} visits={list} onOpen={(v) => setOpenId(v.id)} onDay={(day) => go(day, "day")} />
      ) : (
        <DayGrid date={date} range={dayRange(branch.hours, date, inGrid)} chairs={columns} visits={inGrid} onOpen={(v) => setOpenId(v.id)} />
      )}
      {view === "day" && off.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">Cancelled and no-show</h2>
          <ul className="flex flex-wrap gap-2">
            {off.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(v.id)}
                  className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
                >
                  {`${formatTime(new Date(v.start))} ${v.patientName}`}
                  <StatusBadge status={v.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <VisitPanel visitId={openId} branch={branch.code} staff={staff} onClose={() => setOpenId(null)} />
    </div>
  );
}
```

- [ ] **Step 8: Check it in the browser**

With a fresh seed (`npm run seed` on an empty `.data/dev`, dev server stopped) and `npm run dev`, sign in as `downtown.desk`:

Expected: you land on `/downtown/calendar` (today). Four columns, "Chair 1 · General" to "Chair 4 · Surgery", rows every 15 minutes from 9:00 AM to 6:00 PM, cards with the time, patient, procedure, dentist, and a status badge, a hatched turnover strip under each card, red Alerts marks on some cards, and a red line at the current time during opening hours. Previous, Next, Today, and the date field change the day (and the URL); Week shows seven columns filtered by dentist and chair. Clicking a card opens its panel: a card from an earlier day shows its status and history; one of today's upcoming confirmed visits offers "Check in" and "Cancel visit"; "Check in" updates the card within a second; "Cancel visit" asks for a reason. At 375px wide the chairs become buttons that show one column at a time. The browser console shows no errors.

- [ ] **Step 9: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the branch calendar with day and week views and the visit panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Booking, walk-ins, and moving

**Files:**
- Create: `src/components/calendar/booking-panel.tsx`
- Modify (full replacements below): `src/app/[branch]/calendar/page.tsx`, `src/app/[branch]/calendar/calendar-screen.tsx`

**Interfaces:**
- Consumes: `GET /procedures?active=1`, `GET /dentists` (`useDentists`, plan A), `GET /availability` (Task 4), `POST /appointments/validate`, `POST /appointments`, `PATCH /appointments/{id}` (Task 3); `PatientSearch`, `AddPatientDialog` (Task 6); `DayGrid`'s `onSlot` and `VisitPanel`'s `onMove`, `chairName`, `type VisitDetailJson` (Task 7).
- Produces: `BookingPanel({ intent, branch, chairs, today, onClose })` and `type BookingIntent`:
  - `{ kind: "new"; date; minutes?; chairNumber?; walkIn? }`: from New booking, Walk-in, or a click on an empty slot (which fills the time and chair);
  - `{ kind: "move"; visit }`: from the visit panel's Move. A checked-in visit changes only its chair (spec 8.7).

How the panel works (spec 10): find or add the patient; tick procedures (the total time and turnover show); pick a date and one of its open times, filtered by dentist or Any (the dentist and the lowest free chair fill in and can be changed), or "Pick another time" to type any start with any dentist and chair. As soon as the booking is complete the panel asks `POST /appointments/validate` and lists the errors (Book stays disabled) and warnings (the button becomes "Book anyway", which sends `acknowledgeWarnings: true`). A clash found only at saving, such as another desk booking the same chair a moment earlier, shows the server's message naming the visit that won.

- [ ] **Step 1: Write the booking panel, `src/components/calendar/booking-panel.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch } from "@/components/patient-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, RequestError } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";
import { formatDay, formatTime, fromMinutes, manilaDate, manilaInstant, manilaMinutes, toMinutes } from "@/lib/time";
import { chairName, type VisitDetailJson } from "@/lib/visits";

type Procedure = { id: string; name: string; durationMinutes: number; bufferMinutes: number };
type OpenTime = { start: string; dentists: { id: string; name: string; chairs: number[] }[] };
type Finding = { code: string; message: string };
type Check = { ok: boolean; errors: Finding[]; warnings: Finding[] };

/** What opened the panel: New booking, Walk-in, or an empty slot (with its time and chair), or Move on a visit. */
export type BookingIntent =
  | { kind: "new"; date: string; minutes?: number; chairNumber?: number; walkIn?: boolean }
  | { kind: "move"; visit: VisitDetailJson };

type Props = {
  intent: BookingIntent;
  branch: { id: string; code: string; name: string };
  chairs: { number: number; label: string }[];
  today: string;
  onClose: () => void;
};

/** "HH:MM" in Manila for an ISO instant. */
const clock = (iso: string) => fromMinutes(manilaMinutes(new Date(iso)));
const lowest = (numbers: number[] | undefined) => (numbers && numbers.length > 0 ? Math.min(...numbers) : null);

const toggleClass = "flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm sm:min-h-9";

/** Spec 10, the booking panel. Moving uses the same checks as booking, with the visit itself left out (spec 8.7). */
export function BookingPanel({ intent, branch, chairs, today, onClose }: Props) {
  const client = useQueryClient();
  const moving = intent.kind === "move" ? intent.visit : null;
  const fresh = intent.kind === "new" ? intent : null;
  const chairOnly = moving?.status === "checked_in";
  const [patient, setPatient] = useState(moving ? { id: moving.patientId, name: moving.patientName } : null);
  const [adding, setAdding] = useState(false);
  const [procedureIds, setProcedureIds] = useState<string[]>(moving?.procedureIds ?? []);
  const [walkIn, setWalkIn] = useState(fresh?.walkIn === true);
  const [date, setDate] = useState(moving ? manilaDate(new Date(moving.start)) : (fresh?.date ?? today));
  const [anyTime, setAnyTime] = useState(moving !== null || fresh?.minutes !== undefined);
  const [time, setTime] = useState(moving ? clock(moving.start) : fresh?.minutes !== undefined ? fromMinutes(fresh.minutes) : "");
  const [dentistFilter, setDentistFilter] = useState("");
  const [dentistId, setDentistId] = useState(moving?.dentistId ?? "");
  const [chairNumber, setChairNumber] = useState<number | null>(moving?.chairNumber ?? fresh?.chairNumber ?? null);
  const [requested, setRequested] = useState(false);
  const [note, setNote] = useState("");

  const procedures = useQuery({ queryKey: ["procedures", "active"], queryFn: () => api<Procedure[]>("/procedures?active=1") });
  const dentists = useDentists();
  const picked = (procedures.data ?? []).filter((p) => procedureIds.includes(p.id));
  const minutes = picked.reduce((sum, p) => sum + p.durationMinutes, 0);
  const turnover = Math.max(0, ...picked.map((p) => p.bufferMinutes));
  const open = useQuery({
    queryKey: ["availability", branch.code, date, procedureIds.join(","), patient?.id ?? ""],
    queryFn: () =>
      api<{ times: OpenTime[] }>(
        `/availability?branch=${branch.code}&date=${date}&procedures=${procedureIds.join(",")}${patient ? `&patient=${patient.id}` : ""}`,
      ),
    enabled: procedureIds.length > 0 && !walkIn && !anyTime && !chairOnly,
  });
  const working = [...new Map((open.data?.times ?? []).flatMap((t) => t.dentists.map((d) => [d.id, d.name] as const))).entries()];
  const times = (open.data?.times ?? []).filter((t) => !dentistFilter || t.dentists.some((d) => d.id === dentistFilter));
  const slot = anyTime || walkIn ? undefined : times.find((t) => clock(t.start) === time);
  const slotDentist = slot?.dentists.find((d) => d.id === dentistId);
  const here = (dentists.data ?? []).filter((d) => d.branchIds.includes(branch.id));

  const start = walkIn || !time ? null : manilaInstant(date, toMinutes(time)).toISOString();
  const complete = patient !== null && procedureIds.length > 0 && dentistId !== "" && chairNumber !== null && (walkIn || start !== null);
  const request = { branch: branch.code, chairNumber, dentistId, patientId: patient?.id, start, procedureIds, walkIn };
  const check = useQuery({
    queryKey: ["validate", request, moving?.id ?? null],
    queryFn: () => api<Check>("/appointments/validate", { method: "POST", body: { ...request, excludeAppointmentId: moving?.id ?? null } }),
    enabled: complete && !chairOnly,
  });
  const save = useMutation({
    mutationFn: (acknowledgeWarnings: boolean) =>
      moving
        ? api(`/appointments/${moving.id}`, {
            method: "PATCH",
            body: chairOnly ? { chairNumber } : { chairNumber, dentistId, start, procedureIds, acknowledgeWarnings },
          })
        : api("/appointments", { method: "POST", body: { ...request, requested, note, acknowledgeWarnings } }),
    onSuccess: async () => {
      toast.success(moving ? "Moved." : walkIn ? "Checked in." : "Booked.");
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment"] });
      await client.invalidateQueries({ queryKey: ["availability"] });
      onClose();
    },
  });
  // A check the server refuses outright, such as a start off the 15-minute grid, is an error too: Book stays disabled.
  const errors = check.data?.errors ?? (check.error ? [{ code: "invalid", message: errorMessage(check.error) }] : []);
  const warnings =
    check.data && check.data.warnings.length > 0
      ? check.data.warnings
      : save.error instanceof RequestError
        ? (save.error.body.warnings ?? [])
        : [];

  const pick = (t: OpenTime) => {
    const d = t.dentists.find((x) => x.id === dentistFilter) ?? t.dentists[0];
    setTime(clock(t.start));
    setDentistId(d.id);
    setChairNumber(lowest(d.chairs));
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{moving ? `Move ${moving.patientName}` : walkIn ? "Walk-in" : "New booking"}</DialogTitle>
          <DialogDescription>
            {moving
              ? `Now ${formatDay(manilaDate(new Date(moving.start)))}, ${formatTime(new Date(moving.start))}, ${chairName(moving.chairNumber, moving.chairLabel)}, with ${moving.dentistName}.`
              : `At ${branch.name}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {!moving && (
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Patient</h3>
              {patient ? (
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="font-medium">{patient.name}</span>
                  <Button variant="ghost" onClick={() => setPatient(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <PatientSearch onPick={(p) => setPatient({ id: p.id, name: `${p.lastName}, ${p.firstName}` })} autoFocus />
                  <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>
                    Add a new patient
                  </Button>
                  <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={setPatient} homeBranch={branch.code} />
                </>
              )}
            </section>
          )}

          {!chairOnly && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Procedures</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(procedures.data ?? []).map((p) => (
                  <label key={p.id} className={toggleClass}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={procedureIds.includes(p.id)}
                      onChange={(event) => {
                        setProcedureIds(event.target.checked ? [...procedureIds, p.id] : procedureIds.filter((id) => id !== p.id));
                        if (!anyTime) setTime("");
                      }}
                    />
                    {`${p.name}, ${p.durationMinutes} min`}
                  </label>
                ))}
              </div>
              {picked.length > 0 && <p className="text-sm text-muted-foreground">{`${minutes} minutes, then ${turnover} minutes of chair turnover.`}</p>}
            </fieldset>
          )}

          {!moving && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={toggleClass}>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={walkIn}
                  onChange={(event) => {
                    setWalkIn(event.target.checked);
                    setTime("");
                  }}
                />
                Walk-in: the patient is here now
              </label>
              {!walkIn && (
                <label className={toggleClass}>
                  <input type="checkbox" className="size-4 accent-primary" checked={requested} onChange={(event) => setRequested(event.target.checked)} />
                  The patient still has to confirm
                </label>
              )}
            </div>
          )}

          {!walkIn && !chairOnly && (
            <section className="grid gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1.5 text-sm font-medium">
                  Date
                  <Input
                    type="date"
                    min={today}
                    value={date}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      setDate(event.target.value);
                      if (!anyTime) setTime("");
                    }}
                  />
                </label>
                {anyTime ? (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Start
                    <Input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} />
                  </label>
                ) : (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Dentist
                    <NativeSelect
                      value={dentistFilter}
                      onChange={(event) => {
                        setDentistFilter(event.target.value);
                        setTime("");
                      }}
                    >
                      <NativeSelectOption value="">Any dentist</NativeSelectOption>
                      {working.map(([id, name]) => (
                        <NativeSelectOption key={id} value={id}>
                          {name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAnyTime(!anyTime);
                    setTime("");
                  }}
                >
                  {anyTime ? "Show open times" : "Pick another time"}
                </Button>
              </div>
              {!anyTime &&
                (procedureIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pick procedures to see the open times.</p>
                ) : open.isPending ? (
                  <p className="text-sm text-muted-foreground">Finding open times...</p>
                ) : open.isError ? (
                  <FormAlert message={errorMessage(open.error)} />
                ) : times.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open times on this day. Try another day, or pick another time.</p>
                ) : (
                  <div role="group" aria-label="Open times" className="flex flex-wrap gap-2">
                    {times.map((t) => {
                      const chosen = clock(t.start) === time;
                      return (
                        <Button key={t.start} variant={chosen ? "default" : "outline"} aria-pressed={chosen} onClick={() => pick(t)}>
                          {formatTime(new Date(t.start))}
                        </Button>
                      );
                    })}
                  </div>
                ))}
            </section>
          )}

          {(slot || anyTime || walkIn || chairOnly) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!chairOnly && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Dentist for this visit
                  <NativeSelect
                    value={dentistId}
                    onChange={(event) => {
                      setDentistId(event.target.value);
                      if (slot) setChairNumber(lowest(slot.dentists.find((d) => d.id === event.target.value)?.chairs));
                    }}
                  >
                    {!slot && <NativeSelectOption value="">Pick a dentist</NativeSelectOption>}
                    {(slot ? slot.dentists : here).map((d) => (
                      <NativeSelectOption key={d.id} value={d.id}>
                        {d.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <label className="grid gap-1.5 text-sm font-medium">
                Chair
                <NativeSelect value={chairNumber === null ? "" : String(chairNumber)} onChange={(event) => setChairNumber(event.target.value ? Number(event.target.value) : null)}>
                  {chairNumber === null && <NativeSelectOption value="">Pick a chair</NativeSelectOption>}
                  {chairs
                    .filter((c) => !slotDentist || slotDentist.chairs.includes(c.number))
                    .map((c) => (
                      <NativeSelectOption key={c.number} value={String(c.number)}>
                        {chairName(c.number, c.label)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </label>
            </div>
          )}

          {!moving && (
            <label className="grid gap-1.5 text-sm font-medium">
              Note (optional)
              <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>This booking cannot be saved</AlertTitle>
              <AlertDescription>
                <ul className="grid gap-1">
                  {errors.map((e) => (
                    <li key={`${e.code}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert>
              <AlertTitle>Check before booking</AlertTitle>
              <AlertDescription>
                <ul className="grid gap-1">
                  {warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {save.error && !(save.error instanceof RequestError && save.error.body.code === "warnings") && <FormAlert message={errorMessage(save.error)} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go back
          </Button>
          <Button
            disabled={!complete || errors.length > 0 || save.isPending || (!chairOnly && check.isFetching)}
            onClick={() => save.mutate(warnings.length > 0)}
          >
            {save.isPending
              ? "Saving..."
              : warnings.length > 0
                ? moving
                  ? "Move anyway"
                  : "Book anyway"
                : moving
                  ? "Move visit"
                  : walkIn
                    ? "Check in now"
                    : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Pass the branch id and the booking permission to the calendar**

Replace `src/app/[branch]/calendar/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { branchByCode, listChairs } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { CalendarScreen } from "./calendar-screen";

export const metadata: Metadata = { title: "Calendar" };

/** `?date=YYYY-MM-DD&view=day|week`, so a shared link opens the same day. The layout already checked the branch. */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { branch: code } = await params;
  if (code === "all") redirect("/all");
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const query = await searchParams;
  const today = manilaDate(new Date());
  const date = dateParam(query.date, today);
  const chairs = (await listChairs(branch.id)).filter((c) => c.active).map((c) => ({ number: c.number, label: c.label }));
  return (
    <CalendarScreen
      branch={{ id: branch.id, code: branch.code, name: branch.name, hours: branch.operatingHours }}
      chairs={chairs}
      date={date}
      view={query.view === "week" ? "week" : "day"}
      today={today}
      staff={staff}
      canBook={can(staff, "appointment.book", { branchId: branch.id })}
    />
  );
}
```

- [ ] **Step 3: Add New booking, Walk-in, slot clicks, and Move to the calendar**

Replace `src/app/[branch]/calendar/calendar-screen.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookingPanel, type BookingIntent } from "@/components/calendar/booking-panel";
import { DayGrid } from "@/components/calendar/day-grid";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { WeekGrid } from "@/components/calendar/week-grid";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OperatingHours } from "@/db/schema";
import { api, errorMessage } from "@/lib/fetcher";
import type { Subject } from "@/lib/permissions";
import { addDays, formatDay, formatTime, manilaInstant } from "@/lib/time";
import { dayRange, offGrid, weekDates, type VisitJson } from "@/lib/visits";

export type CalendarProps = {
  branch: { id: string; code: string; name: string; hours: OperatingHours };
  chairs: { number: number; label: string }[];
  date: string;
  view: "day" | "week";
  today: string;
  staff: Subject;
  canBook: boolean;
};

/** Spec 10: the branch calendar, refreshed every 30 seconds and after every change. */
export function CalendarScreen({ branch, chairs, date, view, today, staff, canBook }: CalendarProps) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [intent, setIntent] = useState<BookingIntent | null>(null);
  const days = view === "week" ? weekDates(date) : [date];
  const from = manilaInstant(days[0], 0).toISOString();
  const to = manilaInstant(addDays(days[days.length - 1], 1), 0).toISOString();
  const visits = useQuery({
    queryKey: ["appointments", branch.code, from, to],
    queryFn: () => api<VisitJson[]>(`/appointments?branch=${branch.code}&from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
  const go = (nextDate: string, nextView = view) => router.push(`/${branch.code}/calendar?date=${nextDate}&view=${nextView}`);
  const step = view === "week" ? 7 : 1;
  const list = visits.data ?? [];
  const inGrid = list.filter((v) => !offGrid(v.status));
  const off = list.filter((v) => offGrid(v.status));
  // A chair turned off later still shows the visits it held.
  const columns = [...chairs];
  for (const v of inGrid) if (!columns.some((c) => c.number === v.chairNumber)) columns.push({ number: v.chairNumber, label: v.chairLabel });
  columns.sort((a, b) => a.number - b.number);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{view === "week" ? `Week of ${formatDay(days[0])}` : formatDay(date)}</h1>
          <p className="text-sm text-muted-foreground">{`${branch.name}${view === "day" && date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBook && (
            <>
              <Button onClick={() => setIntent({ kind: "new", date: date < today ? today : date })}>New booking</Button>
              <Button variant="outline" onClick={() => setIntent({ kind: "new", date: today, walkIn: true })}>
                Walk-in
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => go(addDays(date, -step))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, step))}>
            Next
          </Button>
          <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && go(event.target.value)} />
          <div role="group" aria-label="View" className="flex gap-1">
            <Button variant={view === "day" ? "default" : "outline"} aria-pressed={view === "day"} onClick={() => go(date, "day")}>
              Day
            </Button>
            <Button variant={view === "week" ? "default" : "outline"} aria-pressed={view === "week"} onClick={() => go(date, "week")}>
              Week
            </Button>
          </div>
        </div>
      </div>
      {visits.isError && <FormAlert message={errorMessage(visits.error)} />}
      {visits.isPending && <p className="text-sm text-muted-foreground">Loading visits...</p>}
      {columns.length === 0 ? (
        <p className="text-muted-foreground">This branch has no chairs yet. The owner adds them in Settings.</p>
      ) : view === "week" ? (
        <WeekGrid days={days} today={today} chairs={chairs} visits={list} onOpen={(v) => setOpenId(v.id)} onDay={(day) => go(day, "day")} />
      ) : (
        <DayGrid
          date={date}
          range={dayRange(branch.hours, date, inGrid)}
          chairs={columns}
          visits={inGrid}
          onOpen={(v) => setOpenId(v.id)}
          onSlot={canBook && date >= today ? (chairNumber, minutes) => setIntent({ kind: "new", date, minutes, chairNumber }) : undefined}
        />
      )}
      {view === "day" && off.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-medium">Cancelled and no-show</h2>
          <ul className="flex flex-wrap gap-2">
            {off.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(v.id)}
                  className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9"
                >
                  {`${formatTime(new Date(v.start))} ${v.patientName}`}
                  <StatusBadge status={v.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <VisitPanel
        visitId={openId}
        branch={branch.code}
        staff={staff}
        onClose={() => setOpenId(null)}
        onMove={(visit) => {
          setOpenId(null);
          setIntent({ kind: "move", visit });
        }}
      />
      {intent && <BookingPanel intent={intent} branch={branch} chairs={chairs} today={today} onClose={() => setIntent(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Check it in the browser**

With the seeded data and `npm run dev`, sign in as `westside.desk` and open `/westside/calendar`. Pick a weekday in the coming week with Next.

Expected:
1. New booking: find a patient by part of a name; tick "Consultation" and "Tooth filling" ("90 minutes, then 15 minutes of chair turnover."); open times appear for the day; choosing one fills in the dentist and the lowest free chair; Book adds the card to the grid and says "Booked."
2. Clicking an empty slot at 8:30 AM (before opening) opens the panel at that time and chair; after picking a patient, a procedure, and Dr. Ana Cruz, the panel warns that the visit is outside the branch hours and the button reads "Book anyway", which books it.
3. Pick another time with the same dentist at a time she already has a patient: the panel lists the clash in words and Book stays disabled.
4. Walk-in: pick a patient, a procedure, a dentist working now, and a free chair; "Check in now" adds a Checked in card starting at the current minute. (Outside opening hours the panel shows the warnings and offers "Book anyway".)
5. Open a Confirmed card, choose Move, change the time to another open time, and Move visit: the card moves. Move on a Checked in card offers only the chair.
6. Two browser windows booking the same chair and time: the second gets "That time was just taken..." or the clash in words, and nothing is saved twice.

The browser console shows no errors apart from the expected `409` and `422` responses.

- [ ] **Step 5: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: book, check in walk-ins, and move visits from the calendar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: My day, All branches, and a disabled dentist's visits

**Files:**
- Create: `src/app/[branch]/my-day/page.tsx`, `src/app/[branch]/my-day/my-day-screen.tsx`, `src/app/[branch]/overview-screen.tsx`, `src/app/[branch]/staff/disabled-visits.tsx`, `src/app/api/v1/staff/[id]/visits/route.ts`, `tests/db/upcoming.test.ts`
- Modify: `src/server/appointments.ts`, `src/app/[branch]/page.tsx`, `src/app/[branch]/staff/staff-screen.tsx`, `src/components/app-shell.tsx`, `src/lib/nav.ts`, `tests/unit/shell.test.ts`, `src/server/home.ts`

**Interfaces:**
- Consumes: `GET /appointments` with `branch=all&dentist=<me>` (a person's own visits at every branch) and `GET /overview` (Tasks 3 and 4); `visitViews` inside `src/server/appointments.ts`; `VisitPanel`, `chairName`, `dateParam`, `type VisitJson` (Task 7); `StatusBadge`, `AlertMark` (Task 6); `actionLabel`, `ACTIVE`, `STATUSES` (Task 1).
- Produces:
  - `upcomingVisits(actor, dentistId): Promise<VisitView[]>` and `GET /staff/{id}/visits`: the dentist's active visits that have not ended, at the branches the caller covers (spec 6.5).
  - The final navigation: Calendar (Overview at All branches), My day (people who see patients), Patients, Staff (owner and managers), Settings or Schedules. The owner lands on `/all`, a dentist on My day, the front desk on the calendar (spec 10).

Screens keep their visits under query keys that start with `"appointments"`, so every change made anywhere (the visit panel, the booking panel) refreshes them too.

- [ ] **Step 1: Write the failing test, `tests/db/upcoming.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as visitsRoute from "@/app/api/v1/staff/[id]/visits/route";
import { db } from "@/db";
import { appointments, chairs, patients } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

/** Whole hours from the next quarter hour, so visits sit on the grid. */
const inHours = (n: number) => new Date(Math.ceil(Date.now() / 900_000) * 900_000 + n * 3_600_000);

describe("a disabled dentist's upcoming visits", () => {
  it("lists them at every branch for the owner and at their own branches for a manager", async () => {
    const dt = await makeBranch({ code: "dt" });
    const ws = await makeBranch({ code: "ws" });
    await db.insert(chairs).values([
      { branchId: dt.id, number: 1 },
      { branchId: ws.id, number: 1 },
    ]);
    const dentist = await makeUser({ role: "dentist", branchIds: [dt.id, ws.id], status: "disabled" });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const visit = (branchId: string, start: Date) => ({
      patientId: ana.id,
      dentistId: dentist.id,
      branchId,
      chairNumber: 1,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      chairFreeAt: new Date(start.getTime() + 1_800_000),
      status: "confirmed",
      source: "staff",
    });
    const rows = await db
      .insert(appointments)
      .values([visit(dt.id, inHours(24)), visit(ws.id, inHours(48)), visit(dt.id, inHours(-48)), visit(dt.id, inHours(72))])
      .returning({ id: appointments.id });
    await db.update(appointments).set({ status: "cancelled", cancelReason: "Dentist left" }).where(eq(appointments.id, rows[3].id));

    const owner = await makeUser({ role: "owner" });
    const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
    const other = await makeUser({ role: "dentist", branchIds: [dt.id] });
    const get = async (username: string) =>
      call(visitsRoute.GET, request(`/api/v1/staff/${dentist.id}/visits`, { cookie: await signIn(username) }), { id: dentist.id });

    const all = await get(owner.username);
    expect(all.status).toBe(200);
    expect((await all.json()).map((v: { branchCode: string }) => v.branchCode)).toEqual(["dt", "ws"]);
    const mine = await get(desk.username);
    expect((await mine.json()).map((v: { branchCode: string }) => v.branchCode)).toEqual(["dt"]);
    expect((await get(other.username)).status).toBe(403);
  });
});
```

```powershell
npx vitest run tests/db/upcoming.test.ts
```

Expected: FAIL, because the route module does not exist.

- [ ] **Step 2: Add `upcomingVisits` to `src/server/appointments.ts`, and its route**

In `src/server/appointments.ts`, add `ACTIVE` to the import from `@/lib/lifecycle`:

```ts
import { ACTIVE, actionFor, changeProblem, STATUS_LABEL, STATUSES, type Status } from "@/lib/lifecycle";
```

Then add this function right after `listAppointments`:

```ts
/** Spec 6.5: a dentist's active visits that have not ended, at the branches the caller covers, so a disabled dentist's can be moved. */
export async function upcomingVisits(actor: Staff, dentistId: string): Promise<VisitView[]> {
  requireCan(actor, "staff.view");
  return visitViews(
    and(
      eq(appointments.dentistId, dentistId),
      inArray(appointments.status, [...ACTIVE]),
      gt(appointments.endTime, new Date()),
      actor.role === "owner" ? undefined : inArray(appointments.branchId, [...actor.branchIds]),
    ),
  );
}
```

`src/app/api/v1/staff/[id]/visits/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { upcomingVisits } from "@/server/appointments";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await upcomingVisits(staff, id)));
```

```powershell
npx vitest run tests/db/upcoming.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 3: Finish the navigation and where people land**

Replace `src/lib/nav.ts`:

```ts
import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch, or at "all", where the overview replaces the calendar (chairs belong to one branch). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = [branch === "all" ? { href: "/all", label: "Overview" } : { href: `/${branch}/calendar`, label: "Calendar" }];
  if (staff.seesPatients) items.push({ href: `/${branch}/my-day`, label: "My day" });
  items.push({ href: `/${branch}/patients`, label: "Patients" });
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
```

In `tests/unit/shell.test.ts`, replace the test "builds the navigation for each role" with:

```ts
  it("builds the navigation for each role", () => {
    expect(navItems({ role: "owner", seesPatients: false }, "all").map((i) => i.label)).toEqual(["Overview", "Patients", "Staff", "Settings"]);
    expect(navItems({ role: "owner", seesPatients: true }, "all").map((i) => i.href)).toEqual([
      "/all",
      "/all/my-day",
      "/all/patients",
      "/all/staff",
      "/all/settings",
    ]);
    expect(navItems({ role: "manager", seesPatients: false }, "downtown").map((i) => i.href)).toEqual([
      "/downtown/calendar",
      "/downtown/patients",
      "/downtown/staff",
      "/downtown/settings",
    ]);
    expect(navItems({ role: "dentist", seesPatients: true }, "downtown").map((i) => i.label)).toEqual(["Calendar", "My day", "Patients", "Schedules"]);
  });
```

In `src/components/app-shell.tsx`, replace the line that sets `current` so the Overview link (`/all`) is current only on the overview itself:

```tsx
              const current = pathname === item.href || (item.href !== `/${branch}` && pathname.startsWith(`${item.href}/`));
```

In `src/server/home.ts`, replace the doc comment, the owner's line, and the last line of `homePath`:

```ts
/** Where each person lands after signing in (spec 10): the owner at All branches, a dentist at My day, the front desk at the calendar. */
```

```ts
  if (staff.role === "owner") return "/all";
```

```ts
  return staff.role === "dentist" ? `/${branch.code}/my-day` : `/${branch.code}/calendar`;
```

```powershell
npx vitest run tests/unit/shell.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Write My day**

`src/app/[branch]/my-day/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { requireStaff } from "@/server/session";
import { MyDayScreen } from "./my-day-screen";

export const metadata: Metadata = { title: "My day" };

export default async function MyDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  if (!staff.seesPatients) notFound();
  const { branch } = await params;
  const today = manilaDate(new Date());
  return <MyDayScreen branch={branch} date={dateParam((await searchParams).date, today)} today={today} staffId={staff.id} />;
}
```

`src/app/[branch]/my-day/my-day-screen.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertMark } from "@/components/alert-mark";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/fetcher";
import { actionLabel, type Status } from "@/lib/lifecycle";
import { addDays, formatDay, formatTime, manilaInstant } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

// Whoever is in the chair first, then who is waiting, then the rest by time; finished visits last.
const ORDER: Record<Status, number> = { in_treatment: 0, checked_in: 1, confirmed: 2, requested: 2, completed: 3, no_show: 3, cancelled: 3 };
const NEXT_STEP: Partial<Record<Status, Status>> = { checked_in: "in_treatment", in_treatment: "completed" };

/** Spec 10, My day: the person's own visits at every branch, next patient first, with Start treatment and Complete. */
export function MyDayScreen({ branch, date, today, staffId }: { branch: string; date: string; today: string; staffId: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  const visits = useQuery({
    queryKey: ["appointments", "mine", from],
    queryFn: () => api<VisitJson[]>(`/appointments?branch=all&dentist=${staffId}&from=${from}&to=${to}`),
    refetchInterval: 30_000,
  });
  const change = useMutation({
    mutationFn: ({ id, to: next }: { id: string; to: Status }) => api(`/appointments/${id}/transitions`, { method: "POST", body: { to: next } }),
    onSuccess: async () => {
      toast.success("Saved.");
      await client.invalidateQueries({ queryKey: ["appointments"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const go = (next: string) => router.push(`/${branch}/my-day?date=${next}`);
  const sorted = [...(visits.data ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.start.localeCompare(b.start));

  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My day</h1>
          <p className="text-sm text-muted-foreground">{`${formatDay(date)}${date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => go(addDays(date, -1))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, 1))}>
            Next
          </Button>
        </div>
      </div>
      {visits.isError && <FormAlert message={errorMessage(visits.error)} />}
      {visits.isPending && <p className="text-muted-foreground">Loading visits...</p>}
      {visits.data?.length === 0 && <p className="text-muted-foreground">No visits on this day.</p>}
      <ul className="grid gap-3">
        {sorted.map((v) => {
          const next = NEXT_STEP[v.status];
          return (
            <li key={v.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {`${formatTime(new Date(v.start))} ${v.patientName}`}
                    {v.hasAlerts && <AlertMark />}
                  </CardTitle>
                  <CardDescription>{`${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}. ${v.procedures.join(", ")}.`}</CardDescription>
                </CardHeader>
                <CardFooter className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={v.status} />
                  {next && (
                    <Button disabled={change.isPending} onClick={() => change.mutate({ id: v.id, to: next })}>
                      {actionLabel(v.status, next)}
                    </Button>
                  )}
                  <Link href={`/${branch}/patients/${v.patientId}`} className={buttonVariants({ variant: "outline" })}>
                    Open patient
                  </Link>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Write the All branches overview**

`src/app/[branch]/overview-screen.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { VisitPanel } from "@/components/calendar/visit-panel";
import { FormAlert } from "@/components/form-alert";
import { StatusBadge } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/fetcher";
import { STATUSES, type Status } from "@/lib/lifecycle";
import type { Subject } from "@/lib/permissions";
import { addDays, formatDay, formatTime } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

type Summary = { id: string; code: string; name: string; chairs: number; chairsInUse: number; counts: Record<Status, number>; dentistsOnDuty: string[] };

/** Spec 10, All branches: a card per branch (visits by status, chairs in use now, dentists on duty) above the day's visits. */
export function OverviewScreen({ date, today, staff }: { date: string; today: string; staff: Subject }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["appointments", "overview", date],
    queryFn: () => api<{ branches: Summary[]; visits: VisitJson[] }>(`/overview?date=${date}`),
    refetchInterval: 30_000,
  });
  const go = (next: string) => router.push(`/all?date=${next}`);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">All branches</h1>
          <p className="text-sm text-muted-foreground">{`${formatDay(date)}${date === today ? ", today" : ""}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => go(addDays(date, -1))}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(today)}>
            Today
          </Button>
          <Button variant="outline" onClick={() => go(addDays(date, 1))}>
            Next
          </Button>
          <Input type="date" aria-label="Date" className="w-auto" value={date} onChange={(event) => event.target.value && go(event.target.value)} />
        </div>
      </div>
      {overview.isError && <FormAlert message={errorMessage(overview.error)} />}
      {overview.isPending && <p className="text-muted-foreground">Loading...</p>}
      {overview.data && (
        <>
          <ul className="grid gap-3 md:grid-cols-3">
            {overview.data.branches.map((b) => (
              <li key={b.id}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>{b.name}</CardTitle>
                    <CardDescription>{date === today ? `${b.chairsInUse} of ${b.chairs} chairs in use now` : `${b.chairs} chairs`}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    <ul aria-label="Visits by status" className="flex flex-wrap gap-2">
                      {STATUSES.filter((s) => b.counts[s] > 0).map((s) => (
                        <li key={s} className="flex items-center gap-1">
                          <StatusBadge status={s} />
                          {b.counts[s]}
                        </li>
                      ))}
                      {STATUSES.every((s) => b.counts[s] === 0) && <li className="text-muted-foreground">No visits</li>}
                    </ul>
                    <p>{b.dentistsOnDuty.length > 0 ? `On duty: ${b.dentistsOnDuty.join(", ")}` : "No dentist on duty"}</p>
                  </CardContent>
                  <CardFooter>
                    <Link href={`/${b.code}/calendar?date=${date}`} className={buttonVariants({ variant: "outline" })}>
                      Open calendar
                    </Link>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
          <section aria-labelledby="visits-title" className="grid gap-2">
            <h2 id="visits-title" className="text-lg font-semibold">
              Visits
            </h2>
            {overview.data.visits.length === 0 ? (
              <p className="text-muted-foreground">No visits on this day.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Chair</TableHead>
                      <TableHead>Dentist</TableHead>
                      <TableHead>Procedures</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.data.visits.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell>{formatTime(new Date(v.start))}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setOpenId(v.id)}
                              className="rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              {v.patientName}
                            </button>
                            {v.hasAlerts && <AlertMark />}
                          </span>
                        </TableCell>
                        <TableCell>{v.branchName}</TableCell>
                        <TableCell>{chairName(v.chairNumber, v.chairLabel)}</TableCell>
                        <TableCell>{v.dentistName}</TableCell>
                        <TableCell className="whitespace-normal">{v.procedures.join(", ")}</TableCell>
                        <TableCell>
                          <StatusBadge status={v.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
      <VisitPanel visitId={openId} branch="all" staff={staff} onClose={() => setOpenId(null)} />
    </div>
  );
}
```

Replace `src/app/[branch]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { navItems } from "@/lib/nav";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { requireStaff } from "@/server/session";
import { OverviewScreen } from "./overview-screen";

export const metadata: Metadata = { title: "All branches" };

/** `/all` is the All branches overview (the layout admits only those who may see it); a bare branch URL opens its calendar. */
export default async function BranchIndex({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { branch } = await params;
  if (branch !== "all") redirect(navItems(staff, branch)[0].href);
  const today = manilaDate(new Date());
  return (
    <OverviewScreen
      date={dateParam((await searchParams).date, today)}
      today={today}
      staff={staff}
    />
  );
}
```

- [ ] **Step 6: List a disabled dentist's upcoming visits on the Staff page**

`src/app/[branch]/staff/disabled-visits.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime, manilaDate } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

/** Spec 6.5: a disabled dentist's upcoming visits, each linked to its day on the calendar so the desk can move it. */
export function DisabledVisits({ person }: { person: { id: string; name: string } }) {
  const visits = useQuery({ queryKey: ["appointments", "staff", person.id], queryFn: () => api<VisitJson[]>(`/staff/${person.id}/visits`) });
  if (visits.isError) return <FormAlert message={errorMessage(visits.error)} />;
  if (!visits.data || visits.data.length === 0) return null;
  const count = visits.data.length;
  return (
    <section aria-labelledby={`upcoming-${person.id}`} className="grid gap-2 rounded-lg border border-destructive/50 p-4">
      <h2 id={`upcoming-${person.id}`} className="font-semibold">
        {`${person.name} is disabled and still has ${count} upcoming ${count === 1 ? "visit" : "visits"}`}
      </h2>
      <p className="text-sm text-muted-foreground">Open each one on its calendar, then move it to another dentist or cancel it.</p>
      <ul className="grid gap-1 text-sm">
        {visits.data.map((v) => (
          <li key={v.id}>
            <Link href={`/${v.branchCode}/calendar?date=${manilaDate(new Date(v.start))}`} className="underline underline-offset-4">
              {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}: ${v.patientName}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

In `src/app/[branch]/staff/staff-screen.tsx`, add this import after the other local imports:

```tsx
import { DisabledVisits } from "./disabled-visits";
```

and insert this right after the closing `</section>` of the Staff table (the section with `aria-labelledby="staff-title"`):

```tsx
      {staff.data
        ?.filter((s) => s.status === "disabled" && s.seesPatients)
        .map((s) => (
          <DisabledVisits key={s.id} person={s} />
        ))}
```

- [ ] **Step 7: Check it in the browser**

With a fresh seed and `npm run dev`:

Expected:
1. `owner` lands on `/all`: three branch cards with today's visits by status (badges with words), chairs in use now, and dentists on duty; "Open calendar" opens that branch's day; the combined list below opens a visit's panel from the patient's name. The nav reads Overview, My day, Patients, Staff, Settings, and Overview is highlighted only on `/all`.
2. `dr.reyes` lands on `/downtown/my-day`: his visits at Downtown and Metro North with branch and chair, in treatment and checked-in patients first; "Start treatment" and "Complete" move the visit on and the list reorders.
3. As `owner`, disable Dr. Ana Cruz on the Staff page: a red-bordered section lists her upcoming visits, each linking to its calendar day. Enable her again afterwards.
4. `westside.desk` (one branch) is sent from `/all` back to `/westside/calendar`.

The browser console shows no errors.

- [ ] **Step 8: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add My day, the All branches overview, and a disabled dentist's upcoming visits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
