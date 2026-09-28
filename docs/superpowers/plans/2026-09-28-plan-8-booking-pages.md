# BrightSmile Plan 8: The Booking Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of the booking flow and branches spec exists on top of plan 7's engine. The public booking page opens on three choices (book, reschedule or edit, cancel) with the clinic's branches, their addresses, and map links, and each path starts with the patient's number and code; booking runs through branch, who, the new patient form and waiver, services, date and time at the branch, and a summary with a Change button per part and one "Send request"; reschedule or edit and cancel run through the number's upcoming appointments. The page only renders plan 7's reducer and calls plan 7's actions. The old booking sheet and its code path are gone. The owner manages branches in Settings, with the combined short name check for texts; with 2 or more active branches the dashboard names and filters by branch, New appointment and the working hours ask for it, and "Outside hours" is per branch. Staff read the patient form on the patient page, the Privacy Notice explains health information, and the patient link page names the branch.

**Architecture:** `src/app/[slug]/BookingFlow.tsx` is the page's one Client Component: `useReducer(flow, START)` holds every choice, each step renders from `state.step`, and each server answer becomes a reducer action (`code_sent`, `verified`, `taken`, `done`), so the page never picks a step. A branch's dentists, hours, and procedures come from a new `getBranch` action when a patient picks it; `TimeStep` wraps the existing `MonthSheet` and slot grid and asks `getOpenDates` and `getOpenStarts` for the chosen branch or, while changing, for the appointment's own branch. The long patient form is its own component, loaded with `next/dynamic` only when its step opens, and checks itself with plan 7's `parseIntakeForm` (the server parses again). Settings > Branches is owner-only server code in `src/lib/clinic-settings.ts` behind `requireOwner` actions, with the text name checks as pure functions in `src/lib/branches.ts`. The dashboard's loaders take an optional branch filter, `hoursByDentist` keys hours by dentist and branch, and New appointment passes the branch through `openTimes` and `create_booking`. The patient page reads the form's columns through the staff member's RLS client and shapes them with a pure `formView`. Nothing new runs with the secret key except `getBranch`, which returns the same public data the booking page already loads with it.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions, `next/dynamic`, `Link`, `next/form`), React 19.2 (`useReducer`, `startTransition`), TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5 with `react-dom/server` (installed with React) for render tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`: sections 2 (on the pages: the code after the number, Confirm means send, changed services re-check the time, the branch fixed when rescheduling), 3.1 to 3.5 (every page), 4 (the dashboard with 2 or more branches, Settings > Branches, the text name check), 6 (the form and waiver on the page, "In the dashboard", the Privacy Notice paragraph), 7 (the page renders the reducer), 8, and 10 (unit and render tests; the pages are checked by typecheck, build, and review). Plan 7 built everything else (its "Deferred to plan 8" list is this plan). It builds on `docs/superpowers/specs/2026-09-26-brightsmile-teams-reports-design.md` (4 roles: owner-only setup), `docs/superpowers/specs/2026-09-25-brightsmile-billing-design.md` (7.5 the paused notice), and `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (5.1 the booking page, 5.2 the patient link, 5.3 the dashboard, 12 privacy, 13 outside hours).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| Lazy loading a Client Component with `next/dynamic` and a loading fallback (the patient form's code loads only when its step opens) | `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` (sections "`next/dynamic`", "Adding a custom loading component") |
| Server Actions are dispatched one at a time per client (so the page asks for the number's patients, then its appointments, one after the other); public POST endpoints; untrusted arguments | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (sections "Sequential dispatch on the client", "Security") |
| Calling a Server Function from an event handler, and from `useEffect` inside `startTransition` (the time step's loads) | `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` (sections "Event Handlers", "useEffect") |
| `"use server"` files export only async functions; each authenticates and authorizes itself (`getBranch` returns public data only; the Settings actions pass `requireOwner`) | `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` |
| `refresh()` after a Settings save | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` |
| `Link` and `next/form` for the dashboard's branch filter (a branch id in the query string, never patient data) | `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`, `node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/[slug]/actions.ts"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer (CONTRIBUTING.md). The commit commands in this plan leave it out; add `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the final `-m` paragraph of every commit. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-8-booking-pages`, which sits on `plan-7-booking-flow` (its PR is still open), which sits on `plan-6-teams` and `plan-5-billing` (their PRs are still open), one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's or the browser's time zone: dates come from `src/lib/time.ts` (`manilaDate`, `formatDate`, `formatTime`, `addDays`), and the booking page gets "now" from the server (`nowIso`), as today.
- Branches (spec 4): "the first active branch" always means `order by sort, created_at, id` among active branches. Every page looks exactly as today while a clinic has one active branch; the branch shows, filters, and is asked for only once it has 2 or more.
- The flow (spec 7): `BookingFlow` renders the reducer's step and dispatches what the server answered or what the patient chose. It never decides a step itself, and it never changes `src/lib/booking-flow.ts`.
- The number comes first (spec 2.1, 8): no patient name, form, or appointment shows before the number is verified on this phone, and plan 7's actions check the verified-device cookie and every row again on each call. A lapsed clinic shows the paused notice instead of the three buttons (billing spec 7.5).
- Health information (RA 10173): the form's answers live in React state until "Send request" or "Send changes" and the reducer drops them at `done`; they never go into a URL, a query string, a log, a text, or a push. The dashboard shows them read only to the clinic's members (`requireStaff`, the existing patients policy). Never log patient details, numbers, codes, forms, tokens, secrets, keys, or environment values; error logs carry where it failed and the message only.
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies); owner-only settings pass `requireOwner` first. The secret-key client stays where no staff session exists (the public booking page's actions, which now include `getBranch`, and the patient link) and behind `requireOperator`. Nothing else.
- Server Actions are public POST endpoints: each one re-validates every argument on the server, whatever a form already checked.
- No new migration: plan 7's migration already has everything these pages need (`branches` with the owner's write policies, its column grants, and the last active branch trigger; `branch_id` on working hours and appointments; the form's columns; `create_booking`'s `p_branch_id`). Nothing in this plan runs SQL against Supabase.
- UI: reuse the classes in `src/app/globals.css` and the existing components' patterns (`Field`, `MonthSheet`, `member-row`, `cf-box`/`cf-row`, `note-box`, `chip`, the settings editors). Phone first at 360px wide; every target at least 44px (`.btn`, `member-row`, `min-h-11` on text buttons); status never by colour alone (every chip carries a word); one primary button per screen; plain short copy in the product's voice.
- Tests: the unit suite and `tests/sql` run with `npm test`. Page tests render with `react-dom/server`'s `renderToStaticMarkup` and `createElement` in `.ts` files (Vitest includes `tests/**/*.test.ts` only) and mock the page's Server Actions. There is no development Supabase project: `tests/db` and the Playwright test cannot run, and they must keep typechecking. This plan edits them only where the code they call changes (the booking service test, the Playwright walk, and two hours assertions).
- Never use the app locally in this plan: `.env.local` points at production. The pages are checked by typecheck, lint, the unit and render tests, and a build, then walked on production after the deploy.
- Dependencies added: none.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. Clinic dashboard (done).
4. Launch readiness (done).
5. Billing (done; its PR is open).
6. Teams and reports (done; its PR is open).
7. Branches and the booking engine (done; its PR is open, and this branch sits on it).
8. **The booking pages (this plan):** the patient form, the booking page's main page and its three paths, removing the old booking path, Settings > Branches, the dashboard with branches, working hours at each branch, the patient form on the patient page, the Privacy Notice paragraph, the branch on the patient link page, and the README. Deliverable: the whole booking flow and branches spec is built; a clinic with one branch sees the new booking page and nothing else new until it adds a branch.

## File map for this plan

| File | Responsibility |
|---|---|
| `src/app/[slug]/BookingFlow.tsx` | The booking page's Client Component: the main page and every step of the three paths, rendered from the flow reducer |
| `src/app/[slug]/TimeStep.tsx` | Date and time: `MonthSheet` and the day's open times at a branch, or at a changed appointment's branch |
| `src/app/[slug]/PatientForm.tsx` | The new patient form and waiver (spec 6), loaded with `next/dynamic` |
| `src/app/[slug]/actions.ts` | `getBranch`; `requestBooking` and `verifyBookingCode` removed |
| `src/app/[slug]/page.tsx` | Renders `BookingFlow` |
| `src/app/[slug]/BookingSheet.tsx` | Deleted |
| `src/lib/intake.ts` | `NO_ANSWERS`, `QUESTIONS`, `WOMEN_QUESTIONS`, `intakeInput` |
| `src/components/Field.tsx` | `required`: the word Required beside a label |
| `src/lib/booking.ts`, `src/lib/booking-input.ts`, `src/lib/number-booking.ts` | The old booking path removed; `spendCode` for verification codes only |
| `src/lib/validate.ts`, `src/lib/branches.ts` | Branch limits; `activeBranchesProblem`, `clinicSmsNameProblem` |
| `src/lib/settings-input.ts` | `parseBranch` |
| `src/lib/clinic-settings.ts` | Branches in the Settings view, `saveBranch`, `setBranchActive`, `moveBranch`, the profile's text name check (and no more address copying), hours per branch |
| `src/app/app/settings/actions.ts`, `BranchEditor.tsx`, `ClinicForms.tsx`, `page.tsx`, `DentistEditor.tsx` | Settings > Branches; the profile without its map link input; the branch of each working block |
| `src/components/HoursEditor.tsx` | A branch for each block once there are 2 or more branches |
| `src/lib/schedule.ts`, `src/lib/dashboard.ts` | Hours by dentist and branch, outside hours per branch, the branch filter, `loadBranches`, branches for New appointment |
| `src/lib/staff-input.ts`, `src/lib/appointment-actions.ts`, `src/app/app/actions.ts`, `src/app/app/SlotPicker.tsx`, `src/app/app/new/NewAppointment.tsx` | New appointment at a branch |
| `src/app/app/schedule/page.tsx`, `src/app/app/requests/page.tsx` | The branch on each card and the branch filter |
| `src/lib/patients.ts`, `src/app/app/patients/[id]/page.tsx` | `formView` and the Patient form section |
| `src/app/privacy/page.tsx` | The health information paragraph |
| `src/lib/patient-link.ts`, `src/app/a/[token]/page.tsx` | The branch on the patient link page |
| `README.md` | The booking pages and adding a branch |
| `tests/unit/patient-form.test.ts`, `booking-page.test.ts`, `branch-settings.test.ts`, `hours-editor.test.ts`, `patient-form-view.test.ts`, `privacy.test.ts`, `patient-link.test.ts` | New tests |
| `tests/unit/intake.test.ts`, `booking-input.test.ts`, `booking-paused.test.ts`, `branches.test.ts`, `settings-input.test.ts`, `settings-actions.test.ts`, `schedule.test.ts`, `staff-input.test.ts`, `appointment-actions.test.ts` | Updated tests |
| `tests/db/booking-service.test.ts`, `tests/db/clinic-settings.test.ts`, `tests/e2e/booking.spec.ts` | Moved to the new path and shapes (they cannot run without a development project) |

## Tasks

1. The new patient form and waiver
2. The booking page: main page and its three paths
3. Remove the old booking path
4. Settings > Branches
5. The dashboard with branches: Schedule, Requests, and New appointment
6. Working hours at each branch
7. The patient page's Patient form
8. Health information in the Privacy Notice
9. The patient link names the branch
10. README and final verification

---
### Task 1: The new patient form and waiver

**Files:**
- Create: `src/app/[slug]/PatientForm.tsx`, `tests/unit/patient-form.test.ts`
- Modify: `src/lib/intake.ts`, `tests/unit/intake.test.ts`, `src/components/Field.tsx`

**Interfaces:**
- Consumes: `ALLERGIES`, `CONDITIONS`, `INTAKE_LIMITS`, `ageOn`, `parseIntakeForm`, `type IntakeForm`, `type Medical`, `type Allergy`, `type Condition` from `@/lib/intake` (plan 7); `waiverText` from `@/lib/waiver`; `HMO_SUGGESTIONS` from `@/lib/booking-input`; `localMobile` from `@/lib/phone`; `Field` from `@/components/Field`.
- Produces:
  - From `@/lib/intake` (pure, safe in the browser): `NO_ANSWERS: Medical`, `type Question = { key; label; detail?: { key; label } }`, `QUESTIONS: Question[]`, `WOMEN_QUESTIONS: Question[]`, `intakeInput(f: IntakeForm): Record<string, unknown>` (what `bookForNumber` and `changeForNumber` take back: `parseIntakeForm(intakeInput(f), today)` gives `{ ok: true, form: f }`)
  - `Field` gains `required?: boolean` (the word Required beside the label)
  - Default export `PatientForm({ clinicName: string; mobile: string; today: string; initial: IntakeForm | null; onDone: (form: IntakeForm) => void; onBack: () => void })`, a Client Component that Task 2 loads with `next/dynamic`

Rules (spec 3.3 step 4, spec 6, spec 8):
- Short sections on one scrolling screen, in spec 6's order: Patient, Parent or guardian, HMO or dental insurance, Dental history, Medical history, Emergency contact, Waiver and consent. Required fields carry the word "Required" (last name, first name, birthday, sex, home address, the typed signature, and the parent or guardian while the patient is under 18 today); everything else may stay empty, and the form says so.
- The verified number shows read only; the form has no field that changes it. The Yes or No questions are radio pairs with the answer in words; a detail box opens beside a Yes (and beside an Other tick). The women's questions show only when Female is chosen. The waiver shows `waiverText(clinicName)`, then "I have read and agree", then the typed full name.
- The form checks itself with `parseIntakeForm`, the parser the server runs again, and hands the parsed form to the flow. It stores nothing, logs nothing, and puts nothing in a URL. The medical question labels live in `@/lib/intake` so the dashboard's patient page (Task 7) shows the same words.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/intake.test.ts`, replace:

```ts
import { ageOn, formColumns, parseIntakeForm, parseMedical, type Medical } from "@/lib/intake";
```

with:

```ts
import { ageOn, formColumns, intakeInput, NO_ANSWERS, parseIntakeForm, parseMedical, QUESTIONS, WOMEN_QUESTIONS, type Medical } from "@/lib/intake";
```

Append to the end of `tests/unit/intake.test.ts`:

```ts

describe("intakeInput", () => {
  it("gives the server back a form it parses to the same form", () => {
    const result = parseIntakeForm(adult, today);
    if (!result.ok) throw new Error("the adult form should parse");
    expect(parseIntakeForm(intakeInput(result.form), today)).toEqual(result);
  });
});

describe("the form's questions", () => {
  it("start with nothing answered and ask every Yes or No question once", () => {
    expect(NO_ANSWERS).toEqual(EMPTY_MEDICAL);
    const keys = [...QUESTIONS, ...WOMEN_QUESTIONS].map((q) => q.key).sort();
    expect(keys).toEqual(["birthControl", "goodHealth", "hospitalized", "nursing", "pregnant", "seriousIllness", "takingMedicine", "tobacco", "underTreatment"]);
  });
});
```

Create `tests/unit/patient-form.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PatientForm from "@/app/[slug]/PatientForm";
import { parseIntakeForm, type IntakeForm } from "@/lib/intake";

// The form renders without a browser: what a patient sees first, for a new form and for one filled earlier.
const today = "2026-09-28";
const base = { last: "Cruz", first: "Ana", birthday: "1990-05-17", sex: "female", address: "Makati", agree: true, signature: "Ana Cruz" };

function filled(extra: Record<string, unknown>): IntakeForm {
  const parsed = parseIntakeForm({ ...base, ...extra }, today);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.form;
}

function render(initial: IntakeForm | null): string {
  const props = { clinicName: "Bright Dental", mobile: "+639171112222", today, initial, onDone: () => {}, onBack: () => {} };
  return renderToStaticMarkup(createElement(PatientForm, props));
}

const marks = (html: string) => html.split(">Required<").length - 1;

describe("the new patient form", () => {
  it("marks the required fields in words, shows the verified number read only, and names the clinic in the waiver", () => {
    const html = render(null);
    // Last name, first name, birthday, sex, home address, and the signature.
    expect(marks(html)).toBe(6);
    expect(html).toContain('readOnly="" value="09171112222"');
    expect(html).toContain("I allow the dentists of Bright Dental to examine me");
    expect(html).toContain("I have read and agree");
    for (const section of ["Patient", "Parent or guardian", "HMO or dental insurance", "Dental history", "Medical history", "Emergency contact", "Waiver and consent"]) {
      expect(html).toContain(`>${section}</h3>`);
    }
  });

  it("asks the women's questions only when the patient is female", () => {
    expect(render(filled({}))).toContain("Are you pregnant?");
    expect(render(filled({ sex: "male" }))).not.toContain("Are you pregnant?");
    expect(render(null)).not.toContain("Are you pregnant?");
  });

  it("needs a parent or guardian while the patient is under 18 today", () => {
    expect(marks(render(filled({ birthday: "2015-01-01", guardian: "Ben Cruz" })))).toBe(7);
    expect(marks(render(filled({ birthday: "2008-09-28" })))).toBe(6);
  });

  it("opens a detail box beside a Yes and an Other tick", () => {
    const html = render(filled({ medical: { takingMedicine: true, medicineDetail: "Losartan", allergies: ["other"], allergyOther: "Shrimp" } }));
    expect(html).toContain("Which medicine?");
    expect(html).toContain('value="Losartan"');
    expect(html).toContain("Which other allergy?");
    expect(html).not.toContain("For what condition?");
  });
});
```

Run: `npx vitest run tests/unit/intake.test.ts tests/unit/patient-form.test.ts`
Expected: FAIL: `patient-form.test.ts` with `Cannot find package '@/app/[slug]/PatientForm'`, and in `intake.test.ts` the two new tests (`TypeError: intakeInput is not a function`, and `expected undefined to deeply equal` for `NO_ANSWERS`). The other 17 intake tests pass.

- [ ] **Step 2: Share the form's questions and give the server its form back**

In `src/lib/intake.ts`, replace:

```ts
/** The patient form (spec 6) as create_booking stores it. The patient's mobile is the verified number, never a field here. */
```

with:

```ts
/** Nothing answered yet: where a new form starts (spec 6 marks only its required fields). */
export const NO_ANSWERS: Medical = {
  goodHealth: null,
  underTreatment: null,
  treatmentCondition: null,
  seriousIllness: null,
  illnessDetail: null,
  hospitalized: null,
  hospitalDetail: null,
  takingMedicine: null,
  medicineDetail: null,
  tobacco: null,
  allergies: [],
  allergyOther: null,
  pregnant: null,
  nursing: null,
  birthControl: null,
  conditions: [],
  conditionOther: null,
};

/** A Yes or No question of the medical history, and the detail box its Yes opens (spec 6, item 5). */
export type Question = {
  key: "goodHealth" | "underTreatment" | "seriousIllness" | "hospitalized" | "takingMedicine" | "tobacco" | "pregnant" | "nursing" | "birthControl";
  label: string;
  detail?: { key: "treatmentCondition" | "illnessDetail" | "hospitalDetail" | "medicineDetail"; label: string };
};

/** The questions every patient answers, in the form's order. The public form and the dashboard both read these. */
export const QUESTIONS: Question[] = [
  { key: "goodHealth", label: "Are you in good health?" },
  { key: "underTreatment", label: "Are you under medical treatment now?", detail: { key: "treatmentCondition", label: "For what condition?" } },
  { key: "seriousIllness", label: "Have you had a serious illness or an operation?", detail: { key: "illnessDetail", label: "What was it?" } },
  { key: "hospitalized", label: "Have you been in the hospital?", detail: { key: "hospitalDetail", label: "When, and why?" } },
  { key: "takingMedicine", label: "Are you taking any medicine now?", detail: { key: "medicineDetail", label: "Which medicine?" } },
  { key: "tobacco", label: "Do you smoke or use tobacco?" },
];

/** Asked only when the patient is female (parseMedical keeps these answers for women only). */
export const WOMEN_QUESTIONS: Question[] = [
  { key: "pregnant", label: "Are you pregnant?" },
  { key: "nursing", label: "Are you nursing?" },
  { key: "birthControl", label: "Are you taking birth control pills?" },
];

/** The patient form (spec 6) as create_booking stores it. The patient's mobile is the verified number, never a field here. */
```

Append to the end of `src/lib/intake.ts`:

```ts

/**
 * A parsed form as bookForNumber and changeForNumber take it back. The page keeps the parsed form in the flow; the
 * server parses it again, reading the tick and the typed name the way the form sends them. The waiver's version is
 * always the server's own.
 */
export function intakeInput(f: IntakeForm): Record<string, unknown> {
  return { ...f, agree: true, signature: f.waiverName };
}
```

- [ ] **Step 3: Let a field say Required**

In `src/components/Field.tsx`, replace:

```tsx
/** A labelled field: the label wraps the input, then a hint or an error below it. */
export default function Field({
  label,
  children,
  error,
  optional,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="f-label">
        {label}
        {optional && <span className="f-optional">Optional</span>}
```

with:

```tsx
/** A labelled field: the label wraps the input, then a hint or an error below it. The mark says Required or Optional in words. */
export default function Field({
  label,
  children,
  error,
  optional,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="f-label">
        {label}
        {required && <span className="f-optional">Required</span>}
        {optional && <span className="f-optional">Optional</span>}
```

- [ ] **Step 4: Write the form**

Create `src/app/[slug]/PatientForm.tsx`:

```tsx
"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import Field from "@/components/Field";
import { HMO_SUGGESTIONS } from "@/lib/booking-input";
import {
  ageOn,
  ALLERGIES,
  CONDITIONS,
  INTAKE_LIMITS,
  NO_ANSWERS,
  parseIntakeForm,
  QUESTIONS,
  WOMEN_QUESTIONS,
  type Allergy,
  type Condition,
  type IntakeForm,
  type Medical,
  type Question,
} from "@/lib/intake";
import { localMobile } from "@/lib/phone";
import { waiverText } from "@/lib/waiver";

type Props = {
  clinicName: string;
  /** The verified number ("+639..."): the patient's mobile, shown here and never changed (booking flow spec 3.3 step 4). */
  mobile: string;
  /** Manila's date, "YYYY-MM-DD". */
  today: string;
  /** The form as filled earlier in this visit, when the patient comes back to it from the summary. */
  initial: IntakeForm | null;
  onDone: (form: IntakeForm) => void;
  onBack: () => void;
};

/** What the inputs hold: exactly the keys parseIntakeForm reads. */
type Draft = {
  last: string;
  first: string;
  middle: string;
  birthday: string;
  sex: "" | "female" | "male";
  address: string;
  occupation: string;
  email: string;
  guardian: string;
  hmo: string;
  hmoNumber: string;
  previousDentist: string;
  lastVisit: string;
  visitReason: string;
  emergencyName: string;
  emergencyMobile: string;
  medical: Medical;
  agree: boolean;
  signature: string;
};

type TextKey = Exclude<keyof Draft, "sex" | "medical" | "agree">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function draftOf(f: IntakeForm | null): Draft {
  return {
    last: f?.last ?? "",
    first: f?.first ?? "",
    middle: f?.middle ?? "",
    birthday: f?.birthday ?? "",
    sex: f?.sex ?? "",
    address: f?.address ?? "",
    occupation: f?.occupation ?? "",
    email: f?.email ?? "",
    guardian: f?.guardian ?? "",
    hmo: f?.hmo ?? "",
    hmoNumber: f?.hmoNumber ?? "",
    previousDentist: f?.previousDentist ?? "",
    lastVisit: f?.lastVisit ?? "",
    visitReason: f?.visitReason ?? "",
    emergencyName: f?.emergencyName ?? "",
    emergencyMobile: f?.emergencyMobile ? localMobile(f.emergencyMobile) : "",
    medical: f?.medical ?? NO_ANSWERS,
    agree: f !== null,
    signature: f?.waiverName ?? "",
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="font-display text-[16px] font-bold">{title}</h3>
      {children}
    </section>
  );
}

/** A Yes or No question: two radio rows, the answer always in words. */
function YesNo({ question, value, onChange }: { question: Question; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="f-label">{question.label}</legend>
      <div className="flex gap-3">
        <label className="member-row flex-1">
          <input type="radio" name={question.key} checked={value === true} onChange={() => onChange(true)} />
          <span className="nm">Yes</span>
        </label>
        <label className="member-row flex-1">
          <input type="radio" name={question.key} checked={value === false} onChange={() => onChange(false)} />
          <span className="nm">No</span>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * The new patient form and waiver (booking flow spec 6): short sections on one scrolling screen, required fields marked
 * in words, and the answers checked here with the same parser the server runs again. Nothing is stored or logged here:
 * the parsed form goes to the flow, and it reaches the server only with "Send request" (or "Send changes").
 */
export default function PatientForm({ clinicName, mobile, today, initial, onDone, onBack }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = draft.medical;
  // Spec 6 item 2: the form comes before the visit date is chosen, so "under 18" is as of today.
  const minor = DATE.test(draft.birthday) && draft.birthday <= today && ageOn(draft.birthday, today) < 18;

  const text = (key: TextKey) => (e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  function answer<K extends keyof Medical>(key: K, value: Medical[K]) {
    setDraft((d) => ({ ...d, medical: { ...d.medical, [key]: value } }));
  }
  const toggle = <K extends Allergy | Condition>(list: K[], key: K) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  function submit() {
    const parsed = parseIntakeForm(draft, today);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    onDone(parsed.form);
  }

  const question = (q: Question) => {
    const detail = q.detail;
    return (
      <div key={q.key}>
        <YesNo question={q} value={m[q.key]} onChange={(value) => answer(q.key, value)} />
        {detail && m[q.key] === true && (
          <Field label={detail.label}>
            <input
              className="f-input"
              maxLength={INTAKE_LIMITS.detail}
              value={m[detail.key] ?? ""}
              onChange={(e) => answer(detail.key, e.target.value === "" ? null : e.target.value)}
            />
          </Field>
        )}
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="f-hint">Fields marked Required must be filled in. Everything else can stay empty. Only the clinic reads this form.</p>

      <Section title="Patient">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Last name" required error={errors.last}>
            <input className="f-input" autoComplete="family-name" maxLength={INTAKE_LIMITS.name} value={draft.last} onChange={text("last")} />
          </Field>
          <Field label="First name" required error={errors.first}>
            <input className="f-input" autoComplete="given-name" maxLength={INTAKE_LIMITS.name} value={draft.first} onChange={text("first")} />
          </Field>
        </div>
        <Field label="Middle name" error={errors.middle}>
          <input className="f-input" autoComplete="additional-name" maxLength={INTAKE_LIMITS.name} value={draft.middle} onChange={text("middle")} />
        </Field>
        <Field label="Birthday" required error={errors.birthday}>
          <input type="date" className="f-input" min="1900-01-01" max={today} value={draft.birthday} onChange={text("birthday")} />
        </Field>
        <fieldset className="mt-4">
          <legend className="f-label">
            Sex<span className="f-optional">Required</span>
          </legend>
          <div className="flex gap-3">
            <label className="member-row flex-1">
              <input type="radio" name="sex" checked={draft.sex === "female"} onChange={() => setDraft((d) => ({ ...d, sex: "female" }))} />
              <span className="nm">Female</span>
            </label>
            <label className="member-row flex-1">
              <input type="radio" name="sex" checked={draft.sex === "male"} onChange={() => setDraft((d) => ({ ...d, sex: "male" }))} />
              <span className="nm">Male</span>
            </label>
          </div>
          {errors.sex && <p className="field-err">{errors.sex}</p>}
        </fieldset>
        <Field label="Home address" required error={errors.address}>
          <input className="f-input" autoComplete="street-address" maxLength={INTAKE_LIMITS.address} value={draft.address} onChange={text("address")} />
        </Field>
        <Field label="Occupation" error={errors.occupation}>
          <input className="f-input" maxLength={INTAKE_LIMITS.occupation} value={draft.occupation} onChange={text("occupation")} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="f-input" type="email" inputMode="email" autoComplete="email" maxLength={254} value={draft.email} onChange={text("email")} />
        </Field>
        <Field label="Mobile number" hint="The number you verified. It can't be changed here.">
          <input className="f-input" value={localMobile(mobile)} readOnly />
        </Field>
      </Section>

      <Section title="Parent or guardian">
        <p className="f-hint">{minor ? "The patient is under 18, so a parent or guardian is needed." : "Needed when the patient is under 18."}</p>
        <Field label="Parent or guardian's name" required={minor} error={errors.guardian}>
          <input className="f-input" maxLength={INTAKE_LIMITS.guardian} value={draft.guardian} onChange={text("guardian")} />
        </Field>
      </Section>

      <Section title="HMO or dental insurance">
        <Field label="Provider" error={errors.hmo}>
          <input className="f-input" list="hmo-list" maxLength={INTAKE_LIMITS.hmo} value={draft.hmo} onChange={text("hmo")} />
          <datalist id="hmo-list">
            {HMO_SUGGESTIONS.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </Field>
        <Field label="Card or member number" error={errors.hmoNumber}>
          <input className="f-input" maxLength={INTAKE_LIMITS.hmoNumber} value={draft.hmoNumber} onChange={text("hmoNumber")} />
        </Field>
      </Section>

      <Section title="Dental history">
        <Field label="Previous dentist" error={errors.previousDentist}>
          <input className="f-input" maxLength={INTAKE_LIMITS.previousDentist} value={draft.previousDentist} onChange={text("previousDentist")} />
        </Field>
        <Field label="Last dental visit" hint="Month and year." error={errors.lastVisit}>
          <input type="month" className="f-input" min="1900-01" max={today.slice(0, 7)} value={draft.lastVisit} onChange={text("lastVisit")} />
        </Field>
        <Field label="Reason for this visit" error={errors.visitReason}>
          <input className="f-input" maxLength={INTAKE_LIMITS.visitReason} value={draft.visitReason} onChange={text("visitReason")} />
        </Field>
      </Section>

      <Section title="Medical history">
        {QUESTIONS.map(question)}
        <fieldset className="mt-5">
          <legend className="f-label">Allergies: tick any</legend>
          <div className="member-list">
            {(Object.keys(ALLERGIES) as Allergy[]).map((key) => (
              <label key={key} className="member-row">
                <input type="checkbox" checked={m.allergies.includes(key)} onChange={() => answer("allergies", toggle(m.allergies, key))} />
                <span className="nm">{ALLERGIES[key]}</span>
              </label>
            ))}
          </div>
          {m.allergies.includes("other") && (
            <Field label="Which other allergy?">
              <input
                className="f-input"
                maxLength={INTAKE_LIMITS.detail}
                value={m.allergyOther ?? ""}
                onChange={(e) => answer("allergyOther", e.target.value === "" ? null : e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {draft.sex === "female" && WOMEN_QUESTIONS.map(question)}
        <fieldset className="mt-5">
          <legend className="f-label">Tick any you have or had</legend>
          <div className="member-list">
            {(Object.keys(CONDITIONS) as Condition[]).map((key) => (
              <label key={key} className="member-row">
                <input type="checkbox" checked={m.conditions.includes(key)} onChange={() => answer("conditions", toggle(m.conditions, key))} />
                <span className="nm">{CONDITIONS[key]}</span>
              </label>
            ))}
          </div>
          {m.conditions.includes("other") && (
            <Field label="Which other condition?">
              <input
                className="f-input"
                maxLength={INTAKE_LIMITS.detail}
                value={m.conditionOther ?? ""}
                onChange={(e) => answer("conditionOther", e.target.value === "" ? null : e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {errors.medical && <p className="field-err">{errors.medical}</p>}
      </Section>

      <Section title="Emergency contact">
        <Field label="Name" error={errors.emergencyName}>
          <input className="f-input" maxLength={INTAKE_LIMITS.emergencyName} value={draft.emergencyName} onChange={text("emergencyName")} />
        </Field>
        <Field label="Mobile number" error={errors.emergencyMobile}>
          <input className="f-input" type="tel" inputMode="tel" placeholder="0917 123 4567" value={draft.emergencyMobile} onChange={text("emergencyMobile")} />
        </Field>
      </Section>

      <Section title="Waiver and consent">
        <div className="note-box mt-3">
          {waiverText(clinicName).map((p) => (
            <p key={p.title} className="mt-2 first:mt-0">
              <strong>{p.title}</strong> {p.text}
            </p>
          ))}
        </div>
        <label className="member-row mt-3">
          <input type="checkbox" checked={draft.agree} onChange={(e) => setDraft((d) => ({ ...d, agree: e.target.checked }))} />
          <span className="nm">I have read and agree</span>
        </label>
        {errors.agree && <p className="field-err">{errors.agree}</p>}
        <Field label="Patient's full name, as the signature" required hint="Typing the name signs the waiver." error={errors.signature}>
          <input className="f-input" autoComplete="name" maxLength={INTAKE_LIMITS.signature} value={draft.signature} onChange={text("signature")} />
        </Field>
        <p className="f-hint mt-3">
          How the clinic and BrightSmile keep this information:{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="link">
            Privacy Notice
          </a>
          .
        </p>
      </Section>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="note-box warn mt-6">
          Some answers need a look. They are marked above.
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          Continue
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Check and commit**

Run: `npx vitest run tests/unit/intake.test.ts tests/unit/patient-form.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: both test files PASS (`intake.test.ts` 19, `patient-form.test.ts` 4); `tsc` prints nothing; lint clean; every test PASS (49 files, 564 tests). The form is not on any page yet (Task 2 opens it).

```powershell
git add src/lib/intake.ts tests/unit/intake.test.ts src/components/Field.tsx "src/app/[slug]/PatientForm.tsx" tests/unit/patient-form.test.ts
git commit -m "feat: add the new patient form and waiver" -m "The form follows spec 6 in short sections on one screen: required fields say Required, the verified number shows read only, a detail box opens beside a Yes or an Other tick, the women's questions show only for a female patient, and a parent or guardian is required while the patient is under 18 today. The waiver names the clinic and needs the tick and the typed full name. The form checks itself with the server's own parser and keeps nothing; the medical questions live in the intake module for the dashboard too."
```

### Task 2: The booking page: main page and its three paths

**Files:**
- Create: `src/app/[slug]/BookingFlow.tsx`, `src/app/[slug]/TimeStep.tsx`, `tests/unit/booking-page.test.ts`
- Modify: `src/app/[slug]/actions.ts`, `src/app/[slug]/page.tsx`

**Interfaces:**
- Consumes: `flow`, `START`, `type FlowAction`, `type Path` from `@/lib/booking-flow` (plan 7); the actions `startVerification`, `checkVerification`, `resendBookingCode`, `numberPatients`, `numberAppointments`, `getOpenDates`, `getOpenStarts`, `bookForNumber`, `changeForNumber`, `cancelForNumber` (plan 7, `src/app/[slug]/actions.ts`); `type NumberPatient`, `type NumberAppointment`, `type Refused` from `@/lib/number-booking` (types only, erased from the browser bundle); `intakeInput` and `PatientForm` (Task 1); `MonthSheet` (existing); `loadClinic` from `@/lib/availability`; `pausedMessage` from `@/lib/billing`; `fitsAnyBlock`, `mergeWeeks`, `openStarts` from `@/lib/slots`.
- Produces:
  - Server Action `getBranch(slug: string, branchId: string): Promise<PublicClinic | null>` (the booking page at one active branch: public data, like the page)
  - Default export `BookingFlow({ clinic: PublicClinic; nowIso: string; paused: boolean })`, the page's Client Component
  - Default export `TimeStep({ slug, selection, dentist, duration, rules, nowIso, initialDate, initialStart, onPick, onBack })`
  - `/{slug}` renders `BookingFlow` instead of `BookingSheet` (Task 3 deletes the old sheet)

Rules (spec 2, 3.1 to 3.5, 7, 8):
- One `useReducer(flow, START)` holds the path, the step, and every choice. The page renders `state.step` and dispatches what it learned from the server (`code_sent`, `verified`, `taken`, `done`) or what the patient chose; it never picks a step itself. Back is the reducer's `back`; the main page is `home`.
- Main page: the clinic's name, "Book a visit, or change or cancel one you have.", the three buttons (Book an appointment is the page's one primary button), then every active branch with its address and a Map link where it has one. A lapsed clinic shows today's paused notice instead of the three buttons. A clinic with no active procedure (or no dentist at its only branch) says online booking isn't open yet and keeps the reschedule and cancel buttons.
- Number and code (spec 3.2): `startVerification` goes straight on for a number this phone verified before, or texts a code; the code step verifies with `checkVerification`, offers "Send another code" after the countdown (`resendBookingCode`, which answers `wait` with the seconds left), and words every refusal. After a verified number the page reads what the path needs (`numberPatients` for booking and changes, `numberAppointments` for changes and cancels) one action at a time, as Next dispatches them, then dispatches `verified`. A phone that did not keep the cookie gets "Allow cookies for this site".
- Booking: branch (skipped with one active branch: `start` carries `onlyBranchId`), who (the number's patients plus "Someone new"), the form, services (the branch's procedures and, with 2 or more dentists there, the dentist), date and time for the branch (`TimeStep`), the summary with a Change button on the patient, services, dentist, and time lines and one primary "Send request", then "Request sent" naming the branch, with the map link and the patient link. Changing the services while a time is chosen asks the server whether the time still fits (spec 2.3) and passes `timeFits`.
- Reschedule or edit: the number's upcoming appointments (patient, branch, date and time, services, status in words); an appointment within the minimum notice says "Please call the clinic to change it." and cannot be opened; "There is no upcoming appointment for this number." with a way back. Booking details show the same Change buttons; the branch stays fixed (spec 2.5) and says so; "Send changes" calls `changeForNumber`; "Changes sent. The clinic will confirm by text."
- Cancel: the list, "Cancel this appointment?" with its details, "No, keep it" (`keep`) and "Yes, cancel it" (`cancelForNumber`), then "Your appointment is cancelled." with a button back to the main page.
- A branch other than the page's first comes from `getBranch` when the patient picks it (or opens an appointment there), so its dentists, hours, and procedures are that branch's. A change at a branch that no longer takes online bookings asks the patient to call.
- Phone first: the form's code loads with `next/dynamic` only when its step opens; nothing new is installed. Health information stays in React state: the flow drops the form at `done`, nothing goes into the address bar, and nothing is logged. Headings take focus on each step for screen readers.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/booking-page.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BookingFlow from "@/app/[slug]/BookingFlow";
import type { PublicClinic } from "@/lib/booking-input";

