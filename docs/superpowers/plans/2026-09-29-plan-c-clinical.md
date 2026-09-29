# DentaSync Plan C: Clinical records, the access log, and going live

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentists chart teeth on the PDA Dental Record Chart, fill in the PDA exam, and write treatment notes during a visit; everyone reads them; the owner reads the access log; the development seed carries clinical records; one end-to-end run proves the whole path from setup to a completed visit; and the README explains how to go live.

**Architecture:** The chart's layout, surface directions, legend, and current state, and the exam's sections and their Zod shape, are pure modules (`src/lib/chart.ts`, `src/lib/exam.ts`) used by both the server and the screens. `src/server/clinical.ts` holds the chart, exam, and note services behind plan A's `staffRoute`, `requireCan("clinical.read" | "clinical.write")`, and `audit`; the database already refuses edits to notes and chart entries (plan A Task 2). The access log is a read-only query over `audit_log`.

**Tech Stack:** as plans A and B, plus Playwright 1.63 (already pinned) for the end-to-end run.

**Spec:** `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`, sections 9 (clinical records), 10 (screens), 11 (API), 13 (security), 14 (testing), 15 (development data), and 16 (hosting). Plans A and B are merged into this branch's history; their files and interfaces are the starting point.

## Global Constraints

- Repository `D:\dentasync`, branch `plan-c-clinical`. Commit after each task with a conventional prefix, an imperative subject, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/` (async `params` and `searchParams`).
- Times are `timestamptz`; days and display use Asia/Manila through `src/lib/time.ts`.
- Every route goes through `staffRoute` (`src/server/api.ts`); every permission check uses `can()` or `requireCan()`; writes carry the app's Origin and JSON.
- Errors have one shape: `{ "error": { "code", "message", "fields"? } }`.
- Clinical content (chart codes, exam findings, note text) and health information never go into the audit log, logs, or error messages. The audit log records who viewed or changed which patient's record, and the ids of what changed.
- Treatment notes and chart entries are never edited or deleted: a note is corrected by an amending note, and a chart entry is voided with a reason (the database enforces both).
- Copy is plain and direct, with no em dashes or en dashes. No SMS or email is sent.
- WCAG 2.2 AA: every tooth and surface can be reached and chosen by keyboard and has a spoken name; codes show as text, never colour alone; fields and errors are labelled; touch targets are at least 44 pixels tall on phones.
- Add no runtime dependency.

---

## File structure (plan C)

```
src/lib/chart.ts                 the PDA legend, the chart's rows, surface directions and names, a tooth's current state
src/lib/exam.ts                  the PDA exam sections and the Zod shape of their findings
src/server/clinical.ts           chart entries (add, void, read), the exam (read, save), treatment notes (add, read)
src/server/audit-log.ts          the owner's access log
src/components/chart/            tooth-chart (the chart), tooth-panel (a tooth's history and new entries), exam-form
src/app/[branch]/patients/[id]/  chart-tab.tsx, notes-tab.tsx (the patient page's Chart and Notes tabs)
src/app/[branch]/settings/access-log-panel.tsx
tests/e2e/visit.spec.ts, playwright.config.ts
```

---

### Task 1: The chart and exam rules

**Files:**
- Create: `src/lib/chart.ts`, `src/lib/exam.ts`
- Test: `tests/unit/chart.test.ts`, `tests/unit/exam.test.ts`

**Interfaces:**
- Consumes: `CHART_CODES` and `type ExamFindings` from `@/db/schema` (the test checks the legend against them).
- Produces:
  - `@/lib/chart`: `CHART_LEGEND` (`{ code, mark, label, group }[]`, in the PDA's order), `CHART_GROUPS`, `type ChartCode`, `codeInfo(code)`, `SURFACES`, `type Surface`, `needsSurfaces(code)`, `CHART_ROWS` (`{ teeth: number[]; upper: boolean }[]`), `isTooth(n)`, `toothSides(tooth)`, `surfaceName(tooth, surface)`, `type EntryLike`, `toothState(entries)`, `boxCodes(state)`, `describeTooth(tooth, state)`.
  - `@/lib/exam`: `EXAM_SECTIONS` (`{ key, label, items: { key, label }[] }[]`), `examFindingsSchema`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/chart.test.ts`:

```ts
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
```

`tests/unit/exam.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EXAM_SECTIONS, examFindingsSchema } from "@/lib/exam";

describe("the PDA exam", () => {
  it("has the five sections under the chart", () => {
    expect(EXAM_SECTIONS.map((s) => s.label)).toEqual(["Periodontal screening", "Occlusion", "Appliances", "TMD", "X-rays taken"]);
  });

  it("accepts marked items with short details", () => {
    const findings = { periodontal: { gingivitis: "" }, xrays: { periapical: "16, 26", panoramic: "" } };
    expect(examFindingsSchema.parse(findings)).toEqual(findings);
    expect(examFindingsSchema.parse({})).toEqual({});
  });

  it("refuses unknown sections or items and long details", () => {
    expect(examFindingsSchema.safeParse({ fillings: { a: "" } }).success).toBe(false);
    expect(examFindingsSchema.safeParse({ tmd: { snoring: "" } }).success).toBe(false);
    expect(examFindingsSchema.safeParse({ tmd: { clicking: "x".repeat(61) } }).success).toBe(false);
  });
});
```

```powershell
npx vitest run tests/unit/chart.test.ts tests/unit/exam.test.ts
```

Expected: FAIL, because `@/lib/chart` and `@/lib/exam` do not exist.

- [ ] **Step 2: Write `src/lib/chart.ts`**

```ts
/** The PDA chart legend (spec 9.1), in the printed order. The database's check constraint lists the same codes. */
export const CHART_LEGEND = [
  { code: "present", mark: "✓", label: "Present teeth", group: "Condition" },
  { code: "D", mark: "D", label: "Decayed (caries indicated for filling)", group: "Condition" },
  { code: "M", mark: "M", label: "Missing due to caries", group: "Condition" },
  { code: "MO", mark: "MO", label: "Missing due to other causes", group: "Condition" },
  { code: "Im", mark: "Im", label: "Impacted tooth", group: "Condition" },
  { code: "Sp", mark: "Sp", label: "Supernumerary tooth", group: "Condition" },
  { code: "Rf", mark: "Rf", label: "Root fragment", group: "Condition" },
  { code: "Un", mark: "Un", label: "Unerupted", group: "Condition" },
  { code: "Am", mark: "Am", label: "Amalgam filling", group: "Restorations and prosthetics" },
  { code: "Co", mark: "Co", label: "Composite filling", group: "Restorations and prosthetics" },
  { code: "JC", mark: "JC", label: "Jacket crown", group: "Restorations and prosthetics" },
  { code: "Ab", mark: "Ab", label: "Abutment", group: "Restorations and prosthetics" },
  { code: "Att", mark: "Att", label: "Attachment", group: "Restorations and prosthetics" },
  { code: "P", mark: "P", label: "Pontic", group: "Restorations and prosthetics" },
  { code: "In", mark: "In", label: "Inlay", group: "Restorations and prosthetics" },
  { code: "Imp", mark: "Imp", label: "Implant", group: "Restorations and prosthetics" },
  { code: "S", mark: "S", label: "Sealants", group: "Restorations and prosthetics" },
  { code: "Rm", mark: "Rm", label: "Removable denture", group: "Restorations and prosthetics" },
  { code: "X", mark: "X", label: "Extraction due to caries", group: "Surgery" },
  { code: "XO", mark: "XO", label: "Extraction due to other causes", group: "Surgery" },
] as const;

export const CHART_GROUPS = ["Condition", "Restorations and prosthetics", "Surgery"] as const;
export type ChartCode = (typeof CHART_LEGEND)[number]["code"];

export function codeInfo(code: string) {
  return CHART_LEGEND.find((c) => c.code === code);
}

export const SURFACES = ["M", "D", "O", "B", "L"] as const;
export type Surface = (typeof SURFACES)[number];

/** D, Am, Co, In, and S mark surfaces; every other code covers the whole tooth (spec 9.1). */
export function needsSurfaces(code: string): boolean {
  return ["D", "Am", "Co", "In", "S"].includes(code);
}

const run = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from < to ? from + i : from - i));

/** The PDA chart from top to bottom, FDI numbers, the patient's right on the viewer's left (spec 9.1). */
export const CHART_ROWS: { teeth: number[]; upper: boolean }[] = [
  { teeth: [...run(55, 51), ...run(61, 65)], upper: true },
  { teeth: [...run(18, 11), ...run(21, 28)], upper: true },
  { teeth: [...run(48, 41), ...run(31, 38)], upper: false },
  { teeth: [...run(85, 81), ...run(71, 75)], upper: false },
];

const TEETH = new Set(CHART_ROWS.flatMap((r) => r.teeth));

export function isTooth(n: number): boolean {
  return TEETH.has(n);
}

const upperTooth = (tooth: number) => [1, 2, 5, 6].includes(Math.floor(tooth / 10));

/**
 * Which surface each side of a tooth's circle shows: the side facing the other arch is lingual, and the side facing the
 * chart's vertical midline is mesial. Quadrants 1, 4, 5, and 8 (the patient's right) sit on the viewer's left.
 */
export function toothSides(tooth: number): { top: Surface; bottom: Surface; left: Surface; right: Surface } {
  const upper = upperTooth(tooth);
  const viewersLeft = [1, 4, 5, 8].includes(Math.floor(tooth / 10));
  return { top: upper ? "B" : "L", bottom: upper ? "L" : "B", left: viewersLeft ? "D" : "M", right: viewersLeft ? "M" : "D" };
}

/** Incisal on incisors and canines (x1 to x3), palatal on upper teeth, labial on front teeth. */
export function surfaceName(tooth: number, surface: Surface): string {
  const front = tooth % 10 <= 3;
  if (surface === "O") return front ? "Incisal" : "Occlusal";
  if (surface === "L") return upperTooth(tooth) ? "Palatal" : "Lingual";
  if (surface === "B") return front ? "Labial" : "Buccal";
  return surface === "M" ? "Mesial" : "Distal";
}

export type EntryLike = { code: string; surfaces: readonly string[]; createdAt: string; voidedAt: string | null };

/** Spec 9.1: on each surface the latest entry that is not voided wins; an entry for the whole tooth covers every surface. */
export function toothState(entries: readonly EntryLike[]): Partial<Record<Surface, string>> {
  const state: Partial<Record<Surface, string>> = {};
  const live = entries.filter((e) => e.voidedAt === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const e of live) {
    for (const s of e.surfaces.length > 0 ? e.surfaces : SURFACES) state[s as Surface] = e.code;
  }
  return state;
}

/** The codes for a tooth's box on the chart, in surface order, each once. */
export function boxCodes(state: Partial<Record<Surface, string>>): string[] {
  return [...new Set(SURFACES.flatMap((s) => (state[s] ? [state[s]] : [])))];
}

const list = new Intl.ListFormat("en", { type: "conjunction" });

/** A tooth's state in words, for screen readers and the tooth panel: "Tooth 16: Composite filling on occlusal". */
export function describeTooth(tooth: number, state: Partial<Record<Surface, string>>): string {
  const codes = boxCodes(state);
  if (codes.length === 0) return `Tooth ${tooth}, nothing charted`;
  const parts = codes.map((code) => {
    const on = SURFACES.filter((s) => state[s] === code);
    const where = on.length === SURFACES.length ? "" : ` on ${list.format(on.map((s) => surfaceName(tooth, s).toLowerCase()))}`;
    return `${codeInfo(code)?.label ?? code}${where}`;
  });
  return `Tooth ${tooth}: ${parts.join("; ")}`;
}
```

- [ ] **Step 3: Write `src/lib/exam.ts`**

```ts
import { z } from "zod";

/** The exam sections under the PDA chart (spec 9.2). A marked item may carry a detail, such as "16, 26" for periapicals. */
export const EXAM_SECTIONS = [
  {
    key: "periodontal",
    label: "Periodontal screening",
    items: [
      { key: "gingivitis", label: "Gingivitis" },
      { key: "early_periodontitis", label: "Early periodontitis" },
      { key: "moderate_periodontitis", label: "Moderate periodontitis" },
      { key: "advanced_periodontitis", label: "Advanced periodontitis" },
    ],
  },
  {
    key: "occlusion",
    label: "Occlusion",
    items: [
      { key: "molar_class", label: "Class (molar)" },
      { key: "overjet", label: "Overjet" },
      { key: "overbite", label: "Overbite" },
      { key: "midline_deviation", label: "Midline deviation" },
      { key: "crossbite", label: "Crossbite" },
    ],
  },
  {
    key: "appliances",
    label: "Appliances",
    items: [
      { key: "orthodontic", label: "Orthodontic" },
      { key: "stayplate", label: "Stayplate" },
      { key: "others", label: "Others" },
    ],
  },
  {
    key: "tmd",
    label: "TMD",
    items: [
      { key: "clenching", label: "Clenching" },
      { key: "clicking", label: "Clicking" },
      { key: "trismus", label: "Trismus" },
      { key: "muscle_spasm", label: "Muscle spasm" },
    ],
  },
  {
    key: "xrays",
    label: "X-rays taken",
    items: [
      { key: "periapical", label: "Periapical (tooth numbers)" },
      { key: "panoramic", label: "Panoramic" },
      { key: "cephalometric", label: "Cephalometric" },
      { key: "occlusal", label: "Occlusal (upper or lower)" },
      { key: "others", label: "Others" },
    ],
  },
] as const;

const detail = z.string().trim().max(60, "Use at most 60 characters");

/** Marked items only, per section: `{ xrays: { periapical: "16, 26" } }`. Unknown sections and items are refused. */
export const examFindingsSchema = z.strictObject(
  Object.fromEntries(
    EXAM_SECTIONS.map((s) => [s.key, z.partialRecord(z.enum(s.items.map((i) => i.key) as [string, ...string[]]), detail).optional()]),
  ),
);
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run tests/unit/chart.test.ts tests/unit/exam.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```powershell
npm run typecheck; npm run lint
git add -A
git commit -m "feat: add the PDA chart layout, legend, surface rules, and exam sections" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Chart entries, the exam, and treatment notes

**Files:**
- Create: `src/server/clinical.ts`, `src/app/api/v1/patients/[id]/chart/route.ts`, `src/app/api/v1/patients/[id]/chart-entries/route.ts`, `src/app/api/v1/chart-entries/[id]/void/route.ts`, `src/app/api/v1/appointments/[id]/exam/route.ts`, `src/app/api/v1/patients/[id]/notes/route.ts`, `src/app/api/v1/appointments/[id]/notes/route.ts`
- Modify: `src/server/patients.ts` (visits carry their charted teeth). Plan A's `toResponse` already answers a malformed id with 404.
- Test: `tests/db/clinical.test.ts`

**Interfaces:**
- Consumes: `CHART_CODES`, `type ExamFindings`, and the tables from `@/db/schema`; `isTooth`, `needsSurfaces`, `SURFACES` (Task 1); `examFindingsSchema` (Task 1); `ACTIVE`, `type Status` (plan B); `audit`, `requireCan`, `ApiError`, `notFound`, `staffRoute`, `readJson`, `json` (plan A).
- Produces:
  - `@/server/clinical`: `chartEntrySchema`, `voidSchema`, `examSchema`, `noteSchema`; `patientChart(actor, patientId)`, `addChartEntry(actor, patientId, input)`, `voidChartEntry(actor, entryId, input)`, `visitExam(actor, appointmentId)`, `saveExam(actor, appointmentId, findings)`, `patientNotes(actor, patientId)`, `addNote(actor, appointmentId, input)`.
  - Routes (spec 11.3): `GET /patients/{id}/chart`, `POST /patients/{id}/chart-entries` (201 `{ id }`), `POST /chart-entries/{id}/void`, `GET, PUT /appointments/{id}/exam`, `GET /patients/{id}/notes`, `POST /appointments/{id}/notes` (201 `{ id }`).
  - `GET /patients/{id}/visits` answers each visit with its `dentistId` and `teeth: number[]`, the teeth charted during it (spec 9.3).

Rules this task enforces (spec 9):
- Writing (charting, the exam, notes) needs `clinical.write`: a dentist on their own visits or with no visit, or the owner when they see patients. Everyone reads.
- A chart entry joins the author's visit with this patient that is checked in or in treatment, or has no visit. D, Am, Co, In, and S need at least one surface; every other code covers the whole tooth. Only the author, or the owner who sees patients, voids an entry, once, with a reason.
- The exam can change while its visit is requested, confirmed, checked in, or in treatment; after that it is closed.
- Notes go on visits that are checked in, in treatment, or completed. A correction is a new note that names the one it amends, which must be the same patient's.
- Reading the chart, the exam, or the notes writes a `patient.view` audit row with the part read. Changes are audited as `chart.added`, `chart.voided`, `exam.saved`, and `note.added` on the patient, with ids only.

- [ ] **Step 1: Write the failing test, `tests/db/clinical.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as examRoute from "@/app/api/v1/appointments/[id]/exam/route";
import * as visitNotesRoute from "@/app/api/v1/appointments/[id]/notes/route";
import * as voidRoute from "@/app/api/v1/chart-entries/[id]/void/route";
import * as chartEntriesRoute from "@/app/api/v1/patients/[id]/chart-entries/route";
import * as chartRoute from "@/app/api/v1/patients/[id]/chart/route";
import * as notesRoute from "@/app/api/v1/patients/[id]/notes/route";
import * as visitsRoute from "@/app/api/v1/patients/[id]/visits/route";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients } from "@/db/schema";
import type { Status } from "@/lib/lifecycle";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

/** The next quarter hour plus whole hours, so visits sit on the grid. */
const inHours = (n: number) => new Date(Math.ceil(Date.now() / 900_000) * 900_000 + n * 3_600_000);

// The status changes that take a new visit to each status, through the lifecycle trigger.
const PATH: Partial<Record<Status, Status[]>> = {
  in_treatment: ["checked_in", "in_treatment"],
  completed: ["checked_in", "in_treatment", "completed"],
};

async function build() {
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  await db.insert(chairs).values({ branchId: dt.id, number: 1, label: "General" });
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  const owner = await makeUser({ role: "owner", seesPatients: true });
  const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
  const visit = async (status: Status, hours: number) => {
    const start = inHours(hours);
    const end = new Date(start.getTime() + 1_800_000);
    const [row] = await db
      .insert(appointments)
      .values({ patientId: ana.id, dentistId: reyes.id, branchId: dt.id, chairNumber: 1, startTime: start, endTime: end, chairFreeAt: end, status: status === "requested" ? "requested" : "confirmed", source: "staff" })
      .returning();
    for (const to of PATH[status] ?? []) await db.update(appointments).set({ status: to }).where(eq(appointments.id, row.id));
    return row.id;
  };
  return {
    ana,
    today: await visit("in_treatment", 0),
    earlier: await visit("completed", -48),
    later: await visit("requested", 48),
    reyes: await signIn(reyes.username),
    lim: await signIn(lim.username),
    desk: await signIn(desk.username),
    owner: await signIn(owner.username),
  };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const chart = (cookie: string, id: string) => call(chartRoute.GET, request(`/api/v1/patients/${id}/chart`, { cookie }), { id });
const addEntry = (cookie: string, id: string, body: object) =>
  call(chartEntriesRoute.POST, request(`/api/v1/patients/${id}/chart-entries`, { method: "POST", cookie, body }), { id });
const voidEntry = (cookie: string, id: string) =>
  call(voidRoute.POST, request(`/api/v1/chart-entries/${id}/void`, { method: "POST", cookie, body: { reason: "Wrong tooth" } }), { id });
const putExam = (cookie: string, id: string, findings: object) =>
  call(examRoute.PUT, request(`/api/v1/appointments/${id}/exam`, { method: "PUT", cookie, body: { findings } }), { id });
const addNote = (cookie: string, id: string, body: object) =>
  call(visitNotesRoute.POST, request(`/api/v1/appointments/${id}/notes`, { method: "POST", cookie, body }), { id });

describe("the dental chart", () => {
  it("records an entry on the dentist's visit in treatment, for everyone to read", async () => {
    const w = await world();
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "Co", surfaces: ["O", "M"], note: "Small" })).status).toBe(201);
    const res = await chart(w.desk, w.ana.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([
      { tooth: 16, code: "Co", surfaces: ["O", "M"], note: "Small", authorName: "Dr. Reyes", branchName: "Downtown", appointmentId: w.today, voidedAt: null },
    ]);
  });

  it("refuses the front desk, codes on the wrong surfaces, and teeth not on the chart", async () => {
    const w = await world();
    expect((await addEntry(w.desk, w.ana.id, { tooth: 16, code: "D", surfaces: ["O"] })).status).toBe(403);
    const bare = await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "D" });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.fields).toEqual({ surfaces: "Pick at least one surface" });
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 16, code: "X", surfaces: ["O"] })).status).toBe(400);
    expect((await addEntry(w.reyes, w.ana.id, { tooth: 19, code: "X" })).status).toBe(400);
    expect((await chart(w.desk, "not-a-uuid")).status).toBe(404);
  });

  it("lets the author or the owner who sees patients void an entry once, with a reason", async () => {
    const w = await world();
    const { id } = await (await addEntry(w.reyes, w.ana.id, { tooth: 21, code: "present" })).json();
    expect((await voidEntry(w.lim, id)).status).toBe(403);
    expect((await voidEntry(w.reyes, id)).status).toBe(200);
    expect((await voidEntry(w.owner, id)).status).toBe(422);
    const entries = await (await chart(w.desk, w.ana.id)).json();
    expect(entries.find((e: { id: string }) => e.id === id)).toMatchObject({ voidReason: "Wrong tooth", voidedByName: "Dr. Reyes" });
  });
});

describe("the exam", () => {
  it("saves the findings of the dentist's open visit and reads them back", async () => {
    const w = await world();
    const findings = { periodontal: { gingivitis: "" }, xrays: { periapical: "16, 26" } };
    expect((await putExam(w.reyes, w.today, findings)).status).toBe(200);
    const res = await call(examRoute.GET, request(`/api/v1/appointments/${w.today}/exam`, { cookie: w.desk }), { id: w.today });
    expect(await res.json()).toMatchObject({ findings, editable: true, authorName: "Dr. Reyes" });
  });

  it("refuses unknown findings, other dentists, and closed visits", async () => {
    const w = await world();
    expect((await putExam(w.reyes, w.today, { tmd: { snoring: "" } })).status).toBe(400);
    expect((await putExam(w.lim, w.today, {})).status).toBe(403);
    expect((await putExam(w.reyes, w.earlier, {})).status).toBe(422);
  });
});

describe("treatment notes", () => {
  it("adds a note and an amendment, newest first, with the visit's branch and chair", async () => {
    const w = await world();
    const first = await addNote(w.reyes, w.earlier, { body: "Scaling done." });
    expect(first.status).toBe(201);
    const { id } = await first.json();
    expect((await addNote(w.reyes, w.earlier, { body: "Correction: upper arch only.", amendsId: id })).status).toBe(201);
    const notes = await (await call(notesRoute.GET, request(`/api/v1/patients/${w.ana.id}/notes`, { cookie: w.desk }), { id: w.ana.id })).json();
    expect(notes.map((n: Record<string, unknown>) => [n.body, n.amendsId, n.authorName, n.branchName, n.chairNumber])).toEqual([
      ["Correction: upper arch only.", id, "Dr. Reyes", "Downtown", 1],
      ["Scaling done.", null, "Dr. Reyes", "Downtown", 1],
    ]);
  });

  it("refuses the front desk, other dentists, and visits not seen yet", async () => {
    const w = await world();
    expect((await addNote(w.desk, w.earlier, { body: "x" })).status).toBe(403);
    expect((await addNote(w.lim, w.earlier, { body: "x" })).status).toBe(403);
    expect((await addNote(w.reyes, w.later, { body: "x" })).status).toBe(422);
  });
});

describe("the record", () => {
  it("lists the teeth charted during each visit, leaving out voided entries", async () => {
    const w = await world();
    const res = await (await call(visitsRoute.GET, request(`/api/v1/patients/${w.ana.id}/visits`, { cookie: w.desk }), { id: w.ana.id })).json();
    expect(res.visits.find((v: { id: string }) => v.id === w.today)).toMatchObject({ teeth: [16], dentistName: "Dr. Reyes" });
    expect(res.visits.every((v: { dentistId: string }) => typeof v.dentistId === "string")).toBe(true);
  });

  it("audits every view and change by patient, with ids and never the clinical content", async () => {
    const w = await world();
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, w.ana.id));
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["patient.view", "chart.added", "chart.voided", "exam.saved", "note.added"]));
    expect(rows.filter((r) => r.action === "patient.view").map((r) => r.details.part)).toEqual(
      expect.arrayContaining(["chart", "exam", "notes", "visits"]),
    );
    expect(JSON.stringify(rows)).not.toMatch(/Scaling|gingivitis|Small|"Co"/);
  });
});
```

```powershell
npx vitest run tests/db/clinical.test.ts
```

Expected: FAIL, because the route modules do not exist.

- [ ] **Step 2: Write the services, `src/server/clinical.ts`**

```ts
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, CHART_CODES, chairs, chartEntries, exams, patients, treatmentNotes, users, type ExamFindings } from "@/db/schema";
import { isTooth, needsSurfaces, SURFACES } from "@/lib/chart";
import { examFindingsSchema } from "@/lib/exam";
import { ACTIVE, type Status } from "@/lib/lifecycle";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const chartEntrySchema = z
  .object({
    tooth: z.number().int().refine(isTooth, "Pick a tooth on the chart"),
    code: z.enum(CHART_CODES),
    surfaces: z
      .array(z.enum(SURFACES))
      .max(5)
      .default([])
      .transform((list) => [...new Set(list)]),
    note: z.string().trim().max(300, "Use at most 300 characters").default(""),
  })
  .superRefine((entry, ctx) => {
    if (needsSurfaces(entry.code) && entry.surfaces.length === 0) {
      ctx.addIssue({ code: "custom", path: ["surfaces"], message: "Pick at least one surface" });
    }
    if (!needsSurfaces(entry.code) && entry.surfaces.length > 0) {
      ctx.addIssue({ code: "custom", path: ["surfaces"], message: "This code covers the whole tooth" });
    }
  });

export const voidSchema = z.object({ reason: z.string().trim().min(1, "Give a reason").max(200, "Use at most 200 characters") });

export const examSchema = z.object({ findings: examFindingsSchema });

export const noteSchema = z.object({
  body: z.string().trim().min(1, "Write the note").max(4000, "Use at most 4000 characters"),
  amendsId: z.uuid().nullable().optional(),
});

/** Visits a note can go on: the patient was seen or is being seen. */
const SEEN: readonly Status[] = ["checked_in", "in_treatment", "completed"];

async function requirePatient(id: string): Promise<void> {
  const [row] = await db.select({ id: patients.id }).from(patients).where(eq(patients.id, id));
  if (!row) throw notFound("That patient");
}

async function requireVisit(id: string) {
  const [visit] = await db
    .select({ id: appointments.id, patientId: appointments.patientId, dentistId: appointments.dentistId, branchId: appointments.branchId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, id));
  if (!visit) throw notFound("That visit");
  return { ...visit, status: visit.status as Status };
}

const voider = alias(users, "voider");

/** Spec 9.1: every chart entry of a patient, voided ones too, with who made it, where, and during which visit. */
export async function patientChart(actor: Staff, patientId: string) {
  requireCan(actor, "clinical.read");
  await requirePatient(patientId);
  const rows = await db
    .select({
      id: chartEntries.id,
      tooth: chartEntries.tooth,
      surfaces: chartEntries.surfaces,
      code: chartEntries.code,
      note: chartEntries.note,
      createdAt: chartEntries.createdAt,
      authorId: chartEntries.authorId,
      authorName: users.name,
      appointmentId: chartEntries.appointmentId,
      visitStart: appointments.startTime,
      branchName: branches.name,
      voidedAt: chartEntries.voidedAt,
      voidedByName: voider.name,
      voidReason: chartEntries.voidReason,
    })
    .from(chartEntries)
    .innerJoin(users, eq(users.id, chartEntries.authorId))
    .leftJoin(voider, eq(voider.id, chartEntries.voidedBy))
    .leftJoin(appointments, eq(appointments.id, chartEntries.appointmentId))
    .leftJoin(branches, eq(branches.id, chartEntries.branchId))
    .where(eq(chartEntries.patientId, patientId))
    .orderBy(asc(chartEntries.createdAt));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: patientId, details: { part: "chart" } });
  return rows;
}

/** Spec 9.1: the entry joins the author's visit with this patient that is checked in or in treatment, when there is one. */
export async function addChartEntry(actor: Staff, patientId: string, input: z.infer<typeof chartEntrySchema>): Promise<{ id: string }> {
  requireCan(actor, "clinical.write");
  await requirePatient(patientId);
  const [visit] = await db
    .select({ id: appointments.id, branchId: appointments.branchId })
    .from(appointments)
    .where(and(eq(appointments.patientId, patientId), eq(appointments.dentistId, actor.id), inArray(appointments.status, ["checked_in", "in_treatment"])))
    .orderBy(desc(appointments.startTime))
    .limit(1);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(chartEntries)
      .values({ ...input, patientId, appointmentId: visit?.id ?? null, branchId: visit?.branchId ?? null, authorId: actor.id })
      .returning({ id: chartEntries.id });
    await audit(
      { userId: actor.id, action: "chart.added", entity: "patient", entityId: patientId, branchId: visit?.branchId ?? null, details: { entryId: row.id } },
      tx,
    );
    return row;
  });
}

/** Spec 9.1: the author, or the owner when they see patients, voids an entry with a reason. The database allows it once. */
export async function voidChartEntry(actor: Staff, entryId: string, input: z.infer<typeof voidSchema>): Promise<void> {
  const [entry] = await db.select().from(chartEntries).where(eq(chartEntries.id, entryId));
  if (!entry) throw notFound("That chart entry");
  requireCan(actor, "clinical.write", { dentistId: entry.authorId });
  if (entry.voidedAt) throw new ApiError(422, "already_voided", "This entry is already voided.");
  await db.transaction(async (tx) => {
    await tx.update(chartEntries).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: input.reason }).where(eq(chartEntries.id, entryId));
    await audit(
      { userId: actor.id, action: "chart.voided", entity: "patient", entityId: entry.patientId, branchId: entry.branchId, details: { entryId } },
      tx,
    );
  });
}

/** Spec 9.2: a visit's exam (empty findings when none is saved), and whether it can still change. */
export async function visitExam(actor: Staff, appointmentId: string) {
  requireCan(actor, "clinical.read");
  const visit = await requireVisit(appointmentId);
  const [exam] = await db
    .select({ findings: exams.findings, updatedAt: exams.updatedAt, authorName: users.name })
    .from(exams)
    .innerJoin(users, eq(users.id, exams.authorId))
    .where(eq(exams.appointmentId, appointmentId));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: visit.patientId, details: { part: "exam", appointmentId } });
  return {
    findings: exam?.findings ?? {},
    updatedAt: exam?.updatedAt ?? null,
    authorName: exam?.authorName ?? null,
    dentistId: visit.dentistId,
    editable: ACTIVE.includes(visit.status),
  };
}

export async function saveExam(actor: Staff, appointmentId: string, findings: z.infer<typeof examFindingsSchema>): Promise<void> {
  const visit = await requireVisit(appointmentId);
  requireCan(actor, "clinical.write", { dentistId: visit.dentistId });
  if (!ACTIVE.includes(visit.status)) throw new ApiError(422, "exam_closed", "This visit is closed, so its exam can no longer change.");
  const saved = findings as ExamFindings;
  await db.transaction(async (tx) => {
    await tx
      .insert(exams)
      .values({ appointmentId, patientId: visit.patientId, authorId: actor.id, findings: saved })
      .onConflictDoUpdate({ target: exams.appointmentId, set: { findings: saved, authorId: actor.id, updatedAt: new Date() } });
    await audit(
      { userId: actor.id, action: "exam.saved", entity: "patient", entityId: visit.patientId, branchId: visit.branchId, details: { appointmentId } },
      tx,
    );
  });
}

/** Spec 9.3: a patient's treatment notes, newest first, with the dentist, branch, and chair of each visit. */
export async function patientNotes(actor: Staff, patientId: string) {
  requireCan(actor, "clinical.read");
  await requirePatient(patientId);
  const rows = await db
    .select({
      id: treatmentNotes.id,
      body: treatmentNotes.body,
      amendsId: treatmentNotes.amendsId,
      createdAt: treatmentNotes.createdAt,
      authorId: treatmentNotes.authorId,
      authorName: users.name,
      appointmentId: treatmentNotes.appointmentId,
      visitStart: appointments.startTime,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
    })
    .from(treatmentNotes)
    .innerJoin(users, eq(users.id, treatmentNotes.authorId))
    .innerJoin(appointments, eq(appointments.id, treatmentNotes.appointmentId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(eq(treatmentNotes.patientId, patientId))
    .orderBy(desc(treatmentNotes.createdAt));
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: patientId, details: { part: "notes" } });
  return rows.map((r) => ({ ...r, chairLabel: r.chairLabel ?? "" }));
}

/** Spec 9.3: a note on a visit the patient came to. A correction names the note it amends, which must be this patient's. */
export async function addNote(actor: Staff, appointmentId: string, input: z.infer<typeof noteSchema>): Promise<{ id: string }> {
  const visit = await requireVisit(appointmentId);
  requireCan(actor, "clinical.write", { dentistId: visit.dentistId });
  if (!SEEN.includes(visit.status)) throw new ApiError(422, "not_seen", "Notes go on visits that are checked in, in treatment, or completed.");
  if (input.amendsId) {
    const [original] = await db.select({ patientId: treatmentNotes.patientId }).from(treatmentNotes).where(eq(treatmentNotes.id, input.amendsId));
    if (original?.patientId !== visit.patientId) {
      throw new ApiError(400, "invalid", "Amend a note of this patient.", { fields: { amendsId: "Amend a note of this patient." } });
    }
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(treatmentNotes)
      .values({ appointmentId, patientId: visit.patientId, authorId: actor.id, body: input.body, amendsId: input.amendsId ?? null })
      .returning({ id: treatmentNotes.id });
    await audit(
      { userId: actor.id, action: "note.added", entity: "patient", entityId: visit.patientId, branchId: visit.branchId, details: { noteId: row.id, appointmentId } },
      tx,
    );
    return row;
  });
}
```

- [ ] **Step 3: Write the routes**

`src/app/api/v1/patients/[id]/chart/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { patientChart } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientChart(staff, id)));
```

`src/app/api/v1/patients/[id]/chart-entries/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { addChartEntry, chartEntrySchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await addChartEntry(staff, id, await readJson(req, chartEntrySchema)), 201),
);
```

`src/app/api/v1/chart-entries/[id]/void/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { voidChartEntry, voidSchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await voidChartEntry(staff, id, await readJson(req, voidSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/appointments/[id]/exam/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { examSchema, saveExam, visitExam } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await visitExam(staff, id)));

export const PUT = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await saveExam(staff, id, (await readJson(req, examSchema)).findings);
  return json({ ok: true });
});
```

`src/app/api/v1/patients/[id]/notes/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { patientNotes } from "@/server/clinical";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await patientNotes(staff, id)));
```

`src/app/api/v1/appointments/[id]/notes/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { addNote, noteSchema } from "@/server/clinical";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => json(await addNote(staff, id, await readJson(req, noteSchema)), 201));
```

- [ ] **Step 4: Give each visit its dentist and its charted teeth, in `src/server/patients.ts`**

Add `isNull` to the `drizzle-orm` import and `chartEntries` to the `@/db/schema` import. In `type PatientVisit`, add `dentistId: string;` before `dentistName` and `teeth: number[];` after `procedures`. In `patientVisits`, add `dentistId: appointments.dentistId,` to the `select` right before `dentistName: users.name,`, then replace the `const visits = rows.map(...)` statement with:

```ts
  const charted = ids.length
    ? await db
        .select({ appointmentId: chartEntries.appointmentId, tooth: chartEntries.tooth })
        .from(chartEntries)
        .where(and(inArray(chartEntries.appointmentId, ids), isNull(chartEntries.voidedAt)))
    : [];
  const visits = rows.map((r) => ({
    ...r,
    status: r.status as Status,
    chairLabel: r.chairLabel ?? "",
    procedures: procs.filter((p) => p.appointmentId === r.id).map((p) => p.name),
    // Spec 9.3: the Visits tab lists the teeth charted during each visit.
    teeth: [...new Set(charted.filter((c) => c.appointmentId === r.id).map((c) => c.tooth))].sort((a, b) => a - b),
  }));
```

- [ ] **Step 5: Run the tests**

```powershell
npx vitest run tests/db/clinical.test.ts tests/db/patients.test.ts
```

Expected: PASS, 9 tests in `clinical.test.ts` and every test in `patients.test.ts`.

- [ ] **Step 6: Commit**

```powershell
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add chart entries, the exam, and treatment notes with their audit trail" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The access log

**Files:**
- Create: `src/server/audit-log.ts`, `src/app/api/v1/audit-log/route.ts`
- Test: `tests/db/audit-log.test.ts`

**Interfaces:**
- Consumes: `auditLog`, `users`, `branches`, `patients` from `@/db/schema`; `requireCan(actor, "audit.view")` (owner only, plan A); plan A's sign-in audit rows (`auth.signed_in`, `auth.sign_in_failed`).
- Produces: `auditQuerySchema`, `accessLog(actor, query)`, and `GET /audit-log?patient&user&before` (spec 11.3): up to 50 rows, newest first, each `{ id, at, action, entity, entityId, details, userId, userName, branchName, patientName }`. `before` is the `id` of the oldest row already shown. `patient` matches rows about that patient (`entity = "patient"`); `user` matches rows by that staff member.

- [ ] **Step 1: Write the failing test, `tests/db/audit-log.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import * as auditRoute from "@/app/api/v1/audit-log/route";
import { db } from "@/db";
import { auditLog, patients } from "@/db/schema";
import { call, makeUser, request, signIn } from "../helpers";

describe("the access log", () => {
  it("lists entries newest first, 50 at a time, by patient and by staff member", async () => {
    const owner = await makeUser({ role: "owner" });
    const desk = await makeUser({ role: "manager", name: "Liza Ramos" });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    await db.insert(auditLog).values(
      Array.from({ length: 55 }, (_, i) => ({
        userId: i % 2 === 1 ? desk.id : owner.id,
        action: "patient.view",
        entity: "patient",
        entityId: ana.id,
        details: { part: "details" },
      })),
    );
    await db.insert(auditLog).values({ userId: owner.id, action: "branch.created", entity: "branch", entityId: "some-branch" });
    const cookie = await signIn(owner.username);
    const get = async (query: string) => (await call(auditRoute.GET, request(`/api/v1/audit-log${query}`, { cookie }))).json();

    const newest = await get("");
    expect(newest).toHaveLength(50);
    expect(newest[0]).toMatchObject({ action: "auth.signed_in", userName: owner.name });
    const aboutAna = await get(`?patient=${ana.id}`);
    expect(aboutAna).toHaveLength(50);
    expect(aboutAna[0]).toMatchObject({ action: "patient.view", patientName: "Santos, Ana", details: { part: "details" } });
    expect(await get(`?patient=${ana.id}&before=${aboutAna[49].id}`)).toHaveLength(5);
    const byDesk = await get(`?user=${desk.id}`);
    expect(byDesk).toHaveLength(27);
    expect(new Set(byDesk.map((r: { userName: string }) => r.userName))).toEqual(new Set(["Liza Ramos"]));
    // Rows about the person count too, such as someone failing to sign in as them.
    await expect(signIn(desk.username, "not the password")).rejects.toThrow();
    const aboutDesk = await get(`?user=${desk.id}`);
    expect(aboutDesk).toHaveLength(28);
    expect(aboutDesk[0]).toMatchObject({ action: "auth.sign_in_failed", entityId: desk.id, userName: null });
  });

  it("is for the owner only", async () => {
    const desk = await makeUser({ role: "manager" });
    expect((await call(auditRoute.GET, request("/api/v1/audit-log", { cookie: await signIn(desk.username) }))).status).toBe(403);
  });
});
```

```powershell
npx vitest run tests/db/audit-log.test.ts
```

Expected: FAIL, because the route module does not exist.

- [ ] **Step 2: Write `src/server/audit-log.ts`**

```ts
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog, branches, patients, users } from "@/db/schema";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const auditQuerySchema = z.object({
  patient: z.uuid().optional(),
  user: z.uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
});

const PAGE = 50;

/** Spec 10 and 13: the owner's access log, newest first, 50 at a time, filtered by patient or by staff member. */
export async function accessLog(actor: Staff, q: z.infer<typeof auditQuerySchema>) {
  requireCan(actor, "audit.view");
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      details: auditLog.details,
      userId: auditLog.userId,
      userName: users.name,
      branchName: branches.name,
      patientName: sql<string | null>`${patients.lastName} || ', ' || ${patients.firstName}`,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(branches, eq(branches.id, auditLog.branchId))
    .leftJoin(patients, and(eq(auditLog.entity, "patient"), eq(sql`${patients.id}::text`, auditLog.entityId)))
    .where(
      and(
        q.patient ? and(eq(auditLog.entity, "patient"), eq(auditLog.entityId, q.patient)) : undefined,
        // By the person, or about them (a failed sign-in as them, a change to their access, their schedule).
        q.user ? or(eq(auditLog.userId, q.user), eq(auditLog.entityId, q.user)) : undefined,
        q.before ? lt(auditLog.id, q.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(PAGE);
}
```

- [ ] **Step 3: Write the route, `src/app/api/v1/audit-log/route.ts`**

```ts
import { json, staffRoute } from "@/server/api";
import { accessLog, auditQuerySchema } from "@/server/audit-log";

export const GET = staffRoute(async (req, staff) =>
  json(await accessLog(staff, auditQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))),
);
```

- [ ] **Step 4: Run the test**

```powershell
npx vitest run tests/db/audit-log.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```powershell
npm run typecheck; npm run lint
git add -A
git commit -m "feat: add the owner's access log, by patient and by staff member" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Chart tab: the tooth chart, a tooth's history, and the exam

**Files:**
- Create: `src/components/chart/tooth-chart.tsx`, `src/components/chart/tooth-panel.tsx`, `src/components/chart/exam-form.tsx`, `src/app/[branch]/patients/[id]/chart-tab.tsx`
- Modify: `src/lib/visits.ts`, `src/app/[branch]/patients/[id]/patient-screen.tsx`, `src/app/[branch]/patients/[id]/page.tsx`, `src/app/[branch]/my-day/my-day-screen.tsx`

**Interfaces:**
- Consumes: Task 1's chart and exam modules; Task 2's routes; `can`, `type Subject` (plan A); `TextField`, `FormAlert`, shadcn `Dialog`, `NativeSelect` with `NativeSelectOptGroup`, `Input`, `Button`.
- Produces:
  - `type ChartEntryJson` and `ToothChart({ entries, selected, onPick })` from `@/components/chart/tooth-chart`.
  - `ToothPanel({ patientId, tooth, entries, staff, onClose })`, `ExamForm({ appointmentId, staff })`, `ChartTab({ patientId, staff })`.
  - `type PatientVisitJson` in `@/lib/visits` (moved from the patient screen, now with `dentistId` and `teeth`).
  - The patient page takes `?tab=details|visits|chart`, and My day's "Open chart" opens the Chart tab.

How it reads (spec 9 and 10): the chart shows the four PDA rows with a code box above the upper teeth and below the lower ones, each tooth a circle of five surfaces, filled by the current state (decay red, restorations blue, missing or extracted grey) with the codes as text in the box. Every tooth is a button whose spoken name is its state in words. Choosing a tooth opens its panel: its state, a form to chart it (for those who may write), and its full history, voided entries struck through with who voided them and why. Under the chart, the exam of a chosen visit, editable by its dentist (or the owner who sees patients) until the visit closes.

- [ ] **Step 1: Move the patient visit's JSON shape into `src/lib/visits.ts`**

Add to `src/lib/visits.ts`, after `VisitDetailJson`:

```ts
/** GET /patients/{id}/visits: one of a patient's visits at any branch (`PatientVisit` in src/server/patients.ts). */
export type PatientVisitJson = {
  id: string;
  start: string;
  end: string;
  status: Status;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistId: string;
  dentistName: string;
  procedures: string[];
  teeth: number[];
};
```

In `src/app/[branch]/patients/[id]/patient-screen.tsx`, delete the local `type PatientVisitJson = { ... };` block and the line `import type { Status } from "@/lib/lifecycle";`, and add `import type { PatientVisitJson } from "@/lib/visits";` after the `@/lib/time` import.

- [ ] **Step 2: Write the chart, `src/components/chart/tooth-chart.tsx`**

```tsx
"use client";

import { boxCodes, CHART_ROWS, codeInfo, describeTooth, toothSides, toothState, type EntryLike, type Surface } from "@/lib/chart";
import { cn } from "@/lib/utils";

/** GET /patients/{id}/chart: one entry, voided ones included. */
export type ChartEntryJson = EntryLike & {
  id: string;
  tooth: number;
  note: string;
  authorId: string;
  authorName: string;
  appointmentId: string | null;
  visitStart: string | null;
  branchName: string | null;
  voidedByName: string | null;
  voidReason: string | null;
};

// A tooth's circle (viewBox 0 0 40 40): a centre of radius 8 and a ring to radius 18 cut into four sides.
const OUTER = 18;
const INNER = 8;
const at = (radius: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return `${(20 + radius * Math.cos(a)).toFixed(2)} ${(20 + radius * Math.sin(a)).toFixed(2)}`;
};
const side = (from: number, to: number) =>
  `M ${at(OUTER, from)} A ${OUTER} ${OUTER} 0 0 1 ${at(OUTER, to)} L ${at(INNER, to)} A ${INNER} ${INNER} 0 0 0 ${at(INNER, from)} Z`;
const SIDES = { top: side(225, 315), right: side(315, 405), bottom: side(45, 135), left: side(135, 225) } as const;

const ROW_NAMES = ["Upper temporary teeth", "Upper permanent teeth", "Lower permanent teeth", "Lower temporary teeth"];

/** A surface's fill: decay red, restorations blue, missing or extracted grey. The code box carries the words. */
function fill(code: string | undefined): string {
  if (code === "D") return "fill-red-500/70";
  if (code === "M" || code === "MO" || code === "X" || code === "XO") return "fill-zinc-400 dark:fill-zinc-600";
  if (code && codeInfo(code)?.group === "Restorations and prosthetics") return "fill-sky-500/70";
  return "fill-background";
}

function Tooth({ tooth, upper, state, selected, onPick }: { tooth: number; upper: boolean; state: Partial<Record<Surface, string>>; selected: boolean; onPick: (tooth: number) => void }) {
  const sides = toothSides(tooth);
  const box = (
    <span className="flex min-h-6 w-full flex-wrap items-center justify-center gap-0.5 rounded-sm border px-0.5 text-[11px] leading-tight font-medium">
      {boxCodes(state).map((code) => (
        <span key={code}>{codeInfo(code)?.mark ?? code}</span>
      ))}
    </span>
  );
  const number = <span className="text-[11px] text-muted-foreground">{tooth}</span>;
  return (
    <button
      type="button"
      onClick={() => onPick(tooth)}
      aria-label={describeTooth(tooth, state)}
      aria-pressed={selected}
      className={cn(
        "flex w-10 flex-col items-center gap-0.5 rounded-md p-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-muted",
      )}
    >
      {upper && box}
      {upper && number}
      <svg viewBox="0 0 40 40" className="size-9" aria-hidden>
        {(Object.keys(SIDES) as (keyof typeof SIDES)[]).map((key) => (
          <path key={key} d={SIDES[key]} strokeWidth={1} className={cn("stroke-foreground/60", fill(state[sides[key]]))} />
        ))}
        <circle cx={20} cy={20} r={INNER} strokeWidth={1} className={cn("stroke-foreground/60", fill(state.O))} />
      </svg>
      {!upper && number}
      {!upper && box}
    </button>
  );
}

/** Spec 9.1: the PDA Dental Record Chart, the patient's right on the viewer's left. */
export function ToothChart({ entries, selected, onPick }: { entries: ChartEntryJson[]; selected: number | null; onPick: (tooth: number) => void }) {
  const byTooth = new Map<number, ChartEntryJson[]>();
  for (const e of entries) byTooth.set(e.tooth, [...(byTooth.get(e.tooth) ?? []), e]);
  return (
    <div className="overflow-x-auto rounded-lg border p-3">
      <div className="mx-auto grid w-max gap-3">
        {CHART_ROWS.map((row, i) => {
          const half = row.teeth.length / 2;
          return (
            <div key={ROW_NAMES[i]} role="group" aria-label={ROW_NAMES[i]} className={cn("flex justify-center", i === 2 && "border-t pt-3")}>
              {[row.teeth.slice(0, half), row.teeth.slice(half)].map((teeth, j) => (
                <div key={j} className={cn("flex gap-0.5 px-2", j === 1 && "border-l")}>
                  {teeth.map((tooth) => (
                    <Tooth key={tooth} tooth={tooth} upper={row.upper} state={toothState(byTooth.get(tooth) ?? [])} selected={selected === tooth} onPick={onPick} />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write a tooth's panel, `src/components/chart/tooth-panel.tsx`**

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ChartEntryJson } from "@/components/chart/tooth-chart";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { CHART_GROUPS, CHART_LEGEND, codeInfo, describeTooth, needsSurfaces, SURFACES, surfaceName, toothState, type Surface } from "@/lib/chart";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type Props = { patientId: string; tooth: number | null; entries: ChartEntryJson[]; staff: Subject; onClose: () => void };

/** Spec 9.1: a tooth's state and history, a form to chart it, and voiding with a reason. */
export function ToothPanel({ patientId, tooth, entries, staff, onClose }: Props) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [note, setNote] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const history = entries.filter((e) => e.tooth === tooth);
  const refresh = () => client.invalidateQueries({ queryKey: ["chart", patientId] });

  const add = useMutation({
    mutationFn: () => api(`/patients/${patientId}/chart-entries`, { method: "POST", body: { tooth, code, surfaces: needsSurfaces(code) ? surfaces : [], note } }),
    onSuccess: async () => {
      toast.success(`Charted tooth ${tooth}.`);
      setCode("");
      setSurfaces([]);
      setNote("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const voidEntry = useMutation({
    mutationFn: (id: string) => api(`/chart-entries/${id}/void`, { method: "POST", body: { reason } }),
    onSuccess: async () => {
      toast.success("Voided.");
      setVoiding(null);
      setReason("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Dialog open={tooth !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Tooth ${tooth}`}</DialogTitle>
          <DialogDescription>{tooth !== null ? describeTooth(tooth, toothState(history)) : ""}</DialogDescription>
        </DialogHeader>
        {tooth !== null && can(staff, "clinical.write") && (
          <form
            className="grid gap-3 rounded-lg border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate();
            }}
          >
            <label className="grid gap-1.5 text-sm font-medium">
              Code
              <NativeSelect value={code} onChange={(event) => setCode(event.target.value)} className="w-full">
                <NativeSelectOption value="">Pick a code</NativeSelectOption>
                {CHART_GROUPS.map((group) => (
                  <NativeSelectOptGroup key={group} label={group}>
                    {CHART_LEGEND.filter((c) => c.group === group).map((c) => (
                      <NativeSelectOption key={c.code} value={c.code}>
                        {`${c.mark} · ${c.label}`}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                ))}
              </NativeSelect>
            </label>
            {needsSurfaces(code) && (
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">Surfaces</legend>
                <div className="flex flex-wrap gap-2">
                  {SURFACES.map((s) => (
                    <label key={s} className="flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm sm:min-h-9">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={surfaces.includes(s)}
                        onChange={(event) => setSurfaces(event.target.checked ? [...surfaces, s] : surfaces.filter((x) => x !== s))}
                      />
                      {surfaceName(tooth, s)}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <TextField label="Note (optional)" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
            <Button type="submit" className="justify-self-start" disabled={!code || (needsSurfaces(code) && surfaces.length === 0) || add.isPending}>
              Add to the chart
            </Button>
          </form>
        )}
        <section className="grid gap-2 text-sm">
          <h3 className="font-medium">History</h3>
          {history.length === 0 ? (
            <p className="text-muted-foreground">Nothing charted on this tooth yet.</p>
          ) : (
            <ol className="grid gap-2">
              {[...history].reverse().map((e) => (
                <li key={e.id} className="grid gap-1 rounded-md border p-2">
                  <span className={cn("font-medium", e.voidedAt && "line-through")}>
                    {[codeInfo(e.code)?.label ?? e.code, e.surfaces.map((s) => surfaceName(e.tooth, s as Surface).toLowerCase()).join(", ")].filter(Boolean).join(", ")}
                    {e.note ? `: ${e.note}` : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {[formatDateTime(new Date(e.createdAt)), e.authorName, e.branchName, e.visitStart ? `visit of ${formatDate(new Date(e.visitStart))}` : null]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                  {e.voidedAt && <span>{`Voided by ${e.voidedByName ?? "someone"}: ${e.voidReason}`}</span>}
                  {!e.voidedAt &&
                    can(staff, "clinical.write", { dentistId: e.authorId }) &&
                    (voiding === e.id ? (
                      <form
                        className="flex flex-wrap items-end gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          voidEntry.mutate(e.id);
                        }}
                      >
                        <TextField label="Why void it?" value={reason} maxLength={200} required onChange={(event) => setReason(event.target.value)} className="min-w-48 flex-1" />
                        <Button type="submit" variant="destructive" disabled={!reason.trim() || voidEntry.isPending}>
                          Void
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setVoiding(null)}>
                          Keep it
                        </Button>
                      </form>
                    ) : (
                      <Button
                        variant="outline"
                        className="justify-self-start"
                        onClick={() => {
                          setVoiding(e.id);
                          setReason("");
                        }}
                      >
                        Void this entry
                      </Button>
                    ))}
                </li>
              ))}
            </ol>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the exam form, `src/components/chart/exam-form.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXAM_SECTIONS } from "@/lib/exam";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";

type Findings = Record<string, Record<string, string>>;
type Exam = { findings: Findings; updatedAt: string | null; authorName: string | null; dentistId: string; editable: boolean };

/** Spec 9.2: a visit's PDA exam. Its dentist (or the owner who sees patients) edits it until the visit closes. */
export function ExamForm({ appointmentId, staff }: { appointmentId: string; staff: Subject }) {
  const exam = useQuery({ queryKey: ["exam", appointmentId], queryFn: () => api<Exam>(`/appointments/${appointmentId}/exam`) });
  if (exam.isPending) return <p className="text-muted-foreground">Loading the exam...</p>;
  if (exam.isError) return <FormAlert message={errorMessage(exam.error)} />;
  const { findings, editable, dentistId, authorName, updatedAt } = exam.data;
  const saved = authorName && updatedAt ? `Saved by ${authorName}, ${formatDateTime(new Date(updatedAt))}.` : "No exam saved for this visit yet.";
  if (editable && can(staff, "clinical.write", { dentistId })) {
    return <ExamFields key={updatedAt ?? "new"} appointmentId={appointmentId} initial={findings} saved={saved} />;
  }
  const marked = EXAM_SECTIONS.flatMap((s) =>
    s.items.filter((i) => findings[s.key]?.[i.key] !== undefined).map((i) => `${s.label}: ${i.label}${findings[s.key][i.key] ? ` (${findings[s.key][i.key]})` : ""}`),
  );
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">{saved}</p>
      {marked.length > 0 && (
        <ul className="grid gap-1">
          {marked.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamFields({ appointmentId, initial, saved }: { appointmentId: string; initial: Findings; saved: string }) {
  const client = useQueryClient();
  const [findings, setFindings] = useState<Findings>(initial);
  const save = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/exam`, { method: "PUT", body: { findings } }),
    onSuccess: async () => {
      toast.success("Exam saved.");
      await client.invalidateQueries({ queryKey: ["exam", appointmentId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const setItem = (section: string, item: string, value: string | null) => {
    const next = { ...(findings[section] ?? {}) };
    if (value === null) delete next[item];
    else next[item] = value;
    const all = { ...findings, [section]: next };
    if (Object.keys(next).length === 0) delete all[section];
    setFindings(all);
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{saved}</p>
      {EXAM_SECTIONS.map((section) => (
        <fieldset key={section.key} className="grid gap-1">
          <legend className="mb-1 font-medium">{section.label}</legend>
          {section.items.map((item) => {
            const value = findings[section.key]?.[item.key];
            return (
              <div key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={value !== undefined}
                    onChange={(event) => setItem(section.key, item.key, event.target.checked ? "" : null)}
                  />
                  {item.label}
                </label>
                {value !== undefined && (
                  <Input
                    aria-label={`${item.label}: detail`}
                    placeholder="Detail (optional)"
                    maxLength={60}
                    value={value}
                    onChange={(event) => setItem(section.key, item.key, event.target.value)}
                    className="w-56"
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <Button type="submit" className="justify-self-start" disabled={save.isPending}>
        {save.isPending ? "Saving..." : "Save the exam"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Write the Chart tab, `src/app/[branch]/patients/[id]/chart-tab.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ExamForm } from "@/components/chart/exam-form";
import { ToothChart, type ChartEntryJson } from "@/components/chart/tooth-chart";
import { ToothPanel } from "@/components/chart/tooth-panel";
import { FormAlert } from "@/components/form-alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CHART_LEGEND } from "@/lib/chart";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";
import type { PatientVisitJson } from "@/lib/visits";

/** Spec 10, the patient's Chart tab: the tooth chart, and the exam of a chosen visit. */
export function ChartTab({ patientId, staff }: { patientId: string; staff: Subject }) {
  const [tooth, setTooth] = useState<number | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const chart = useQuery({ queryKey: ["chart", patientId], queryFn: () => api<ChartEntryJson[]>(`/patients/${patientId}/chart`) });
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[] }>(`/patients/${patientId}/visits`),
  });
  const examVisits = (visits.data?.visits ?? []).filter((v) => v.status !== "cancelled" && v.status !== "no_show");
  // The visit in progress, else the latest that has started, else the soonest booked (the list is newest first).
  const now = new Date();
  const current =
    examVisits.find((v) => v.status === "checked_in" || v.status === "in_treatment") ??
    examVisits.find((v) => new Date(v.start) <= now) ??
    examVisits.at(-1);
  const chosen = visitId ?? current?.id ?? null;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="chart-title" className="grid gap-2">
        <h2 id="chart-title" className="text-lg font-semibold">
          Dental chart
        </h2>
        <p className="text-sm text-muted-foreground">{`Choose a tooth to see its history${can(staff, "clinical.write") ? " or chart it" : ""}.`}</p>
        {chart.isError ? (
          <FormAlert message={errorMessage(chart.error)} />
        ) : chart.isPending ? (
          <p className="text-muted-foreground">Loading the chart...</p>
        ) : (
          <ToothChart entries={chart.data} selected={tooth} onPick={setTooth} />
        )}
        <details className="text-sm">
          <summary className="cursor-pointer py-2">Legend</summary>
          <dl className="grid grid-cols-[3rem_1fr] gap-x-3 gap-y-1">
            {CHART_LEGEND.map((c) => (
              <Fragment key={c.code}>
                <dt className="font-medium">{c.mark}</dt>
                <dd>{c.label}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      </section>
      <section aria-labelledby="exam-title" className="grid gap-3">
        <h2 id="exam-title" className="text-lg font-semibold">
          Exam
        </h2>
        {visits.isError ? (
          <FormAlert message={errorMessage(visits.error)} />
        ) : visits.isPending ? (
          <p className="text-muted-foreground">Loading visits...</p>
        ) : examVisits.length === 0 ? (
          <p className="text-muted-foreground">No visits yet.</p>
        ) : (
          <>
            <label className="grid max-w-md gap-1.5 text-sm font-medium">
              Visit
              <NativeSelect value={chosen ?? ""} onChange={(event) => setVisitId(event.target.value)} className="w-full">
                {examVisits.map((v) => (
                  <NativeSelectOption key={v.id} value={v.id}>
                    {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${v.dentistName}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {chosen && <ExamForm key={chosen} appointmentId={chosen} staff={staff} />}
          </>
        )}
      </section>
      <ToothPanel key={tooth ?? "none"} patientId={patientId} tooth={tooth} entries={chart.data ?? []} staff={staff} onClose={() => setTooth(null)} />
    </div>
  );
}
```

- [ ] **Step 6: Add the Chart tab to the patient page**

In `src/app/[branch]/patients/[id]/patient-screen.tsx`, add these imports after `import type { PatientVisitJson } from "@/lib/visits";`:

```tsx
import type { Subject } from "@/lib/permissions";
import { ChartTab } from "./chart-tab";
```

and replace the `PatientScreen` function with:

```tsx
export function PatientScreen({ patient, canEdit, staff, initialTab }: { patient: PatientJson; canEdit: boolean; staff: Subject; initialTab: string }) {
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
      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="chart">Chart</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <DetailsPanel patient={patient} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="visits" className="pt-4">
          <VisitsPanel patientId={patient.id} />
        </TabsContent>
        <TabsContent value="chart" className="pt-4">
          <ChartTab patientId={patient.id} staff={staff} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Replace `src/app/[branch]/patients/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can } from "@/lib/permissions";
import { ApiError } from "@/server/errors";
import { getPatient } from "@/server/patients";
import { requireStaff } from "@/server/session";
import { PatientScreen, type PatientJson } from "./patient-screen";

export const metadata: Metadata = { title: "Patient" };

const TABS = ["details", "visits", "chart"];

/** `?tab=` opens a tab directly, such as My day's "Open chart". */
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { tab } = await searchParams;
  let patient;
  try {
    patient = await getPatient(staff, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <PatientScreen
      patient={JSON.parse(JSON.stringify(patient)) as PatientJson}
      canEdit={can(staff, "patient.edit")}
      staff={staff}
      initialTab={typeof tab === "string" && TABS.includes(tab) ? tab : "details"}
    />
  );
}
```

- [ ] **Step 7: Open the chart from My day**

In `src/app/[branch]/my-day/my-day-screen.tsx`, change the patient link to open the Chart tab:

```tsx
                  <Link href={`/${branch}/patients/${v.patientId}?tab=chart`} className={buttonVariants({ variant: "outline" })}>
                    Open chart
                  </Link>
```

- [ ] **Step 8: Check it in the browser**

With a fresh seed and `npm run dev`, sign in as `dr.reyes`. On My day, check in is the front desk's job, so first sign in as `downtown.desk`, check in one of Dr. Reyes's visits today, and start treatment; then, as `dr.reyes`, choose "Open chart" on that visit.

Expected: the four rows read 55 to 51 and 61 to 65 on top, then 18 to 11 and 21 to 28, a line, 48 to 41 and 31 to 38, and 85 to 81 and 71 to 75, with a vertical line between the halves. Choosing tooth 16 opens "Tooth 16" and "Tooth 16, nothing charted". Picking "Co · Composite filling" shows the five surfaces named Mesial, Distal, Occlusal, Buccal, Palatal; ticking Occlusal and adding shows "Charted tooth 16.", the box above 16 reads "Co", and the circle's centre turns blue. On tooth 11 the surfaces read Incisal and Labial. Voiding the entry asks why, then strikes it through with "Voided by Dr. Jose Reyes: ...", and the box empties. In the Exam section, ticking Gingivitis and "Periapical (tooth numbers)" with "16, 26" and saving shows "Exam saved."; the front desk sees the same exam read-only and no chart form. Tab reaches every tooth; each tooth's spoken name is its state in words. The browser console shows no errors.

- [ ] **Step 9: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the Chart tab with the PDA tooth chart, tooth history, and the exam" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Notes tab and the teeth on the Visits tab

**Files:**
- Create: `src/app/[branch]/patients/[id]/notes-tab.tsx`
- Modify: `src/app/[branch]/patients/[id]/patient-screen.tsx`, `src/app/[branch]/patients/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /patients/{id}/notes`, `POST /appointments/{id}/notes`, `GET /patients/{id}/visits` with `dentistId` and `teeth` (Task 2); `type PatientVisitJson`, `chairName` (`@/lib/visits`); `can`, `type Subject`.
- Produces: `NotesTab({ patientId, staff })`; the patient page's Notes tab (`?tab=notes`); the Visits tab's columns in the PDA treatment record's order (spec 9.3): date, branch, chair, teeth, procedures, dentist, status.

How it reads (spec 9.3): notes newest first, each with its date, dentist, branch, chair, and visit; a correction says which note it corrects. Those who may write add a note to one of their visits the patient came to (checked in, in treatment, or completed), and correct a note with "Correct this note", which adds a new note naming the old one; nothing is ever edited.

- [ ] **Step 1: Write the Notes tab, `src/app/[branch]/patients/[id]/notes-tab.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/fetcher";
import type { Status } from "@/lib/lifecycle";
import { can, type Subject } from "@/lib/permissions";
import { formatDate, formatDateTime } from "@/lib/time";
import { chairName, type PatientVisitJson } from "@/lib/visits";

type NoteJson = {
  id: string;
  body: string;
  amendsId: string | null;
  createdAt: string;
  authorName: string;
  appointmentId: string;
  visitStart: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
};

/** Visits a note can go on: the patient came (the server checks the same). */
const SEEN: readonly Status[] = ["checked_in", "in_treatment", "completed"];

function NoteForm({ patientId, appointmentId, amendsId, onClose }: { patientId: string; appointmentId: string; amendsId?: string; onClose?: () => void }) {
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/notes`, { method: "POST", body: { body, amendsId: amendsId ?? null } }),
    onSuccess: async () => {
      toast.success(amendsId ? "Correction added." : "Note added.");
      setBody("");
      await client.invalidateQueries({ queryKey: ["notes", patientId] });
      onClose?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        {amendsId ? "Correction" : "Note"}
        <Textarea value={body} maxLength={4000} rows={4} onChange={(event) => setBody(event.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!body.trim() || add.isPending}>
          {amendsId ? "Add the correction" : "Add the note"}
        </Button>
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            Go back
          </Button>
        )}
      </div>
    </form>
  );
}

/** Spec 9.3, the patient's Notes tab. Notes are never edited: a correction is a new note naming the one it corrects. */
export function NotesTab({ patientId, staff }: { patientId: string; staff: Subject }) {
  const [visitId, setVisitId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const notes = useQuery({ queryKey: ["notes", patientId], queryFn: () => api<NoteJson[]>(`/patients/${patientId}/notes`) });
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[] }>(`/patients/${patientId}/visits`),
  });
  const all = visits.data?.visits ?? [];
  const writable = all.filter((v) => SEEN.includes(v.status) && can(staff, "clinical.write", { dentistId: v.dentistId }));
  const chosen = visitId ?? writable[0]?.id ?? null;
  const canCorrect = (n: NoteJson) => {
    const dentistId = all.find((v) => v.id === n.appointmentId)?.dentistId;
    return dentistId !== undefined && can(staff, "clinical.write", { dentistId });
  };
  const byId = new Map((notes.data ?? []).map((n) => [n.id, n]));

  return (
    <div className="grid max-w-3xl gap-6">
      {chosen && (
        <section aria-labelledby="new-note-title" className="grid gap-3 rounded-lg border p-3">
          <h2 id="new-note-title" className="font-semibold">
            Add a treatment note
          </h2>
          <label className="grid gap-1.5 text-sm font-medium">
            Visit
            <NativeSelect value={chosen} onChange={(event) => setVisitId(event.target.value)} className="w-full">
              {writable.map((v) => (
                <NativeSelectOption key={v.id} value={v.id}>
                  {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <NoteForm key={chosen} patientId={patientId} appointmentId={chosen} />
        </section>
      )}
      <section aria-labelledby="notes-title" className="grid gap-3">
        <h2 id="notes-title" className="text-lg font-semibold">
          Treatment notes
        </h2>
        {notes.isError ? (
          <FormAlert message={errorMessage(notes.error)} />
        ) : notes.isPending ? (
          <p className="text-muted-foreground">Loading notes...</p>
        ) : notes.data.length === 0 ? (
          <p className="text-muted-foreground">No notes yet.</p>
        ) : (
          <ol className="grid gap-3">
            {notes.data.map((n) => {
              const original = n.amendsId ? byId.get(n.amendsId) : undefined;
              return (
                <li key={n.id} className="grid gap-2 rounded-lg border p-3">
                  <p className="text-sm text-muted-foreground">
                    {[formatDateTime(new Date(n.createdAt)), n.authorName, n.branchName, chairName(n.chairNumber, n.chairLabel), `visit of ${formatDate(new Date(n.visitStart))}`].join(", ")}
                  </p>
                  {n.amendsId && (
                    <p className="text-sm font-medium">{`Correction to the note of ${original ? formatDateTime(new Date(original.createdAt)) : "an earlier date"}`}</p>
                  )}
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  {canCorrect(n) &&
                    (correcting === n.id ? (
                      <NoteForm patientId={patientId} appointmentId={n.appointmentId} amendsId={n.id} onClose={() => setCorrecting(null)} />
                    ) : (
                      <Button variant="outline" className="justify-self-start" onClick={() => setCorrecting(n.id)}>
                        Correct this note
                      </Button>
                    ))}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add the Notes tab and the teeth column to the patient page**

In `src/app/[branch]/patients/[id]/patient-screen.tsx`:

1. Add `import { NotesTab } from "./notes-tab";` after `import { ChartTab } from "./chart-tab";`.
2. In `PatientScreen`, add `<TabsTrigger value="notes">Notes</TabsTrigger>` after the Chart trigger, and this panel after the Chart panel:

```tsx
        <TabsContent value="notes" className="pt-4">
          <NotesTab patientId={patient.id} staff={staff} />
        </TabsContent>
```

3. In `VisitsPanel`, replace the table's header row and body rows with the PDA treatment record's order:

```tsx
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Chair</TableHead>
                <TableHead>Teeth</TableHead>
                <TableHead>Procedures</TableHead>
                <TableHead>Dentist</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.data.visits.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{formatDateTime(new Date(v.start))}</TableCell>
                  <TableCell>{v.branchName}</TableCell>
                  <TableCell>{v.chairLabel ? `${v.chairNumber}, ${v.chairLabel}` : v.chairNumber}</TableCell>
                  <TableCell>{v.teeth.join(", ")}</TableCell>
                  <TableCell className="whitespace-normal">{v.procedures.join(", ")}</TableCell>
                  <TableCell>{v.dentistName}</TableCell>
                  <TableCell>
                    <StatusBadge status={v.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
```

In `src/app/[branch]/patients/[id]/page.tsx`, add `"notes"` to `TABS`:

```ts
const TABS = ["details", "visits", "chart", "notes"];
```

- [ ] **Step 3: Check it in the browser**

With a fresh seed and `npm run dev`, sign in as `dr.reyes`, open one of his patients with a completed visit, and choose the Notes tab.

Expected: "Add a treatment note" lists only his visits the patient came to; adding "Scaling done." shows "Note added." and the note on top with the date, "Dr. Jose Reyes", branch, chair, and visit. "Correct this note" opens a Correction box under it; adding one shows a new note on top reading "Correction to the note of ..." while the first note stays as it was. Signed in as `downtown.desk`, the same notes show with no form and no "Correct this note". The Visits tab lists Teeth after Chair. The browser console shows no errors.

- [ ] **Step 4: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the Notes tab with corrections, and charted teeth on the Visits tab" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The access log screen

**Files:**
- Create: `src/lib/access-log.ts`, `tests/unit/access-log.test.ts`, `src/app/[branch]/settings/access-log-panel.tsx`
- Modify: `src/app/[branch]/settings/settings-screen.tsx`

**Interfaces:**
- Consumes: `GET /audit-log` (Task 3), `GET /staff` (plan A), `PatientSearch` and `type PatientHit` (plan B).
- Produces: `actionText({ action, details })` (`@/lib/access-log`), `AccessLogPanel()`, and an owner-only "Access log" tab in Settings (spec 10).

- [ ] **Step 1: Write the failing test, `tests/unit/access-log.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { actionText } from "@/lib/access-log";

describe("the access log in words", () => {
  it("says what happened, with the part viewed, the fields changed, or the username tried", () => {
    expect(actionText({ action: "patient.view", details: { part: "chart" } })).toBe("Viewed the record (chart)");
    expect(actionText({ action: "patient.updated", details: { fields: ["mobile", "email"] } })).toBe("Changed the patient's details: mobile, email");
    expect(actionText({ action: "auth.sign_in_failed", details: { username: "ana.s", ip: null } })).toBe("Failed to sign in as ana.s");
    expect(actionText({ action: "chart.added", details: { entryId: "x" } })).toBe("Charted a tooth");
    expect(actionText({ action: "something.new", details: {} })).toBe("something.new");
  });
});
```

```powershell
npx vitest run tests/unit/access-log.test.ts
```

Expected: FAIL, because `@/lib/access-log` does not exist.

- [ ] **Step 2: Write `src/lib/access-log.ts`**

```ts
/** Every action the app writes to the audit log, in words. */
const ACTIONS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.sign_in_failed": "Failed to sign in",
  "auth.password_changed": "Changed their password",
  "setup.completed": "Set up DentaSync",
  "setup.owner_password_reset": "Reset the owner's password with the setup code",
  "patient.view": "Viewed the record",
  "patient.created": "Added the patient",
  "patient.updated": "Changed the patient's details",
  "chart.added": "Charted a tooth",
  "chart.voided": "Voided a chart entry",
  "exam.saved": "Saved an exam",
  "note.added": "Added a treatment note",
  "appointment.created": "Booked a visit",
  "appointment.moved": "Moved a visit",
  "appointment.status_changed": "Changed a visit's status",
  "staff.join_requested": "Asked to join",
  "staff.approved": "Approved a join request",
  "staff.declined": "Declined a join request",
  "staff.updated": "Changed a staff member",
  "staff.reset_link_created": "Made a password reset QR",
  "staff.password_reset": "Reset their password",
  "branch.created": "Added a branch",
  "branch.updated": "Changed a branch",
  "branch.qr_replaced": "Replaced a branch QR",
  "chair.added": "Added a chair",
  "chair.updated": "Changed a chair",
  "procedure.created": "Added a procedure",
  "procedure.updated": "Changed a procedure",
  "practice.renamed": "Renamed the practice",
  "schedule.replaced": "Changed a weekly schedule",
  "time_off.added": "Added time off",
  "time_off.removed": "Removed time off",
};

/** An audit row in words, with the part of the record viewed, the fields changed, or the username a failed sign-in tried. */
export function actionText(row: { action: string; details: Record<string, unknown> }): string {
  const base = ACTIONS[row.action] ?? row.action;
  const { part, fields, username } = row.details;
  if (row.action === "patient.view" && typeof part === "string") return `${base} (${part})`;
  if (row.action === "patient.updated" && Array.isArray(fields)) return `${base}: ${fields.join(", ")}`;
  if (row.action === "auth.sign_in_failed" && typeof username === "string") return `${base} as ${username}`;
  return base;
}
```

```powershell
npx vitest run tests/unit/access-log.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 3: Write the panel, `src/app/[branch]/settings/access-log-panel.tsx`**

```tsx
"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch, type PatientHit } from "@/components/patient-search";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actionText } from "@/lib/access-log";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type AuditRow = {
  id: number;
  at: string;
  action: string;
  details: Record<string, unknown>;
  userName: string | null;
  branchName: string | null;
  patientName: string | null;
};

const PAGE = 50;

/** Spec 10: the owner's access log, newest first, by patient and by staff member. */
export function AccessLogPanel() {
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [user, setUser] = useState("");
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<{ id: string; name: string }[]>("/staff") });
  const log = useInfiniteQuery({
    queryKey: ["audit-log", patient?.id ?? "", user],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (patient) query.set("patient", patient.id);
      if (user) query.set("user", user);
      if (pageParam) query.set("before", String(pageParam));
      return api<AuditRow[]>(`/audit-log?${query}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Sign-ins, every view and change of a patient record, and every staff and settings change, newest first.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {patient ? (
          <div className="flex items-center justify-between gap-2 self-start rounded-md border p-2 text-sm">
            <span>{`Patient: ${patient.lastName}, ${patient.firstName}`}</span>
            <Button variant="ghost" onClick={() => setPatient(null)}>
              Every patient
            </Button>
          </div>
        ) : (
          <PatientSearch onPick={setPatient} />
        )}
        <label className="grid gap-1.5 self-start text-sm font-medium">
          Staff member
          <NativeSelect value={user} onChange={(event) => setUser(event.target.value)} className="w-full">
            <NativeSelectOption value="">Everyone</NativeSelectOption>
            {(staff.data ?? []).map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {log.isError && <FormAlert message={errorMessage(log.error)} />}
      {log.isPending ? (
        <p className="text-muted-foreground">Loading the access log...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded for this choice.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Branch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateTime(new Date(r.at))}</TableCell>
                  <TableCell>{r.userName ?? "No one signed in"}</TableCell>
                  <TableCell className="whitespace-normal">{actionText(r)}</TableCell>
                  <TableCell>{r.patientName ?? ""}</TableCell>
                  <TableCell>{r.branchName ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {log.hasNextPage && (
        <Button variant="outline" className="justify-self-start" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
          {log.isFetchingNextPage ? "Loading..." : "Show older"}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the tab to Settings**

In `src/app/[branch]/settings/settings-screen.tsx`, add `import { AccessLogPanel } from "./access-log-panel";` before `import { BranchesPanel } from "./branches-panel";`, add `{owner && <TabsTrigger value="access-log">Access log</TabsTrigger>}` after the Time off trigger, and add this panel after the Time off panel:

```tsx
        {owner && (
          <TabsContent value="access-log" className="pt-4">
            <AccessLogPanel />
          </TabsContent>
        )}
```

- [ ] **Step 5: Check it in the browser**

With a fresh seed and `npm run dev`, sign in as `owner`, open Settings, then Access log.

Expected: the newest rows first, including "Signed in" by Dr. Maria Santos; opening a patient's chart in another tab and coming back adds "Viewed the record (chart)" with that patient's name. Picking the patient in the search narrows the log to that patient, "Every patient" clears it, and "Staff member" narrows it to one person. After 50 rows, "Show older" loads the next 50. A failed sign-in (a wrong password on the login page) shows as "Failed to sign in as" the username tried, with no password anywhere. Managers see no Access log tab. The browser console shows no errors.

- [ ] **Step 6: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the access log to the owner's Settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Clinical records in the development data

**Files:**
- Modify: `src/server/seed.ts`, `tests/db/seed.test.ts`, `README.md`

**Interfaces:**
- Consumes: plan B's `seed(now)` and its `planned` visits; `chartEntries`, `exams`, `treatmentNotes`, `type ExamFindings` from `@/db/schema`.
- Produces: `npm run seed` also writes, for about seven in ten completed visits, a chart entry, an exam, and a treatment note by the visit's dentist, dated at the visit's end (spec 15: "some chart entries and exams").

- [ ] **Step 1: Extend the test, `tests/db/seed.test.ts`**

Add `chartEntries`, `exams`, and `treatmentNotes` to the `@/db/schema` import, and add these lines at the end of the first test, after the statuses check:

```ts
    expect(await total(chartEntries)).toBeGreaterThan(0);
    expect(await total(exams)).toBeGreaterThan(0);
    expect(await total(treatmentNotes)).toBeGreaterThan(0);
```

```powershell
npx vitest run tests/db/seed.test.ts
```

Expected: FAIL, the chart entries count is 0.

- [ ] **Step 2: Write the clinical records in `src/server/seed.ts`**

Add `chartEntries`, `exams`, `treatmentNotes`, and `type ExamFindings` to the `@/db/schema` import. Add these constants after `COMPLETED`:

```ts
// Sample clinical records for past visits: a tooth, a chart code with its surfaces, exam findings, and a note.
const TEETH = [11, 14, 16, 21, 24, 26, 36, 37, 46, 47];
const CHARTED: [string, string[]][] = [
  ["present", []],
  ["D", ["O"]],
  ["Co", ["O"]],
  ["Am", ["O", "M"]],
  ["S", ["O"]],
  ["X", []],
];
const FINDINGS: ExamFindings[] = [{ periodontal: { gingivitis: "" } }, { xrays: { periapical: "16, 26" } }, { occlusion: { molar_class: "Class I" } }, {}];
const NOTES = [
  "Oral prophylaxis done. Advised to floss daily.",
  "Composite restoration placed. No sensitivity reported.",
  "Extraction done under local anesthesia. Post-operative care explained.",
  "Consultation done. Treatment plan explained to the patient.",
  "Fluoride varnish applied. Recall in six months.",
];
```

Then, inside the transaction, right after the loop of status changes (the one commented "Real status changes, one step at a time"), add:

```ts
    // Most completed visits get a chart entry, an exam, and a note by their dentist, dated when the visit ended.
    const done = planned.flatMap((v, i) => (v.path.at(-1) === "completed" && random() < 0.7 ? [{ ...v, id: saved[i].id }] : []));
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
    if (done.length > 0) {
      await tx.insert(chartEntries).values(
        done.map((v) => {
          const [code, surfaces] = pick(CHARTED);
          return { patientId: v.patientId, appointmentId: v.id, branchId: v.branchId, tooth: pick(TEETH), code, surfaces, authorId: v.dentistId, createdAt: v.end };
        }),
      );
      await tx
        .insert(exams)
        .values(done.map((v) => ({ appointmentId: v.id, patientId: v.patientId, authorId: v.dentistId, findings: pick(FINDINGS), createdAt: v.end, updatedAt: v.end })));
      await tx
        .insert(treatmentNotes)
        .values(done.map((v) => ({ appointmentId: v.id, patientId: v.patientId, authorId: v.dentistId, body: pick(NOTES), createdAt: v.end })));
    }
```

- [ ] **Step 3: Run the test**

```powershell
npx vitest run tests/db/seed.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 4: Mention it in `README.md`**

In the `npm run seed` step of `## Run it`, change "40 patients, and two weeks of visits" to "40 patients, two weeks of visits, and chart entries, exams, and notes on past visits".

- [ ] **Step 5: Commit**

```powershell
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add chart entries, exams, and notes to the development data" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The end-to-end run and going live

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/env.ts`, `tests/e2e/visit.spec.ts`, `scripts/e2e-server.mjs`
- Modify: `drizzle.config.ts`, `README.md`

**Interfaces:**
- Consumes: every screen of plans A to C, by their labels and button names; `POST /branches`, `POST /branches/{code}/chairs`, `POST /procedures` (plan A) for the setup the run does not test.
- Produces: `npm run test:e2e`, one Playwright run of spec 14's path: setup, a QR join, approval, booking, check-in, start of treatment, charting a tooth, the exam, a note, and completion. `npm run db:migrate` now reaches the Postgres in `DATABASE_URL`. The README explains the scripts, the end-to-end run, and going live (spec 16).

- [ ] **Step 1: Let `npm run db:migrate` reach the production database**

Replace `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Used only by `npm run db:migrate`, against the production Postgres. PGlite migrates itself (src/db/index.ts).
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

```powershell
npx drizzle-kit generate
```

Expected: "No schema changes, nothing to migrate".

- [ ] **Step 2: Write the end-to-end setup**

`tests/e2e/env.ts`:

```ts
/** The end-to-end server's port and its test-only secrets (playwright.config.ts and visit.spec.ts). */
export const E2E = {
  port: 3701,
  setupCode: "e2e-only-setup-code-that-is-at-least-32-characters",
  secret: "e2e-only-auth-secret-that-is-at-least-32-characters",
};
```

`scripts/e2e-server.mjs`:

```js
// The end-to-end server (playwright.config.ts): a fresh PGlite folder, then `next dev` on the given port.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

rmSync(".data/e2e", { recursive: true, force: true });
const server = spawn(`npx next dev -p ${process.env.PORT}`, { stdio: "inherit", shell: true });
server.on("exit", (code) => process.exit(code ?? 0));
```

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
import { E2E } from "./tests/e2e/env";

const origin = `http://localhost:${E2E.port}`;

/** Spec 14: one end-to-end run, against its own development server and database. */
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: origin,
    // PLAYWRIGHT_CHANNEL=chrome (or msedge) uses an installed browser instead of Playwright's own Chromium.
    channel: process.env.PLAYWRIGHT_CHANNEL,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${origin}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      PORT: String(E2E.port),
      DATABASE_URL: "pglite:.data/e2e",
      APP_URL: origin,
      BETTER_AUTH_SECRET: E2E.secret,
      SETUP_TOKEN: E2E.setupCode,
    },
  },
});
```

- [ ] **Step 3: Write the run, `tests/e2e/visit.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { E2E } from "./env";

const origin = `http://localhost:${E2E.port}`;

/** The next quarter hour at least 15 minutes away, as "HH:MM" in Manila, or null when that is tomorrow. */
function nextSlot(): string | null {
  const manila = new Date(Date.now() + 8 * 3_600_000);
  const slot = Math.ceil((manila.getUTCHours() * 60 + manila.getUTCMinutes() + 15) / 15) * 15;
  return slot < 24 * 60 ? `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}` : null;
}

test("a visit from setup to completion", async ({ page, browser }) => {
  const slot = nextSlot();
  test.skip(slot === null, "The visit is booked for later today: run this before 23:30 Manila time.");

  // Setup (spec 6.1): the practice and its owner.
  await page.goto("/setup");
  await page.getByLabel("Setup code").fill(E2E.setupCode);
  await page.getByLabel("Practice name").fill("E2E Dental");
  await page.getByLabel("Your full name").fill("Dr. Olivia Owner");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("owner password 1");
  await page.getByLabel("Password again").fill("owner password 1");
  await page.getByRole("button", { name: "Set up DentaSync" }).click();
  await expect(page.getByRole("heading", { name: "All branches" })).toBeVisible();

  // A branch, a chair, and a procedure through the API, as the owner (the Settings screens have their own checks).
  const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, { open: "09:00", close: "18:00" }]));
  const post = (path: string, data: object) => page.request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect((await post("/branches", { code: "downtown", name: "Downtown", address: "", phone: "", operatingHours: hours })).ok()).toBe(true);
  expect((await post("/branches/downtown/chairs", { label: "General" })).ok()).toBe(true);
  expect((await post("/procedures", { name: "Consultation", durationMinutes: 30, bufferMinutes: 10 })).ok()).toBe(true);

  // A dentist asks to join with the branch's QR (spec 6.3), in a browser of their own.
  await page.goto("/poster/downtown");
  const joinUrl = ((await page.getByText("/join/").textContent()) ?? "").trim();
  const dentist = await (await browser.newContext({ baseURL: origin })).newPage();
  await dentist.goto(joinUrl);
  await dentist.getByLabel("Your full name").fill("Dr. Dana Dentist");
  await dentist.getByLabel("Username").fill("dr.dana");
  await dentist.getByLabel("Password", { exact: true }).fill("dentist password 1");
  await dentist.getByLabel("Password again").fill("dentist password 1");
  await dentist.getByLabel("Dentist or hygienist").check();
  await dentist.getByRole("button", { name: "Ask for an account" }).click();
  await expect(dentist).toHaveURL(/\/waiting/);

  // The owner approves (spec 6.4).
  await page.goto("/all/staff");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("cell", { name: "Dr. Dana Dentist" })).toBeVisible();

  // The owner books a new patient for later today (spec 10, the booking panel). The dentist has no weekly schedule
  // yet, so the booking needs "Book anyway".
  await page.goto("/downtown/calendar");
  await page.getByRole("button", { name: "New booking" }).click();
  const booking = page.getByRole("dialog", { name: "New booking" });
  await booking.getByRole("button", { name: "Add a new patient" }).click();
  const addPatient = page.getByRole("dialog", { name: "Add a patient" });
  await addPatient.getByLabel("Last name").fill("Santos");
  await addPatient.getByLabel("First name").fill("Ana");
  await addPatient.getByRole("button", { name: "Add patient" }).click();
  await expect(booking.getByText("Santos, Ana")).toBeVisible();
  await booking.getByLabel("Consultation, 30 min").check();
  await booking.getByRole("button", { name: "Pick another time" }).click();
  await booking.getByLabel("Start").fill(slot ?? "");
  await booking.getByLabel("Dentist for this visit").selectOption({ label: "Dr. Dana Dentist" });
  await booking.getByLabel("Chair").selectOption({ label: "Chair 1 · General" });
  await booking.getByRole("button", { name: "Book anyway" }).click();
  await expect(page.getByText("Booked.")).toBeVisible();

  // The front desk checks the patient in (spec 8.6).
  await page.getByRole("button", { name: /Santos, Ana/ }).click();
  const visit = page.getByRole("dialog", { name: "Santos, Ana" });
  await visit.getByRole("button", { name: "Check in" }).click();
  await expect(visit.getByText("Checked in", { exact: true })).toBeVisible();

  // The dentist starts treatment from My day, charts a tooth, fills in the exam, writes a note, and completes the visit.
  await dentist.goto("/login");
  await dentist.getByLabel("Username").fill("dr.dana");
  await dentist.getByLabel("Password").fill("dentist password 1");
  await dentist.getByRole("button", { name: "Sign in" }).click();
  await expect(dentist).toHaveURL(/\/downtown\/my-day/);
  await dentist.getByRole("button", { name: "Start treatment" }).click();
  await expect(dentist.getByText("In treatment", { exact: true })).toBeVisible();
  await dentist.getByRole("link", { name: "Open chart" }).click();
  await dentist.getByRole("button", { name: "Tooth 16, nothing charted" }).click();
  const tooth = dentist.getByRole("dialog", { name: "Tooth 16" });
  await tooth.getByLabel("Code").selectOption("Co");
  await tooth.getByLabel("Occlusal").check();
  await tooth.getByRole("button", { name: "Add to the chart" }).click();
  await expect(tooth.getByText("Tooth 16: Composite filling on occlusal")).toBeVisible();
  await dentist.keyboard.press("Escape");
  await dentist.getByLabel("Gingivitis").check();
  await dentist.getByRole("button", { name: "Save the exam" }).click();
  await expect(dentist.getByText("Exam saved.")).toBeVisible();
  await dentist.getByRole("tab", { name: "Notes" }).click();
  await dentist.getByLabel("Note", { exact: true }).fill("Consultation done. Composite on 16.");
  await dentist.getByRole("button", { name: "Add the note" }).click();
  await expect(dentist.getByText("Consultation done. Composite on 16.")).toBeVisible();
  await dentist.goto("/downtown/my-day");
  await dentist.getByRole("button", { name: "Complete" }).click();
  await expect(dentist.getByText("Completed", { exact: true })).toBeVisible();
});
```

- [ ] **Step 4: Run it**

Stop `npm run dev` if it is running (both servers would share `.next`). Playwright needs a browser once: `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL` to use an installed Chrome or Edge.

```powershell
$env:PLAYWRIGHT_CHANNEL = "chrome"; npm run test:e2e
```

Expected: `1 passed` (the first compile of each page in the dev server makes the run take a few minutes).

- [ ] **Step 5: Replace `README.md`**

````markdown
# DentaSync

Appointments, chairs, and dental charts for a dental practice with three branches in the Philippines.

- Spec: `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`
- Plans: `docs/superpowers/plans/`

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `BETTER_AUTH_SECRET` and `SETUP_TOKEN`.
3. `npm run seed` fills `.data/dev` with 3 branches, staff, 40 patients, two weeks of visits, and chart entries, exams, and notes on past visits, and prints the sign-in usernames and password once. Run it while the dev server is stopped. To start over, delete `.data/dev` and run it again.
4. `npm run dev`, then open http://localhost:3700. The database migrates itself. Without the seed, open `/setup` to create the owner.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm run seed` | Development data (PGlite only) |
| `npm test` | Unit and database tests (PGlite, no network) |
| `npm run test:e2e` | The end-to-end run, below |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run db:migrate` | Applies `drizzle/` to the Postgres in `DATABASE_URL` (production) |

## The end-to-end run

`npm run test:e2e` starts its own dev server on port 3701 with a fresh database in `.data/e2e` and walks one visit through setup, a QR join, approval, booking, check-in, start of treatment, charting a tooth, the exam, a note, and completion.

- Stop `npm run dev` first; both would share `.next`.
- Playwright needs a browser once: `npx playwright install chromium`. Or use an installed Chrome or Edge: `$env:PLAYWRIGHT_CHANNEL = "chrome"` in PowerShell, `PLAYWRIGHT_CHANNEL=chrome` elsewhere.
- The visit is booked for the next quarter hour, so run it before 23:30 Manila time.

## Going live

Spec section 16 holds the decisions. The steps:

1. **Database.** Create a Postgres 17 database in Singapore (Neon Free to start). From a trusted computer, apply the migrations: `$env:DATABASE_URL = "postgres://..."; npm run db:migrate` in PowerShell, or `DATABASE_URL="postgres://..." npm run db:migrate`. Run it again after any release that adds a file under `drizzle/`, before that release goes out.
2. **App.** Deploy the repository to Netlify (the free plan allows commercial use; it pauses the site when the month's credits run out, so batch releases about weekly) or to Vercel Pro. The build command is `npm run build`. Set four environment variables: `DATABASE_URL`; `BETTER_AUTH_SECRET` and `SETUP_TOKEN`, each 32 or more random characters, the setup code kept private; and `APP_URL`, the site's https origin with no trailing slash. The server refuses to start if any is missing or if `DATABASE_URL` points at PGlite. The sign-in and join limits count per visitor, by the address in a header the host sets and never takes from the visitor: Netlify's `x-nf-client-connection-ip`, or `x-real-ip` on Vercel (found on its own there). On any other host, set `CLIENT_IP_HEADER` to that host's header.
3. **First run.** Open `/setup` with the setup code to create the practice and the owner. In Settings, add the real branches, hours, chairs, and procedures, then each dentist's weekly schedule, and print each branch's QR poster for its staff room.
4. **Backups.** Every night, dump the database and encrypt the dump with a key only the owner holds, then keep it away from the database host:

   ```bash
   pg_dump --format=custom "$DATABASE_URL" | gpg --symmetric --cipher-algo AES256 --output "dentasync-$(date +%F).dump.gpg"
   ```

   Before going live, restore one backup into a scratch database (`gpg --decrypt dentasync-DATE.dump.gpg | pg_restore --dbname "$SCRATCH_DATABASE_URL"`) and note how long it took.
5. **Before go-live.** The practice's real branch names, addresses, phones, hours, and chair labels; the procedure list with durations and turnover; the dentists' check of the PDA legend, surfaces, and exam items; the privacy notice and consent form, reviewed by a lawyer, saying the data is kept in Singapore (RA 10173); and the printed QR posters.
6. **After go-live.** The owner reads the access log in Settings. When someone leaves, disable them on the Staff page: it signs them out at once and lists their upcoming visits to move.
````

- [ ] **Step 6: Commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "test: add the end-to-end visit run, and document going live" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