// The page's first screen renders without a browser or a server: no action runs until a patient taps something.
vi.mock("@/app/[slug]/actions", () => ({}));

const makati = { id: "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92", name: "Makati", address: "12 Rizal St, Makati", mapsUrl: "https://maps.app.goo.gl/abc" };
const pasig = { id: "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03", name: "Pasig", address: "5 Ortigas Ave, Pasig", mapsUrl: null };
const clinic: PublicClinic = {
  id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: makati,
  branches: [makati, pasig],
  dentists: [{ id: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: [[], [{ start: 540, end: 1020 }], [], [], [], [], []] }],
  procedures: [{ id: "9e8d7c6b-5a49-4382-a716-151413121110", name: "Consultation", minutes: 30 }],
};

const render = (props: { clinic?: PublicClinic; paused?: boolean } = {}) =>
  renderToStaticMarkup(createElement(BookingFlow, { clinic, nowIso: "2026-09-28T02:00:00.000Z", paused: false, ...props }));

describe("the booking page's main page", () => {
  it("offers the three paths with booking as the one primary button", () => {
    const html = render();
    const book = html.indexOf("Book an appointment");
    expect(book).toBeGreaterThan(-1);
    expect(html.indexOf("Reschedule or edit a booking")).toBeGreaterThan(book);
    expect(html.indexOf("Cancel a booking")).toBeGreaterThan(html.indexOf("Reschedule or edit a booking"));
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toContain("Book a visit, or change or cancel one you have.");
  });

  it("lists every active branch with its address, and a map link where there is one", () => {
    const html = render();
    expect(html).toContain("Our branches");
    expect(html).toContain("12 Rizal St, Makati");
    expect(html).toContain("5 Ortigas Ave, Pasig");
    expect(html).toContain('href="https://maps.app.goo.gl/abc"');
    expect(html.match(/>Map</g)).toHaveLength(1);
  });

  it("shows a lapsed clinic's paused notice instead of the three buttons", () => {
    const html = render({ paused: true });
    expect(html).toContain("Bright Dental is not taking online requests right now. Call 09170000000 to book.");
    for (const button of ["Book an appointment", "Reschedule or edit a booking", "Cancel a booking"]) expect(html).not.toContain(button);
    expect(html).toContain("12 Rizal St, Makati");
  });

  it("says where to find a clinic with one branch", () => {
    const html = render({ clinic: { ...clinic, branches: [makati] } });
    expect(html).toContain("Where to find us");
    expect(html).not.toContain("Pasig");
  });
});
```

Run: `npx vitest run tests/unit/booking-page.test.ts`
Expected: FAIL with `Cannot find package '@/app/[slug]/BookingFlow'`.

- [ ] **Step 2: Load a branch for the page**

In `src/app/[slug]/actions.ts`, replace:

```ts
import { resolveSelection } from "@/lib/booking-input";
```

with:

```ts
import { resolveSelection, type PublicClinic } from "@/lib/booking-input";
```

In `src/app/[slug]/actions.ts`, replace:

```ts
/** Enabled days of a month: dates only, never busy times (spec 6). */
```

with:

```ts
/**
 * The booking page at one active branch: its dentists with their hours there, and the procedures (booking flow spec 3.3
 * step 1, 3.4 step 3). Public, like the page itself; null for a branch that is not one of the clinic's active ones.
 */
export async function getBranch(slug: string, branchId: string): Promise<PublicClinic | null> {
  if (typeof slug !== "string" || !isUuid(branchId)) return null;
  return loadClinic({ slug }, branchId);
}

/** Enabled days of a month: dates only, never busy times (spec 6). */
```

- [ ] **Step 3: Write the date and time step**

Create `src/app/[slug]/TimeStep.tsx`:

```tsx
"use client";

import { startTransition, useEffect, useState } from "react";
import MonthSheet from "./MonthSheet";
import { getOpenDates, getOpenStarts } from "./actions";
import type { PublicDentist } from "@/lib/booking-input";
import { openStarts, type BookingRules } from "@/lib/slots";
import { addDays, formatDate, formatTime, manilaDate, weekday } from "@/lib/time";

type Props = {
  slug: string;
  /** What the server checks the times for: the branch (or the appointment being changed), the dentist, and the services. The caller memoizes it. */
  selection: object;
  dentist: PublicDentist;
  duration: number;
  rules: BookingRules;
  nowIso: string;
  /** The day to open on: the chosen time's, or a time that was just taken. Null opens this month. */
  initialDate: string | null;
  /** The time chosen earlier, shown picked while it is still open. */
  initialStart: string | null;
  onPick: (startsAt: string) => void;
  onBack: () => void;
};

/**
 * Date and time (booking flow spec 3.3 step 6, 3.4 step 3): the month calendar and one day's open times for the dentist
 * at the selection's branch. The server answers dates and times only, never busy times. Each load belongs to the month
 * or day that asked for it, so a late answer for an earlier choice is dropped. Loads run in a transition, as Next's
 * docs call Server Functions from an effect.
 */
export default function TimeStep({ slug, selection, dentist, duration, rules, nowIso, initialDate, initialStart, onPick, onBack }: Props) {
  const now = new Date(nowIso);
  const today = manilaDate(now);
  const [month, setMonth] = useState((initialDate ?? today).slice(0, 7));
  const [monthOpen, setMonthOpen] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(initialDate);
  const [starts, setStarts] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(initialStart ? new Date(initialStart).toISOString() : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    startTransition(async () => {
      try {
        const open = await getOpenDates(slug, selection, month);
        if (live) setMonthOpen(open);
      } catch {
        if (live) {
          setMonthOpen([]);
          setFailed(true);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [slug, selection, month]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    startTransition(async () => {
      try {
        const list = await getOpenStarts(slug, selection, date);
        if (live) setStarts(list);
      } catch {
        if (live) {
          setStarts([]);
          setFailed(true);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [slug, selection, date]);

  const lastBookable = addDays(today, rules.maxDaysAhead);
  const closedWeekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => dentist.hours[d].length === 0);
  // Ignoring bookings: would any time today still fit before the hours or the minimum notice run out?
  const todayOutOfTime = openStarts({ date: today, blocks: dentist.hours[weekday(today)], busy: [], durationMinutes: duration, rules, now }).length === 0;
  const chosen = picked && starts?.includes(picked) ? picked : null;

  function chooseDay(day: string) {
    setDate(day);
    setStarts(null);
    setPicked(null);
  }

  function changeMonth(delta: number) {
    setMonth(addDays(`${month}-01`, delta > 0 ? 31 : -1).slice(0, 7));
    setMonthOpen(null);
    setDate(null);
    setStarts(null);
    setPicked(null);
  }

  return (
    <>
      {failed && (
        <p role="alert" className="note-box warn mb-4">
          Times are not loading right now. Please try again in a few minutes.
        </p>
      )}
      <MonthSheet
        month={month}
        today={today}
        lastBookable={lastBookable}
        openDates={monthOpen ?? []}
        loading={monthOpen === null}
        closedWeekdays={closedWeekdays}
        todayOutOfTime={todayOutOfTime}
        selected={date}
        onSelect={chooseDay}
        onMonth={changeMonth}
      />

      {date && (
        <div className="screen-in mt-6">
          <div className="mini-head">
            <p className="m font-display">{formatDate(new Date(`${date}T00:00:00+08:00`))}</p>
            {starts && (
              <span className="chip chip-brand">
                {starts.length} {starts.length === 1 ? "opening" : "openings"}
              </span>
            )}
          </div>
          {starts === null ? (
            <p className="empty-note" aria-live="polite">
              Checking times...
            </p>
          ) : starts.length === 0 ? (
            <p className="empty-note">Nothing left on this day.</p>
          ) : (
            <div className="slot-grid">
              {starts.map((iso) => (
                <button key={iso} type="button" onClick={() => setPicked(iso)} aria-pressed={iso === chosen} className={`slot ${iso === chosen ? "sel" : ""}`}>
                  {formatTime(new Date(iso))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary flex-1" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
          {chosen ? `Take ${formatTime(new Date(chosen))}` : "Pick a time"}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write the page's flow**

Create `src/app/[slug]/BookingFlow.tsx`:

```tsx
"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import Field from "@/components/Field";
import TimeStep from "./TimeStep";
import {
  bookForNumber,
  cancelForNumber,
  changeForNumber,
  checkVerification,
  getBranch,
  getOpenStarts,
  numberAppointments,
  numberPatients,
  resendBookingCode,
  startVerification,
} from "./actions";
import { pausedMessage } from "@/lib/billing";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
import { flow, START, type FlowAction, type Path } from "@/lib/booking-flow";
import { intakeInput } from "@/lib/intake";
import type { NumberAppointment, NumberPatient, Refused } from "@/lib/number-booking";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { fitsAnyBlock, mergeWeeks } from "@/lib/slots";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

// Only new patients see the form, and it is long, so its code loads when that step opens: a phone's first visit to the
// page stays light.
const PatientForm = dynamic(() => import("./PatientForm"), {
  loading: () => (
    <p className="empty-note" aria-live="polite">
      Opening the form...
    </p>
  ),
});

type Props = { clinic: PublicClinic; nowIso: string; paused: boolean };

const H2 = "font-display text-[19px] font-bold outline-none";
const UNAVAILABLE = "Booking is temporarily unavailable. Please try again in a few minutes.";
const MOBILE_HINT = "Enter a Philippine mobile number, like 0917 123 4567.";
const VERIFY_AGAIN = "Please enter your number again to continue.";
const CHANGED = "This appointment changed a moment ago. Here are your appointments now.";
const REFUSED: Record<Refused["status"], string> = {
  unverified: "This phone did not keep your verified number. Allow cookies for this site, then try again.",
  invalid: "This booking link doesn't exist.",
  unavailable: UNAVAILABLE,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** One line of a summary: what it is, its value, and its Change button when it can change (spec 3.3 step 7). */
function Row({ k, v, onChange }: { k: string; v: ReactNode; onChange?: () => void }) {
  return (
    <div className="cf-row items-center">
      <span className="k">{k}</span>
      <span className="v">
        {v}
        {onChange && (
          <button type="button" className="link ml-3 inline-flex min-h-11 items-center" aria-label={`Change the ${k.toLowerCase()}`} onClick={onChange}>
            Change
          </button>
        )}
      </span>
    </div>
  );
}

function Place({ name, address }: { name: string; address: string }) {
  return (
    <>
      {name}
      {address && <span className="f-hint block">{address}</span>}
    </>
  );
}

/**
 * Services (spec 3.3 step 5): the branch's active procedures, several allowed, and the dentist when the branch has 2 or
 * more. It starts from what the flow already holds, so a Change opens with the earlier choice.
 */
function ServicesStep({
  branch,
  initialIds,
  initialDentistId,
  editing,
  working,
  call,
  onDone,
  onBack,
}: {
  branch: PublicClinic;
  initialIds: string[];
  initialDentistId: string | null;
  editing: boolean;
  working: boolean;
  call: ReactNode;
  onDone: (procedureIds: string[], dentistId: string) => void;
  onBack: () => void;
}) {
  const [ids, setIds] = useState(() => initialIds.filter((id) => branch.procedures.some((p) => p.id === id)));
  const [dentistId, setDentistId] = useState(() =>
    branch.dentists.some((d) => d.id === initialDentistId) ? (initialDentistId as string) : branch.dentists.length === 1 ? branch.dentists[0].id : "",
  );
  const [query, setQuery] = useState("");
  const showDentist = branch.dentists.length > 1;
  const dentist = branch.dentists.find((d) => d.id === dentistId);
  const duration = branch.procedures.filter((p) => ids.includes(p.id)).reduce((sum, p) => sum + p.minutes, 0);
  const tooLong = duration > 0 && !fitsAnyBlock(duration, dentist ? dentist.hours : mergeWeeks(branch.dentists.map((d) => d.hours)));
  const search = query.trim().toLowerCase();
  const listed = search ? branch.procedures.filter((p) => p.name.toLowerCase().includes(search)) : branch.procedures;
  const back = (
    <button type="button" className="btn btn-ghost" onClick={onBack}>
      Back
    </button>
  );

  if (branch.dentists.length === 0 || branch.procedures.length === 0) {
    return (
      <>
        <p className="note-box">This branch isn&apos;t taking online bookings yet. Call {call} to book.</p>
        <div className="mt-6">{back}</div>
      </>
    );
  }

  return (
    <>
      {branch.procedures.length > 6 && (
        <input
          type="search"
          className="f-input mb-3"
          placeholder="Search procedures"
          aria-label="Search procedures"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="member-list">
        {listed.map((p) => (
          <label key={p.id} className="member-row">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={() => setIds((list) => (list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id]))}
              aria-label={`${p.name}, ${p.minutes} minutes`}
            />
            <span className="nm">{p.name}</span>
            <span className="meta">{p.minutes} min</span>
          </label>
        ))}
        {listed.length === 0 && <p className="empty-note">No procedure matches that search.</p>}
      </div>

      {showDentist && (
        <fieldset className="mt-5">
          <legend className="f-label">Dentist</legend>
          <div className="member-list">
            {branch.dentists.map((d) => (
              <label key={d.id} className="member-row">
                <input type="radio" name="dentist" value={d.id} aria-label={d.name} checked={dentistId === d.id} onChange={() => setDentistId(d.id)} />
                <span className="nm">{d.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="cf-row mt-4">
        <span className="k">Estimated time</span>
        <span className="v">{duration > 0 ? `${duration} min` : "Nothing chosen yet"}</span>
      </div>
      {tooLong && <p className="note-box warn mt-4">No single opening fits all of these. Choose fewer procedures or call {call}.</p>}

      <div className="mt-6 flex gap-3">
        {back}
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={working || duration === 0 || tooLong || !dentist}
          onClick={() => onDone(ids, dentistId)}
        >
          {duration === 0 ? "Pick what you need" : !dentist ? "Choose a dentist" : editing ? "Continue" : "Pick a day"}
        </button>
      </div>
    </>
  );
}

/**
 * The public booking page (booking flow spec 3): the main page and the paths to book, to reschedule or edit, and to
 * cancel. The page shows the flow reducer's step and calls the Server Actions with what the flow holds; the reducer
 * alone decides the next step (spec 7). The server checks the verified number and every row again on each call.
 * Nothing about a patient goes into the address bar, and the patient form stays in memory until it is sent.
 */
export default function BookingFlow({ clinic, nowIso, paused }: Props) {
  const [state, dispatch] = useReducer(flow, START);
  // The clinic as loaded at the branch in use: its dentists, their hours there, and the procedures.
  const [branch, setBranch] = useState<PublicClinic>(clinic);
  const [patients, setPatients] = useState<NumberPatient[]>([]);
  const [appointments, setAppointments] = useState<NumberAppointment[]>([]);
  const [picked, setPicked] = useState<NumberAppointment | null>(null);
  const [mobileText, setMobileText] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [token, setToken] = useState("");
  // The day of a time that stopped fitting (taken, or too short for new services), where the time step reopens.
  const [retryDate, setRetryDate] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const today = manilaDate(new Date(nowIso));
  const phone = localMobile(clinic.mobile);
  const call = (
    <a href={`tel:${clinic.mobile}`} className="link">
      {phone}
    </a>
  );
  // Words for the answers several actions share.
  const said = {
    limited: `Too many codes for now. Try again in an hour, or call ${phone}.`,
    sms_failed: `We couldn't send the code. Try again, or call ${phone}.`,
    paused: pausedMessage(clinic.name, phone),
    unavailable: UNAVAILABLE,
  };
  const closed = clinic.procedures.length === 0 || (clinic.branches.length === 1 && clinic.dentists.length === 0);
  const chosen = branch.procedures.filter((p) => state.procedureIds.includes(p.id));
  const duration = chosen.reduce((sum, p) => sum + p.minutes, 0);
  const dentist: PublicDentist | null = branch.dentists.find((d) => d.id === state.dentistId) ?? null;
  const start = state.startsAt ? new Date(state.startsAt) : null;
  const person = patients.find((p) => p.id === state.patientId);
  const patientName = state.form ? `${state.form.first} ${state.form.last}` : person ? `${person.first} ${person.last}` : "";
  const services = chosen.length > 0 ? `${chosen.map((p) => p.name).join(", ")} (${duration} min)` : "Choose again";
  const when = start ? `${formatDate(start)}, ${formatTime(start)}` : "Choose again";
  // What the server checks open times for: the chosen branch, or the appointment being changed (its own branch, its own
  // time counted as free). Memoized so the time step asks again only when the choice changes.
  const selection = useMemo(
    () =>
      state.path === "change"
        ? { changing: state.appointmentId, mobile: state.mobile, dentistId: state.dentistId, procedureIds: state.procedureIds }
        : { branchId: state.branchId, dentistId: state.dentistId, procedureIds: state.procedureIds },
    [state.path, state.appointmentId, state.mobile, state.branchId, state.dentistId, state.procedureIds],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  // The resend countdown starts where the code was sent, so nothing sets state straight from an effect.
  useEffect(() => {
    if (state.step !== "code") return;
    const tick = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [state.step]);

  function go(action: FlowAction) {
    setNotice("");
    setFieldError("");
    dispatch(action);
  }

  async function run(task: () => Promise<void>) {
    setWorking(true);
    setNotice("");
    try {
      await task();
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  function home() {
    setBranch(clinic);
    setPicked(null);
    setToken("");
    setRetryDate(null);
    go({ type: "home" });
  }

  /** The server no longer sees this number as verified on this phone (the cookie went): start again from the number. */
  function again() {
    home();
    setNotice(VERIFY_AGAIN);
  }

  function begin(path: Path) {
    setBranch(clinic);
    go({ type: "start", path, onlyBranchId: clinic.branches.length === 1 ? clinic.branch.id : null });
  }

  /** Spec 3.3 step 1: the branch's dentists and hours come with it. */
  function chooseBranch(id: string) {
    void run(async () => {
      const data = id === clinic.branch.id ? clinic : await getBranch(clinic.slug, id);
      if (!data) {
        setNotice(`That branch isn't taking online bookings now. Choose another, or call ${phone}.`);
        return;
      }
      setBranch(data);
      go({ type: "branch", branchId: id });
    });
  }

  /**
   * After the number is verified: the lists the path shows next (spec 3.3 step 3, 3.4 and 3.5 step 2). Next sends one
   * Server Action at a time from a page, so they are asked one after the other.
   */
  async function verified(mobile: string) {
    const people = state.path === "cancel" ? null : await numberPatients(clinic.slug, mobile);
    const visits = state.path === "book" ? null : await numberAppointments(clinic.slug, mobile);
    for (const outcome of [people, visits]) {
      if (outcome && outcome.status !== "ok") {
        setNotice(REFUSED[outcome.status]);
        return;
      }
    }
    const found = people?.status === "ok" ? people.patients : [];
    setPatients(found);
    setAppointments(visits?.status === "ok" ? visits.appointments : []);
    go({ type: "verified", mobile, hasPatients: found.length > 0 });
  }

  /** Spec 3.2: straight on for a number this phone verified before, otherwise a code by text. */
  function sendNumber() {
    const mobile = normalizeMobile(mobileText);
    if (!mobile) {
      setFieldError(MOBILE_HINT);
      return;
    }
    setFieldError("");
    void run(async () => {
      const outcome = await startVerification(clinic.slug, mobile);
      switch (outcome.status) {
        case "verified":
          return verified(outcome.mobile);
        case "code":
          setCode("");
          setResendIn(60);
          go({ type: "code_sent", mobile: outcome.mobile, requestId: outcome.requestId });
          return;
        case "invalid":
          setFieldError(MOBILE_HINT);
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  function checkCode() {
    const requestId = state.requestId;
    if (!/^\d{6}$/.test(code) || !requestId) {
      setFieldError("Enter the 6 digits from the text.");
      return;
    }
    setFieldError("");
    void run(async () => {
      const outcome = await checkVerification(requestId, code);
      switch (outcome.status) {
        case "verified":
          return verified(outcome.mobile);
        case "wrong":
          setFieldError(
            outcome.attemptsLeft > 0
              ? `That code is not right. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? "try" : "tries"} left.`
              : "Too many wrong tries. Send another code.",
          );
          return;
        case "expired":
          setFieldError("That code has expired. Send another code.");
          return;
        case "locked":
          setFieldError("Too many wrong tries. Send another code.");
          return;
        case "used":
          setFieldError("That code was already used. Send another code.");
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  function resend() {
    const { requestId, mobile } = state;
    if (!requestId || !mobile) return;
    void run(async () => {
      const outcome = await resendBookingCode(requestId);
      switch (outcome.status) {
        case "code":
          setCode("");
          setResendIn(60);
          go({ type: "code_sent", mobile, requestId: outcome.requestId });
          return;
        case "wait":
          setResendIn(outcome.seconds);
          return;
        case "gone":
          go({ type: "back" });
          setNotice(VERIFY_AGAIN);
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** Spec 2.3: new services change the visit's length, so the chosen time is checked again before the summary. */
  function chooseServices(procedureIds: string[], dentistId: string) {
    const startsAt = state.startsAt;
    if (!state.editing || !startsAt) {
      go({ type: "services", procedureIds, dentistId, timeFits: false });
      return;
    }
    void run(async () => {
      const at = new Date(startsAt);
      const open = await getOpenStarts(clinic.slug, { ...selection, dentistId, procedureIds }, manilaDate(at));
      const timeFits = open.some((s) => new Date(s).getTime() === at.getTime());
      setRetryDate(manilaDate(at));
      go({ type: "services", procedureIds, dentistId, timeFits });
      if (!timeFits) setNotice("Your time doesn't fit these services. Pick a new time.");
    });
  }

  function timeTaken(message: string) {
    if (state.startsAt) setRetryDate(manilaDate(new Date(state.startsAt)));
    dispatch({ type: "taken" });
    setNotice(message);
  }

  /** A send the server refused on its own checks: back to the part that needs a new choice. */
  function refusedParts(errors: Record<string, string>) {
    if (errors.slot) return timeTaken(errors.slot);
    if (errors.branch) {
      home();
      setNotice(errors.branch);
      return;
    }
    // The patient chosen is gone, or the new patient's form has a problem.
    dispatch({ type: "change", part: "patient" });
    setNotice(errors.patient ?? "Please check the patient form again.");
  }

  const who = () => (state.form ? { form: intakeInput(state.form) } : { patientId: state.patientId });

  /** Spec 3.3 step 7 "Send request". */
  function sendRequest() {
    void run(async () => {
      const outcome = await bookForNumber(clinic.slug, {
        mobile: state.mobile,
        branchId: state.branchId,
        dentistId: state.dentistId,
        procedureIds: state.procedureIds,
        startsAt: state.startsAt,
        ...who(),
      });
      switch (outcome.status) {
        case "sent":
          setToken(outcome.token);
          go({ type: "done" });
          return;
        case "taken":
          return timeTaken("That time was just taken. Pick another one.");
        case "too_many":
          setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
          return;
        case "invalid":
          return refusedParts(outcome.errors);
        case "unverified":
          return again();
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** The list again, after the server said the appointment changed underneath (spec 3.4, 3.5). */
  async function listAgain() {
    const found = await numberAppointments(clinic.slug, state.mobile ?? "");
    if (found.status === "ok") setAppointments(found.appointments);
    go({ type: "back" });
    setNotice(CHANGED);
  }

  /** Spec 3.4 step 3 and 3.5 step 3: a change needs the branch's services and dentists; a cancel needs nothing more. */
  function openAppointment(a: NumberAppointment) {
    const choose = () => {
      setPicked(a);
      go({
        type: "appointment",
        appointment: { id: a.id, branchId: a.branch.id, patientId: a.patient.id, procedureIds: a.procedureIds, dentistId: a.dentist.id, startsAt: a.startsAt },
      });
    };
    if (state.path === "cancel") return choose();
    void run(async () => {
      const data = a.branch.id === clinic.branch.id ? clinic : await getBranch(clinic.slug, a.branch.id);
      if (!data) {
        setNotice(`Please call the clinic to change it: ${phone}.`);
        return;
      }
      setBranch(data);
      choose();
    });
  }

  /** Spec 3.4 step 4 "Send changes". */
  function sendChanges() {
    void run(async () => {
      const outcome = await changeForNumber(clinic.slug, {
        mobile: state.mobile,
        appointmentId: state.appointmentId,
        dentistId: state.dentistId,
        procedureIds: state.procedureIds,
        startsAt: state.startsAt,
        ...who(),
      });
      switch (outcome.status) {
        case "sent":
          go({ type: "done" });
          return;
        case "taken":
          return timeTaken("That time was just taken. Pick another one.");
        case "call_clinic":
          setNotice(`It's too close to the visit to change it online. Please call the clinic to change it: ${phone}.`);
          return;
        case "unchanged":
          setNotice("Nothing is changed yet. Use Change on the part you want to change.");
          return;
        case "gone":
          return listAgain();
        case "invalid":
          return refusedParts(outcome.errors);
        case "unverified":
          return again();
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** Spec 3.5 step 3 "Yes, cancel it". */
  function cancelIt() {
    const id = state.appointmentId;
    if (!id) return;
    void run(async () => {
      const outcome = await cancelForNumber(clinic.slug, state.mobile ?? "", id);
      switch (outcome) {
        case "cancelled":
          go({ type: "done" });
          return;
        case "not_allowed":
          setNotice(`This appointment can't be cancelled online any more. Please call the clinic at ${phone}.`);
          return;
        case "gone":
          return listAgain();
        case "unverified":
          return again();
        case "unavailable":
          setNotice(UNAVAILABLE);
          return;
      }
    });
  }

  const back = (
    <button type="button" className="btn btn-ghost" onClick={() => go({ type: "back" })}>
      Back
    </button>
  );
  const mainButton = (
    <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={home}>
      Back to the main page
    </button>
  );
  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className={H2}>
      {text}
    </h2>
  );

  let screen: ReactNode = null;
  switch (state.step) {
    case "main":
      screen = (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-[17px] font-semibold outline-none">
            Book a visit, or change or cancel one you have.
          </h2>
          {paused ? (
            <p className="note-box mt-5" role="status">
              {pausedMessage(clinic.name, phone)}
            </p>
          ) : (
            <div className="mt-5">
              {closed ? (
                <p className="note-box">Online booking isn&apos;t open yet. Call {call} to book.</p>
              ) : (
                <button type="button" className="btn btn-primary wide-btn" onClick={() => begin("book")}>
                  Book an appointment
                </button>
              )}
              <button type="button" className="btn btn-ghost wide-btn mt-3" onClick={() => begin("change")}>
                Reschedule or edit a booking
              </button>
              <button type="button" className="btn btn-ghost wide-btn mt-3" onClick={() => begin("cancel")}>
                Cancel a booking
              </button>
            </div>
          )}
          <h3 className="f-label mt-7">{clinic.branches.length > 1 ? "Our branches" : "Where to find us"}</h3>
          <div className="member-list">
            {clinic.branches.map((b) => (
              <div key={b.id} className="member-row cursor-default">
                <span className="nm">
                  {b.name}
                  {b.address && <span className="meta block">{b.address}</span>}
                </span>
                {b.mapsUrl && (
                  <a href={b.mapsUrl} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" aria-label={`Map of ${b.name}`}>
                    Map
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      );
      break;

    case "branch":
      screen = (
        <section>
          {heading("Which branch?")}
          <p className="sub">Choose where you want to go.</p>
          <div className="member-list">
            {clinic.branches.map((b) => (
              <button key={b.id} type="button" className="member-row w-full text-left" disabled={working} onClick={() => chooseBranch(b.id)}>
                <span className="nm">
                  {b.name}
                  {b.address && <span className="meta block">{b.address}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "number":
      screen = (
        <section>
          {heading("Your mobile number")}
          <p className="sub">We text a 6 digit code to check it is yours. A phone that checked this number before goes straight on.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendNumber();
            }}
          >
            <Field label="Mobile number" error={fieldError}>
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  +63
                </span>
                <input
                  className="f-input"
                  value={mobileText}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="917 123 4567"
                  onChange={(e) => setMobileText(e.target.value)}
                />
              </span>
            </Field>
            <div className="mt-6 flex gap-3">
              {back}
              <button type="submit" className="btn btn-primary flex-1" disabled={working}>
                {working ? "Checking..." : "Continue"}
              </button>
            </div>
          </form>
        </section>
      );
      break;

    case "code":
      screen = (
        <section>
          {heading("Check your texts")}
          <p className="sub">We sent a 6 digit code to {localMobile(state.mobile ?? "+63")}. It expires in 5 minutes.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              checkCode();
            }}
          >
            <Field label="Code from the text" error={fieldError}>
              <input
                className="f-input text-center text-2xl font-bold tracking-[0.3em] tabular-nums"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="mt-6 flex gap-3">
              {back}
              <button type="submit" className="btn btn-primary flex-1" disabled={working}>
                {working ? "Checking..." : "Verify"}
              </button>
            </div>
          </form>
          <p className="f-hint mt-4">
            {resendIn > 0 ? (
              <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
            ) : (
              <button type="button" onClick={resend} className="link inline-flex min-h-11 items-center" disabled={working}>
                Send another code
              </button>
            )}
          </p>
        </section>
      );
      break;

    case "who":
      screen = (
        <section>
          {heading("Who is the appointment for?")}
          <p className="sub">Choose a patient on this number, or someone new.</p>
          <div className="member-list">
            {patients.map((p) => (
              <button key={p.id} type="button" className="member-row w-full text-left" onClick={() => go({ type: "patient", patientId: p.id })}>
                <span className="nm">
                  {p.first} {p.last}
                </span>
              </button>
            ))}
            <button type="button" className="member-row w-full text-left" onClick={() => go({ type: "someone_new" })}>
              <span className="nm">Someone new</span>
              <span className="meta">Fill in the patient form</span>
            </button>
          </div>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "form":
      screen = (
        <section>
          {heading("New patient form")}
          <p className="sub">The clinic keeps one form for each patient. It takes about 5 minutes.</p>
          <PatientForm
            clinicName={clinic.name}
            mobile={state.mobile ?? ""}
            today={today}
            initial={state.form}
            onDone={(form) => go({ type: "form", form })}
            onBack={() => go({ type: "back" })}
          />
        </section>
      );
      break;

    case "services":
      screen = (
        <section>
          {heading("What do you need?")}
          <p className="sub">Pick everything you need in one visit. The times you see will fit all of it.</p>
          <ServicesStep
            branch={branch}
            initialIds={state.procedureIds}
            initialDentistId={state.dentistId}
            editing={state.editing}
            working={working}
            call={call}
            onDone={chooseServices}
            onBack={() => go({ type: "back" })}
          />
        </section>
      );
      break;

    case "time":
      screen = dentist ? (
        <section>
          {heading("When suits you?")}
          <p className="sub">
            {duration} minutes with {dentist.name} at {branch.branch.name}.
          </p>
          <TimeStep
            slug={clinic.slug}
            selection={selection}
            dentist={dentist}
            duration={duration}
            rules={clinic.rules}
            nowIso={nowIso}
            initialDate={start ? manilaDate(start) : retryDate}
            initialStart={state.startsAt}
            onPick={(startsAt) => {
              setRetryDate(null);
              go({ type: "time", startsAt });
            }}
            onBack={() => go({ type: "back" })}
          />
        </section>
      ) : (
        <section>
          {heading("When suits you?")}
          <p className="note-box">Choose the services and the dentist again first.</p>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "summary":
      screen = (
        <section>
          {heading("Check your request")}
          <p className="sub">Change anything before you send it.</p>
          <div className="cf-box">
            <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
            <Row k="Patient" v={patientName} onChange={() => go({ type: "change", part: "patient" })} />
            <Row k="Services" v={services} onChange={() => go({ type: "change", part: "services" })} />
            {branch.dentists.length > 1 && <Row k="Dentist" v={dentist?.name ?? "Choose again"} onChange={() => go({ type: "change", part: "services" })} />}
            <Row k="Date and time" v={when} onChange={() => go({ type: "change", part: "time" })} />
          </div>
          <p className="f-hint mt-4">The clinic confirms by text. Nothing is booked until they do.</p>
          <div className="mt-6 flex gap-3">
            {back}
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={sendRequest}>
              {working ? "Sending..." : "Send request"}
            </button>
          </div>
        </section>
      );
      break;

    case "list":
      screen = (
        <section>
          {heading("Your appointments")}
          {appointments.length === 0 ? (
            <>
              <p className="note-box mt-4">There is no upcoming appointment for this number.</p>
              {mainButton}
            </>
          ) : (
            <>
              <p className="sub">{state.path === "cancel" ? "Choose the appointment to cancel." : "Choose the appointment to change."}</p>
              <div className="member-list">
                {appointments.map((a) => {
                  const at = new Date(a.startsAt);
                  const locked = state.path === "change" && !a.changeable;
                  const body = (
                    <>
                      <span className="nm">
                        {formatDate(at)}, {formatTime(at)}
                        <span className="meta block">
                          {a.patient.first} {a.patient.last}, {a.branch.name}
                        </span>
                        <span className="meta block">{a.procedures.join(", ")}</span>
                        {locked && <span className="meta block">Please call the clinic to change it.</span>}
                      </span>
                      <span className={`chip ${a.status === "confirmed" ? "chip-green" : "chip-amber"}`}>
                        {a.status === "confirmed" ? "Confirmed" : "Waiting for the clinic"}
                      </span>
                    </>
                  );
                  return locked ? (
                    <div key={a.id} className="member-row cursor-default">
                      {body}
                    </div>
                  ) : (
                    <button key={a.id} type="button" className="member-row w-full text-left" disabled={working} onClick={() => openAppointment(a)}>
                      {body}
                    </button>
                  );
                })}
              </div>
              <div className="mt-6">{back}</div>
            </>
          )}
        </section>
      );
      break;

    case "details":
      screen = (
        <section>
          {heading("Booking details")}
          <p className="sub">Change what you need, then send the changes. The clinic confirms again by text.</p>
          <div className="cf-box">
            <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
            <Row k="Patient" v={patientName} onChange={() => go({ type: "change", part: "patient" })} />
            <Row k="Services" v={services} onChange={() => go({ type: "change", part: "services" })} />
            {branch.dentists.length > 1 && (
              <Row k="Dentist" v={dentist?.name ?? picked?.dentist.name ?? ""} onChange={() => go({ type: "change", part: "services" })} />
            )}
            <Row k="Date and time" v={when} onChange={() => go({ type: "change", part: "time" })} />
          </div>
          <p className="f-hint mt-4">The branch stays the same. To go to another branch, cancel this one and book again.</p>
          <div className="mt-6 flex gap-3">
            {back}
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={sendChanges}>
              {working ? "Sending..." : "Send changes"}
            </button>
          </div>
        </section>
      );
      break;

    case "confirm_cancel":
      screen = picked ? (
        <section>
          {heading("Cancel this appointment?")}
          <p className="sub">The clinic is told, and the time goes back to other patients.</p>
          <div className="cf-box">
            <Row k="Patient" v={`${picked.patient.first} ${picked.patient.last}`} />
            <Row k="Branch" v={<Place name={picked.branch.name} address={picked.branch.address} />} />
            <Row k="Date and time" v={`${formatDate(new Date(picked.startsAt))}, ${formatTime(new Date(picked.startsAt))}`} />
            <Row k="Services" v={picked.procedures.join(", ")} />
            <Row k="Dentist" v={picked.dentist.name} />
          </div>
          <div className="mt-6 flex gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => go({ type: "keep" })}>
              No, keep it
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={cancelIt}>
              {working ? "Cancelling..." : "Yes, cancel it"}
            </button>
          </div>
        </section>
      ) : null;
      break;

    case "done":
      if (state.path === "change") {
        screen = (
          <section>
            {heading("Changes sent")}
            <p className="sub">Changes sent. The clinic will confirm by text.</p>
            <p>
              <span className="chip chip-amber">Waiting for the clinic</span>
            </p>
            {mainButton}
          </section>
        );
      } else if (state.path === "cancel") {
        screen = (
          <section>
            {heading("Cancelled")}
            <p className="sub">Your appointment is cancelled.</p>
            {mainButton}
          </section>
        );
      } else if (start) {
        screen = (
          <section>
            {heading("Request sent")}
            <p className="sub">The clinic will confirm by text. Nothing is booked until they do.</p>
            <div className="cf-box screen-in">
              <span aria-hidden="true" className="cf-check">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <p className="big-time">{formatTime(start)}</p>
              <p className="font-display text-[15px] font-semibold">{formatDate(start)}</p>
              <p className="mt-3">
                <span className="chip chip-amber">Waiting for the clinic</span>
              </p>
              <div className="mt-4">
                <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
                {dentist && <Row k="With" v={dentist.name} />}
                <Row k="For" v={chosen.map((p) => p.name).join(", ")} />
              </div>
            </div>
            {branch.branch.mapsUrl && (
              <a href={branch.branch.mapsUrl} className="link inline-flex min-h-11 items-center" target="_blank" rel="noreferrer">
                Open the map to {branch.branch.name}
              </a>
            )}
            <p className="f-hint mt-4">No reply within a day? Call {call}.</p>
            {token && (
              <p className="f-hint mt-2">
                <Link href={`/a/${token}`} className="link inline-flex min-h-11 items-center">
                  View or cancel this request
                </Link>
              </p>
            )}
            {mainButton}
          </section>
        );
      }
      break;
  }

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <div className="clinic-head">
          <span aria-hidden="true" className="brand-mark">
            {initials(clinic.name)}
          </span>
          <div>
            <h1 className="name">{clinic.name}</h1>
            <p className="meta">{call}</p>
          </div>
        </div>
        <hr className="rule-gold" />
        {notice && (
          <p role="alert" className="note-box warn mb-4">
            {notice}
          </p>
        )}
        {screen}
      </div>

      <p className="mt-5 text-center">
        <span className="brand-lockup">
          <Image src="/brand/logo.png" alt="" width={22} height={22} />
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </span>
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Show it on the booking page**

In `src/app/[slug]/page.tsx`, replace:

```tsx
import BookingSheet from "./BookingSheet";
```

with:

```tsx
import BookingFlow from "./BookingFlow";
```

In `src/app/[slug]/page.tsx`, replace:

```tsx
/**
 * A clinic's public booking page and website (spec 5.1). It receives no patient data and no busy times.
 * A lapsed clinic's page shows how to call instead of the booking form (billing spec 7.5).
 */
```

with:

```tsx
/**
 * A clinic's public booking page and website (spec 5.1, booking flow spec 3): the main page, then booking, rescheduling
 * or editing, and cancelling for a verified number. It receives no patient data and no busy times. A lapsed clinic's
 * page shows how to call instead of the three buttons (billing spec 7.5).
 */
```

In `src/app/[slug]/page.tsx`, replace:

```tsx
  return <BookingSheet clinic={clinic} nowIso={now.toISOString()} paused={!open} />;
```

with:

```tsx
  return <BookingFlow clinic={clinic} nowIso={now.toISOString()} paused={!open} />;
```

- [ ] **Step 6: Check and commit**

Run: `npx vitest run tests/unit/booking-page.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: `booking-page.test.ts` PASS (4); `tsc` prints nothing; lint clean; every test PASS (50 files, 568 tests).

```powershell
git add "src/app/[slug]/BookingFlow.tsx" "src/app/[slug]/TimeStep.tsx" "src/app/[slug]/actions.ts" "src/app/[slug]/page.tsx" tests/unit/booking-page.test.ts
git commit -m "feat: build the booking page's main page and its three paths" -m "The public page opens on three choices and lists every branch with its address and map link, or shows the paused notice. Book, reschedule or edit, and cancel all start with the number and its code, and the page renders the flow reducer's steps: branch, who, the patient form, services, date and time at the branch, the summary with a Change button per part and one Send request, your appointments, booking details, and cancel. A branch's dentists and hours load when a patient picks it, and the form's code loads only when its step opens."
```

### Task 3: Remove the old booking path

**Files:**
- Delete: `src/app/[slug]/BookingSheet.tsx`
- Modify: `src/app/[slug]/actions.ts`, `src/lib/booking.ts`, `src/lib/booking-input.ts`, `src/lib/number-booking.ts`, `tests/unit/booking-input.test.ts`, `tests/unit/booking-paused.test.ts`, `tests/db/booking-service.test.ts` (rewritten), `tests/e2e/booking.spec.ts`

**Interfaces:**
- Consumes: `startVerification`, `checkVerification`, `bookForNumber` from `@/lib/number-booking` (the rewritten database test); `resendCode` from `@/lib/booking`.
- Produces: nothing new. Removed: the Server Actions `requestBooking` and `verifyBookingCode`; from `@/lib/booking`: `requestBooking`, `verifyCode`, `type BookingOutcome`, `type VerifyOutcome`, and the `purpose` argument of `spendCode` (now `spendCode(requestId, code, now)`, verification codes only); from `@/lib/booking-input`: `detailErrors`, `parseBookingInput`, `type Selection`, `type Details`, `type BookingInput`, `type BookingPayload`. Kept because the new page uses them: `resendBookingCode` and `resendCode` (the code step's "Send another code"), `HMO_SUGGESTIONS` (the form), `resolveSelection`, `issueCode`, `spendCode`, `takenStarts`, `overBookingCap`.

Rules:
- The old flow's only callers were `BookingSheet` and the tests; `git grep` proves it before anything is deleted. The patient link `/a/{token}` and its cancel are untouched.
- A code the old page stored (a booking, no `verify`) expired within 5 minutes of being sent; `spendCode` keeps refusing it, as plan 7's test "never takes a code sent with a booking page request" checks.
- `tests/db/booking-service.test.ts` keeps every code rule it proved (attempts, lock, parallel guesses, expiry, resend, limits per number and per connection) and proves booking through the new path instead. Like the rest of `tests/db` it runs only against a development project (none exists) and must typecheck. The Playwright test walks the new page: the number, the code from `sms_log`, the patient form, services, date and time, the summary, and "Send request".

- [ ] **Step 1: Prove nothing else uses the old path**

Run: `git grep -n -E "requestBooking|verifyBookingCode|verifyCode\(|parseBookingInput|detailErrors|BookingPayload|BookingSheet" -- src tests`
Expected: lines in exactly these files: `src/app/[slug]/BookingSheet.tsx`, `src/app/[slug]/actions.ts`, `src/lib/booking.ts`, `src/lib/booking-input.ts`, `tests/unit/booking-input.test.ts`, `tests/unit/booking-paused.test.ts`, and `tests/db/booking-service.test.ts`. `src/app/[slug]/page.tsx` no longer imports `BookingSheet` (Task 2).

- [ ] **Step 2: Delete the old page and its code**

Delete `src/app/[slug]/BookingSheet.tsx`.

In `src/app/[slug]/actions.ts`, replace:

```ts
export async function requestBooking(slug: string, input: unknown): Promise<booking.BookingOutcome> {
  const now = new Date();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const { verifiedMobiles } = await device(now);
  return booking.requestBooking(String(slug), input, { ip, now, verifiedMobiles });
}

export async function verifyBookingCode(requestId: string, code: string): Promise<booking.VerifyOutcome> {
  const now = new Date();
  const { outcome, verifiedMobile } = await booking.verifyCode(String(requestId), String(code), now);
  if (verifiedMobile) await remember(verifiedMobile, now);
  return outcome;
}

```

with:

```ts
```

In `src/lib/booking.ts`, replace:

```ts
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import { parseBookingInput, type BookingPayload, type PublicClinic } from "@/lib/booking-input";
import { BOOKING_CAPS, checkCode, hashCode, newCode, newToken, OTP } from "@/lib/codes";
import { alertClinic } from "@/lib/notify";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";

type Finalized = { status: "sent"; token: string } | { status: "taken"; starts: string[] } | { status: "too_many" };
export type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };

export type BookingOutcome =
  | Finalized
  | CodeIssued
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "paused" }
  | { status: "unavailable" };

export type VerifyOutcome =
  | Finalized
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "locked" }
  | { status: "used" }
  | { status: "paused" }
  | { status: "unavailable" };

export type ResendOutcome =
```

with:

```ts
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import type { PublicClinic } from "@/lib/booking-input";
import { BOOKING_CAPS, checkCode, hashCode, newCode, OTP } from "@/lib/codes";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";

export type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };

export type ResendOutcome =
```

In `src/lib/booking.ts`, replace:

```ts
/** A code sent for a number alone (booking flow spec 3.2): no booking comes with it. */
export type VerifyRequest = { clinicId: string; verify: true };
/** What otp_requests.booking holds: the booking page's request, or a number's verification. */
export type StoredRequest = BookingPayload | VerifyRequest;
```

with:

```ts
/** A code sent for a number alone (booking flow spec 3.2): no booking comes with it. */
export type VerifyRequest = { clinicId: string; verify: true };
/**
 * What otp_requests.booking holds: a number's verification. A row the old booking page stored holds a booking and no
 * verify; it expired within 5 minutes of being sent and never verifies a number.
 */
type StoredRequest = { clinicId: string; verify?: boolean };
```

In `src/lib/booking.ts`, replace:

```ts
/** takenStarts for the booking page's stored payload. */
function payloadTaken(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<string[] | null> {
  return takenStarts(clinic, p.dentistId, new Date(p.startsAt), new Date(p.endsAt), now);
}

```

with:

```ts
```

In `src/lib/booking.ts`, replace:

```ts
/** Spec 9.1 steps 5 and 6: one transaction creates the request, then the clinic is alerted. */
async function finalize(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<Finalized> {
  if (await overBookingCap(clinic.id, p.mobile, now)) return { status: "too_many" };
  const fresh = await payloadTaken(clinic, p, now);
  if (fresh) return { status: "taken", starts: fresh };

  const token = newToken();
  const { data: appointmentId, error } = await adminClient().rpc("create_booking", {
    p_clinic_id: clinic.id,
    p_branch_id: clinic.branch.id,
    p_dentist_id: p.dentistId,
    p_starts_at: p.startsAt,
    p_ends_at: p.endsAt,
    p_procedure_names: p.procedureNames,
    p_source: "online",
    p_status: "pending",
    p_manage_token: token,
    p_patient_id: null,
    p_first_name: p.first,
    p_last_name: p.last,
    p_mobile: p.mobile,
    p_birthday: p.birthday,
    p_hmo: p.hmo,
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
  });
  // 23P01: the overlap guard caught a booking that landed between the check above and this insert.
  if (error?.code === "23P01") return { status: "taken", starts: (await payloadTaken(clinic, p, now)) ?? [] };
  if (error) throw error;

  const dentist = clinic.dentists.find((d) => d.id === p.dentistId)!;
  await alertClinic({
    kind: "request_alert",
    clinicId: clinic.id,
    appointmentId: appointmentId as string,
    first: p.first,
    last: p.last,
    startsAt: new Date(p.startsAt),
    dentist: clinic.dentists.length > 1 ? dentist.smsName : null,
  });
  return { status: "sent", token };
}

```

with:

```ts
```

In `src/lib/booking.ts`, replace:

```ts
 * Spec 10.3: rolling-hour limits, then a stored request holding the payload (the booking page's request, or a number's
 * verification, booking flow spec 3.2) and the code hash, then the text. Both kinds share every limit.
 */
export async function issueCode(clinic: Pick<PublicClinic, "id" | "smsName">, mobile: string, stored: StoredRequest, { ip, now }: Ctx): Promise<CodeIssued> {
```

with:

```ts
 * Spec 10.3: rolling-hour limits, then a stored request for the number's verification (booking flow spec 3.2) and the
 * code hash, then the text.
 */
export async function issueCode(clinic: Pick<PublicClinic, "id" | "smsName">, mobile: string, stored: VerifyRequest, { ip, now }: Ctx): Promise<CodeIssued> {
```

In `src/lib/booking.ts`, replace:

```ts
/** Spec 9.1 step 3: validate, then book straight away for a verified device, or send a code. */
export async function requestBooking(
  slug: string,
  input: unknown,
  ctx: Ctx & { verifiedMobiles: string[] },
): Promise<BookingOutcome> {
  try {
    const clinic = await loadClinic({ slug });
    if (!clinic) return { status: "invalid", errors: { slot: "This booking link doesn't exist." } };
    // Billing spec 7.5: a lapsed clinic takes no requests, even from a tab opened before it lapsed.
    if (!(await bookingOpen(clinic.id, ctx.now))) return { status: "paused" };
    const parsed = parseBookingInput(clinic, input, manilaDate(ctx.now));
    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    if (ctx.verifiedMobiles.includes(parsed.payload.mobile)) return await finalize(clinic, parsed.payload, ctx.now);
    const starts = await payloadTaken(clinic, parsed.payload, ctx.now);
    if (starts) return { status: "taken", starts };
    return await issueCode(clinic, parsed.payload.mobile, parsed.payload, ctx);
  } catch (e) {
    logFailure("requestBooking", e);
    return { status: "unavailable" };
  }
}

```

with:

```ts
```

In `src/lib/booking.ts`, replace:

```ts
 * Spec 9.1 step 4 and booking flow spec 3.2: checks a code, spends an attempt, and marks it used. A code sent with a
 * booking page request and a code sent for a number alone each work only for their own purpose. Billing spec 7.5: a
 * lapsed clinic takes no code, checked before the attempt or the code is spent.
 */
export async function spendCode(requestId: string, code: string, now: Date, purpose: "booking" | "verify"): Promise<Spent> {
```

with:

```ts
 * Booking flow spec 3.2: checks a code sent for a number, spends an attempt, and marks it used. Billing spec 7.5: a
 * lapsed clinic takes no code, checked before the attempt or the code is spent.
 */
export async function spendCode(requestId: string, code: string, now: Date): Promise<Spent> {
```

In `src/lib/booking.ts`, replace:

```ts
  if (("verify" in row.booking) !== (purpose === "verify")) return { status: "expired" };
```

with:

```ts
  if (row.booking.verify !== true) return { status: "expired" };
```

In `src/lib/booking.ts`, replace:

```ts
/** Spec 9.1 step 4: check the code, mark it verified, then book the payload stored with it. */
export async function verifyCode(
  requestId: string,
  code: string,
  now: Date,
): Promise<{ outcome: VerifyOutcome; verifiedMobile: string | null }> {
  let verifiedMobile: string | null = null;
  const done = (outcome: VerifyOutcome) => ({ outcome, verifiedMobile });
  try {
    const spent = await spendCode(requestId, code, now, "booking");
    if (spent.status !== "ok") return done(spent);
    verifiedMobile = spent.row.mobile;
    const booking = spent.row.booking as BookingPayload;
    const clinic = await loadClinic({ id: booking.clinicId }, booking.branchId);
    if (!clinic) return done({ status: "unavailable" });
    return done(await finalize(clinic, booking, now));
  } catch (e) {
    logFailure("verifyCode", e);
    return done({ status: "unavailable" });
  }
}

```

with:

```ts
```

In `src/lib/number-booking.ts`, replace:

```ts
    const spent = await spendCode(requestId, code, now, "verify");
```

with:

```ts
    const spent = await spendCode(requestId, code, now);
```

In `src/lib/booking-input.ts`, replace:

```ts
import { normalizeMobile } from "@/lib/phone";
import type { Block, BookingRules } from "@/lib/slots";
import { cleanBirthday, cleanText, LIMITS } from "@/lib/validate";
```

with:

```ts
import type { Block, BookingRules } from "@/lib/slots";
```

In `src/lib/booking-input.ts`, replace:

```ts
export type Selection = { dentistId: string; procedureIds: string[] };
export type Details = { first: string; last: string; mobile: string; birthday: string; hmo: string; consent: boolean };
export type BookingInput = Selection & Details & { startsAt: string };

/** The pending booking: stored in otp_requests.booking, then passed to create_booking. */
export type BookingPayload = {
  clinicId: string;
  slug: string;
  /** Absent in codes requested before branches: they book at the clinic's first active branch. */
  branchId?: string;
  dentistId: string;
  startsAt: string;
  endsAt: string;
  procedureNames: string[];
  first: string;
  last: string;
  mobile: string;
  birthday: string | null;
  hmo: string;
};

```

with:

```ts
```

In `src/lib/booking-input.ts`, replace:

```ts
/** Common HMO providers, offered as suggestions on the booking form (spec 5.1). */
```

with:

```ts
/** Common HMO providers, offered as suggestions on the patient form (spec 5.1, booking flow spec 6). */
```

In `src/lib/booking-input.ts`, replace:

```ts
  return { dentist, procedures, duration: procedures.reduce((sum, p) => sum + p.minutes, 0) };
}

/** Problems with the patient's details, keyed by field. Used by the form and again by the server. */
export function detailErrors(d: Details, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!cleanText(d.first, LIMITS.personName)) errors.first = "Please enter your first name.";
  if (!cleanText(d.last, LIMITS.personName)) errors.last = "Please enter your last name.";
  if (!normalizeMobile(d.mobile)) errors.mobile = "Enter a Philippine mobile number, like 0917 123 4567.";
  if (cleanBirthday(d.birthday, today) === null) errors.birthday = "Use a real past date, or leave this blank.";
  if (cleanText(d.hmo, LIMITS.hmo, true) === null) errors.hmo = `Keep this under ${LIMITS.hmo} characters.`;
  if (!d.consent) errors.consent = "Please agree before sending your request.";
  return errors;
}

/**
 * Validates a booking request on the server (spec 12) and builds the payload from the clinic's own
 * data: the end time, procedure names, and clinic come from the server, never from the client.
 * Whether the start is still open is checked separately, against the database.
 */
export function parseBookingInput(
  clinic: PublicClinic,
  value: unknown,
  today: string,
): { ok: true; payload: BookingPayload } | { ok: false; errors: Record<string, string> } {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof v[key] === "string" ? (v[key] as string) : "");
  const details: Details = {
    first: text("first"),
    last: text("last"),
    mobile: text("mobile"),
    birthday: text("birthday"),
    hmo: text("hmo"),
    consent: v.consent === true,
  };
  const errors = detailErrors(details, today);
  const chosen = resolveSelection(clinic, v);
  const start = new Date(text("startsAt"));
  if (!chosen || Number.isNaN(start.getTime())) errors.slot = "Pick the visit and time again.";
  if (!chosen || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      clinicId: clinic.id,
      slug: clinic.slug,
      branchId: clinic.branch.id,
      dentistId: chosen.dentist.id,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + chosen.duration * 60_000).toISOString(),
      procedureNames: chosen.procedures.map((p) => p.name),
      first: cleanText(details.first, LIMITS.personName)!,
      last: cleanText(details.last, LIMITS.personName)!,
      mobile: normalizeMobile(details.mobile)!,
      birthday: cleanBirthday(details.birthday, today) || null,
      hmo: cleanText(details.hmo, LIMITS.hmo, true) ?? "",
    },
  };
}
```

with:

```ts
  return { dentist, procedures, duration: procedures.reduce((sum, p) => sum + p.minutes, 0) };
}
```

- [ ] **Step 3: See what still leans on the old path**

Run: `npx tsc --noEmit`
Expected: FAIL with `TS2305: Module '"@/lib/booking"' has no exported member 'requestBooking'` (and `'verifyCode'`) in `tests/unit/booking-paused.test.ts` and `tests/db/booking-service.test.ts`, and `'"@/lib/booking-input"' has no exported member 'detailErrors'` (and `'parseBookingInput'`) in `tests/unit/booking-input.test.ts`, and one `TS7006` implicit `any` that follows from them in `tests/db/booking-service.test.ts`. Nothing under `src` fails.

- [ ] **Step 4: Move the tests to the new path**

In `tests/unit/booking-input.test.ts`, replace:

```ts
import { detailErrors, parseBookingInput, resolveSelection, type PublicClinic } from "@/lib/booking-input";
```

with:

```ts
import { resolveSelection, type PublicClinic } from "@/lib/booking-input";
```

In `tests/unit/booking-input.test.ts`, replace:

```ts
const today = "2026-09-24";
const good = {
  dentistId: "d2",
  procedureIds: ["p2", "p1"],
  startsAt: "2026-10-01T01:00:00.000Z",
  first: " Maria ",
  last: "Santos",
  mobile: "0917 123 4567",
  birthday: "",
  hmo: " Maxicare ",
  consent: true,
};

describe("resolveSelection", () => {
```

with:

```ts
describe("resolveSelection", () => {
```

In `tests/unit/booking-input.test.ts`, replace:

```ts
    expect(resolveSelection(clinic, value)).toBeNull();
  });
});

describe("detailErrors", () => {
  it("asks for the required fields", () => {
    const errors = detailErrors({ first: "", last: "", mobile: "", birthday: "", hmo: "", consent: false }, today);
    expect(Object.keys(errors).sort()).toEqual(["consent", "first", "last", "mobile"]);
    expect(errors.mobile).toBe("Enter a Philippine mobile number, like 0917 123 4567.");
    expect(errors.consent).toBe("Please agree before sending your request.");
  });

  it("rejects a future birthday", () => {
    const errors = detailErrors({ ...good, birthday: "2026-09-25" }, today);
    expect(errors).toEqual({ birthday: "Use a real past date, or leave this blank." });
  });
});

describe("parseBookingInput", () => {
  it("builds the stored payload on the server's terms", () => {
    expect(parseBookingInput(clinic, good, today)).toEqual({
      ok: true,
      payload: {
        clinicId: "c1",
        slug: "bright-dental",
        branchId: "b1",
        dentistId: "d2",
        startsAt: "2026-10-01T01:00:00.000Z",
        endsAt: "2026-10-01T02:30:00.000Z",
        procedureNames: ["Consultation", "Oral Prophylaxis (Cleaning)"],
        first: "Maria",
        last: "Santos",
        mobile: "+639171234567",
        birthday: null,
        hmo: "Maxicare",
      },
    });
  });

  it("ignores fields the client has no say over", () => {
    const result = parseBookingInput(clinic, { ...good, clinicId: "someone-else", branchId: "b9", endsAt: "2030-01-01T00:00:00Z" }, today);
    expect(result.ok && result.payload.clinicId).toBe("c1");
    expect(result.ok && result.payload.branchId).toBe("b1");
    expect(result.ok && result.payload.endsAt).toBe("2026-10-01T02:30:00.000Z");
  });

  it("reports every detail problem at once", () => {
    const result = parseBookingInput(clinic, { ...good, mobile: "123", consent: "yes" }, today);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["consent", "mobile"]);
  });

  it("flags an unusable visit or time as slot", () => {
    const badTime = parseBookingInput(clinic, { ...good, startsAt: "tomorrow" }, today);
    expect(!badTime.ok && badTime.errors.slot).toBe("Pick the visit and time again.");
    const badDentist = parseBookingInput(clinic, { ...good, dentistId: "gone" }, today);
    expect(!badDentist.ok && badDentist.errors.slot).toBe("Pick the visit and time again.");
  });

  it("survives input that is not an object", () => {
    expect(parseBookingInput(clinic, "hello", today).ok).toBe(false);
  });
});
```

with:

```ts
    expect(resolveSelection(clinic, value)).toBeNull();
  });
});
```

In `tests/unit/booking-paused.test.ts`, replace:

```ts
import { requestBooking, resendCode, verifyCode } from "@/lib/booking";
```

with:

```ts
import { resendCode } from "@/lib/booking";
```

In `tests/unit/booking-paused.test.ts`, replace:

```ts
  it("refuse a new request, even from a verified mobile", async () => {
    for (const verifiedMobiles of [[], ["+639171112222"]]) {
      expect(await requestBooking("bright-dental", { mobile: "09171112222" }, { ...ctx, verifiedMobiles })).toEqual({ status: "paused" });
    }
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuse to send a new code", async () => {
    expect(await resendCode(fake.requestId, ctx)).toEqual({ status: "paused" });
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("refuse a right code without spending an attempt, using the code, or remembering the mobile", async () => {
    expect(await verifyCode(fake.requestId, "123456", now)).toEqual({ outcome: { status: "paused" }, verifiedMobile: null });
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
  });
});
```

with:

```ts
  it("refuse to send a new code", async () => {
    expect(await resendCode(fake.requestId, ctx)).toEqual({ status: "paused" });
    expect(bookingOpen).toHaveBeenCalledWith(fake.clinicId, now);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
```

(The paused start of every path, the paused booking and change, and the code check are proven by `tests/unit/number-booking.test.ts`.)

Delete `tests/db/booking-service.test.ts`.

Create `tests/db/booking-service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resendCode } from "@/lib/booking";
import { bookForNumber, checkVerification, startVerification } from "@/lib/number-booking";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const date = addDays(manilaDate(new Date()), 3);
const at = (minutes: number) => manilaInstant(date, minutes).toISOString();
const later = (ms: number) => new Date(Date.now() + ms);
const mobiles: string[] = [];
let seed: Seed;
let procedureId: string;
let branchId: string;

function newMobile(): string {
  const mobile = `+63918${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  mobiles.push(mobile);
  return mobile;
}
const newIp = () => `test-${rand()}`;
const phone = (verifiedMobiles: string[] = [], ip = newIp()) => ({ ip, now: new Date(), verifiedMobiles });
const form = { last: "Santos", first: "Maria", birthday: "1990-05-17", sex: "female", address: "Makati", agree: true, signature: "Maria Santos" };

/** A request for someone new, as the booking page sends it once the number is verified. */
function request(startsAt: string, mobile: string) {
  return { mobile, branchId, dentistId: seed.dentist.id, procedureIds: [procedureId], startsAt, form };
}

/** Log mode keeps the real code in sms_log (spec 10.6), so the test reads it like a phone would. */
async function lastCode(mobile: string): Promise<string> {
  const { data } = await db
    .from("sms_log")
    .select("body")
    .eq("to_mobile", mobile)
    .eq("kind", "otp")
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  const match = /is (\d{6})\./.exec(data.body as string);
  if (!match) throw new Error(`No code in: ${data.body}`);
  return match[1];
}

async function codeRequest(mobile: string, ip = newIp()): Promise<string> {
  const outcome = await startVerification(seed.clinic.slug, mobile, phone([], ip));
  if (outcome.status !== "code") throw new Error(`Expected a code, got ${outcome.status}`);
  return outcome.requestId;
}

beforeAll(async () => {
  seed = await seedClinic();
  const { data } = await db
    .from("procedures")
    .insert({ clinic_id: seed.clinic.id, name: "Consultation", duration_minutes: 30 })
    .select("id")
    .single()
    .throwOnError();
  procedureId = data.id;
  const { data: branch } = await db.from("branches").select("id").eq("clinic_id", seed.clinic.id).single().throwOnError();
  branchId = branch.id;
});

afterAll(async () => {
  await db.from("otp_requests").delete().in("mobile", mobiles);
  await deleteClinic(seed.clinic.id);
});

describe("booking by a verified number", () => {
  it("texts a code, verifies the number with it, then books someone new with the form", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkVerification(requestId, wrong, new Date())).toEqual({ status: "wrong", attemptsLeft: 4 });
    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "verified", mobile });

    const outcome = await bookForNumber(seed.clinic.slug, request(at(540), mobile), phone([mobile]));
    if (outcome.status !== "sent") throw new Error(`Expected sent, got ${outcome.status}`);
    const { data: appt } = await db
      .from("appointments")
      .select("id, status, source, starts_at, procedure_names, branch_id")
      .eq("manage_token", outcome.token)
      .single()
      .throwOnError();
    expect(appt).toMatchObject({ status: "pending", source: "online", procedure_names: ["Consultation"], branch_id: branchId });
    expect(new Date(appt.starts_at).toISOString()).toBe(at(540));

    const { data: alert } = await db
      .from("sms_log")
      .select("to_mobile, status, body")
      .eq("appointment_id", appt.id)
      .eq("kind", "request_alert")
      .single()
      .throwOnError();
    expect(alert.to_mobile).toBe("+639170000000");
    expect(alert.status).toBe("logged");
    expect(alert.body).toMatch(/^New request: Maria S\., /);

    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "used" });
  });

  it("skips the code for a number this phone already verified", async () => {
    const mobile = newMobile();
    expect(await startVerification(seed.clinic.slug, mobile, phone([mobile]))).toEqual({ status: "verified", mobile });
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBe(0);
  });

  it("offers fresh times when the chosen one was just taken", async () => {
    const first = newMobile();
    expect((await bookForNumber(seed.clinic.slug, request(at(600), first), phone([first]))).status).toBe("sent");
    const second = newMobile();
    const outcome = await bookForNumber(seed.clinic.slug, request(at(600), second), phone([second]));
    if (outcome.status !== "taken") throw new Error(`Expected taken, got ${outcome.status}`);
    expect(outcome.starts).not.toContain(at(600));
    expect(outcome.starts).toContain(at(630));
  });

  it("names every problem with the form", async () => {
    const mobile = newMobile();
    const outcome = await bookForNumber(seed.clinic.slug, { ...request(at(630), mobile), form: { ...form, agree: false, address: "" } }, phone([mobile]));
    if (outcome.status !== "invalid") throw new Error(`Expected invalid, got ${outcome.status}`);
    expect(Object.keys(outcome.errors).sort()).toEqual(["address", "agree"]);
  });

  it("does not know an unknown booking link", async () => {
    expect(await startVerification("no-such-clinic-zz9", newMobile(), phone())).toEqual({ status: "invalid" });
  });

  it("books at most 3 pending requests per clinic for one mobile, then refuses a 4th", async () => {
    const day = addDays(date, 1);
    const at2 = (minutes: number) => manilaInstant(day, minutes).toISOString();
    const mobile = newMobile();
    for (const minutes of [540, 570, 600]) {
      expect((await bookForNumber(seed.clinic.slug, request(at2(minutes), mobile), phone([mobile]))).status).toBe("sent");
    }
    expect(await bookForNumber(seed.clinic.slug, request(at2(630), mobile), phone([mobile]))).toEqual({ status: "too_many" });
    await db.from("appointments").delete().eq("clinic_id", seed.clinic.id).gte("starts_at", manilaInstant(day, 0).toISOString());
  });
});

describe("verification code rules", () => {
  it("locks a code after 5 wrong tries, even for the right code", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1, 0]) {
      expect(await checkVerification(requestId, wrong, new Date())).toEqual({ status: "wrong", attemptsLeft: left });
    }
    expect(await checkVerification(requestId, code, new Date())).toEqual({ status: "locked" });
  });

  it("never lets parallel wrong guesses spend more than 5 attempts", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => checkVerification(requestId, wrong, new Date())));
    const { data } = await db.from("otp_requests").select("attempts").eq("id", requestId).single().throwOnError();
    expect(data.attempts).toBeLessThanOrEqual(5);
  });

  it("expires a code after 5 minutes", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(mobile);
    const code = await lastCode(mobile);
    expect(await checkVerification(requestId, code, later(5 * 60_000 + 1_000))).toEqual({ status: "expired" });
  });

  it("treats an unknown or malformed request as expired", async () => {
    expect(await checkVerification("00000000-0000-0000-0000-000000000000", "123456", new Date())).toEqual({ status: "expired" });
    expect(await checkVerification("not-a-uuid", "123456", new Date())).toEqual({ status: "expired" });
  });

  it("resends after 60 seconds with a new code and retires the old one", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(mobile);
    const oldCode = await lastCode(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");

    const resent = await resendCode(oldId, { ip: newIp(), now: later(61_000) });
    if (resent.status !== "code") throw new Error(`Expected code, got ${resent.status}`);
    expect(resent.requestId).not.toBe(oldId);
    expect(await checkVerification(oldId, oldCode, later(62_000))).toEqual({ status: "expired" });
    expect(await checkVerification(resent.requestId, await lastCode(mobile), new Date())).toEqual({ status: "verified", mobile });
  });

  it("allows 3 codes per mobile in an hour", async () => {
    const mobile = newMobile();
    for (let i = 0; i < 3; i++) await codeRequest(mobile);
    expect((await startVerification(seed.clinic.slug, mobile, phone())).status).toBe("limited");
  });

  it("allows 10 codes per IP address in an hour", async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) await codeRequest(newMobile(), ip);
    expect((await startVerification(seed.clinic.slug, newMobile(), phone([], ip))).status).toBe("limited");
  });

  it("still caps parallel requests at 3 codes per mobile", async () => {
    const mobile = newMobile();
    const results = await Promise.all(Array.from({ length: 6 }, () => startVerification(seed.clinic.slug, mobile, phone())));
    expect(results.filter((r) => r.status === "code").length).toBeLessThanOrEqual(3);
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBeLessThanOrEqual(3);
  });

  it("lets only one of two parallel resends through, and rejects reuse of a retired id", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(mobile);

    const [first, second] = await Promise.all([
      resendCode(oldId, { ip: newIp(), now: later(61_000) }),
      resendCode(oldId, { ip: newIp(), now: later(61_000) }),
    ]);
    const codeResults = [first, second].filter((r) => r.status === "code");
    expect(codeResults.length).toBe(1);

    // The other racer sees the row already retired by the winner.
    const other = codeResults[0] === first ? second : first;
    expect(["gone", "wait"]).toContain(other.status);

    // Reusing the now-retired original id is unusable.
    expect((await resendCode(oldId, { ip: newIp(), now: later(62_000) })).status).toBe("gone");
  });

  it("rejects a resend before 60 seconds", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");
  });
});
```

In `tests/e2e/booking.spec.ts`, replace:

```ts
  // The patient books tomorrow's first opening on the public page.
  await page.goto(`/${s.seed.clinic.slug}`);
  await page.getByRole("checkbox", { name: "Consultation, 30 minutes" }).check();
  await page.getByRole("button", { name: "Pick a day" }).click();
  if (day.slice(0, 7) !== today.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: `${DAYS[weekday(day)]}, ${MONTHS[month - 1]} ${date}`, exact: true }).click();
  await page.locator(".slot-grid .slot").first().click();
  await page.getByRole("button", { name: /^Take / }).click();
  await page.getByLabel("First name").fill("Playwright");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("checkbox", { name: /^I agree to/ }).check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Check your texts" })).toBeVisible();
```

with:

```ts
  // The patient starts booking on the public page and verifies their number first.
  await page.goto(`/${s.seed.clinic.slug}`);
  await page.getByRole("button", { name: "Book an appointment" }).click();
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your texts" })).toBeVisible();
```

In `tests/e2e/booking.spec.ts`, replace:

```ts
  await page.getByLabel("Code from the text").fill(code!);
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
```

with:

```ts
  await page.getByLabel("Code from the text").fill(code!);
  await page.getByRole("button", { name: "Verify" }).click();

  // A new number has no patients yet, so the patient form opens; then tomorrow's first opening.
  await expect(page.getByRole("heading", { name: "New patient form" })).toBeVisible();
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("First name").fill("Playwright");
  await page.getByLabel("Birthday").fill("1990-05-17");
  await page.getByRole("radio", { name: "Female" }).check();
  await page.getByLabel("Home address").fill("12 Rizal St, Makati");
  await page.getByRole("checkbox", { name: "I have read and agree" }).check();
  await page.getByLabel("Patient's full name, as the signature").fill("Playwright Tester");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("checkbox", { name: "Consultation, 30 minutes" }).check();
  await page.getByRole("button", { name: "Pick a day" }).click();
  if (day.slice(0, 7) !== today.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: `${DAYS[weekday(day)]}, ${MONTHS[month - 1]} ${date}`, exact: true }).click();
  await page.locator(".slot-grid .slot").first().click();
  await page.getByRole("button", { name: /^Take / }).click();
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS (50 files, 559 tests: the 9 tests of the removed code are gone).

Run: `git grep -n -E "requestBooking|verifyBookingCode|parseBookingInput|detailErrors|BookingPayload|BookingSheet" -- src tests`
Expected: no output.

```powershell
git add -A "src/app/[slug]" src/lib/booking.ts src/lib/booking-input.ts src/lib/number-booking.ts tests/unit/booking-input.test.ts tests/unit/booking-paused.test.ts tests/db/booking-service.test.ts tests/e2e/booking.spec.ts
git commit -m "refactor: remove the old booking path" -m "BookingSheet, requestBooking, verifyBookingCode, and the code behind them had no caller left once the new page shipped. spendCode now takes verification codes only and still refuses a code the old page stored. The database test proves the code rules and booking through the verified-number path, and the Playwright test walks the new page."
```
### Task 4: Settings > Branches

**Files:**
- Create: `src/app/app/settings/BranchEditor.tsx`, `tests/unit/branch-settings.test.ts`
- Modify: `src/lib/validate.ts`, `src/lib/branches.ts`, `tests/unit/branches.test.ts`, `src/lib/settings-input.ts`, `tests/unit/settings-input.test.ts`, `src/lib/clinic-settings.ts`, `src/app/app/settings/actions.ts`, `tests/unit/settings-actions.test.ts`, `src/app/app/settings/ClinicForms.tsx`, `src/app/app/settings/page.tsx`

**Interfaces:**
- Consumes: `branchSmsNameProblem` (plan 7); `requireOwner`, `OWNER_ONLY` (plan 6); the `branches` table, its owner-only write policies and column grants, and the `keep_an_active_branch` trigger (`BSLAB`) from plan 7's migration; `errorFor`, `Feedback` from `./ClinicForms`.
- Produces:
  - From `@/lib/validate`: `LIMITS.branchName` (40) and `LIMITS.branchSmsName` (18), the database's caps
  - From `@/lib/branches` (pure): `activeBranchesProblem(clinicSmsName: string, active: { name: string; smsName: string }[]): string | null`, `clinicSmsNameProblem(clinicSmsName: string, activeBranchSmsNames: string[]): string | null`
  - From `@/lib/settings-input` (pure): `type BranchRow = { name; sms_name; address; maps_url }`, `parseBranch(value: unknown): Parsed<BranchRow>`
  - From `@/lib/clinic-settings` (server only): `SettingsView.branches: { id; name; smsName; address; mapsUrl; active }[]` (every branch, in the order patients see them), `saveBranch(staff, id: string | null, input): Promise<Saved>`, `setBranchActive(staff, id: string, active: boolean): Promise<Saved>`, `moveBranch(staff, id: string, direction: "up" | "down"): Promise<Saved>`
  - Server Actions (owner only): `saveBranchAction(branchId: unknown, input: unknown)`, `setBranchActiveAction(branchId: unknown, active: unknown)`, `moveBranchAction(branchId: unknown, direction: unknown)`, each `Promise<Saved>`
  - Default export `BranchEditor({ branches, clinicSmsName })`, on the Settings page for the owner

Rules (spec 4, plan 7's deferred list):
- Owner only: the section renders for the owner, every action passes `requireOwner`, and RLS refuses staff writes regardless. Staff see nothing new in Settings.
- Add (active, last in order), rename, edit the short name for texts, the address (required: patients need to know where to go), and the map link (optional, https only); move up or down; deactivate or reactivate. Deactivating the last active branch is refused in words ("Keep at least one active branch, or patients can't book."), from the database's own trigger. Inactive branches leave the booking page; their visits stay. No branch is ever deleted (appointments point at it).
- The combined short name check (plan 7 deferred it): with 2 or more active branches every text names the branch after the clinic, within 20 characters. So saving an active branch checks its short name beside the clinic's text name and then every other active branch's (this is how the first branch, "Main", gets checked when a second becomes active); reactivating a branch checks every active branch; and the clinic profile refuses a new text name that leaves no room for the longest active branch short name. With one active branch nothing is checked, as texts carry the clinic's name alone.
- The clinic profile no longer copies its address and map link to a one-branch clinic's branch (plan 7 did that only until this section existed; keeping it would overwrite what the owner sets here). The profile keeps the clinic's own address; its map link input goes, because patients now see each branch's link. The stored link is sent back unchanged, so saving the profile keeps it.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/branches.test.ts`, replace:

```ts
import { branchSmsNameProblem, smsClinicName } from "@/lib/branches";
```

with:

```ts
import { activeBranchesProblem, branchSmsNameProblem, clinicSmsNameProblem, smsClinicName } from "@/lib/branches";
```

Append to the end of `tests/unit/branches.test.ts`:

```ts

describe("activeBranchesProblem", () => {
  it("checks nothing while one branch is active, when texts carry the clinic's name alone", () => {
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main Branch Office" }])).toBeNull();
  });

  it("names the first active branch whose short name does not fit once there are 2", () => {
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main" }, { name: "Pasig", smsName: "Pasig" }])).toBeNull();
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main Branch" }, { name: "Pasig", smsName: "Pasig" }])).toBe(
      "Main: Use 1 to 6 characters, so the clinic and branch names fit in a text together.",
    );
  });
});

describe("clinicSmsNameProblem", () => {
  it("leaves the clinic's text name alone while it has one active branch", () => {
    expect(clinicSmsNameProblem("Bright Smile Dental", ["Main"])).toBeNull();
  });

  it("keeps room for the longest active branch short name once there are 2", () => {
    expect(clinicSmsNameProblem("Bright Dental", ["Makati", "Pasig"])).toBeNull();
    expect(clinicSmsNameProblem("Bright Smile Dental", ["Makati", "Pasig"])).toBe(
      "Texts add the branch's short name after this. Use up to 13 characters, or shorten your branches' short names first.",
    );
  });
});
```

In `tests/unit/settings-input.test.ts`, replace:

```ts
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
```

with:

```ts
import { parseBranch, parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
```

Append to the end of `tests/unit/settings-input.test.ts`:

```ts

describe("parseBranch", () => {
  const branch = { name: " Makati ", smsName: " Makati ", address: "12 Rizal St, Makati", mapsUrl: "" };

  it("cleans the branch and stores an empty map link as null", () => {
    expect(parseBranch(branch)).toEqual({ ok: true, value: { name: "Makati", sms_name: "Makati", address: "12 Rizal St, Makati", maps_url: null } });
    expect(parseBranch({ ...branch, mapsUrl: "https://maps.app.goo.gl/abc" })).toMatchObject({ ok: true, value: { maps_url: "https://maps.app.goo.gl/abc" } });
  });

  it("names the field that is wrong", () => {
    expect(parseBranch({ ...branch, name: "x".repeat(41) })).toMatchObject({ ok: false, field: "name" });
    expect(parseBranch({ ...branch, smsName: "  " })).toEqual({ ok: false, field: "smsName", error: "Use 1 to 18 characters." });
    expect(parseBranch({ ...branch, address: "" })).toMatchObject({ ok: false, field: "address" });
    expect(parseBranch({ ...branch, mapsUrl: "http://maps.example.com" })).toMatchObject({ ok: false, field: "mapsUrl" });
    expect(parseBranch("Makati")).toMatchObject({ ok: false, field: "name" });
  });
});
```

Create `tests/unit/branch-settings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveBranch, saveBranch, saveProfile, setBranchActive } from "@/lib/clinic-settings";
import type { Staff } from "@/lib/supabase/server";

// Settings > Branches through the owner's client (booking flow spec 4). The fake client answers each table from the
// rows below and records every write with its filters, so "saves nothing" is checked, not assumed.
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const MAIN = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const PASIG = "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03";
const CUBAO = "9f4a1b32-5d7e-4a0c-b3f6-4e8b0c2a7d14";

type Row = { id: string; name: string; sms_name: string; address: string; maps_url: string | null; active: boolean; sort: number };
type Write = { table: string; kind: "insert" | "update"; values: Record<string, unknown>; filters: [string, unknown][] };

const fake = {
  clinicSmsName: "Bright Dental",
  branches: [] as Row[],
  updateError: null as { code: string; message: string } | null,
  writes: [] as Write[],
};

function staff(): Staff {
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let writing = false;
      const answer = () => {
        if (writing) return { data: [{ id: "row" }], error: fake.updateError };
        if (table === "clinics") return { data: { sms_name: fake.clinicSmsName }, error: null };
        const onlyActive = filters.some(([column, value]) => column === "active" && value === true);
        return { data: onlyActive ? fake.branches.filter((b) => b.active) : fake.branches, error: null };
      };
      const write = (kind: Write["kind"]) => (values: Record<string, unknown>) => {
        writing = true;
        fake.writes.push({ table, kind, values, filters });
        return chain;
      };
      const chain = {
        select: () => chain,
        order: () => chain,
        single: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        insert: write("insert"),
        update: write("update"),
        throwOnError: async () => {
          const result = answer();
          if (result.error) throw result.error;
          return result;
        },
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, userId: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", clinicId: CLINIC } as unknown as Staff;
}

const main = (over: Partial<Row> = {}): Row => ({ id: MAIN, name: "Main", sms_name: "Main", address: "12 Rizal St, Makati", maps_url: null, active: true, sort: 0, ...over });
const pasig = (over: Partial<Row> = {}): Row => ({ id: PASIG, name: "Pasig", sms_name: "Pasig", address: "5 Ortigas Ave, Pasig", maps_url: null, active: true, sort: 1, ...over });
const branch = { name: "Pasig", smsName: "Pasig", address: "5 Ortigas Ave, Pasig", mapsUrl: "" };
const profile = { name: "Bright Smile Dental", smsName: "Bright Smile Dental", slug: "bright-smile", mobile: "0917 123 4567", address: "Makati", mapsUrl: "" };
const FITS = "Use 1 to 6 characters, so the clinic and branch names fit in a text together.";

beforeEach(() => {
  fake.clinicSmsName = "Bright Dental";
  fake.branches = [main()];
  fake.updateError = null;
  fake.writes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveBranch", () => {
  it("adds a branch last and active once its short name fits beside the clinic's text name", async () => {
    expect(await saveBranch(staff(), null, branch)).toEqual({ ok: true });
    expect(fake.writes).toEqual([
      { table: "branches", kind: "insert", values: { clinic_id: CLINIC, name: "Pasig", sms_name: "Pasig", address: "5 Ortigas Ave, Pasig", maps_url: null, sort: 1 }, filters: [] },
    ]);
  });

  it("refuses a second active branch whose short name would push the pair past 20 characters", async () => {
    expect(await saveBranch(staff(), null, { ...branch, smsName: "Quezon City" })).toEqual({ ok: false, field: "smsName", error: FITS });
    expect(fake.writes).toEqual([]);
  });

  it("checks the first branch too when a second becomes active, and names it", async () => {
    fake.branches = [main({ sms_name: "Main Branch" })];
    expect(await saveBranch(staff(), null, branch)).toEqual({ ok: false, error: `Main: ${FITS}` });
    expect(fake.writes).toEqual([]);
  });

  it("lets a clinic's only active branch keep a longer short name, since texts name no branch yet", async () => {
    expect(await saveBranch(staff(), MAIN, { ...branch, name: "Main", smsName: "Main Branch Office" })).toEqual({ ok: true });
    expect(fake.writes).toEqual([
      {
        table: "branches",
        kind: "update",
        values: { name: "Main", sms_name: "Main Branch Office", address: "5 Ortigas Ave, Pasig", maps_url: null },
        filters: [
          ["id", MAIN],
          ["clinic_id", CLINIC],
        ],
      },
    ]);
  });

  it("refuses a branch this clinic does not have, or an id that is not one, before writing", async () => {
    expect(await saveBranch(staff(), PASIG, branch)).toEqual({ ok: false, error: "That item no longer exists. Reload the page." });
    expect(await saveBranch(staff(), "not-an-id", branch)).toMatchObject({ ok: false });
    expect(fake.writes).toEqual([]);
  });
});

describe("setBranchActive", () => {
  it("says in words that the last active branch stays, as the database refuses it", async () => {
    fake.updateError = { code: "BSLAB", message: "a clinic keeps at least one active branch" };
    expect(await setBranchActive(staff(), MAIN, false)).toEqual({ ok: false, error: "Keep at least one active branch, or patients can't book." });
  });

  it("checks every active branch's short name before a second one opens again", async () => {
    fake.branches = [main(), pasig({ sms_name: "Pasig City", active: false })];
    expect(await setBranchActive(staff(), PASIG, true)).toEqual({ ok: false, error: `Pasig: ${FITS}` });
    expect(fake.writes).toEqual([]);
    fake.branches = [main(), pasig({ active: false })];
    expect(await setBranchActive(staff(), PASIG, true)).toEqual({ ok: true });
    expect(fake.writes.map((w) => w.values)).toEqual([{ active: true }]);
  });
});

describe("moveBranch", () => {
  it("moves a branch one place and numbers the order again", async () => {
    // Main and Pasig share sort 0, as the backfill left every first branch.
    fake.branches = [main(), pasig({ sort: 0 }), { ...pasig(), id: CUBAO, name: "Cubao", sms_name: "Cubao", sort: 1 }];
    expect(await moveBranch(staff(), CUBAO, "up")).toEqual({ ok: true });
    // Now Main, Cubao, Pasig: only Pasig's number changes.
    expect(fake.writes.map((w) => [w.filters[0][1], w.values.sort])).toEqual([[PASIG, 2]]);
  });

  it("changes nothing past either end", async () => {
    expect(await moveBranch(staff(), MAIN, "up")).toEqual({ ok: true });
    expect(await moveBranch(staff(), MAIN, "down")).toEqual({ ok: true });
    expect(fake.writes).toEqual([]);
  });
});

describe("saveProfile", () => {
  it("keeps room in the clinic's text name for its active branches' short names", async () => {
    fake.branches = [main({ sms_name: "Makati" }), pasig()];
    expect(await saveProfile(staff(), profile)).toEqual({
      ok: false,
      field: "smsName",
      error: "Texts add the branch's short name after this. Use up to 13 characters, or shorten your branches' short names first.",
    });
    expect(fake.writes).toEqual([]);
  });

  it("saves the clinic only: each branch keeps the address set under Branches", async () => {
    expect(await saveProfile(staff(), profile)).toEqual({ ok: true });
    expect(fake.writes.map((w) => w.table)).toEqual(["clinics"]);
  });
});
```

In `tests/unit/settings-actions.test.ts`, replace:

```ts
    saveProcedure: vi.fn(saved),
    setProcedureActive: vi.fn(saved),
  };
});
```

with:

```ts
    saveProcedure: vi.fn(saved),
    setProcedureActive: vi.fn(saved),
    saveBranch: vi.fn(saved),
    setBranchActive: vi.fn(saved),
    moveBranch: vi.fn(saved),
  };
});
```

In `tests/unit/settings-actions.test.ts`, replace:

```ts
  actions.saveProcedureAction(null, {}),
  actions.setProcedureActiveAction(ID, false),
];
```

with:

```ts
  actions.saveProcedureAction(null, {}),
  actions.setProcedureActiveAction(ID, false),
  actions.saveBranchAction(null, {}),
  actions.setBranchActiveAction(ID, false),
  actions.moveBranchAction(ID, "up"),
];
```

In `tests/unit/settings-actions.test.ts`, replace:

```ts
    expect(settings.saveProfile).toHaveBeenCalledOnce();
    expect(settings.setProcedureActive).toHaveBeenCalledOnce();
```

with:

```ts
    expect(settings.saveProfile).toHaveBeenCalledOnce();
    expect(settings.setProcedureActive).toHaveBeenCalledOnce();
    expect(settings.moveBranch).toHaveBeenCalledWith(member("owner"), ID, "up");
```

Run: `npx vitest run tests/unit/branches.test.ts tests/unit/settings-input.test.ts tests/unit/branch-settings.test.ts tests/unit/settings-actions.test.ts`
Expected: FAIL: 19 tests. The new ones in `branches.test.ts`, `settings-input.test.ts`, and `branch-settings.test.ts` with `TypeError: activeBranchesProblem is not a function` (and `clinicSmsNameProblem`, `parseBranch`, `saveBranch`, `setBranchActive`, `moveBranch`); both `settings-actions.test.ts` tests with `saveBranchAction is not a function`; and the two `saveProfile` tests, because today's `saveProfile` saves the too long name and copies the address to the branch. The 19 other tests pass.

- [ ] **Step 2: Write the branch rules**

In `src/lib/validate.ts`, replace:

```ts
  timeOffNote: 100,
} as const;
```

with:

```ts
  timeOffNote: 100,
  branchName: 40,
  branchSmsName: 18,
} as const;
```

Append to the end of `src/lib/branches.ts`:

```ts

/**
 * With 2 or more active branches every text names the branch (spec 4): the first active branch whose short name does not
 * fit beside the clinic's text name, named with the reason, or null. Settings runs it when a second branch becomes active.
 */
export function activeBranchesProblem(clinicSmsName: string, active: { name: string; smsName: string }[]): string | null {
  if (active.length < 2) return null;
  for (const b of active) {
    const problem = branchSmsNameProblem(clinicSmsName, b.smsName);
    if (problem) return `${b.name}: ${problem}`;
  }
  return null;
}

/** Why a new text name for the clinic leaves no room for its active branches' short names (spec 4), or null. */
export function clinicSmsNameProblem(clinicSmsName: string, activeBranchSmsNames: string[]): string | null {
  if (activeBranchSmsNames.length < 2) return null;
  const room = LIMITS.clinicSmsName - 1 - Math.max(...activeBranchSmsNames.map((n) => n.trim().length));
  if (clinicSmsName.trim().length <= room) return null;
  return `Texts add the branch's short name after this. Use up to ${room} characters, or shorten your branches' short names first.`;
}
```

In `src/lib/settings-input.ts`, replace:

```ts
export type ProcedureRow = { name: string; duration_minutes: number };
```

with:

```ts
export type ProcedureRow = { name: string; duration_minutes: number };
export type BranchRow = { name: string; sms_name: string; address: string; maps_url: string | null };
```

Append to the end of `src/lib/settings-input.ts`:

```ts

/**
 * A branch (booking flow spec 4): the name patients see, a short name for texts, the address patients go to, and an
 * optional https map link. Whether the short name fits beside the clinic's text name is checked on save, against the
 * other active branches.
 */
export function parseBranch(value: unknown): Parsed<BranchRow> {
  const v = record(value);
  const name = cleanText(v.name, LIMITS.branchName);
  if (!name) return fail("name", `Enter a name, up to ${LIMITS.branchName} characters.`);
  const smsName = cleanText(v.smsName, LIMITS.branchSmsName);
  if (!smsName) return fail("smsName", `Use 1 to ${LIMITS.branchSmsName} characters.`);
  const address = cleanText(v.address, LIMITS.address);
  if (!address) return fail("address", `Enter the address patients go to, up to ${LIMITS.address} characters.`);
  const mapsUrl = text(v.mapsUrl).trim();
  if (mapsUrl && !mapsUrlOk(mapsUrl)) return fail("mapsUrl", `Paste a map link that starts with https://, up to ${LIMITS.mapsUrl} characters.`);
  return { ok: true, value: { name, sms_name: smsName, address, maps_url: mapsUrl || null } };
}
```

- [ ] **Step 3: Save, order, and deactivate branches**

In `src/lib/clinic-settings.ts`, replace:

```ts
import "server-only";
import type { Clock } from "@/lib/onboarding";
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
```

with:

```ts
import "server-only";
import { activeBranchesProblem, branchSmsNameProblem, clinicSmsNameProblem } from "@/lib/branches";
import type { Clock } from "@/lib/onboarding";
import { parseBranch, parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
```

In `src/lib/clinic-settings.ts`, replace:

```ts
  procedures: { id: string; name: string; minutes: number; active: boolean }[];
};
```

with:

```ts
  procedures: { id: string; name: string; minutes: number; active: boolean }[];
  /** Every branch, in the order patients see them (booking flow spec 4). */
  branches: { id: string; name: string; smsName: string; address: string; mapsUrl: string; active: boolean }[];
};

type BranchRow = { id: string; name: string; sms_name: string; address: string; maps_url: string | null; active: boolean; sort: number };
```

In `src/lib/clinic-settings.ts`, replace:

```ts
/** Everything the Settings page edits. Time off lists only entries that are not over yet. */
export async function loadSettings(staff: Staff, now: Date): Promise<SettingsView> {
  const [clinic, dentists, hours, timeOff, procedures] = await Promise.all([
```

with:

```ts
/** The clinic's branches in the order patients see them: sort, then when they were added. */
async function branchRows(staff: Staff): Promise<BranchRow[]> {
  const { data } = await staff.db
    .from("branches")
    .select("id, name, sms_name, address, maps_url, active, sort")
    .eq("clinic_id", staff.clinicId)
    .order("sort")
    .order("created_at")
    .order("id")
    .throwOnError();
  return data as BranchRow[];
}

/** The clinic's name for texts: every text starts with it (booking flow spec 4 adds a branch after it). */
async function clinicSmsName(staff: Staff): Promise<string> {
  const { data } = await staff.db.from("clinics").select("sms_name").eq("id", staff.clinicId).single().throwOnError();
  return (data as { sms_name: string }).sms_name;
}

/** Everything the Settings page edits. Time off lists only entries that are not over yet. */
export async function loadSettings(staff: Staff, now: Date): Promise<SettingsView> {
  const [clinic, dentists, hours, timeOff, procedures, branches] = await Promise.all([
```

In `src/lib/clinic-settings.ts`, replace:

```ts
    staff.db.from("procedures").select("id, name, duration_minutes, active").eq("clinic_id", staff.clinicId).order("name").throwOnError(),
  ]);
```

with:

```ts
    staff.db.from("procedures").select("id, name, duration_minutes, active").eq("clinic_id", staff.clinicId).order("name").throwOnError(),
    branchRows(staff),
  ]);
```

In `src/lib/clinic-settings.ts`, replace:

```ts
      minutes: p.duration_minutes,
      active: p.active,
    })),
  };
}
```

with:

```ts
      minutes: p.duration_minutes,
      active: p.active,
    })),
    branches: branches.map((b) => ({ id: b.id, name: b.name, smsName: b.sms_name, address: b.address, mapsUrl: b.maps_url ?? "", active: b.active })),
  };
}
```

In `src/lib/clinic-settings.ts`, replace:

```ts
/** Clinic profile. RLS lets staff update only their own clinic row. */
export async function saveProfile(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseProfile(input);
  if (!parsed.ok) return parsed;
  try {
    const { error } = await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId);
    if (error?.code === "23505") return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
    if (error) throw error;
    // Until Settings has Branches (plan 8), a clinic with one branch keeps that branch's address and map link in step
    // with the profile, so the booking page never shows an address the owner already changed.
    const { data: branches } = await staff.db.from("branches").select("id").eq("clinic_id", staff.clinicId).throwOnError();
    const only = branches as { id: string }[];
    if (only.length === 1) {
      await staff.db.from("branches").update({ address: parsed.value.address, maps_url: parsed.value.maps_url }).eq("id", only[0].id).throwOnError();
    }
    return { ok: true };
```

with:

```ts
/**
 * Clinic profile. RLS lets staff update only their own clinic row. Patients see each branch's own address and map link
 * (Settings > Branches). With 2 or more active branches, texts add the branch's short name after the clinic's, so a new
 * text name must leave room for them (booking flow spec 4).
 */
export async function saveProfile(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseProfile(input);
  if (!parsed.ok) return parsed;
  try {
    const { data: active } = await staff.db.from("branches").select("sms_name").eq("clinic_id", staff.clinicId).eq("active", true).throwOnError();
    const problem = clinicSmsNameProblem(parsed.value.sms_name, (active as { sms_name: string }[]).map((b) => b.sms_name));
    if (problem) return { ok: false, field: "smsName", error: problem };
    const { error } = await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId);
    if (error?.code === "23505") return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
    if (error) throw error;
    return { ok: true };
```

Append to the end of `src/lib/clinic-settings.ts`:

```ts

/**
 * Adds a branch (id null: active, last in order) or edits one (booking flow spec 4). With 2 or more active branches every
 * text names the branch after the clinic, so an active branch's short name must fit beside the clinic's text name, and
 * so must every other active branch's (the first one is checked here when a second becomes active).
 */
export async function saveBranch(staff: Staff, id: string | null, input: unknown): Promise<Saved> {
  if (id !== null && !isUuid(id)) return { ok: false, error: GONE };
  const parsed = parseBranch(input);
  if (!parsed.ok) return parsed;
  try {
    const [rows, clinicName] = await Promise.all([branchRows(staff), clinicSmsName(staff)]);
    const current = id === null ? null : rows.find((b) => b.id === id);
    if (current === undefined) return { ok: false, error: GONE };
    const others = rows.filter((b) => b.active && b.id !== id).map((b) => ({ name: b.name, smsName: b.sms_name }));
    if ((current === null || current.active) && others.length > 0) {
      const mine = branchSmsNameProblem(clinicName, parsed.value.sms_name);
      if (mine) return { ok: false, field: "smsName", error: mine };
      const theirs = activeBranchesProblem(clinicName, [...others, { name: parsed.value.name, smsName: parsed.value.sms_name }]);
      if (theirs) return { ok: false, error: theirs };
    }
    if (current === null) {
      const sort = rows.reduce((last, b) => Math.max(last, b.sort), -1) + 1;
      await staff.db.from("branches").insert({ clinic_id: staff.clinicId, ...parsed.value, sort }).throwOnError();
      return { ok: true };
    }
    const { data } = await staff.db.from("branches").update(parsed.value).eq("id", current.id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("saveBranch", e);
  }
}

/**
 * Deactivates or reactivates a branch. Its visits stay; an inactive branch leaves the booking page. The database keeps
 * the last active branch (BSLAB). Opening a branch again checks every active branch's short name for texts.
 */
export async function setBranchActive(staff: Staff, id: string, active: boolean): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    if (active) {
      const [rows, clinicName] = await Promise.all([branchRows(staff), clinicSmsName(staff)]);
      const after = rows.filter((b) => b.active || b.id === id).map((b) => ({ name: b.name, smsName: b.sms_name }));
      const problem = activeBranchesProblem(clinicName, after);
      if (problem) return { ok: false, error: problem };
    }
    const { data, error } = await staff.db.from("branches").update({ active }).eq("id", id).eq("clinic_id", staff.clinicId).select("id");
    if (error?.code === "BSLAB") return { ok: false, error: "Keep at least one active branch, or patients can't book." };
    if (error) throw error;
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("setBranchActive", e);
  }
}

/** Moves a branch one place up or down in the order patients see (booking flow spec 4). */
export async function moveBranch(staff: Staff, id: string, direction: "up" | "down"): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    const rows = await branchRows(staff);
    const from = rows.findIndex((b) => b.id === id);
    if (from < 0) return { ok: false, error: GONE };
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= rows.length) return { ok: true };
    const order = [...rows];
    [order[from], order[to]] = [order[to], order[from]];
    // ponytail: one update per branch whose place changed, not one transaction; moving again tidies a half-done move.
    for (const [sort, b] of order.entries()) {
      if (b.sort !== sort) await staff.db.from("branches").update({ sort }).eq("id", b.id).eq("clinic_id", staff.clinicId).throwOnError();
    }
    return { ok: true };
  } catch (e) {
    return failure("moveBranch", e);
  }
}
```

- [ ] **Step 4: The owner's actions**

In `src/app/app/settings/actions.ts`, replace:

```ts
export async function setProcedureActiveAction(procedureId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true), requireOwner);
}
```

with:

```ts
export async function setProcedureActiveAction(procedureId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true), requireOwner);
}

/** Booking flow spec 4: branches are the owner's, like the rest of the clinic's setup. */
export async function saveBranchAction(branchId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.saveBranch(staff, idOrNull(branchId), input), requireOwner);
}

export async function setBranchActiveAction(branchId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setBranchActive(staff, String(branchId), active === true), requireOwner);
}

export async function moveBranchAction(branchId: unknown, direction: unknown): Promise<Saved> {
  return run((staff) => settings.moveBranch(staff, String(branchId), direction === "up" ? "up" : "down"), requireOwner);
}
```

- [ ] **Step 5: The Branches section**

Create `src/app/app/settings/BranchEditor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Field from "@/components/Field";
import type { SettingsView } from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { LIMITS } from "@/lib/validate";
import { moveBranchAction, saveBranchAction, setBranchActiveAction } from "./actions";
import { errorFor, Feedback } from "./ClinicForms";

type Branch = SettingsView["branches"][number];

const FIELDS = ["name", "smsName", "address", "mapsUrl"];

/**
 * One branch (or "Add a branch" when null): name, short name for texts, address, map link, its place in the order, and
 * active. `named` is true when texts name the branch: the clinic has, or with this one will have, 2 or more active.
 */
function BranchRow({ branch, clinicSmsName, named, first, last }: { branch: Branch | null; clinicSmsName: string; named: boolean; first?: boolean; last?: boolean }) {
  const blank = { name: "", smsName: "", address: "", mapsUrl: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(branch ? { name: branch.name, smsName: branch.smsName, address: branch.address, mapsUrl: branch.mapsUrl } : blank);
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const room = Math.max(1, LIMITS.clinicSmsName - clinicSmsName.trim().length - 1);
  const example = `${clinicSmsName} ${form.smsName.trim() || "Makati"}`;
  const act = (action: () => Promise<Saved>) => startTransition(async () => setResult(await action()));

  if (!open) {
    return branch ? (
      <div className="member-row cursor-default">
        <span className="nm">
          {branch.name}
          <span className="meta block">{branch.address}</span>
        </span>
        <span className={`chip ${branch.active ? "chip-green" : "chip-gold"}`}>{branch.active ? "Active" : "Inactive"}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-soft mt-3" onClick={() => setOpen(true)}>
        Add a branch
      </button>
    );
  }

  return (
    <div className="cf-box mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await saveBranchAction(branch?.id ?? null, form);
            setResult(r);
            if (r.ok && !branch) {
              setForm(blank);
              setOpen(false);
            }
          });
        }}
      >
        <Field label="Branch name" hint='Patients see it, like "Makati".' error={err("name")}>
          <input className="f-input" maxLength={LIMITS.branchName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field
          label="Short name for texts"
          hint={named ? `Up to ${room} characters. Texts say "${example}".` : `With 2 or more active branches, texts add it after your clinic's name, like "${example}".`}
          error={err("smsName")}
        >
          <input className="f-input" maxLength={LIMITS.branchSmsName} value={form.smsName} onChange={(e) => setForm({ ...form, smsName: e.target.value })} />
        </Field>
        <Field label="Address" hint="Where patients go. It shows on your booking page." error={err("address")}>
          <input className="f-input" maxLength={LIMITS.address} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Map link" optional hint="Paste a Google Maps share link. It shows on your booking page." error={err("mapsUrl")}>
          <input
            className="f-input"
            type="url"
            inputMode="url"
            maxLength={LIMITS.mapsUrl}
            placeholder="https://maps.app.goo.gl/..."
            value={form.mapsUrl}
            onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
          />
        </Field>
        <Feedback result={result} inline={FIELDS} />
        <div className="action-row">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
            {pending ? "Saving..." : branch ? "Save branch" : "Add branch"}
          </button>
        </div>
      </form>

      {branch && (
        <>
          <h3 className="f-label mt-6">Order on the booking page</h3>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" disabled={pending || first} onClick={() => act(() => moveBranchAction(branch.id, "up"))}>
              Move up
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending || last} onClick={() => act(() => moveBranchAction(branch.id, "down"))}>
              Move down
            </button>
          </div>
          <button
            type="button"
            className={`btn mt-5 ${branch.active ? "btn-danger" : "btn-soft"}`}
            disabled={pending}
            onClick={() => act(() => setBranchActiveAction(branch.id, !branch.active))}
          >
            {branch.active ? "Deactivate" : "Reactivate"}
          </button>
          <p className="f-hint">Inactive branches leave the booking page. Their visits stay on the schedule.</p>
        </>
      )}
    </div>
  );
}

/** Settings > Branches (booking flow spec 4), for the owner: each branch's address and calendar, and their order. */
export default function BranchEditor({ branches, clinicSmsName }: { branches: Branch[]; clinicSmsName: string }) {
  const active = branches.filter((b) => b.active).length;
  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Branches</h2>
      <p className="f-hint">
        Each branch has its own address and calendar. With 2 or more active branches, patients choose one when they book, and texts name it.
      </p>
      <div className="member-list mt-2">
        {branches.map((b, i) => (
          <BranchRow key={b.id} branch={b} clinicSmsName={clinicSmsName} named={b.active ? active > 1 : active > 0} first={i === 0} last={i === branches.length - 1} />
        ))}
      </div>
      <BranchRow branch={null} clinicSmsName={clinicSmsName} named={active > 0} />
    </section>
  );
}
```

In `src/app/app/settings/ClinicForms.tsx`, replace:

```tsx
const PROFILE_FIELDS = ["name", "smsName", "slug", "mobile", "address", "mapsUrl"];

/** Clinic profile, including the map link. Warns before the booking link changes (spec 5.3). */
```

with:

```tsx
const PROFILE_FIELDS = ["name", "smsName", "slug", "mobile", "address"];

/**
 * Clinic profile. Warns before the booking link changes (spec 5.3). Patients see each branch's address and map link
 * (Settings > Branches), so the clinic's own map link is kept as stored and sent back unchanged.
 */
```

In `src/app/app/settings/ClinicForms.tsx`, replace:

```tsx
      <Field label="Address" error={err("address")}>
        <input className="f-input" maxLength={200} value={form.address} onChange={set("address")} />
      </Field>
      <Field label="Map link" optional hint="Paste a Google Maps share link. It shows on your booking page." error={err("mapsUrl")}>
        <input
          className="f-input"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://maps.app.goo.gl/..."
          value={form.mapsUrl}
          onChange={set("mapsUrl")}
        />
      </Field>
```

with:

```tsx
      <Field label="Clinic address" hint="Your clinic's own address. Patients see each branch's address and map link, set under Branches." error={err("address")}>
        <input className="f-input" maxLength={200} value={form.address} onChange={set("address")} />
      </Field>
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
import { AccountForms, ProfileForm, RulesForm } from "./ClinicForms";
```

with:

```tsx
import BranchEditor from "./BranchEditor";
import { AccountForms, ProfileForm, RulesForm } from "./ClinicForms";
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
 * Spec 5.3 Settings: clinic profile, booking rules and alerts, dentists, procedures, account. Staff see only what they
 * may use (teams spec 4): alerts on their device, dentists' time off, the plan's status, and their account.
```

with:

```tsx
 * Spec 5.3 Settings: clinic profile, branches (booking flow spec 4), booking rules and alerts, dentists, procedures,
 * account. Staff see only what they may use (teams spec 4): alerts on their device, dentists' time off, the plan's
 * status, and their account.
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
      {owner && <ProfileForm clinic={settings.clinic} appUrl={appUrl()} />}
```

with:

```tsx
      {owner && <ProfileForm clinic={settings.clinic} appUrl={appUrl()} />}
      {owner && <BranchEditor branches={settings.branches} clinicSmsName={settings.clinic.smsName} />}
```

- [ ] **Step 6: Check and commit**

Run: `npx vitest run tests/unit/branches.test.ts tests/unit/settings-input.test.ts tests/unit/branch-settings.test.ts tests/unit/settings-actions.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: the four files PASS; `tsc` prints nothing; lint clean; every test PASS (51 files, 576 tests).

```powershell
git add src/lib/validate.ts src/lib/branches.ts tests/unit/branches.test.ts src/lib/settings-input.ts tests/unit/settings-input.test.ts src/lib/clinic-settings.ts tests/unit/branch-settings.test.ts src/app/app/settings/actions.ts tests/unit/settings-actions.test.ts src/app/app/settings/BranchEditor.tsx src/app/app/settings/ClinicForms.tsx src/app/app/settings/page.tsx
git commit -m "feat: add Settings > Branches for the owner" -m "The owner adds, renames, and orders branches, edits each one's short name for texts, address, and map link, and deactivates or reactivates them; the last active branch stays, in words. Once a clinic has 2 or more active branches every text names the branch, so saving a branch, opening a second one, and changing the clinic's text name all check that every pair fits in 20 characters. The profile no longer copies its address to the branch, and its map link input gives way to each branch's."
```
### Task 5: The dashboard with branches: Schedule, Requests, and New appointment

**Files:**
- Modify: `src/lib/schedule.ts`, `tests/unit/schedule.test.ts`, `src/lib/dashboard.ts`, `src/lib/staff-input.ts`, `tests/unit/staff-input.test.ts`, `src/lib/appointment-actions.ts`, `tests/unit/appointment-actions.test.ts`, `src/app/app/actions.ts`, `src/app/app/SlotPicker.tsx`, `src/app/app/new/NewAppointment.tsx`, `src/app/app/schedule/page.tsx`, `src/app/app/requests/page.tsx`

**Interfaces:**
- Consumes: `staffOpenStarts(staff, { dentistId, date, duration, ignoreId?, branchId? }, now)` (plan 7 already takes a branch); `smsClinicName` (plan 7); `create_booking`'s `p_branch_id` (plan 7's migration); `appointments.branch_id` and `working_hours.branch_id`.
- Produces:
  - From `@/lib/schedule` (pure): `HoursRow` and `DayRow` gain `branch_id`; `hoursByDentist(rows): Map<string, Map<string, Block[][]>>` (dentist, then branch, then the week); `ScheduleItem.branchId`; `assembleDay` checks a visit against its dentist's hours at the visit's own branch
  - From `@/lib/dashboard`: `type BranchOption = { id: string; name: string; active: boolean }`, `loadBranches(staff): Promise<BranchOption[]>` (every branch, in the clinic's order); `loadRequests(staff, now, branchId: string | null = null)` and `loadDay(staff, date, dentistId, now, branchId: string | null = null)` filter by branch (the trailing default keeps every existing caller, including `tests/db`); `RequestItem.branchId`; `BookingOptions.branches: { id: string; name: string }[]` (active ones)
  - From `@/lib/staff-input`: `ManualBooking.branchId: string | null`
  - From `@/lib/appointment-actions`: `activeBranches(staff): Promise<{ id: string; smsName: string }[]>` (was `activeBranchNames`); `createAppointment` books at the branch staff chose (or the first active one) and texts that branch's name
  - `openTimes` takes an optional `branchId`; `SlotPicker` takes an optional `branchId` prop

Rules (spec 4 "Dashboard, only when the clinic has 2 or more branches"):
- With 2 or more active branches: each appointment card on Schedule and Requests names its branch ("at Makati"), both pages filter by branch (`?branch={id}`, next to the dentist filter; a branch id is not personal data), and New appointment asks for the branch before the time. With one active branch every page looks exactly as before; New appointment sends the one branch without asking.
- "Outside hours" is per branch for every clinic: a visit is inside hours only within its dentist's blocks at the visit's branch (plan 7 left `loadDay` checking a dentist's blocks at every branch together).
- New appointment checks the chosen time at the chosen branch (`staffOpenStarts` with `branchId`), refuses a branch that is not an active branch of the clinic ("Choose an open branch."), passes `p_branch_id`, and the confirmation text names that branch when the clinic has 2 or more active branches. Moving a visit keeps its branch (spec 2.5; `staffOpenStarts` already uses the visit's own branch).

- [ ] **Step 1: Write the failing tests**

In `tests/unit/schedule.test.ts`, replace:

```ts
describe("hoursByDentist", () => {
  it("builds each dentist's week in minutes, sorted", () => {
    const week = hoursByDentist([
      { dentist_id: "d", weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { dentist_id: "d", weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
    ]).get("d")!;
```

with:

```ts
describe("hoursByDentist", () => {
  it("builds each dentist's week at each branch in minutes, sorted", () => {
    const byBranch = hoursByDentist([
      { dentist_id: "d", branch_id: "b", weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { dentist_id: "d", branch_id: "b", weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
      { dentist_id: "d", branch_id: "b2", weekday: 2, start_time: "09:00:00", end_time: "12:00:00" },
    ]).get("d")!;
    expect([...byBranch.keys()]).toEqual(["b", "b2"]);
    const week = byBranch.get("b")!;
```

In `tests/unit/schedule.test.ts`, replace:

```ts
    dentist_id: "d",
    patient_id: "p",
```

with:

```ts
    dentist_id: "d",
    branch_id: "b",
    patient_id: "p",
```

In `tests/unit/schedule.test.ts`, replace:

```ts
  const hours = hoursByDentist([
    { dentist_id: "d", weekday: 1, start_time: "09:00", end_time: "12:00" },
    { dentist_id: "d", weekday: 1, start_time: "13:00", end_time: "17:00" },
  ]);
```

with:

```ts
  const hours = hoursByDentist([
    { dentist_id: "d", branch_id: "b", weekday: 1, start_time: "09:00", end_time: "12:00" },
    { dentist_id: "d", branch_id: "b", weekday: 1, start_time: "13:00", end_time: "17:00" },
  ]);
```

In `tests/unit/schedule.test.ts`, replace:

```ts
    const [item] = assembleDay([{ ...row("x", "confirmed", 540, 570), dentist_id: "other" }], { hours, timeOff, failed: new Set(), now });
    expect(item.outsideHours).toBe(true);
    expect(item.actions).toEqual(["move", "cancel"]);
  });
});
```

with:

```ts
    const [item] = assembleDay([{ ...row("x", "confirmed", 540, 570), dentist_id: "other" }], { hours, timeOff, failed: new Set(), now });
    expect(item.outsideHours).toBe(true);
    expect(item.actions).toEqual(["move", "cancel"]);
  });

  it("checks a visit against its dentist's hours at the visit's own branch, and carries the branch", () => {
    // Monday mornings at b, Monday afternoons at b2: one dentist at 2 branches (spec 4).
    const split = hoursByDentist([
      { dentist_id: "d", branch_id: "b", weekday: 1, start_time: "09:00", end_time: "12:00" },
      { dentist_id: "d", branch_id: "b2", weekday: 1, start_time: "13:00", end_time: "17:00" },
    ]);
    const items = assembleDay(
      [row("morning", "confirmed", 540, 570), { ...row("wrong", "confirmed", 600, 630), branch_id: "b2" }, { ...row("afternoon", "pending", 840, 870), branch_id: "b2" }],
      { hours: split, timeOff: new Map(), failed: new Set(), now },
    );
    expect(items.map((i) => [i.id, i.branchId, i.outsideHours])).toEqual([
      ["morning", "b", false],
      ["wrong", "b2", true],
      ["afternoon", "b2", false],
    ]);
  });
});
```

In `tests/unit/staff-input.test.ts`, replace:

```ts
      value: { patientId: uuid(2), patient: null, procedureIds: [uuid(3)], slot: parseSlot(slot), sendText: true },
    });
  });
```

with:

```ts
      value: { patientId: uuid(2), patient: null, procedureIds: [uuid(3)], slot: parseSlot(slot), sendText: true, branchId: null },
    });
  });

  it("keeps the branch staff chose, and refuses one that is not an id", () => {
    const booking = { patientId: uuid(2), procedureIds: [uuid(3)], slot };
    expect(parseManualBooking({ ...booking, branchId: uuid(4) }, today)).toMatchObject({ ok: true, value: { branchId: uuid(4) } });
    expect(parseManualBooking({ ...booking, branchId: "Makati" }, today)).toEqual({ ok: false, errors: { branch: "Choose an open branch." } });
  });
```

In `tests/unit/appointment-actions.test.ts`, replace:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeStatus, rowText, type Row } from "@/lib/appointment-actions";
import { sendSms } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

vi.mock("@/lib/sms/send", () => ({ sendSms: vi.fn(async () => "logged") }));
```

with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeStatus, createAppointment, rowText, type Row } from "@/lib/appointment-actions";
import { staffOpenStarts } from "@/lib/dashboard";
import { sendSms } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

vi.mock("@/lib/sms/send", () => ({ sendSms: vi.fn(async () => "logged") }));
vi.mock("@/lib/dashboard", () => ({ staffOpenStarts: vi.fn() }));
```

In `tests/unit/appointment-actions.test.ts`, replace:

```ts
// like showsDentist and activeBranchNames, await the builder directly instead of calling a terminal method).
```

with:

```ts
// like showsDentist and activeBranches, await the builder directly instead of calling a terminal method).
```

Append to the end of `tests/unit/appointment-actions.test.ts`:

```ts

describe("createAppointment at a branch", () => {
  const MAKATI = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
  const PASIG = "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03";
  const DENTIST = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
  const PROCEDURE = "9e8d7c6b-5a49-4382-a716-151413121110";
  const now = new Date("2026-10-01T00:00:00.000Z");
  const startsAt = "2026-10-05T02:00:00.000Z";
  const input = (branchId?: string) => ({
    patient: { first: "Lolo", last: "Santos", mobile: "0917 111 2222" },
    procedureIds: [PROCEDURE],
    slot: { dentistId: DENTIST, startsAt, custom: false },
    sendText: true,
    branchId,
  });

  /** Every query answers its table's rows; the dentists count is 2, so texts name the dentist. */
  function staffWith(rpcs: Record<string, unknown>[]): Staff {
    const tables: Record<string, unknown> = {
      dentists: { id: DENTIST, sms_name: "Dr. Reyes" },
      procedures: [{ id: PROCEDURE, name: "Consultation", duration_minutes: 30 }],
      clinics: { sms_name: "Bright Dental", slug: "bright-dental" },
      branches: [
        { id: MAKATI, sms_name: "Makati" },
        { id: PASIG, sms_name: "Pasig" },
      ],
    };
    const db = {
      from: (table: string) => {
        const result = { data: tables[table], error: null, count: 2 };
        const c: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order", "in", "is", "single"]) c[method] = () => c;
        c.maybeSingle = async () => result;
        c.throwOnError = async () => result;
        c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
        return c;
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, ...args });
        return { data: "new-appointment", error: null };
      },
    };
    return { db, userId: "u1", clinicId: "c1" } as unknown as Staff;
  }

  beforeEach(() => {
    vi.mocked(sendSms).mockClear();
    vi.mocked(staffOpenStarts).mockReset().mockResolvedValue([new Date(startsAt)]);
  });

  it("checks the time at the branch staff chose, books there, and texts that branch's name", async () => {
    const rpcs: Record<string, unknown>[] = [];
    const staff = staffWith(rpcs);
    expect(await createAppointment(staff, input(PASIG), now)).toEqual({ ok: true, text: "logged" });
    expect(staffOpenStarts).toHaveBeenCalledWith(staff, expect.objectContaining({ branchId: PASIG, dentistId: DENTIST, duration: 30 }), now);
    expect(rpcs).toEqual([expect.objectContaining({ name: "create_booking", p_branch_id: PASIG, p_status: "confirmed" })]);
    expect(vi.mocked(sendSms).mock.calls[0][0].vars?.clinic).toBe("Bright Dental Pasig");
  });

  it("books at the first active branch when staff name none", async () => {
    const rpcs: Record<string, unknown>[] = [];
    expect(await createAppointment(staffWith(rpcs), input(), now)).toEqual({ ok: true, text: "logged" });
    expect(rpcs).toEqual([expect.objectContaining({ p_branch_id: MAKATI })]);
  });

  it("refuses a branch that is not one of the clinic's active branches", async () => {
    const rpcs: Record<string, unknown>[] = [];
    expect(await createAppointment(staffWith(rpcs), input("9f4a1b32-5d7e-4a0c-b3f6-4e8b0c2a7d14"), now)).toEqual({ ok: false, error: "Choose an open branch." });
    expect(rpcs).toEqual([]);
  });
});
```

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/staff-input.test.ts tests/unit/appointment-actions.test.ts`
Expected: FAIL: 7 tests. `hoursByDentist` still keys by dentist alone (`expected [ +0, 1, 2, 3, 4, 5, 6 ] to deeply equal [ 'b', 'b2' ]`); the new `assembleDay` test (no `branchId`, and the other branch's afternoon block still counts); both changed `parseManualBooking` tests (no `branchId` in the value); and the three `createAppointment at a branch` tests (the time is checked with no branch, `create_booking` gets no `p_branch_id`, and an unknown branch still books). The other 28 pass.

- [ ] **Step 2: Hours and outside hours per branch**

In `src/lib/schedule.ts`, replace:

```ts
export type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string };

/** working_hours rows as each dentist's week: index 0 is Sunday, blocks in minutes, sorted. */
export function hoursByDentist(rows: HoursRow[]): Map<string, Block[][]> {
  const weeks = new Map<string, Block[][]>();
  for (const h of rows) {
    const week = weeks.get(h.dentist_id) ?? Array.from({ length: 7 }, (): Block[] => []);
    week[h.weekday].push({ start: parseClock(h.start_time), end: parseClock(h.end_time) });
    weeks.set(h.dentist_id, week);
  }
  for (const week of weeks.values()) for (const blocks of week) blocks.sort((x, y) => x.start - y.start);
  return weeks;
}

export type DayRow = {
  id: string;
  status: Status;
  starts_at: string;
  ends_at: string;
  procedure_names: string[];
  dentist_id: string;
  patient_id: string;
```

with:

```ts
export type HoursRow = { dentist_id: string; branch_id: string; weekday: number; start_time: string; end_time: string };

/**
 * working_hours rows as each dentist's week at each branch (booking flow spec 4): dentist, then branch, then the week
 * (index 0 is Sunday), blocks in minutes, sorted.
 */
export function hoursByDentist(rows: HoursRow[]): Map<string, Map<string, Block[][]>> {
  const weeks = new Map<string, Map<string, Block[][]>>();
  for (const h of rows) {
    const byBranch = weeks.get(h.dentist_id) ?? new Map<string, Block[][]>();
    const week = byBranch.get(h.branch_id) ?? Array.from({ length: 7 }, (): Block[] => []);
    week[h.weekday].push({ start: parseClock(h.start_time), end: parseClock(h.end_time) });
    byBranch.set(h.branch_id, week);
    weeks.set(h.dentist_id, byBranch);
  }
  for (const byBranch of weeks.values()) for (const week of byBranch.values()) for (const blocks of week) blocks.sort((x, y) => x.start - y.start);
  return weeks;
}

export type DayRow = {
  id: string;
  status: Status;
  starts_at: string;
  ends_at: string;
  procedure_names: string[];
  dentist_id: string;
  branch_id: string;
  patient_id: string;
```

In `src/lib/schedule.ts`, replace:

```ts
  dentistId: string;
  patientId: string;
  patientName: string;
```

with:

```ts
  dentistId: string;
  branchId: string;
  patientId: string;
  patientName: string;
```

In `src/lib/schedule.ts`, replace:

```ts
 * One day's appointments in time order with their flags (spec 5.3 and 13). "Outside hours" applies to
 * pending and confirmed visits that are not inside one working block, or that overlap time off.
 */
export function assembleDay(
  rows: DayRow[],
  ctx: { hours: Map<string, Block[][]>; timeOff: Map<string, Busy[]>; failed: Set<string>; now: Date },
): ScheduleItem[] {
```

with:

```ts
 * One day's appointments in time order with their flags (spec 5.3 and 13). "Outside hours" applies to
 * pending and confirmed visits that are not inside one of their dentist's working blocks at the visit's own branch
 * (booking flow spec 4), or that overlap time off.
 */
export function assembleDay(
  rows: DayRow[],
  ctx: { hours: Map<string, Map<string, Block[][]>>; timeOff: Map<string, Busy[]>; failed: Set<string>; now: Date },
): ScheduleItem[] {
```

In `src/lib/schedule.ts`, replace:

```ts
      const outside = !withinHours(start, end, ctx.hours.get(r.dentist_id) ?? NO_HOURS) || inTimeOff;
```

with:

```ts
      const outside = !withinHours(start, end, ctx.hours.get(r.dentist_id)?.get(r.branch_id) ?? NO_HOURS) || inTimeOff;
```

In `src/lib/schedule.ts`, replace:

```ts
        dentistId: r.dentist_id,
        patientId: r.patient_id,
```

with:

```ts
        dentistId: r.dentist_id,
        branchId: r.branch_id,
        patientId: r.patient_id,
```

- [ ] **Step 3: Load and filter by branch**

In `src/lib/dashboard.ts`, replace:

```ts
  procedures: string[];
  dentistName: string;
  patientId: string;
```

with:

```ts
  procedures: string[];
  dentistName: string;
  branchId: string;
  patientId: string;
```

In `src/lib/dashboard.ts`, replace:

```ts
  procedure_names: string[];
  patient_id: string;
  dentist: { name: string };
```

with:

```ts
  procedure_names: string[];
  patient_id: string;
  branch_id: string;
  dentist: { name: string };
```

In `src/lib/dashboard.ts`, replace:

```ts
/** Spec 5.3 Requests: pending requests still ahead, soonest first. Returning means a completed visit here before. */
export async function loadRequests(staff: Staff, now: Date): Promise<RequestItem[]> {
  const { data } = await staff.db
    .from("appointments")
    .select(
      "id, starts_at, created_at, procedure_names, patient_id, dentist:dentists(name), patient:patients(first_name, last_name, mobile)",
    )
    .eq("clinic_id", staff.clinicId)
    .eq("status", "pending")
    .gt("starts_at", now.toISOString())
    .order("starts_at")
    .limit(100)
    .throwOnError();
```

with:

```ts
/**
 * Spec 5.3 Requests: pending requests still ahead, soonest first, at one branch when branchId names it (booking flow
 * spec 4). Returning means a completed visit here before.
 */
export async function loadRequests(staff: Staff, now: Date, branchId: string | null = null): Promise<RequestItem[]> {
  let query = staff.db
    .from("appointments")
    .select(
      "id, starts_at, created_at, procedure_names, patient_id, branch_id, dentist:dentists(name), patient:patients(first_name, last_name, mobile)",
    )
    .eq("clinic_id", staff.clinicId)
    .eq("status", "pending")
    .gt("starts_at", now.toISOString());
  if (branchId) query = query.eq("branch_id", branchId);
  const { data } = await query.order("starts_at").limit(100).throwOnError();
```

In `src/lib/dashboard.ts`, replace:

```ts
    dentistName: r.dentist.name,
    patientId: r.patient_id,
```

with:

```ts
    dentistName: r.dentist.name,
    branchId: r.branch_id,
    patientId: r.patient_id,
```

In `src/lib/dashboard.ts`, replace:

```ts
/** Spec 5.3 Schedule: one Manila day, every status except expired, with "outside hours" and "text not delivered". */
export async function loadDay(staff: Staff, date: string, dentistId: string | null, now: Date): Promise<DayView> {
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  let appointments = staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, procedure_names, dentist_id, patient_id, patient:patients(first_name, last_name, mobile)")
    .eq("clinic_id", staff.clinicId)
    .neq("status", "expired")
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (dentistId) appointments = appointments.eq("dentist_id", dentistId);
```

with:

```ts
/**
 * Spec 5.3 Schedule: one Manila day, every status except expired, with "outside hours" (at the visit's own branch) and
 * "text not delivered", for one dentist and one branch when they are named (booking flow spec 4).
 */
export async function loadDay(staff: Staff, date: string, dentistId: string | null, now: Date, branchId: string | null = null): Promise<DayView> {
  const from = manilaInstant(date, 0).toISOString();
  const to = manilaInstant(addDays(date, 1), 0).toISOString();
  let appointments = staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, procedure_names, dentist_id, branch_id, patient_id, patient:patients(first_name, last_name, mobile)")
    .eq("clinic_id", staff.clinicId)
    .neq("status", "expired")
    .gte("starts_at", from)
    .lt("starts_at", to);
  if (dentistId) appointments = appointments.eq("dentist_id", dentistId);
  if (branchId) appointments = appointments.eq("branch_id", branchId);
```

In `src/lib/dashboard.ts`, replace:

```ts
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
```

with:

```ts
    staff.db.from("working_hours").select("dentist_id, branch_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
```

In `src/lib/dashboard.ts`, replace:

```ts
 * The branch staff times are for (booking flow spec 4): a moved visit's own branch, otherwise the clinic's first
 * active branch, where create_booking puts a New appointment that names none (until plan 8 asks for one).
```

with:

```ts
 * The branch staff times are for (booking flow spec 4): a moved visit's own branch, otherwise the clinic's first
 * active branch, where create_booking puts a New appointment that names none.
```

In `src/lib/dashboard.ts`, replace:

```ts
export type BookingOptions = {
  dentists: { id: string; name: string }[];
  procedures: { id: string; name: string; minutes: number }[];
};

/** What New appointment offers: active dentists and active procedures. */
export async function loadBookingOptions(staff: Staff): Promise<BookingOptions> {
  const [dentists, procedures] = await Promise.all([
    staff.db.from("dentists").select("id, name").eq("clinic_id", staff.clinicId).eq("active", true).order("created_at").order("name").throwOnError(),
    staff.db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", staff.clinicId).eq("active", true).order("name").throwOnError(),
  ]);
  return {
    dentists: dentists.data as BookingOptions["dentists"],
```

with:

```ts
export type BookingOptions = {
  dentists: { id: string; name: string }[];
  procedures: { id: string; name: string; minutes: number }[];
  /** Active branches in the clinic's order: New appointment asks for one when there are 2 or more (spec 4). */
  branches: { id: string; name: string }[];
};

/** What New appointment offers: active dentists, active procedures, and active branches. */
export async function loadBookingOptions(staff: Staff): Promise<BookingOptions> {
  const [dentists, procedures, branches] = await Promise.all([
    staff.db.from("dentists").select("id, name").eq("clinic_id", staff.clinicId).eq("active", true).order("created_at").order("name").throwOnError(),
    staff.db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", staff.clinicId).eq("active", true).order("name").throwOnError(),
    loadBranches(staff),
  ]);
  return {
    branches: branches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })),
    dentists: dentists.data as BookingOptions["dentists"],
```

Append to the end of `src/lib/dashboard.ts`:

```ts

export type BranchOption = { id: string; name: string; active: boolean };

/** Every branch of the clinic in its order (booking flow spec 4): names for the cards, active ones for the filters. */
export async function loadBranches(staff: Staff): Promise<BranchOption[]> {
  const { data } = await staff.db
    .from("branches")
    .select("id, name, active")
    .eq("clinic_id", staff.clinicId)
    .order("sort")
    .order("created_at")
    .order("id")
    .throwOnError();
  return data as BranchOption[];
}
```

- [ ] **Step 4: New appointment at a branch**

In `src/lib/staff-input.ts`, replace:

```ts
export type ManualBooking = {
  patientId: string | null;
  patient: PatientFields | null;
  procedureIds: string[];
  slot: SlotChoice;
  sendText: boolean;
};
```

with:

```ts
export type ManualBooking = {
  patientId: string | null;
  patient: PatientFields | null;
  procedureIds: string[];
  slot: SlotChoice;
  sendText: boolean;
  /** Null: the clinic's first active branch (booking flow spec 4). */
  branchId: string | null;
};
```

In `src/lib/staff-input.ts`, replace:

```ts
  const slot = parseSlot(v.slot);
  if (!slot) errors.slot = "Choose a time.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { patientId, patient, procedureIds: ids as string[], slot: slot!, sendText: v.sendText === true } };
```

with:

```ts
  const slot = parseSlot(v.slot);
  if (!slot) errors.slot = "Choose a time.";
  const branchId = v.branchId === undefined || v.branchId === null ? null : v.branchId;
  if (branchId !== null && !isUuid(branchId)) errors.branch = "Choose an open branch.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { patientId, patient, procedureIds: ids as string[], slot: slot!, sendText: v.sendText === true, branchId: branchId as string | null } };
```

In `src/lib/appointment-actions.ts`, replace:

```ts
/** The short names for texts of the clinic's active branches, first branch first (booking flow spec 4). */
export async function activeBranchNames(staff: Staff): Promise<string[]> {
  const { data, error } = await staff.db
    .from("branches")
    .select("sms_name")
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .order("sort")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return (data as { sms_name: string }[]).map((b) => b.sms_name);
}
```

with:

```ts
/** The clinic's active branches with their short names for texts, first branch first (booking flow spec 4). */
export async function activeBranches(staff: Staff): Promise<{ id: string; smsName: string }[]> {
  const { data, error } = await staff.db
    .from("branches")
    .select("id, sms_name")
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .order("sort")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return (data as { id: string; sms_name: string }[]).map((b) => ({ id: b.id, smsName: b.sms_name }));
}
```

In `src/lib/appointment-actions.ts`, replace:

```ts
    const [row, dentistShown, branches] = await Promise.all([loadRow(staff, id), showsDentist(staff), activeBranchNames(staff)]);
```

with:

```ts
    const [row, dentistShown, branches] = await Promise.all([loadRow(staff, id), showsDentist(staff), activeBranches(staff)]);
```

In `src/lib/appointment-actions.ts`, replace:

```ts
 * would silently no-show it.
 */
async function timeProblem(
  staff: Staff,
  slot: SlotChoice,
  duration: number,
  now: Date,
  ignoreId?: string,
  requireFuture = false,
): Promise<string | null> {
  if (manilaDate(slot.startsAt) < manilaDate(now)) return "Pick today or a later date.";
  if (slot.custom) {
    if (requireFuture && slot.startsAt <= now) return "This time has already passed. Pick a later time.";
    return null;
  }
  const open = await staffOpenStarts(staff, { dentistId: slot.dentistId, date: manilaDate(slot.startsAt), duration, ignoreId }, now);
```

with:

```ts
 * would silently no-show it. An open time is checked at the branch it is for (booking flow spec 4): a moved visit's
 * own, or the branch a New appointment names.
 */
async function timeProblem(
  staff: Staff,
  slot: SlotChoice,
  duration: number,
  now: Date,
  opts: { ignoreId?: string; requireFuture?: boolean; branchId?: string } = {},
): Promise<string | null> {
  if (manilaDate(slot.startsAt) < manilaDate(now)) return "Pick today or a later date.";
  if (slot.custom) {
    if (opts.requireFuture && slot.startsAt <= now) return "This time has already passed. Pick a later time.";
    return null;
  }
  const open = await staffOpenStarts(
    staff,
    { dentistId: slot.dentistId, date: manilaDate(slot.startsAt), duration, ignoreId: opts.ignoreId, branchId: opts.branchId },
    now,
  );
```

In `src/lib/appointment-actions.ts`, replace:

```ts
      showsDentist(staff),
      activeBranchNames(staff),
    ]);
    if (!row) return { ok: false, error: MESSAGES.gone };
```

with:

```ts
      showsDentist(staff),
      activeBranches(staff),
    ]);
    if (!row) return { ok: false, error: MESSAGES.gone };
```

In `src/lib/appointment-actions.ts`, replace:

```ts
    const problem = await timeProblem(staff, slot, duration, now, row.id, true);
```

with:

```ts
    const problem = await timeProblem(staff, slot, duration, now, { ignoreId: row.id, requireFuture: true });
```

In `src/lib/appointment-actions.ts`, replace:

```ts
 * Spec 5.3 New appointment: confirmed immediately, source manual. The confirmation text goes out only
 * when sendText is on and the patient has a mobile.
 */
```

with:

```ts
 * Spec 5.3 New appointment: confirmed immediately, source manual, at the branch staff chose or the clinic's first
 * active branch (booking flow spec 4). The confirmation text goes out only when sendText is on and the patient has a
 * mobile, and names the branch when the clinic has 2 or more active branches.
 */
```

In `src/lib/appointment-actions.ts`, replace:

```ts
      showsDentist(staff),
      activeBranchNames(staff),
    ]);
    if (!dentist) return { ok: false, error: NO_DENTIST };
```

with:

```ts
      showsDentist(staff),
      activeBranches(staff),
    ]);
    if (!dentist) return { ok: false, error: NO_DENTIST };
    const branch = b.branchId === null ? branches[0] : branches.find((x) => x.id === b.branchId);
    if (!branch) return { ok: false, error: "Choose an open branch." };
```

In `src/lib/appointment-actions.ts`, replace:

```ts
    const problem = await timeProblem(staff, b.slot, duration, now);
    if (problem) return { ok: false, error: problem };

    const token = newToken();
    const startsAt = b.slot.startsAt;
    const { data: appointmentId, error } = await staff.db.rpc("create_booking", {
      p_clinic_id: staff.clinicId,
      p_dentist_id: dentist.id,
```

with:

```ts
    const problem = await timeProblem(staff, b.slot, duration, now, { branchId: branch.id });
    if (problem) return { ok: false, error: problem };

    const token = newToken();
    const startsAt = b.slot.startsAt;
    const { data: appointmentId, error } = await staff.db.rpc("create_booking", {
      p_clinic_id: staff.clinicId,
      p_branch_id: branch.id,
      p_dentist_id: dentist.id,
```

In `src/lib/appointment-actions.ts`, replace:

```ts
          // create_booking put it at the first active branch (staff name none until plan 8).
          clinicSmsName: smsClinicName(sms_name, branches[0], branches.length),
```

with:

```ts
          clinicSmsName: smsClinicName(sms_name, branch.smsName, branches.length),
```

In `src/app/app/actions.ts`, replace:

```ts
/** Open start times (ISO) for New and Move. The duration only shapes the list; saving recomputes it. */
export async function openTimes(q: unknown): Promise<string[]> {
  const staff = await requireStaff();
  const v = (typeof q === "object" && q !== null ? q : {}) as Record<string, unknown>;
  const duration = Number(v.duration);
  if (!isUuid(v.dentistId) || typeof v.date !== "string" || parseDay(v.date, "") !== v.date) return [];
  if (!Number.isInteger(duration) || duration < 5 || duration > MAX_DURATION) return [];
  const ignoreId = isUuid(v.ignoreId) ? v.ignoreId : undefined;
  try {
    const starts = await staffOpenStarts(staff, { dentistId: v.dentistId, date: v.date, duration, ignoreId }, new Date());
```

with:

```ts
/**
 * Open start times (ISO) for New and Move, at the branch New names (booking flow spec 4; Move uses the visit's own).
 * The duration only shapes the list; saving recomputes it.
 */
export async function openTimes(q: unknown): Promise<string[]> {
  const staff = await requireStaff();
  const v = (typeof q === "object" && q !== null ? q : {}) as Record<string, unknown>;
  const duration = Number(v.duration);
  if (!isUuid(v.dentistId) || typeof v.date !== "string" || parseDay(v.date, "") !== v.date) return [];
  if (!Number.isInteger(duration) || duration < 5 || duration > MAX_DURATION) return [];
  const ignoreId = isUuid(v.ignoreId) ? v.ignoreId : undefined;
  const branchId = isUuid(v.branchId) ? v.branchId : undefined;
  try {
    const starts = await staffOpenStarts(staff, { dentistId: v.dentistId, date: v.date, duration, ignoreId, branchId }, new Date());
```

In `src/app/app/SlotPicker.tsx`, replace:

```tsx
  initialDentistId?: string;
  ignoreId?: string;
  onChange: (slot: Slot | null) => void;
};
```

with:

```tsx
  initialDentistId?: string;
  ignoreId?: string;
  /** The branch New appointment chose (booking flow spec 4); Move leaves it out and gets the visit's own. */
  branchId?: string;
  onChange: (slot: Slot | null) => void;
};
```

In `src/app/app/SlotPicker.tsx`, replace:

```tsx
export default function SlotPicker({ dentists, duration, today, initialDentistId, ignoreId, onChange }: Props) {
```

with:

```tsx
export default function SlotPicker({ dentists, duration, today, initialDentistId, ignoreId, branchId, onChange }: Props) {
```

In `src/app/app/SlotPicker.tsx`, replace:

```tsx
      const list = await openTimes({ dentistId: nextDentist, date: nextDate, duration, ignoreId });
```

with:

```tsx
      const list = await openTimes({ dentistId: nextDentist, date: nextDate, duration, ignoreId, branchId });
```

In `src/app/app/new/NewAppointment.tsx`, replace:

```tsx
/** Spec 5.3 New appointment: for walk-ins, phone and Messenger bookings, seniors and PWDs. Confirmed immediately. */
export default function NewAppointment({ dentists, procedures, today, initialPatient }: Props) {
```

with:

```tsx
/**
 * Spec 5.3 New appointment: for walk-ins, phone and Messenger bookings, seniors and PWDs. Confirmed immediately. With 2
 * or more active branches it asks where first (booking flow spec 4); with one it books there without asking.
 */
export default function NewAppointment({ dentists, procedures, branches, today, initialPatient }: Props) {
```

In `src/app/app/new/NewAppointment.tsx`, replace:

```tsx
  const [sendText, setSendText] = useState(true);
```

with:

```tsx
  const [sendText, setSendText] = useState(true);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
```

In `src/app/app/new/NewAppointment.tsx`, replace:

```tsx
      slot,
      sendText: hasMobile && sendText,
    };
```

with:

```tsx
      slot,
      sendText: hasMobile && sendText,
      branchId: branchId || null,
    };
```

In `src/app/app/new/NewAppointment.tsx`, replace:

```tsx
      <section className="card card-pad mb-3" aria-labelledby="when-h">
        <h2 id="when-h" className="font-display text-[17px] font-bold">
          When
        </h2>
        {duration === 0 ? (
          <p className="f-hint">Choose procedures first.</p>
        ) : (
          <SlotPicker key={procedureIds.join(",")} dentists={dentists} duration={duration} today={today} onChange={setSlot} />
        )}
      </section>
```

with:

```tsx
      {branches.length > 1 && (
        <section className="card card-pad mb-3" aria-labelledby="branch-h">
          <h2 id="branch-h" className="font-display text-[17px] font-bold">
            Branch
          </h2>
          <div className="member-list mt-2">
            {branches.map((b) => (
              <label key={b.id} className="member-row">
                <input
                  type="radio"
                  name="branch"
                  checked={branchId === b.id}
                  onChange={() => {
                    setBranchId(b.id);
                    setSlot(null); // the picker remounts (its key has the branch)
                  }}
                />
                <span className="nm">{b.name}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="card card-pad mb-3" aria-labelledby="when-h">
        <h2 id="when-h" className="font-display text-[17px] font-bold">
          When
        </h2>
        {duration === 0 ? (
          <p className="f-hint">Choose procedures first.</p>
        ) : (
          <SlotPicker
            key={`${branchId} ${procedureIds.join(",")}`}
            dentists={dentists}
            duration={duration}
            today={today}
            branchId={branchId || undefined}
            onChange={setSlot}
          />
        )}
      </section>
```

- [ ] **Step 5: The branch on Schedule and Requests**

In `src/app/app/schedule/page.tsx`, replace:

```tsx
import { loadDay } from "@/lib/dashboard";
```

with:

```tsx
import { loadBranches, loadDay } from "@/lib/dashboard";
```

In `src/app/app/schedule/page.tsx`, replace:

```tsx
type Props = { searchParams: Promise<{ date?: string | string[]; dentist?: string | string[] }> };

/** Spec 5.3: day view with a dentist filter (2 or more active dentists), previous and next day, and a date jump. */
export default async function SchedulePage({ searchParams }: Props) {
  const staff = await requireStaff();
  const now = new Date();
  const query = await searchParams;
  const today = manilaDate(now);
  const date = parseDay(query.date, today);
  const dentistId = isUuid(query.dentist) ? query.dentist : null;
  const { dentists, items } = await loadDay(staff, date, dentistId, now);
  const active = dentists.filter((d) => d.active);
  const nameOf = new Map(dentists.map((d) => [d.id, d.name]));
  const href = (day: string, dentist: string | null = dentistId) =>
    `/app/schedule?date=${day}${dentist ? `&dentist=${dentist}` : ""}`;
```

with:

```tsx
type Props = { searchParams: Promise<{ date?: string | string[]; dentist?: string | string[]; branch?: string | string[] }> };

/**
 * Spec 5.3: day view with a dentist filter (2 or more active dentists), previous and next day, and a date jump. With 2
 * or more active branches, each visit names its branch and a branch filter joins the dentist one (booking flow spec 4).
 */
export default async function SchedulePage({ searchParams }: Props) {
  const staff = await requireStaff();
  const now = new Date();
  const query = await searchParams;
  const today = manilaDate(now);
  const date = parseDay(query.date, today);
  const dentistId = isUuid(query.dentist) ? query.dentist : null;
  const branchId = isUuid(query.branch) ? query.branch : null;
  const [{ dentists, items }, branches] = await Promise.all([loadDay(staff, date, dentistId, now, branchId), loadBranches(staff)]);
  const active = dentists.filter((d) => d.active);
  const nameOf = new Map(dentists.map((d) => [d.id, d.name]));
  const open = branches.filter((b) => b.active);
  const branchOf = new Map(branches.map((b) => [b.id, b.name]));
  const href = (day: string, dentist: string | null = dentistId, branch: string | null = branchId) =>
    `/app/schedule?date=${day}${dentist ? `&dentist=${dentist}` : ""}${branch ? `&branch=${branch}` : ""}`;
```

In `src/app/app/schedule/page.tsx`, replace:

```tsx
          {dentistId && <input type="hidden" name="dentist" value={dentistId} />}
```

with:

```tsx
          {dentistId && <input type="hidden" name="dentist" value={dentistId} />}
          {branchId && <input type="hidden" name="branch" value={branchId} />}
```

In `src/app/app/schedule/page.tsx`, replace:

```tsx
                {d.name}
              </Link>
            ))}
          </div>
        )}
      </div>
```

with:

```tsx
                {d.name}
              </Link>
            ))}
          </div>
        )}
        {open.length > 1 && (
          <div className="chip-row mt-3" role="group" aria-label="Branch">
            <Link href={href(date, dentistId, null)} className={`btn ${branchId ? "btn-ghost" : "btn-primary"}`} aria-current={branchId ? undefined : "true"}>
              All branches
            </Link>
            {open.map((b) => (
              <Link
                key={b.id}
                href={href(date, dentistId, b.id)}
                className={`btn ${branchId === b.id ? "btn-primary" : "btn-ghost"}`}
                aria-current={branchId === b.id ? "true" : undefined}
              >
                {b.name}
              </Link>
            ))}
          </div>
        )}
      </div>
```

In `src/app/app/schedule/page.tsx`, replace:

```tsx
              {active.length > 1 && ` with ${nameOf.get(item.dentistId) ?? "a former dentist"}`}
```

with:

```tsx
              {active.length > 1 && ` with ${nameOf.get(item.dentistId) ?? "a former dentist"}`}
              {open.length > 1 && ` at ${branchOf.get(item.branchId) ?? "a former branch"}`}
```

In `src/app/app/requests/page.tsx`, replace:

```tsx
import { loadRequests } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Requests" };

/** Spec 5.3: pending requests, soonest first, each with Approve and Decline. */
export default async function RequestsPage() {
  const staff = await requireStaff();
  const requests = await loadRequests(staff, new Date());
```

with:

```tsx
import { loadBranches, loadRequests } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "Requests" };

type Props = { searchParams: Promise<{ branch?: string | string[] }> };

/**
 * Spec 5.3: pending requests, soonest first, each with Approve and Decline. With 2 or more active branches, each names
 * its branch and a branch filter shows one at a time (booking flow spec 4).
 */
export default async function RequestsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { branch } = await searchParams;
  const branchId = isUuid(branch) ? branch : null;
  const [requests, branches] = await Promise.all([loadRequests(staff, new Date(), branchId), loadBranches(staff)]);
  const open = branches.filter((b) => b.active);
  const branchOf = new Map(branches.map((b) => [b.id, b.name]));
```

In `src/app/app/requests/page.tsx`, replace:

```tsx
        <span className="f-hint">{requests.length === 1 ? "1 waiting" : `${requests.length} waiting`}</span>
      </div>

      {requests.length === 0 && (
        <div className="card empty-note">No requests waiting. New ones from your booking page appear here.</div>
      )}
```

with:

```tsx
        <span className="f-hint">{requests.length === 1 ? "1 waiting" : `${requests.length} waiting`}</span>
      </div>

      {open.length > 1 && (
        <div className="chip-row mb-3" role="group" aria-label="Branch">
          <Link href="/app/requests" className={`btn ${branchId ? "btn-ghost" : "btn-primary"}`} aria-current={branchId ? undefined : "true"}>
            All branches
          </Link>
          {open.map((b) => (
            <Link
              key={b.id}
              href={`/app/requests?branch=${b.id}`}
              className={`btn ${branchId === b.id ? "btn-primary" : "btn-ghost"}`}
              aria-current={branchId === b.id ? "true" : undefined}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      {requests.length === 0 && (
        <div className="card empty-note">
          {branchId ? "No requests waiting at this branch." : "No requests waiting. New ones from your booking page appear here."}
        </div>
      )}
```

In `src/app/app/requests/page.tsx`, replace:

```tsx
              {r.procedures.join(", ")} with {r.dentistName}
```

with:

```tsx
              {r.procedures.join(", ")} with {r.dentistName}
              {open.length > 1 && ` at ${branchOf.get(r.branchId) ?? "a former branch"}`}
```

- [ ] **Step 6: Check and commit**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/staff-input.test.ts tests/unit/appointment-actions.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: the three files PASS; `tsc` prints nothing; lint clean; every test PASS (51 files, 581 tests).

```powershell
git add src/lib/schedule.ts tests/unit/schedule.test.ts src/lib/dashboard.ts src/lib/staff-input.ts tests/unit/staff-input.test.ts src/lib/appointment-actions.ts tests/unit/appointment-actions.test.ts src/app/app/actions.ts src/app/app/SlotPicker.tsx src/app/app/new/NewAppointment.tsx src/app/app/schedule/page.tsx src/app/app/requests/page.tsx
git commit -m "feat: show branches on the schedule, requests, and new appointments" -m "With 2 or more active branches every appointment card names its branch, Schedule and Requests filter by branch, and New appointment asks where before offering times there; its confirmation text names that branch. Outside hours now checks a visit against its dentist's hours at the visit's own branch. A clinic with one branch sees no change."
```
### Task 6: Working hours at each branch

**Files:**
- Create: `tests/unit/hours-editor.test.ts`
- Modify: `src/components/HoursEditor.tsx`, `src/lib/clinic-settings.ts`, `src/app/app/settings/DentistEditor.tsx`, `src/app/app/settings/page.tsx`, `tests/db/clinic-settings.test.ts`

**Interfaces:**
- Consumes: `parseDentist` and `saveDentist` (plan 7: a block may name its branch; a named branch must be an active one; blocks may not overlap even across branches); `SettingsView.branches` (Task 4).
- Produces:
  - From `@/components/HoursEditor`: `type HourBlock = Clock & { branchId?: string }`; `HoursEditor({ hours: HourBlock[][]; onChange; error?; branches?: { id: string; name: string }[] })`, which asks for each block's branch when given 2 or more branches (onboarding passes none and is unchanged)
  - `SettingsView.dentists[].hours: (Clock & { branchId: string })[][]`: each block names its branch, and only blocks at active branches are listed
  - `DentistEditor({ dentist, canEdit?, branches? })`

Rules (spec 4 "the working hours editor asks for each block's branch"):
- With 2 or more active branches, every block has a Branch select (a labelled `<select>`, the branch in words); a new block starts at the branch of the block before it, or the first branch. With one active branch the editor looks as before, and each block keeps the branch it has.
- A branch that is deactivated disappears from the editor with its blocks: nobody can book there, and saving the dentist replaces all their hours with what the editor shows (plan 7's `saveDentist` already refuses a block at an inactive branch). Reactivating a branch before that save brings its blocks back.
- Blocks at two branches on the same weekday may not overlap (`parseDentist`, plan 7), so one dentist is never in two places at once.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/hours-editor.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HoursEditor, { type HourBlock } from "@/components/HoursEditor";

const makati = { id: "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92", name: "Makati" };
const pasig = { id: "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03", name: "Pasig" };
const week = (monday: HourBlock[]): HourBlock[][] => [[], monday, [], [], [], [], []];

const render = (hours: HourBlock[][], branches?: { id: string; name: string }[]) =>
  renderToStaticMarkup(createElement(HoursEditor, { hours, onChange: () => {}, branches }));

describe("the working hours editor", () => {
  it("asks for each block's branch once the clinic has 2 or more active branches", () => {
    const html = render(
      week([
        { start: "09:00", end: "12:00", branchId: makati.id },
        { start: "13:00", end: "17:00", branchId: pasig.id },
      ]),
      [makati, pasig],
    );
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Monday, block 1, branch"');
    expect(html).toContain(`<option value="${pasig.id}" selected="">Pasig</option>`);
  });

  it("looks as before with one branch, and in onboarding", () => {
    const monday = week([{ start: "09:00", end: "12:00", branchId: makati.id }]);
    expect(render(monday, [makati])).not.toContain("<select");
    expect(render(monday)).not.toContain("<select");
  });
});
```

Run: `npx vitest run tests/unit/hours-editor.test.ts`
Expected: FAIL: the first test with `AssertionError: Target cannot be null or undefined.` (there is no select yet, so the match is null); the second passes.

- [ ] **Step 2: A branch for each block**

In `src/components/HoursEditor.tsx`, replace:

```tsx
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekly working hours with several blocks per day (spec 5.3 and 5.4). Used by onboarding and Settings. */
export default function HoursEditor({ hours, onChange, error }: { hours: Clock[][]; onChange: (hours: Clock[][]) => void; error?: string }) {
  function setDay(day: number, blocks: Clock[]) {
    onChange(hours.map((b, d) => (d === day ? blocks : b)));
  }
```

with:

```tsx
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A working block, and the branch it is at (booking flow spec 4). Onboarding's blocks name none. */
export type HourBlock = Clock & { branchId?: string };

/**
 * Weekly working hours with several blocks per day (spec 5.3 and 5.4). Used by onboarding and Settings. Given 2 or more
 * branches, each block also says which branch it is at (booking flow spec 4); a new block starts at the branch of the
 * block before it.
 */
export default function HoursEditor({
  hours,
  onChange,
  error,
  branches = [],
}: {
  hours: HourBlock[][];
  onChange: (hours: HourBlock[][]) => void;
  error?: string;
  branches?: { id: string; name: string }[];
}) {
  const many = branches.length > 1;
  function setDay(day: number, blocks: HourBlock[]) {
    onChange(hours.map((b, d) => (d === day ? blocks : b)));
  }
```

In `src/components/HoursEditor.tsx`, replace:

```tsx
          {blocks.map((b, k) => (
            <div key={k} className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input
                type="time"
                step={900}
                className="f-input"
                aria-label={`${DAYS[day]}, block ${k + 1}, starts`}
                value={b.start}
                onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)))}
              />
              <span className="meta">to</span>
              <input
                type="time"
                step={900}
                className="f-input"
                aria-label={`${DAYS[day]}, block ${k + 1}, ends`}
                value={b.end}
                onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)))}
              />
            </div>
          ))}
          <div className="flex gap-5">
            <button
              type="button"
              className="link py-3"
              onClick={() => setDay(day, [...blocks, blocks.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "17:00" }])}
            >
```

with:

```tsx
          {blocks.map((b, k) => (
            <div key={k} className="mt-2">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  type="time"
                  step={900}
                  className="f-input"
                  aria-label={`${DAYS[day]}, block ${k + 1}, starts`}
                  value={b.start}
                  onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)))}
                />
                <span className="meta">to</span>
                <input
                  type="time"
                  step={900}
                  className="f-input"
                  aria-label={`${DAYS[day]}, block ${k + 1}, ends`}
                  value={b.end}
                  onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)))}
                />
              </div>
              {many && (
                <select
                  className="f-input mt-2"
                  aria-label={`${DAYS[day]}, block ${k + 1}, branch`}
                  value={b.branchId ?? branches[0].id}
                  onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, branchId: e.target.value } : x)))}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <div className="flex gap-5">
            <button
              type="button"
              className="link py-3"
              onClick={() => {
                const next: HourBlock = blocks.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "17:00" };
                setDay(day, [...blocks, many ? { ...next, branchId: blocks.at(-1)?.branchId ?? branches[0].id } : next]);
              }}
            >
```

In `src/lib/clinic-settings.ts`, replace:

```ts
    hours: Clock[][];
    timeOff: { id: string; startsAt: string; endsAt: string; note: string }[];
```

with:

```ts
    /** Each block at its branch; blocks at an inactive branch are left out (booking flow spec 4). */
    hours: (Clock & { branchId: string })[][];
    timeOff: { id: string; startsAt: string; endsAt: string; note: string }[];
```

In `src/lib/clinic-settings.ts`, replace:

```ts
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
```

with:

```ts
    staff.db.from("working_hours").select("dentist_id, branch_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
```

In `src/lib/clinic-settings.ts`, replace:

```ts
  const hourRows = hours.data as { dentist_id: string; weekday: number; start_time: string; end_time: string }[];
```

with:

```ts
  // Nobody books at an inactive branch, so its blocks stay out of the editor; saving the dentist replaces them.
  const open = new Set(branches.filter((b) => b.active).map((b) => b.id));
  const hourRows = (hours.data as { dentist_id: string; branch_id: string; weekday: number; start_time: string; end_time: string }[]).filter((h) =>
    open.has(h.branch_id),
  );
```

In `src/lib/clinic-settings.ts`, replace:

```ts
          .map((h) => ({ start: clock(h.start_time), end: clock(h.end_time) }))
```

with:

```ts
          .map((h) => ({ start: clock(h.start_time), end: clock(h.end_time), branchId: h.branch_id }))
```

- [ ] **Step 3: Ask for it in Settings**

In `src/app/app/settings/DentistEditor.tsx`, replace:

```tsx
import HoursEditor from "@/components/HoursEditor";
```

with:

```tsx
import HoursEditor, { type HourBlock } from "@/components/HoursEditor";
```

In `src/app/app/settings/DentistEditor.tsx`, replace:

```tsx
/**
 * One dentist (or "Add a dentist" when null): name, short name, weekly hours, active, and time off. Staff (canEdit
 * false) see only the time off, the one part of a dentist they may change (teams spec 4).
 */
export default function DentistEditor({ dentist, canEdit = true }: { dentist: Dentist | null; canEdit?: boolean }) {
  const blank = { name: "", smsName: "", hours: DEFAULT_HOURS };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(dentist ? { name: dentist.name, smsName: dentist.smsName, hours: dentist.hours } : blank);
```

with:

```tsx
/**
 * One dentist (or "Add a dentist" when null): name, short name, weekly hours (each block at a branch once the clinic has
 * 2 or more active ones, booking flow spec 4), active, and time off. Staff (canEdit false) see only the time off, the
 * one part of a dentist they may change (teams spec 4).
 */
export default function DentistEditor({
  dentist,
  canEdit = true,
  branches = [],
}: {
  dentist: Dentist | null;
  canEdit?: boolean;
  branches?: { id: string; name: string }[];
}) {
  const blank = { name: "", smsName: "", hours: DEFAULT_HOURS };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; smsName: string; hours: HourBlock[][] }>(
    dentist ? { name: dentist.name, smsName: dentist.smsName, hours: dentist.hours } : blank,
  );
```

In `src/app/app/settings/DentistEditor.tsx`, replace:

```tsx
          <HoursEditor hours={form.hours} onChange={(hours) => setForm({ ...form, hours })} error={err("hours")} />
```

with:

```tsx
          <HoursEditor hours={form.hours} onChange={(hours) => setForm({ ...form, hours })} error={err("hours")} branches={branches} />
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
  const settings = await loadSettings(staff, new Date());
```

with:

```tsx
  const settings = await loadSettings(staff, new Date());
  const branches = settings.branches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }));
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
            <DentistEditor key={d.id} dentist={d} canEdit={owner} />
```

with:

```tsx
            <DentistEditor key={d.id} dentist={d} canEdit={owner} branches={branches} />
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
        {owner && <DentistEditor dentist={null} />}
```

with:

```tsx
        {owner && <DentistEditor dentist={null} branches={branches} />}
```

The database suite reads the hours back with their branch now. In `tests/db/clinic-settings.test.ts`, replace:

```ts
    expect(added.hours[1]).toEqual([{ start: "09:00", end: "12:00" }]);
```

with:

```ts
    expect(added.hours[1]).toMatchObject([{ start: "09:00", end: "12:00" }]);
```

In `tests/db/clinic-settings.test.ts`, replace:

```ts
    expect(view.dentists.find((d) => d.id === lim)!.hours[1]).toEqual([
```

with:

```ts
    expect(view.dentists.find((d) => d.id === lim)!.hours[1]).toMatchObject([
```

- [ ] **Step 4: Check and commit**

Run: `npx vitest run tests/unit/hours-editor.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: `hours-editor.test.ts` PASS (2); `tsc` prints nothing; lint clean; every test PASS (52 files, 583 tests).

```powershell
git add src/components/HoursEditor.tsx tests/unit/hours-editor.test.ts src/lib/clinic-settings.ts src/app/app/settings/DentistEditor.tsx src/app/app/settings/page.tsx tests/db/clinic-settings.test.ts
git commit -m "feat: ask for each working block's branch" -m "With 2 or more active branches, each block of a dentist's hours has a Branch select, and a new block starts at the branch of the one before it. Blocks at an inactive branch leave the editor. With one branch, and in onboarding, the editor looks as before."
```
### Task 7: The patient page's Patient form

**Files:**
- Create: `tests/unit/patient-form-view.test.ts`
- Modify: `src/lib/patients.ts`, `src/app/app/patients/[id]/page.tsx`

**Interfaces:**
- Consumes: `ALLERGIES`, `CONDITIONS`, `QUESTIONS`, `WOMEN_QUESTIONS`, `parseMedical` from `@/lib/intake` (Task 1, plan 7); the form's columns on `patients` (plan 7's migration), read through the staff member's RLS client.
- Produces:
  - From `@/lib/patients`: `type PatientFormView = { allergies: string[]; conditions: string[]; rows: { label: string; value: string }[]; signed: { name: string; at: string; version: string } }`, `formView(row): PatientFormView | null` (pure), and `PatientDetail.form: PatientFormView | null`

Rules (spec 6 "In the dashboard"):
- A "Patient form" section on the patient page, read only: allergies and ticked conditions first (in words, "None ticked" when empty), then the rest of the form, answered lines only, in the form's order, then who signed the waiver, when, and its version. A patient without a signed form (booked before the form existed, or added by staff) shows "No patient form on file." A deleted (anonymized) patient shows no section: the form was cleared with the rest.
- Health information: read with `requireStaff().db` (the existing patients policy: the clinic's members only), shown only on this staff page, never logged, never in a URL. Editing it stays out of scope (spec 9); staff edit the basic fields as today.
- The medical answers are read back through `parseMedical`, so the section shows exactly the fixed shape the server stored (women's answers only for a female patient, a detail only beside its Yes).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/patient-form-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formView } from "@/lib/patients";

const signed = { waiver_name: "Ana Santos Cruz", waiver_version: "2026-09-26", waiver_at: "2026-09-28T02:00:00.000Z" };
const empty = {
  middle_name: null,
  sex: null,
  address: null,
  occupation: null,
  email: null,
  guardian_name: null,
  hmo_number: null,
  previous_dentist: null,
  last_visit: null,
  visit_reason: null,
  emergency_name: null,
  emergency_mobile: null,
  waiver_name: null,
  waiver_version: null,
  waiver_at: null,
  medical: null,
};

describe("formView", () => {
  it("is null for a patient who never signed the form", () => {
    expect(formView(empty)).toBeNull();
  });

  it("puts allergies and ticked conditions first, then only what was answered, in the form's order", () => {
    const view = formView({
      ...empty,
      ...signed,
      sex: "female",
      address: "12 Rizal St, Makati",
      last_visit: "2025-06",
      emergency_name: "Ben Cruz",
      emergency_mobile: "+639175550000",
      medical: {
        goodHealth: true,
        takingMedicine: true,
        medicineDetail: "Losartan",
        tobacco: false,
        pregnant: false,
        allergies: ["latex", "antibiotics"],
        conditions: ["asthma", "other"],
        conditionOther: "Migraine",
      },
    });
    expect(view).toEqual({
      allergies: ["Penicillin or other antibiotics", "Latex"],
      conditions: ["Asthma", "Other: Migraine"],
      rows: [
        { label: "Sex", value: "Female" },
        { label: "Home address", value: "12 Rizal St, Makati" },
        { label: "Last dental visit", value: "June 2025" },
        { label: "Are you in good health?", value: "Yes" },
        { label: "Are you taking any medicine now?", value: "Yes: Losartan" },
        { label: "Do you smoke or use tobacco?", value: "No" },
        { label: "Are you pregnant?", value: "No" },
        { label: "Emergency contact", value: "Ben Cruz, 09175550000" },
      ],
      signed: { name: "Ana Santos Cruz", at: "2026-09-28T02:00:00.000Z", version: "2026-09-26" },
    });
  });

  it("shows a male patient no women's answers, and survives answers that are not the stored shape", () => {
    const male = formView({ ...empty, ...signed, sex: "male", medical: { pregnant: true, allergies: [] } });
    expect(male?.rows).toEqual([{ label: "Sex", value: "Male" }]);
    const odd = formView({ ...empty, ...signed, sex: "female", medical: "not an object" });
    expect(odd).toMatchObject({ allergies: [], conditions: [], rows: [{ label: "Sex", value: "Female" }] });
  });
});
```

Run: `npx vitest run tests/unit/patient-form-view.test.ts`
Expected: FAIL with `TypeError: formView is not a function` (3 tests).

- [ ] **Step 2: Read the form for the patient page**

In `src/lib/patients.ts`, replace:

```ts
import "server-only";
import type { Status } from "@/lib/appointments";
```

with:

```ts
import "server-only";
import type { Status } from "@/lib/appointments";
import { ALLERGIES, CONDITIONS, parseMedical, QUESTIONS, WOMEN_QUESTIONS } from "@/lib/intake";
import { localMobile } from "@/lib/phone";
```

In `src/lib/patients.ts`, replace:

```ts
  history: { id: string; startsAt: string; status: Status; procedures: string[]; dentistName: string }[];
  noShows: number;
};
```

with:

```ts
  history: { id: string; startsAt: string; status: Status; procedures: string[]; dentistName: string }[];
  noShows: number;
  /** The patient form, or null when there is none (booking flow spec 6). */
  form: PatientFormView | null;
};

/** The patient form as the patient page shows it: allergies and ticked conditions first (booking flow spec 6). */
export type PatientFormView = {
  allergies: string[];
  conditions: string[];
  /** The rest of the form, answered lines only, in the form's order. */
  rows: { label: string; value: string }[];
  signed: { name: string; at: string; version: string };
};

/** The form's columns on public.patients, as the patient page reads them. */
type FormRow = {
  middle_name: string | null;
  sex: "female" | "male" | null;
  address: string | null;
  occupation: string | null;
  email: string | null;
  guardian_name: string | null;
  hmo_number: string | null;
  previous_dentist: string | null;
  last_visit: string | null;
  visit_reason: string | null;
  emergency_name: string | null;
  emergency_mobile: string | null;
  waiver_name: string | null;
  waiver_version: string | null;
  waiver_at: string | null;
  medical: unknown;
};

const FORM_COLUMNS =
  "middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit, visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The patient form for the patient page (booking flow spec 6 "In the dashboard"), or null for a patient who never signed
 * one (booked before the form existed, or added by staff). Allergies and ticked conditions come first; the rest lists
 * only what was answered, in the form's order. The medical answers are read back through parseMedical, so only the
 * fixed shape shows. Health information: the clinic's members read it here and nowhere else, and it is never logged.
 */
export function formView(row: FormRow): PatientFormView | null {
  if (!row.waiver_name || !row.waiver_at || !row.waiver_version) return null;
  const medical = parseMedical(row.medical, row.sex ?? "male");
  const allergies = (medical?.allergies ?? []).map((k) => (k === "other" ? `Other: ${medical?.allergyOther ?? "not named"}` : ALLERGIES[k]));
  const conditions = (medical?.conditions ?? []).map((k) => (k === "other" ? `Other: ${medical?.conditionOther ?? "not named"}` : CONDITIONS[k]));
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value) rows.push({ label, value });
  };
  add("Middle name", row.middle_name);
  add("Sex", row.sex === "female" ? "Female" : row.sex === "male" ? "Male" : null);
  add("Home address", row.address);
  add("Occupation", row.occupation);
  add("Email", row.email);
  add("Parent or guardian", row.guardian_name);
  add("HMO card or member number", row.hmo_number);
  add("Previous dentist", row.previous_dentist);
  add("Last dental visit", row.last_visit ? `${MONTHS[Number(row.last_visit.slice(5, 7)) - 1]} ${row.last_visit.slice(0, 4)}` : null);
  add("Reason for the visit", row.visit_reason);
  if (medical) {
    for (const q of [...QUESTIONS, ...(row.sex === "female" ? WOMEN_QUESTIONS : [])]) {
      const answer = medical[q.key];
      if (answer === null) continue;
      const detail = answer && q.detail ? medical[q.detail.key] : null;
      add(q.label, answer ? (detail ? `Yes: ${detail}` : "Yes") : "No");
    }
  }
  add("Emergency contact", [row.emergency_name, row.emergency_mobile ? localMobile(row.emergency_mobile) : null].filter(Boolean).join(", ") || null);
  return { allergies, conditions, rows, signed: { name: row.waiver_name, at: row.waiver_at, version: row.waiver_version } };
}
```

In `src/lib/patients.ts`, replace:

```ts
type PatientRow = HitRow & { birthday: string | null; hmo: string | null; anonymized_at: string | null };
```

with:

```ts
type PatientRow = HitRow & FormRow & { birthday: string | null; hmo: string | null; anonymized_at: string | null };
```

In `src/lib/patients.ts`, replace:

```ts
      .select("id, first_name, last_name, mobile, birthday, hmo, anonymized_at")
```

with:

```ts
      .select(`id, first_name, last_name, mobile, birthday, hmo, anonymized_at, ${FORM_COLUMNS}`)
```

In `src/lib/patients.ts`, replace:

```ts
    noShows: rows.filter((r) => r.status === "no_show").length,
  };
}
```

with:

```ts
    noShows: rows.filter((r) => r.status === "no_show").length,
    form: formView(p),
  };
}
```

- [ ] **Step 3: Show it on the patient page**

In `src/app/app/patients/[id]/page.tsx`, replace:

```tsx
/** Spec 5.3 patient detail: editable details, appointment history, no-show count, and Delete. */
export default async function PatientPage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const detail = await loadPatient(staff, id);
  if (!detail) notFound();
  const { patient, history, noShows } = detail;
```

with:

```tsx
/**
 * Spec 5.3 patient detail: editable details, the patient form read only (booking flow spec 6), appointment history,
 * no-show count, and Delete.
 */
export default async function PatientPage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const detail = await loadPatient(staff, id);
  if (!detail) notFound();
  const { patient, history, noShows, form } = detail;
```

In `src/app/app/patients/[id]/page.tsx`, replace:

```tsx
      <section className="card card-pad">
        <h2 className="font-display text-[17px] font-bold">History</h2>
```

with:

```tsx
      {!patient.anonymized && (
        <section className="card card-pad mb-3" aria-labelledby="form-h">
          <h2 id="form-h" className="font-display text-[17px] font-bold">
            Patient form
          </h2>
          {form ? (
            <>
              <p className="f-hint">Health information. Only your clinic&apos;s team can see it.</p>
              <div className="cf-box mt-3">
                <div className="cf-row">
                  <span className="k">Allergies</span>
                  <span className="v">{form.allergies.length > 0 ? form.allergies.join(", ") : "None ticked"}</span>
                </div>
                <div className="cf-row">
                  <span className="k">Has or had</span>
                  <span className="v">{form.conditions.length > 0 ? form.conditions.join(", ") : "None ticked"}</span>
                </div>
              </div>
              <div className="mt-3">
                {form.rows.map((r) => (
                  <div key={r.label} className="cf-row">
                    <span className="k">{r.label}</span>
                    <span className="v">{r.value}</span>
                  </div>
                ))}
              </div>
              <p className="f-hint mt-3">
                Waiver signed by {form.signed.name} on {formatDate(new Date(form.signed.at))} {manilaDate(new Date(form.signed.at)).slice(0, 4)} (version{" "}
                {form.signed.version}).
              </p>
            </>
          ) : (
            <p className="f-hint">No patient form on file.</p>
          )}
        </section>
      )}

      <section className="card card-pad">
        <h2 className="font-display text-[17px] font-bold">History</h2>
```

- [ ] **Step 4: Check and commit**

Run: `npx vitest run tests/unit/patient-form-view.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: `patient-form-view.test.ts` PASS (3); `tsc` prints nothing; lint clean; every test PASS (53 files, 586 tests).

```powershell
git add src/lib/patients.ts tests/unit/patient-form-view.test.ts "src/app/app/patients/[id]/page.tsx"
git commit -m "feat: show the patient form on the patient page" -m "Staff see a read only Patient form section: allergies and ticked conditions first, then every answered line in the form's order, then who signed the waiver, when, and its version. Patients without a form say No patient form on file; deleted patients show no section."
```
### Task 8: Health information in the Privacy Notice

**Files:**
- Create: `tests/unit/privacy.test.ts`
- Modify: `src/app/privacy/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the Privacy Notice's "Health information" section, the patient form in "What we collect", and the form in what deleting a patient erases.

Rules (spec 6 "Where it lives", spec 8):
- The paragraph says: the form's answers are health information, sensitive personal information under RA 10173; the clinic collects them only with the patient's consent, given on the form; only the clinic's staff read them; they never appear in texts or push alerts; deleting a patient erases the whole form. It keeps the notice's bracketed legal review notes and adds one for this paragraph, because the notice is still a draft for a lawyer.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/privacy.test.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";

describe("the Privacy Notice", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("explains how the patient form's health information is kept", () => {
    expect(html).toContain(">Health information</h2>");
    expect(html).toContain("sensitive personal information under the Data Privacy Act (RA 10173)");
    expect(html).toContain("only with your consent");
    expect(html).toContain("never appear in text messages or push alerts");
    expect(html).toContain("the whole form is erased");
  });

  it("keeps every note for the legal review", () => {
    expect(html.match(/\[Legal review:/g)).toHaveLength(3);
    expect(html).toContain("Draft for legal review.");
  });
});
```

Run: `npx vitest run tests/unit/privacy.test.ts`
Expected: FAIL: the first test (`expected '...' to contain '>Health information</h2>'`) and the second (`expected [ '[Legal review:', '[Legal review:' ] to have a length of 3 but got 2`).

- [ ] **Step 2: Add the health information paragraph**

In `src/app/privacy/page.tsx`, replace:

```tsx
          <li>Your birthday and HMO provider, only if you give them.</li>
```

with:

```tsx
          <li>Your birthday and HMO provider, only if you give them.</li>
          <li>
            If you are new to the clinic, its patient form: your middle name, sex, home address, occupation, email, a parent or
            guardian, HMO card number, dental history, medical history (for example allergies, medicines, and conditions), an
            emergency contact, and the name you type to sign the clinic&apos;s consent, with the date.
          </li>
```

In `src/app/privacy/page.tsx`, replace:

```tsx
        <h2>Why we use it</h2>
```

with:

```tsx
        <h2>Health information</h2>
        <p>
          The answers on the patient form, and the procedures you ask for, are health information: sensitive personal information
          under the Data Privacy Act (RA 10173). The clinic collects them only with your consent, which you give on the form by
          ticking &quot;I have read and agree&quot; and typing your name. Only the clinic&apos;s staff can read them, in the
          clinic&apos;s dashboard, and only to book and manage your appointments and for your dental care. They never appear in text
          messages or push alerts. When the clinic deletes a patient, the whole form is erased with the patient&apos;s other details.
          [Legal review: health information wording and the basis for processing it.]
        </p>

        <h2>Why we use it</h2>
```

In `src/app/privacy/page.tsx`, replace:

```tsx
            &quot;Deleted patient&quot; and the mobile number, birthday, and HMO are erased; the visits stay only as counts.
```

with:

```tsx
            &quot;Deleted patient&quot; and the mobile number, birthday, HMO, and patient form are erased; the visits stay only as counts.
```

- [ ] **Step 3: Check and commit**

Run: `npx vitest run tests/unit/privacy.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: `privacy.test.ts` PASS (2); `tsc` prints nothing; lint clean; every test PASS (54 files, 588 tests).

```powershell
git add src/app/privacy/page.tsx tests/unit/privacy.test.ts
git commit -m "docs: explain health information in the Privacy Notice" -m "The notice lists the patient form among what is collected, and a new paragraph says its answers are sensitive personal information under RA 10173, collected only with the consent given on the form, read only by the clinic's staff, never in texts or alerts, and erased with the rest when a patient is deleted. The legal review notes stay, with one more for this paragraph."
```
### Task 9: The patient link names the branch

**Files:**
- Create: `tests/unit/patient-link.test.ts`
- Modify: `src/lib/patient-link.ts`, `src/app/a/[token]/page.tsx`

**Interfaces:**
- Consumes: `appointments.branch_id` and `branches` (plan 7), read with the secret key as the patient link already does (a patient has no session; the link's token is the key).
- Produces: `PatientView` gains `branchName: string`, `branchAddress: string`, `branchMapsUrl: string | null`.

Rules (spec 3.5 "The patient link in every text keeps working as today", spec 4):
- The `/a/{token}` page shows the visit's branch and its address in the summary, and a map link when the branch has one, so the patient knows where to go. Everything else on the page, and its cancel, stays as it is. The branch is public information; the page still shows only the patient's first name.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/patient-link.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPatientView } from "@/lib/patient-link";

// The patient link reads one appointment by its token with the secret key; the fake answers one row and records the
// columns asked for.
const fake = vi.hoisted(() => ({ select: "", row: null as Record<string, unknown> | null }));

vi.mock("@/lib/notify", () => ({ alertClinic: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: () => ({
      select: (columns: string) => {
        fake.select = columns;
        return { eq: () => ({ maybeSingle: async () => ({ data: fake.row, error: null }) }) };
      },
    }),
  }),
}));

const now = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  fake.row = {
    id: "a1",
    clinic_id: "c1",
    status: "confirmed",
    starts_at: "2026-10-05T02:00:00.000Z",
    patient: { first_name: "Ana", last_name: "Cruz" },
    dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    clinic: { name: "Bright Dental", slug: "bright-dental", mobile: "+639170000000" },
    branch: { name: "Makati", address: "12 Rizal St, Makati", maps_url: "https://maps.app.goo.gl/abc" },
  };
});

describe("loadPatientView", () => {
  it("names the visit's branch, its address, and its map link", async () => {
    expect(await loadPatientView("AbCdEfGhIjKl", now)).toMatchObject({
      firstName: "Ana",
      clinicName: "Bright Dental",
      branchName: "Makati",
      branchAddress: "12 Rizal St, Makati",
      branchMapsUrl: "https://maps.app.goo.gl/abc",
      cancellable: true,
    });
    expect(fake.select).toContain("branch:branches(name, address, maps_url)");
  });
});
```

Run: `npx vitest run tests/unit/patient-link.test.ts`
Expected: FAIL: `expected { status: 'confirmed', ... } to match object` (no branch fields yet).

- [ ] **Step 2: Read and show the branch**

In `src/lib/patient-link.ts`, replace:

```ts
  clinicName: string;
  clinicMobile: string;
  slug: string;
  cancellable: boolean;
};
```

with:

```ts
  clinicName: string;
  clinicMobile: string;
  slug: string;
  /** Where to go (booking flow spec 4). */
  branchName: string;
  branchAddress: string;
  branchMapsUrl: string | null;
  cancellable: boolean;
};
```

In `src/lib/patient-link.ts`, replace:

```ts
  clinic: { name: string; slug: string; mobile: string };
};
```

with:

```ts
  clinic: { name: string; slug: string; mobile: string };
  branch: { name: string; address: string; maps_url: string | null };
};
```

In `src/lib/patient-link.ts`, replace:

```ts
      "id, clinic_id, status, starts_at, patient:patients(first_name, last_name), dentist:dentists(name, sms_name), clinic:clinics(name, slug, mobile)",
```

with:

```ts
      "id, clinic_id, status, starts_at, patient:patients(first_name, last_name), dentist:dentists(name, sms_name), clinic:clinics(name, slug, mobile), branch:branches(name, address, maps_url)",
```

In `src/lib/patient-link.ts`, replace:

```ts
/** Spec 5.2: status, clinic, dentist, date, time, and the patient's first name only. */
```

with:

```ts
/** Spec 5.2: status, clinic, branch (booking flow spec 4), dentist, date, time, and the patient's first name only. */
```

In `src/lib/patient-link.ts`, replace:

```ts
    slug: row.clinic.slug,
    cancellable: isCancellable({ status: row.status, starts_at: startsAt }, now),
```

with:

```ts
    slug: row.clinic.slug,
    branchName: row.branch.name,
    branchAddress: row.branch.address,
    branchMapsUrl: row.branch.maps_url,
    cancellable: isCancellable({ status: row.status, starts_at: startsAt }, now),
```

In `src/app/a/[token]/page.tsx`, replace:

```tsx
            <div className="cf-row">
              <span className="k">Clinic</span>
              <span className="v">{view.clinicName}</span>
            </div>
          </div>
        </div>
```

with:

```tsx
            <div className="cf-row">
              <span className="k">Clinic</span>
              <span className="v">{view.clinicName}</span>
            </div>
            <div className="cf-row">
              <span className="k">Branch</span>
              <span className="v">
                {view.branchName}
                {view.branchAddress && <span className="f-hint block">{view.branchAddress}</span>}
              </span>
            </div>
          </div>
        </div>
        {view.branchMapsUrl && (
          <a href={view.branchMapsUrl} className="link inline-flex min-h-11 items-center" target="_blank" rel="noreferrer">
            Open the map to {view.branchName}
          </a>
        )}
```

- [ ] **Step 3: Check and commit**

Run: `npx vitest run tests/unit/patient-link.test.ts; npx tsc --noEmit; npm run lint; npm test`
Expected: `patient-link.test.ts` PASS (1); `tsc` prints nothing; lint clean; every test PASS (55 files, 589 tests).

```powershell
git add src/lib/patient-link.ts tests/unit/patient-link.test.ts "src/app/a/[token]/page.tsx"
git commit -m "feat: name the branch on the patient link page" -m "The page in every text now shows the visit's branch with its address, and a map link when the branch has one. Everything else, and the cancel, works as before."
```
### Task 10: README and final verification

**Files:**
- Modify: `README.md`

The controller runs this task after Tasks 1 to 9 are committed. It changes only the README unless a check fails; a fix gets its own `fix:` commit.

- [ ] **Step 1: Document the booking pages and branches**

In `README.md`, replace:

```markdown
One Playwright test walks the whole booking loop: a patient books on a clinic's page, the code is read from `sms_log`, the clinic approves in the dashboard, and the visit shows on the schedule.
```

with:

```markdown
One Playwright test walks the whole booking loop: a patient verifies their number on a clinic's page (the code is read from `sms_log`), fills in the patient form, and books; the clinic approves in the dashboard; and the visit shows on the schedule.
```

In `README.md`, replace:

```markdown
A clinic can have several branches, each with its own address and calendar, and the server side of the new patient booking flow is in place (spec: `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`): patients verify their number first, then book for one of their patients or for someone new with the clinic's patient form and waiver, change a booking (it goes back to the clinic for approval, and the clinic gets a "Changed request" alert), or cancel one. The pages for it come in the next plan; until then every clinic has one branch, "Main", and every page works as before. Once a clinic has 2 or more active branches, patients' texts name the branch after the clinic (for example "Bright Dental Makati").

Answers on the patient form are health information, sensitive personal information under RA 10173: only the clinic's members read them, they never appear in texts, pushes, logs, or reports, and deleting a patient clears all of them. The waiver's wording (`src/lib/waiver.ts`) still needs legal review before the pages show it.
```

with:

```markdown
A clinic can have several branches, each with its own address and calendar (spec: `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`). The booking page opens on three choices: book an appointment, reschedule or edit a booking, or cancel one. Every path starts with the patient's mobile number and a 6 digit code by text (a phone that verified the number before goes straight on). Then the patient books for one of the number's patients or for someone new with the clinic's patient form and waiver, changes a booking (it goes back to the clinic for approval, and the clinic gets a "Changed request" alert), or cancels one. Every clinic starts with one branch, "Main". Once it has 2 or more active branches, patients choose a branch when they book, the dashboard names each visit's branch and filters by it, New appointment and each dentist's working hours ask for the branch, and patients' texts name the branch after the clinic (for example "Bright Dental Makati").

Answers on the patient form are health information, sensitive personal information under RA 10173: only the clinic's members read them (read only, in a "Patient form" section on the patient page), they never appear in texts, pushes, logs, reports, or URLs, and deleting a patient clears all of them. The form's fields (`src/lib/intake.ts`) and the waiver's wording (`src/lib/waiver.ts`) are our draft: they still need Kai's corrections and legal review, and changing the waiver's words means a new `WAIVER_VERSION`.
```

Append to the end of `README.md`:

```markdown

The booking pages need no migration of their own: they use the branches migration above.

### Add a branch

1. As the owner, open **Settings**. Under **Branches**, press **Edit** on "Main" and give it its real name, address, and map link: patients see them on the booking page and on the page linked from every text. The clinic profile's address stays the clinic's own.
2. Press **Add a branch**. Its short name for texts goes after the clinic's name for texts, and the two must fit in 20 characters together (for example "Bright Dental" leaves 6, enough for "Makati"). Settings says how many characters are left, checks every active branch when a second becomes active, and refuses a clinic name for texts that leaves no room.
3. Open each dentist in **Settings**: with 2 or more active branches, every block of working hours has a **Branch**. One dentist's blocks may not overlap, even at two branches.
4. **Move up** and **Move down** set the order patients see. **Deactivate** takes a branch off the booking page; its visits stay on the schedule, and the last active branch cannot be deactivated.
```

- [ ] **Step 2: Run every automated check**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run build`
Expected: lint clean; `tsc` silent; every unit test and the `tests/sql` suite PASS (55 files, 589 tests); the build finishes and its route list still shows `ƒ /[slug]`, `ƒ /a/[token]`, `ƒ /app/requests`, `ƒ /app/schedule`, `ƒ /app/settings`, `ƒ /app/patients/[id]`, and `○ /privacy` (no route added or removed). `;` keeps going after a failure, so read every result.

- [ ] **Step 3: No dashes, no migration, no dependency, and nothing personal in a URL**

Run: `git grep -n -P "[\x{2013}\x{2014}]" -- src tests supabase public README.md CONTRIBUTING.md docs/superpowers/plans/2026-09-28-plan-8-booking-pages.md`
Expected: no output.

Run: `git diff --stat plan-7-booking-flow...HEAD -- supabase package.json package-lock.json`
Expected: no output (no migration, no new dependency).

Run: `git grep -n -E "searchParams|router\.push|href=\{" -- "src/app/[slug]"`
Expected: exactly four lines, all in `BookingFlow.tsx`: the clinic's phone (`tel:`), the two branch map links, and the patient link (`/a/${token}`). The booking page puts no number, name, or form answer in a URL.

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: explain the booking pages and adding a branch" -m "The README's branches section now describes the booking page's three paths, the dashboard with 2 or more branches, where staff read the patient form, and what still needs Kai's corrections and legal review, and gains the steps to add a branch. The Playwright paragraph follows the new walk."
```

- [ ] **Step 5: Report to Kai**

Write the summary for Kai: what shipped (the booking page's main page and its three paths on the flow reducer, the patient form and waiver, Settings > Branches, the dashboard with branches, the patient form on the patient page, the Privacy Notice paragraph, the branch on the patient link page), the test counts, that no dependency and no migration were added, that the old booking path is gone and the patient link still works, and the list in "What Kai must do" below. Say plainly that the pages were checked by typecheck, lint, render tests, and the build, not against a database (there is no development project), so the production walk below is the first real run.

## What Kai must do (outside the code)

Before merging this branch (after the billing, teams, and branches branches it sits on; every merge to `main` deploys production):
- Nothing in Supabase: this plan has no migration. The branches migration from plan 7 must already be pasted (its README steps).
- Correct the patient form's fields (`src/lib/intake.ts`) and the waiver's wording (`src/lib/waiver.ts`), and have the waiver and the Privacy Notice's new health information paragraph reviewed (the bracketed notes say what is open). The pages show them as soon as this merges. Changing the waiver's words means a new `WAIVER_VERSION`.
- No new environment variables, no Supabase setting or email template changes.

After the deploy, a walk on production (the pages were never run against a database before this):
- On a phone, open the demo clinic's booking page: the name, "Book a visit, or change or cancel one you have.", three buttons, and the branch "Main" with its address. In Settings > Branches, rename "Main" and give it its real address and map link; reload the booking page and check them.
- Book with a number that is new to the clinic: a code arrives, the patient form opens, fill in only the Required fields, pick a service and a time, Change the time from the summary, then Send request. The clinic gets the new request alert; approve it in Requests; the confirmation text reads as before.
- Book again with the same number on the same phone: no code this time, and the patient is listed under "Who is the appointment for?". In the dashboard, the patient page shows the Patient form section with the answers given.
- Reschedule that visit from the main page: pick it, Change the time, Send changes. It is Pending again in Requests, and the clinic gets the "Changed request" alert. Then cancel it from the main page: the clinic gets the cancellation alert.
- Add a second branch in Settings with a short name that fits, give a dentist a block there, and check: the booking page lists both branches and asks for one, Schedule and Requests name and filter by branch, New appointment asks for the branch, and a confirmation text for the new branch starts with the clinic's and the branch's short names. Deactivate the second branch again if the clinic has only one.
- Open the patient link in any text: it shows the branch and its address, and Cancel still works.

## Self-review

**Spec coverage.**

| Spec | Where |
|---|---|
| 2.1: a code after the number, skipped on a phone that verified it | Task 2 (number and code steps; `startVerification` goes straight on for a verified phone) |
| 2.2: Confirm means send; a Change button per summary line | Task 2 (summary and booking details: Change on patient, services, dentist, and time; one primary "Send request" or "Send changes") |
| 2.3: changed services re-check the time | Task 2 (`chooseServices` asks `getOpenStarts` for the chosen day and passes `timeFits`; the reducer sends the patient to the time step when it no longer fits) |
| 2.4: saving a booking holds the time | Unchanged server behaviour (plan 7); Task 2 sends the request |
| 2.5: the branch stays fixed when rescheduling | Task 2 (booking details show the branch without a Change button and say how to move branches; times load for the appointment's own branch) |
| 3.1: main page, branches with address and map link, the paused notice | Task 2 (`BookingFlow` main page; `tests/unit/booking-page.test.ts`) |
| 3.2: number and code, resend and wait, errors, verified phone | Task 2 (number and code steps, the countdown, `resendBookingCode`'s `wait`, every refusal in words, the cookie note) |
| 3.3: branch (skipped with one), who, form and waiver, services, date and time at the branch, summary with Change, sent naming the branch | Tasks 1 and 2 |
| 3.4: your appointments, "call the clinic" within the minimum notice, none, booking details with Change, send changes, sent | Task 2 (`list`, `details`, done screen) |
| 3.5: your appointments, confirm with "No, keep it" and "Yes, cancel it", cancelled, back to the main page; the patient link keeps working | Task 2 (`confirm_cancel`, done screen); Task 3 leaves `/a/` and its cancel untouched; Task 9 adds the branch there |
| 4: Settings > Branches (add, rename, text short name, address, map link, order, deactivate, the last active branch), the combined text name check | Task 4 |
| 4: the dashboard with 2 or more branches (branch on each card, the branch filter on Schedule and Requests, New appointment asks, hours per block, outside hours per branch) | Tasks 5 and 6 |
| 6: the form in short sections, required marks, a guardian under 18 today, Yes or No with detail boxes, allergy and condition ticks, women's questions for a female patient, the waiver with the clinic's name, "I have read and agree", the typed name | Task 1 (`PatientForm`, `tests/unit/patient-form.test.ts`) |
| 6: "In the dashboard": allergies and ticked conditions first, "No patient form on file", read only | Task 7 |
| 6: the Privacy Notice paragraph on health information | Task 8 |
| 7: the page renders the reducer and never decides a step | Task 2 (every step from `state.step`, every move a `FlowAction`) |
| 8: security and privacy | Tasks 2 and 3 (nothing before the number is verified; plan 7's actions re-check everything; no form data in a URL or log), Task 4 (owner only), Task 7 (members only, read only) |
| 9: out of scope | Not built: changing branch while rescheduling, branch-level staff permissions, per-branch procedures, prices, or reports, patients editing their form, staff editing medical answers, drawn signatures, a form builder, printing |
| 10: tests | Render tests for the main page, the form, the hours editor, and the Privacy Notice; unit tests for `intakeInput`, the branch name checks, `parseBranch`, the branch services, hours and outside hours per branch, New appointment at a branch, `formView`, and the patient link; the reducer itself stays proven by plan 7's tests |

**Decisions worth a second look.**
- The page keeps the parsed form (`IntakeForm`) in the reducer and sends it back with `intakeInput`, which adds the tick and the typed name the server parser reads; a test proves the round trip gives the same form. The waiver's version is always the server's.
- `getBranch` is the one new Server Action: the booking page is loaded at the first active branch, and another branch's dentists, hours, and procedures load when a patient picks it (or opens an appointment there). It returns what the page already shows and checks the id and that the branch is active.
- The page asks for the number's patients and appointments one action after the other, because Next dispatches a page's Server Actions one at a time anyway; the time step loads in `startTransition`, as Next's docs call Server Functions from an effect.
- The main page drops the old header's hours line: hours differ by branch now, and the calendar shows what is open. The clinic's phone stays in the header.
- A clinic with no active procedure (or no dentist at its only branch) says online booking isn't open yet and still offers reschedule and cancel; a branch without dentists says so at the services step.
- Old code removed only where nothing else used it: `resendBookingCode` and `resendCode` stay (the code step's "Send another code"), and so do `HMO_SUGGESTIONS` (the form), `issueCode`, `spendCode`, `takenStarts`, and `overBookingCap`. `spendCode` lost its `purpose` argument and still refuses a code the old page stored.
- The clinic profile stops copying its address and map link to a one-branch clinic's branch (plan 7 did it only until Settings had Branches; it would now overwrite the owner's branch edits), and its map link input goes, because patients see each branch's link. The stored link is sent back unchanged.
- Blocks at an inactive branch leave the hours editor; saving the dentist then replaces them, which is what the editor shows. Reactivating the branch before that save brings them back.
- "Outside hours" now checks a visit's own branch for every clinic; with one branch that is the same check as before.
- The combined text name check runs the moment it matters: saving an active branch (its own name, then every other active branch's, which is how "Main" is checked when a second branch opens), reactivating a branch, and saving the clinic profile. With one active branch nothing is checked.
- The guardian field shows for everyone (spec 6 lists it as its own section) and says Required only while the birthday makes the patient under 18 today.
- The Playwright test and the booking service database test were moved to the new path so they stay true, though neither can run until a development project exists.

**Deferred (explicitly).** `tests/db` seed helpers still insert appointments and hours without a branch (plan 7's note), so that suite needs `branch_id` in its helpers when a development project exists. Nothing else from plan 7's deferred list is left.

**Placeholder scan.** Every step has complete code or exact text. Kai supplies nothing but the corrections, the legal review, and the production walk.

**How this plan was checked.** Every Create, replace, append, and Delete instruction was applied by script, in order, to a clean export of commit `cbe0ddb` (the plan's base, `plan-8-booking-pages` before this plan): each replaced text occurs exactly once in its file at that point, as the Edit tool needs. For every task, Step 1 was applied alone and its test command failed for the reason written under it; then the task's other steps were applied and the copy passed `npx tsc --noEmit`, `npm run lint`, and `npm test` with the counts given. After Task 10 the copy also passed `npm run build` (on its own `npm ci`, with a copy of `.env.local` that was removed afterwards), with the route list Task 10 Step 2 names (this plan adds and removes no page or route), and the greps of Task 10 Step 3 gave what they say. The UI was not run against a database: there is no development project, and `.env.local` points at production.

**Type consistency.** `FlowAppointment` is built from `NumberAppointment` in `openAppointment` (Task 2); `IntakeForm` goes into the reducer from `PatientForm.onDone` and back to the server through `intakeInput` (Task 1). `PublicClinic` is what `getBranch` and the page load share. `SettingsView.branches` (Task 4) feeds `BranchEditor` and, filtered to the active ones, `DentistEditor` and `HoursEditor` (Task 6); `SettingsView.dentists[].hours` blocks carry `branchId`, which `parseDentist` (plan 7) reads back. `HoursRow`, `DayRow`, and `ScheduleItem` gain the branch together (Task 5), and `hoursByDentist`'s nested map is what `assembleDay` reads. `BookingOptions.branches` feeds `NewAppointment`, whose `branchId` reaches `parseManualBooking`, `createAppointment`, `openTimes`, and `staffOpenStarts`. `activeBranches` replaces `activeBranchNames` for every caller. `PatientDetail.form` is `formView`'s result (Task 7), and `PatientView` gains the branch fields the page shows (Task 9).
