# BrightSmile Plan 7: Branches and the Booking Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic can have several branches, each with its own address and calendar, and everything behind the new patient booking flow exists and is proven offline: the data model, the database functions, the server services and Server Actions, and the flow's logic as a pure reducer. Patients verify their number first; a verified number can book for one of its patients or for someone new with the clinic's patient form and waiver, change a booking (which goes back to the clinic for approval), and cancel one, and the server checks the number and every row on each call. This plan adds no page and changes no page's look: today's booking page, the patient link `/a/`, the dashboard, Settings, and onboarding keep working exactly as today, at each clinic's first (and, until plan 8, only) branch. Plan 8 builds the new pages on top.

**Architecture:** One migration adds `branches` (members read, the owner writes, a trigger keeps the last active branch), gives every existing clinic one branch, `Main`, holding all its working hours and appointments (`branch_id` not null on both, with composite keys to `branches (id, clinic_id)`), adds the patient form's columns and a `medical` jsonb object to `patients` (a constraint refuses an anonymized patient that keeps any of it), makes `create_clinic` create `Main`, lets `create_booking` take a branch (the first active branch when none is named, so every current caller keeps working) and a new patient's form, and adds `change_booking` (secret key only) for a patient's change: one statement moves the time, dentist, services, and patient and sends the appointment back to pending. The slot engine stays pure; `loadClinic` loads a clinic at one branch, so open times come from that branch's hours while the no-overlap guard stays per dentist. Texts about an appointment name the branch after the clinic once a clinic has 2 or more active branches (`smsClinicName`), within the 20 character field. `src/lib/number-booking.ts` holds the patient-side services: verification reuses `issue_otp` and the existing verified-device cookie, booking re-validates like the booking page, a change re-validates the new time like a new booking, and cancelling reuses the patient link's cancel; each checks the number and the rows first. `src/lib/intake.ts` validates the form, `src/lib/waiver.ts` holds the waiver and its version, and `src/lib/booking-flow.ts` is the reducer of every step and move of spec 3.3 to 3.5.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions, `cookies`, `headers`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5, `@electric-sql/pglite` 0.4.6 (dev, already installed). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`: sections 2 (every deviation from the flowchart), 3.2 to 3.5 (their server side), 4 (except the dashboard and Settings pages), 5, 6 (except the dashboard's patient page and the Privacy Notice paragraph), 7, 8, and 10 (database and unit). Plan 8 covers the rest: every page of section 3, the dashboard and Settings > Branches of section 4, the "Patient form" section of the patient page and the Privacy Notice paragraph of section 6. It builds on `docs/superpowers/specs/2026-09-26-brightsmile-teams-reports-design.md` (4 roles, 5 `is_clinic_owner`), `docs/superpowers/specs/2026-09-25-brightsmile-billing-design.md` (7.5 paused booking), and `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (8 open times, 9 booking and statuses, 10.1 texts, 10.3 codes and the verified device, 10.4 alerts, 12 privacy).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| `"use server"` files export only async functions; every Server Function authenticates and authorizes itself (here: the verified-device cookie and the rows' number) | `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` (sections "Using `use server` at the top of a file", "Security considerations") |
| Server Action security: public POST endpoints, arguments are untrusted, unused Server Functions are stripped and have no endpoint until a page uses them (the new actions here get one in plan 8) | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (section "Security"), `node_modules/next/dist/docs/01-app/02-guides/data-security.md` |
| `cookies()`: read anywhere on the server; `set` only in Server Functions and Route Handlers (why `checkVerification` is an action, not a page) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` |
| `headers()` is async (the caller's IP for the code limits) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, SQL comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/[slug]/actions.ts"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer (CONTRIBUTING.md). The commit commands in this plan leave it out; add `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the final `-m` paragraph of every commit. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-7-booking-flow`, which sits on `plan-6-teams` (its PR is still open), which sits on `plan-5-billing` (its PR is still open), one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone (Vercel runs in UTC; the offline tests run the database in UTC). Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and months as `"YYYY-MM"`. "Under 18 today" and "a month that has passed" use Manila's date (`manilaDate`).
- Branches (spec 4): one clinic keeps one account, one booking link, and one set of patients, procedures, and staff; each branch has its own address and calendar. "The first active branch" always means `order by sort, created_at` among active branches, in SQL (`create_booking`) and in TypeScript (`loadClinic`, `staffOpenStarts`, `saveDentist`, `activeBranchNames`). Every caller that names no branch books at it, so a clinic with one branch sees no change anywhere.
- The number comes first (spec 2.1, 8): patient names, forms, and appointments for a number are read only after the verified-device cookie (`bs_verified`, signed with `APP_SECRET`, up to 5 numbers for 180 days) holds that number, and every service in `src/lib/number-booking.ts` checks it again with `verifiedNumber` before any read. Every query filters by this clinic and by the patient's mobile, and never lists a deleted (anonymized) patient. `change_booking` checks the number again in SQL.
- Health information is sensitive personal information (RA 10173): the form's columns and `patients.medical` are read only by the clinic's members (the existing patients policy) and the server's secret key; they never appear in texts, pushes, logs, reports, or URLs. Alerts carry the patient's first name and last initial in a text and no name in a push, as today. Anonymizing a patient clears the whole form (`patients_anonymized_clean`).
- Never log patient details, numbers, codes, forms, tokens, secrets, keys, or environment values. Error logs carry where it failed and the error message only (`logError` in `src/lib/log.ts`).
- The billing pause (billing spec 7.5): a lapsed clinic sends and takes no code, takes no booking, and takes no change (`bookingOpen`); cancelling by number is not refused, like the patient link in every text.
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies). The secret-key client (`adminClient`) is used only where no staff session exists: `sendSms`, the public booking flow (now including `src/lib/number-booking.ts`), patient links, `sendPush`, the daily job, the PayMongo webhook, `/admin` after `requireOperator`, and the join link lookup. Nothing else.
- Server Actions are public POST endpoints: each one re-validates every argument on the server, whatever a form already checked. The new actions in `src/app/[slug]/actions.ts` have no endpoint until plan 8's pages call them (Next strips unused Server Functions), and they check everything regardless.
- One new migration, `supabase/migrations/20260928000100_branches_booking.sql`. Kai reviews it and pastes it into the production SQL Editor after the teams migration and before this plan's branch merges (every merge to `main` deploys production). It starts with a paste guard that fails fast when the teams migration is missing. Nothing in this plan runs SQL against Supabase. The migration follows the earlier plans' rules: explicit grants and revokes (Supabase's default privileges grant new tables and functions to `anon` and `authenticated`, and the offline harness does the same), `security definer` only where RLS cannot express the rule (this migration adds none; `create_clinic` stays definer as before), always `set search_path = ''`, and only what Supabase's `postgres` role may do on Postgres 17 (PGlite 0.4.6 is Postgres 17.5; no Postgres 18 features, so no `RETURNING old`). `create or replace function public.create_clinic` copies the latest body (in `20260926000100_teams.sql`) exactly and adds only the first branch, and a test compares the two definitions. `tests/sql/isolation.test.ts` lists exactly which functions `anon` (none) and `authenticated` may run, and stays exact: `change_booking` and the trigger function are not `authenticated`'s.
- Database tests are the offline PGlite suite in `tests/sql`, run by `npm test`. There is no development Supabase project and no Docker. `tests/db` and the Playwright test keep refusing the production project; this plan neither runs nor edits them, and they keep typechecking.
- Never use the app locally in this plan: `.env.local` points at production. This plan changes no page, so it is checked by typecheck, lint, the unit and database tests, and a build.
- Dependencies added: none.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. Clinic dashboard (done).
4. Launch readiness (done).
5. Billing (done; its PR is open).
6. Teams and reports (done; its PR is open, and this branch sits on it).
7. **Branches and the booking engine (this plan):** branch names in texts and the patient form parser, the migration, open times per branch, texts naming the branch and the changed request alert, number-first verification, booking, changing, and cancelling by number, the flow reducer, and the README. Deliverable: once Kai pastes the migration, every clinic has one branch holding its calendar, today's pages work exactly as before, and every server piece of the new flow is in place and tested.
8. Booking flow pages (next): the public booking page's main page and its three paths on the reducer, the dashboard with branches, Settings > Branches, the patient form on the patient page, and the Privacy Notice paragraph.

## File map for this plan

| File | Responsibility |
|---|---|
| `src/lib/branches.ts` | Pure: `smsClinicName` (a text's clinic field, with the branch when there are 2 or more), `branchSmsNameProblem` |
| `src/lib/waiver.ts` | Pure: the waiver's words and `WAIVER_VERSION` |
| `src/lib/intake.ts` | Pure: the patient form's types and limits, `parseMedical`, `parseIntakeForm`, `formColumns`, `ageOn` |
| `supabase/migrations/20260928000100_branches_booking.sql` | `branches` with RLS and grants, the last active branch trigger, the backfill and `branch_id` on hours and appointments, the patient form's columns and constraints, `create_clinic` with `Main`, `create_booking` with a branch and a form, `change_booking` |
| `tests/sql/branches.test.ts` | The migration, proven offline |
| `tests/sql/isolation.test.ts`, `tests/sql/teams.test.ts` | Rows inserted directly now name their branch; the teams `create_clinic` comparison reads the definition right after the teams migration; `branches` joins the isolation sweep |
| `src/lib/patients.ts` | `deletePatient` clears the form |
| `src/lib/onboarding.ts` | Doc comment: where `create_clinic` is now defined |
| `src/lib/booking-input.ts` | `PublicBranch`; `PublicClinic.branch` and `branches`; `BookingPayload.branchId` |
| `src/lib/availability.ts` | `loadClinic` at one branch; `ignoreId` in `monthOpenDates` and `dayOpenStarts` |
| `src/lib/booking.ts` | The booking page books at its branch; `issueCode`, `spendCode`, `takenStarts`, `overBookingCap` shared with the number services |
| `src/lib/dashboard.ts` | `staffOpenStarts` reads hours at one branch |
| `src/lib/settings-input.ts`, `src/lib/clinic-settings.ts` | A branch per working block (overlaps refused across branches); a one-branch clinic's profile address follows to its branch |
| `src/lib/sms/templates.ts`, `src/lib/push.ts` | The `change_alert` text and push |
| `src/lib/appointment-actions.ts`, `src/lib/daily.ts`, `src/lib/daily-job.ts` | Patients' texts name the branch |
| `src/lib/number-booking.ts` | Server: `verifiedNumber`, `startVerification`, `checkVerification`, `numberPatients`, `numberAppointments`, `bookForNumber`, `changeForNumber`, `cancelForNumber`, `changeScope` |
| `src/app/[slug]/actions.ts` | The cookie helpers; `startVerification`, `checkVerification`, `numberPatients`, `numberAppointments`, `bookForNumber`, `changeForNumber`, `cancelForNumber`; open times at a branch or while changing |
| `src/lib/booking-flow.ts` | Pure: the flow reducer (`flow`, `START`) |
| `README.md` | Migration 9, the Branches and booking engine section |
| `tests/unit/branches.test.ts`, `intake.test.ts`, `availability.test.ts`, `appointment-actions.test.ts`, `number-booking.test.ts`, `booking-flow.test.ts` | New unit tests |
| `tests/unit/booking-input.test.ts`, `settings-input.test.ts`, `sms-templates.test.ts`, `push.test.ts`, `daily.test.ts` | Updated unit tests |

## Tasks

1. Branch names in texts, and the patient form
2. The branches and booking migration
3. Open times per branch; today's pages book at the first active branch
4. Texts name the branch; the changed request alert
5. Number-first verification
6. Booking, changing, and cancelling by number
7. The booking flow as one pure reducer
8. README and final verification


---
### Task 1: Branch names in texts, and the patient form

**Files:**
- Create: `src/lib/branches.ts`, `src/lib/waiver.ts`, `src/lib/intake.ts`, `tests/unit/branches.test.ts`, `tests/unit/intake.test.ts`

**Interfaces:**
- Consumes: `LIMITS`, `cleanText`, `cleanBirthday`, `cleanEmail` from `@/lib/validate`; `normalizeMobile` from `@/lib/phone`; `renderSms` from `@/lib/sms/templates` (test only).
- Produces:
  - From `@/lib/branches` (pure): `smsClinicName(clinicSmsName: string, branchSmsName: string | null | undefined, activeBranches: number): string`, `branchSmsNameProblem(clinicSmsName: string, branchSmsName: string): string | null`
  - From `@/lib/waiver` (pure): `WAIVER_VERSION: string` (`"2026-09-26"`), `waiverText(clinicName: string): { title: string; text: string }[]`
  - From `@/lib/intake` (pure): `ALLERGIES`, `CONDITIONS` (key to label), `type Allergy`, `type Condition`, `type YesNo = boolean | null`, `type Medical`, `type IntakeForm`, `INTAKE_LIMITS`, `ageOn(birthday: string, day: string): number`, `parseMedical(value: unknown, sex: "female" | "male"): Medical | null`, `parseIntakeForm(value: unknown, today: string): { ok: true; form: IntakeForm } | { ok: false; errors: Record<string, string> }`, `formColumns(f: IntakeForm): Record<string, unknown>` (the `p_form` argument of `create_booking` and `change_booking`, Task 2)

Rules (spec 4 "Texts", spec 6, spec 8):
- A text's clinic field stays at most 20 characters, so every template still fits one text (`renderSms` cuts it at 20 regardless). With 2 or more active branches it is `${clinic.sms_name} ${branch.sms_name}`; with one it is the clinic's name alone, as today. `branchSmsNameProblem` is the check Settings > Branches (plan 8) runs before saving a branch's short name; the database caps `branches.sms_name` at 18 (Task 2), the most a one character clinic name leaves.
- The form's required fields are exactly spec 6's: last name, first name, birthday, sex, home address, a parent or guardian when the patient is under 18 today, the "I have read and agree" tick, and the typed name as the signature. Everything else may stay empty. The medical questions are Yes, No, or empty; allergies and conditions are ticks from fixed lists; a detail is kept only beside its Yes (or the Other tick), and the women's questions only for women. `patients.medical` always stores every key of `Medical`, so the dashboard (plan 8) never meets a missing one.
- The verified number is the patient's mobile (spec 3.3 step 4), so the form has no mobile field; the emergency contact's mobile is normalized like any other. The waiver's version comes from `WAIVER_VERSION`, never from the client. The waiver text leaves out the spec's bracketed legal review note (it is a note for Kai, not words for patients) and says so in a comment.
- Health information never reaches a log: these modules have no logging, and the services in Tasks 5 and 6 log only where they failed.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/branches.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { branchSmsNameProblem, smsClinicName } from "@/lib/branches";
import { renderSms } from "@/lib/sms/templates";

describe("smsClinicName", () => {
  it("is the clinic's name for texts alone while the clinic has one active branch", () => {
    expect(smsClinicName("Bright Dental", "Makati", 1)).toBe("Bright Dental");
  });

  it("adds the branch's short name once the clinic has 2 or more active branches", () => {
    expect(smsClinicName("Bright Dental", "Makati", 2)).toBe("Bright Dental Makati");
    expect(smsClinicName("Bright Dental", null, 3)).toBe("Bright Dental");
  });
});

describe("branchSmsNameProblem", () => {
  it("allows a short name that keeps the pair within the 20 characters every text has room for", () => {
    // "Bright Dental" is 13 characters, so a space and 6 more make 20.
    expect(branchSmsNameProblem("Bright Dental", "Makati")).toBeNull();
    expect(branchSmsNameProblem("Bright Dental", " Pasig ")).toBeNull();
  });

  it("refuses a short name that would push the pair past 20 characters, or an empty one", () => {
    expect(branchSmsNameProblem("Bright Dental", "Quezon C")).toBe("Use 1 to 6 characters, so the clinic and branch names fit in a text together.");
    expect(branchSmsNameProblem("Bright Dental", "  ")).toBe("Use 1 to 6 characters, so the clinic and branch names fit in a text together.");
    expect(branchSmsNameProblem("Bright Smile Dental", "M")).toBe("Shorten the clinic's name for texts first, so a branch name fits beside it.");
  });

  it("keeps the confirmation text whole with the longest pair it allows", () => {
    const clinic = smsClinicName("C".repeat(13), "B".repeat(6), 2);
    expect(branchSmsNameProblem("C".repeat(13), "B".repeat(6))).toBeNull();
    expect(clinic).toHaveLength(20);
    const text = renderSms("confirmed", { clinic, first: "Juan", date: "Thu Sep 24", time: "10:00 AM", link: "https://brightsmile.ph/a/Ab12Cd34Ef56" });
    expect(text.startsWith(`${clinic}: Juan's visit`)).toBe(true);
  });
});
```

Create `tests/unit/intake.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ageOn, formColumns, parseIntakeForm, parseMedical, type Medical } from "@/lib/intake";
import { WAIVER_VERSION, waiverText } from "@/lib/waiver";

const today = "2026-09-28";

const EMPTY_MEDICAL: Medical = {
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

const adult = {
  last: " Cruz ",
  first: "Ana",
  middle: "Santos",
  birthday: "1990-05-17",
  sex: "female",
  address: "12 Rizal St, Makati",
  occupation: "",
  email: " Ana@Example.com ",
  guardian: "",
  hmo: "Maxicare",
  hmoNumber: "MX-1234",
  previousDentist: "",
  lastVisit: "2025-06",
  visitReason: "Toothache",
  emergencyName: "Ben Cruz",
  emergencyMobile: "0917 555 0000",
  medical: { goodHealth: true, takingMedicine: true, medicineDetail: " Losartan ", allergies: ["latex", "antibiotics"] },
  agree: true,
  signature: "Ana Santos Cruz",
};

describe("parseIntakeForm", () => {
  it("builds the stored form on the server's terms", () => {
    expect(parseIntakeForm(adult, today)).toEqual({
      ok: true,
      form: {
        first: "Ana",
        last: "Cruz",
        middle: "Santos",
        birthday: "1990-05-17",
        sex: "female",
        address: "12 Rizal St, Makati",
        occupation: null,
        email: "ana@example.com",
        guardian: null,
        hmo: "Maxicare",
        hmoNumber: "MX-1234",
        previousDentist: null,
        lastVisit: "2025-06",
        visitReason: "Toothache",
        emergencyName: "Ben Cruz",
        emergencyMobile: "+639175550000",
        medical: { ...EMPTY_MEDICAL, goodHealth: true, takingMedicine: true, medicineDetail: "Losartan", allergies: ["antibiotics", "latex"] },
        waiverName: "Ana Santos Cruz",
        waiverVersion: WAIVER_VERSION,
      },
    });
  });

  it("asks for every required field at once", () => {
    const result = parseIntakeForm({}, today);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["address", "agree", "birthday", "first", "last", "sex", "signature"]);
  });

  it("asks for a parent or guardian while the patient is under 18 today", () => {
    const minor = { ...adult, birthday: "2008-09-29" };
    expect(parseIntakeForm(minor, today)).toMatchObject({
      ok: false,
      errors: { guardian: "Enter the name of a parent or guardian: the patient is under 18." },
    });
    expect(parseIntakeForm({ ...minor, guardian: "Rosa Cruz" }, today)).toMatchObject({ ok: true, form: { guardian: "Rosa Cruz" } });
    expect(parseIntakeForm({ ...adult, birthday: "2008-09-28" }, today).ok).toBe(true);
  });

  it("refuses text that is too long, a bad email or mobile, and a month that has not passed", () => {
    const result = parseIntakeForm(
      { ...adult, middle: "M".repeat(51), signature: "S".repeat(151), email: "ana@", emergencyMobile: "12345", lastVisit: "2026-10", birthday: "2026-09-29" },
      today,
    );
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["birthday", "email", "emergencyMobile", "lastVisit", "middle", "signature"]);
  });

  it("stores the waiver's version, never one the client sends", () => {
    const result = parseIntakeForm({ ...adult, waiverVersion: "1999-01-01" }, today);
    expect(result.ok && result.form.waiverVersion).toBe(WAIVER_VERSION);
  });
});

describe("parseMedical", () => {
  it("always has every key, with details only beside a Yes or an Other tick", () => {
    const medical = parseMedical(
      {
        underTreatment: false,
        treatmentCondition: "ignored without a Yes",
        hospitalized: true,
        hospitalDetail: "2019, appendix",
        allergies: ["other"],
        allergyOther: "Shellfish",
        conditions: ["asthma"],
        conditionOther: "ignored without the Other tick",
        unknownQuestion: true,
      },
      "male",
    );
    expect(medical).toEqual({
      ...EMPTY_MEDICAL,
      underTreatment: false,
      hospitalized: true,
      hospitalDetail: "2019, appendix",
      allergies: ["other"],
      allergyOther: "Shellfish",
      conditions: ["asthma"],
    });
  });

  it("asks the women's questions of women only", () => {
    const answers = { pregnant: true, nursing: false, birthControl: true };
    expect(parseMedical(answers, "female")).toEqual({ ...EMPTY_MEDICAL, ...answers });
    expect(parseMedical(answers, "male")).toEqual(EMPTY_MEDICAL);
  });

  it("is empty when nothing was answered", () => {
    expect(parseMedical(undefined, "female")).toEqual(EMPTY_MEDICAL);
  });

  it.each([
    ["a list", []],
    ["text", "healthy"],
    ["an answer that is not Yes or No", { tobacco: "yes" }],
    ["an unknown allergy", { allergies: ["pollen"] }],
    ["a repeated tick", { conditions: ["asthma", "asthma"] }],
    ["a detail that is too long", { takingMedicine: true, medicineDetail: "x".repeat(101) }],
  ])("refuses %s", (_, value) => {
    expect(parseMedical(value, "female")).toBeNull();
    expect(parseIntakeForm({ ...adult, medical: value }, today)).toMatchObject({ ok: false, errors: { medical: "Answer the medical questions again." } });
  });
});

describe("ageOn", () => {
  it("counts whole years on the day", () => {
    expect(ageOn("2008-09-28", today)).toBe(18);
    expect(ageOn("2008-09-29", today)).toBe(17);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
  });
});

describe("formColumns", () => {
  it("names the patients columns create_booking fills", () => {
    const result = parseIntakeForm(adult, today);
    expect(result.ok && formColumns(result.form)).toEqual({
      middle_name: "Santos",
      sex: "female",
      address: "12 Rizal St, Makati",
      occupation: null,
      email: "ana@example.com",
      guardian_name: null,
      hmo_number: "MX-1234",
      previous_dentist: null,
      last_visit: "2025-06",
      visit_reason: "Toothache",
      emergency_name: "Ben Cruz",
      emergency_mobile: "+639175550000",
      waiver_name: "Ana Santos Cruz",
      waiver_version: WAIVER_VERSION,
      medical: { ...EMPTY_MEDICAL, goodHealth: true, takingMedicine: true, medicineDetail: "Losartan", allergies: ["antibiotics", "latex"] },
    });
  });
});

describe("waiverText", () => {
  it("names the clinic in both paragraphs", () => {
    const paragraphs = waiverText("Bright Dental");
    expect(paragraphs.map((p) => p.title)).toEqual(["Consent for dental examination and treatment.", "Data privacy consent."]);
    expect(paragraphs.every((p) => p.text.includes("Bright Dental"))).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/branches.test.ts tests/unit/intake.test.ts`
Expected: FAIL: both files stop on `Cannot find package '@/lib/branches'` and `Cannot find package '@/lib/intake'` (the modules do not exist yet).

- [ ] **Step 2: Write the text name helpers**

Create `src/lib/branches.ts`:

```ts
import { LIMITS } from "@/lib/validate";

/**
 * The clinic field of a text about an appointment (booking flow spec 4): the clinic's name for texts, followed by the
 * branch's short name when the clinic has 2 or more active branches, so the patient knows where to go. Every template
 * is sized for a clinic field of at most 20 characters, which branchSmsNameProblem keeps.
 */
export function smsClinicName(clinicSmsName: string, branchSmsName: string | null | undefined, activeBranches: number): string {
  return activeBranches >= 2 && branchSmsName ? `${clinicSmsName} ${branchSmsName}` : clinicSmsName;
}

/** Why a branch's short name for texts cannot be used beside this clinic's name for texts, or null (spec 4). */
export function branchSmsNameProblem(clinicSmsName: string, branchSmsName: string): string | null {
  const room = LIMITS.clinicSmsName - clinicSmsName.trim().length - 1;
  const length = branchSmsName.trim().length;
  if (room < 1) return "Shorten the clinic's name for texts first, so a branch name fits beside it.";
  if (length === 0 || length > room) return `Use 1 to ${room} characters, so the clinic and branch names fit in a text together.`;
  return null;
}
```

- [ ] **Step 3: Write the waiver and the form parser**

Create `src/lib/waiver.ts`:

```ts
/**
 * The consent waiver of the patient form (booking flow spec 6, item 7). Every signature stores WAIVER_VERSION with the
 * typed name and the time, so change the version whenever the words change. Drafted by us and waiting for legal review:
 * the wording, a cancellation and no-show policy, and minors signing through a guardian.
 */
export const WAIVER_VERSION = "2026-09-26";

/** The waiver's two paragraphs, each a bold title and its text, naming the clinic. */
export function waiverText(clinicName: string): { title: string; text: string }[] {
  return [
    {
      title: "Consent for dental examination and treatment.",
      text:
        "I confirm that the information I gave is true and complete to the best of my knowledge, and I will tell the clinic of any change in my health. " +
        `I allow the dentists of ${clinicName} to examine me and to explain the treatment I need; no treatment will start without my consent to it. ` +
        "I understand that dental treatment carries risks the dentist will explain before treatment, and that results cannot be guaranteed.",
    },
    {
      title: "Data privacy consent.",
      text:
        `I allow ${clinicName}, and BrightSmile as its booking service, to collect, keep, and use my personal and health information ` +
        "to book and manage my appointments and for my dental care, as described in the Privacy Notice. I may ask to see, correct, or delete it.",
    },
  ];
}
```

Create `src/lib/intake.ts`:

```ts
import { normalizeMobile } from "@/lib/phone";
import { cleanBirthday, cleanEmail, cleanText, LIMITS } from "@/lib/validate";
import { WAIVER_VERSION } from "@/lib/waiver";

/** Allergies the form offers to tick (booking flow spec 6, item 5), by the key patients.medical stores. */
export const ALLERGIES = {
  local_anaesthetic: "Local anaesthetic (for example lidocaine)",
  antibiotics: "Penicillin or other antibiotics",
  sulfa: "Sulfa drugs",
  aspirin: "Aspirin",
  latex: "Latex",
  other: "Other",
} as const;

/** Conditions the patient has or had, to tick (spec 6, item 5). */
export const CONDITIONS = {
  high_blood_pressure: "High blood pressure",
  low_blood_pressure: "Low blood pressure",
  heart_disease: "Heart disease",
  heart_surgery: "Heart surgery or pacemaker",
  diabetes: "Diabetes",
  asthma: "Asthma",
  bleeding: "Bleeding problems",
  hepatitis: "Hepatitis or liver disease",
  kidney: "Kidney disease",
  epilepsy: "Epilepsy or seizures",
  stroke: "Stroke",
  cancer: "Cancer",
  tuberculosis: "Tuberculosis",
  thyroid: "Thyroid problems",
  hiv: "HIV",
  other: "Other",
} as const;

export type Allergy = keyof typeof ALLERGIES;
export type Condition = keyof typeof CONDITIONS;
/** A Yes or No answer, or null when it was left empty: spec 6 requires only the fields it marks. */
export type YesNo = boolean | null;

/**
 * The medical history as patients.medical stores it (spec 6, item 5): always every key, a detail only beside its Yes
 * (or the Other tick), and the women's questions only for women.
 */
export type Medical = {
  goodHealth: YesNo;
  underTreatment: YesNo;
  treatmentCondition: string | null;
  seriousIllness: YesNo;
  illnessDetail: string | null;
  hospitalized: YesNo;
  hospitalDetail: string | null;
  takingMedicine: YesNo;
  medicineDetail: string | null;
  tobacco: YesNo;
  allergies: Allergy[];
  allergyOther: string | null;
  pregnant: YesNo;
  nursing: YesNo;
  birthControl: YesNo;
  conditions: Condition[];
  conditionOther: string | null;
};

/** The patient form (spec 6) as create_booking stores it. The patient's mobile is the verified number, never a field here. */
export type IntakeForm = {
  first: string;
  last: string;
  middle: string | null;
  birthday: string;
  sex: "female" | "male";
  address: string;
  occupation: string | null;
  email: string | null;
  guardian: string | null;
  hmo: string | null;
  hmoNumber: string | null;
  previousDentist: string | null;
  lastVisit: string | null;
  visitReason: string | null;
  emergencyName: string | null;
  emergencyMobile: string | null;
  medical: Medical;
  waiverName: string;
  waiverVersion: string;
};

/** Field limits, the same as the checks on public.patients (20260928000100_branches_booking.sql). */
export const INTAKE_LIMITS = {
  name: LIMITS.personName,
  address: LIMITS.address,
  occupation: 60,
  guardian: 100,
  hmo: LIMITS.hmo,
  hmoNumber: 40,
  previousDentist: 100,
  visitReason: 200,
  emergencyName: 100,
  signature: 150,
  detail: 100,
} as const;

const ALLERGY_KEYS = Object.keys(ALLERGIES) as Allergy[];
const CONDITION_KEYS = Object.keys(CONDITIONS) as Condition[];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const record = (value: unknown) =>
  (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** true, false, null for no answer, or undefined for anything that is not an answer. */
function yesNo(value: unknown): YesNo | undefined {
  if (value === true || value === false) return value;
  return value === null || value === undefined ? null : undefined;
}

/** The ticked keys in the form's order, or null for anything but a list of distinct known keys. */
function ticks<K extends string>(value: unknown, keys: K[]): K[] | null {
  if (value === null || value === undefined) return [];
  const known: unknown[] = keys;
  if (!Array.isArray(value) || new Set(value).size !== value.length || !value.every((x) => known.includes(x))) return null;
  return keys.filter((k) => value.includes(k));
}

/** A detail box: trimmed text or null when empty, undefined when too long. */
function detail(value: unknown): string | null | undefined {
  const text = cleanText(value, INTAKE_LIMITS.detail, true);
  return text === null ? undefined : text || null;
}

/** Age in whole years on a "YYYY-MM-DD" day. */
export function ageOn(birthday: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birthday.slice(0, 4));
  return day.slice(5) < birthday.slice(5) ? years - 1 : years;
}

/** The medical history in its fixed shape, or null when the input is not one. Unknown keys are dropped. */
export function parseMedical(value: unknown, sex: "female" | "male"): Medical | null {
  if (value !== null && value !== undefined && (typeof value !== "object" || Array.isArray(value))) return null;
  const v = record(value);
  const women = (key: string) => (sex === "female" ? yesNo(v[key]) : null);
  const answers = {
    goodHealth: yesNo(v.goodHealth),
    underTreatment: yesNo(v.underTreatment),
    seriousIllness: yesNo(v.seriousIllness),
    hospitalized: yesNo(v.hospitalized),
    takingMedicine: yesNo(v.takingMedicine),
    tobacco: yesNo(v.tobacco),
    pregnant: women("pregnant"),
    nursing: women("nursing"),
    birthControl: women("birthControl"),
  };
  const details = {
    treatmentCondition: detail(v.treatmentCondition),
    illnessDetail: detail(v.illnessDetail),
    hospitalDetail: detail(v.hospitalDetail),
    medicineDetail: detail(v.medicineDetail),
    allergyOther: detail(v.allergyOther),
    conditionOther: detail(v.conditionOther),
  };
  const allergies = ticks(v.allergies, ALLERGY_KEYS);
  const conditions = ticks(v.conditions, CONDITION_KEYS);
  if (Object.values(answers).includes(undefined) || Object.values(details).includes(undefined) || !allergies || !conditions) return null;
  const a = answers as Record<keyof typeof answers, YesNo>;
  const d = details as Record<keyof typeof details, string | null>;
  return {
    goodHealth: a.goodHealth,
    underTreatment: a.underTreatment,
    treatmentCondition: a.underTreatment ? d.treatmentCondition : null,
    seriousIllness: a.seriousIllness,
    illnessDetail: a.seriousIllness ? d.illnessDetail : null,
    hospitalized: a.hospitalized,
    hospitalDetail: a.hospitalized ? d.hospitalDetail : null,
    takingMedicine: a.takingMedicine,
    medicineDetail: a.takingMedicine ? d.medicineDetail : null,
    tobacco: a.tobacco,
    allergies,
    allergyOther: allergies.includes("other") ? d.allergyOther : null,
    pregnant: a.pregnant,
    nursing: a.nursing,
    birthControl: a.birthControl,
    conditions,
    conditionOther: conditions.includes("other") ? d.conditionOther : null,
  };
}

/**
 * Validates the patient form and waiver on the server (spec 6, 8): the required fields, a parent or guardian when the
 * patient is under 18 today (the form comes before the visit date is chosen), lengths, the email and mobile formats,
 * and the medical history's shape. Reports every problem at once, keyed by field. `today` is Manila's date.
 */
export function parseIntakeForm(value: unknown, today: string): { ok: true; form: IntakeForm } | { ok: false; errors: Record<string, string> } {
  const v = record(value);
  const errors: Record<string, string> = {};
  const required = (key: string, max: number, message: string) => {
    const text = cleanText(v[key], max);
    if (!text) errors[key] = message;
    return text ?? "";
  };
  const optional = (key: string, max: number) => {
    const text = cleanText(v[key], max, true);
    if (text === null) errors[key] = `Keep this to ${max} characters or fewer.`;
    return text || null;
  };
  const typed = (key: string) => (typeof v[key] === "string" ? (v[key] as string).trim() : "");

  const last = required("last", INTAKE_LIMITS.name, `Enter the last name, up to ${INTAKE_LIMITS.name} characters.`);
  const first = required("first", INTAKE_LIMITS.name, `Enter the first name, up to ${INTAKE_LIMITS.name} characters.`);
  const middle = optional("middle", INTAKE_LIMITS.name);
  const birthday = cleanBirthday(v.birthday, today);
  if (!birthday) errors.birthday = "Enter the birthday, a real past date.";
  const sex = v.sex === "female" || v.sex === "male" ? v.sex : null;
  if (!sex) errors.sex = "Choose female or male.";
  const address = required("address", INTAKE_LIMITS.address, `Enter the home address, up to ${INTAKE_LIMITS.address} characters.`);
  const occupation = optional("occupation", INTAKE_LIMITS.occupation);
  const email = typed("email") ? cleanEmail(typed("email")) : null;
  if (typed("email") && !email) errors.email = "Enter an email address like name@example.com, or leave it blank.";
  const guardian = optional("guardian", INTAKE_LIMITS.guardian);
  if (birthday && ageOn(birthday, today) < 18 && !guardian && !errors.guardian) {
    errors.guardian = "Enter the name of a parent or guardian: the patient is under 18.";
  }
  const hmo = optional("hmo", INTAKE_LIMITS.hmo);
  const hmoNumber = optional("hmoNumber", INTAKE_LIMITS.hmoNumber);
  const previousDentist = optional("previousDentist", INTAKE_LIMITS.previousDentist);
  const month = typed("lastVisit");
  const lastVisit = MONTH.test(month) && month >= "1900-01" && month <= today.slice(0, 7) ? month : null;
  if (month && !lastVisit) errors.lastVisit = "Choose a month that has passed, or leave it blank.";
  const visitReason = optional("visitReason", INTAKE_LIMITS.visitReason);
  const emergencyName = optional("emergencyName", INTAKE_LIMITS.emergencyName);
  const emergencyMobile = typed("emergencyMobile") ? normalizeMobile(typed("emergencyMobile")) : null;
  if (typed("emergencyMobile") && !emergencyMobile) errors.emergencyMobile = "Enter a Philippine mobile number, like 0917 123 4567, or leave it blank.";
  const medical = parseMedical(v.medical, sex ?? "male");
  if (!medical) errors.medical = "Answer the medical questions again.";
  if (v.agree !== true) errors.agree = "Please read the waiver and tick that you agree.";
  const waiverName = required("signature", INTAKE_LIMITS.signature, "Type the patient's full name as the signature.");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    form: {
      first,
      last,
      middle,
      birthday: birthday as string,
      sex: sex as "female" | "male",
      address,
      occupation,
      email,
      guardian,
      hmo,
      hmoNumber,
      previousDentist,
      lastVisit,
      visitReason,
      emergencyName,
      emergencyMobile,
      medical: medical as Medical,
      waiverName,
      waiverVersion: WAIVER_VERSION,
    },
  };
}

/** The form's columns on public.patients, as create_booking and change_booking take them (p_form). */
export function formColumns(f: IntakeForm): Record<string, unknown> {
  return {
    middle_name: f.middle,
    sex: f.sex,
    address: f.address,
    occupation: f.occupation,
    email: f.email,
    guardian_name: f.guardian,
    hmo_number: f.hmoNumber,
    previous_dentist: f.previousDentist,
    last_visit: f.lastVisit,
    visit_reason: f.visitReason,
    emergency_name: f.emergencyName,
    emergency_mobile: f.emergencyMobile,
    waiver_name: f.waiverName,
    waiver_version: f.waiverVersion,
    medical: f.medical,
  };
}
```

Run: `npx vitest run tests/unit/branches.test.ts tests/unit/intake.test.ts`
Expected: PASS (5 and 17 tests).

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every unit test and the `tests/sql` suite PASS.

```powershell
git add src/lib/branches.ts src/lib/waiver.ts src/lib/intake.ts tests/unit/branches.test.ts tests/unit/intake.test.ts
git commit -m "feat: add branch names for texts and the patient form parser" -m "smsClinicName puts a branch's short name after the clinic's in texts once a clinic has 2 or more active branches, and branchSmsNameProblem keeps the pair within 20 characters. parseIntakeForm validates spec 6's patient form and waiver on the server: required fields, a guardian for patients under 18 today, lengths, email and mobile formats, and the medical history's fixed shape. The waiver's words and version live in one module."
```

### Task 2: The branches and booking migration

**Files:**
- Create: `supabase/migrations/20260928000100_branches_booking.sql`, `tests/sql/branches.test.ts`
- Modify: `tests/sql/isolation.test.ts`, `tests/sql/teams.test.ts`, `src/lib/patients.ts`, `src/lib/onboarding.ts` (doc comment only)

**Interfaces:**
- Consumes: the harness (`freshDb`, `asUser`, `asService`, `addStaff`, `newClinic`, `migrate`, `MIGRATIONS`); `public.is_clinic_member(uuid)` and `public.is_clinic_owner(uuid)` (teams); `public.create_clinic(jsonb)` as last defined in `20260926000100_teams.sql`; `public.create_booking` as last defined in `20260924000100_hardening.sql`; the `patients_identity` unique index and the `no_overlap` exclusion constraint (`20260922000100_schema.sql`).
- Produces (SQL, in `supabase/migrations/20260928000100_branches_booking.sql`):
  - Table `public.branches (id uuid primary key, clinic_id uuid not null references clinics on delete cascade, name text not null (1 to 40), sms_name text not null (1 to 18), address text not null default '' (at most 200), maps_url text (https), active boolean not null default true, sort integer not null default 0, created_at timestamptz not null default now(), unique (id, clinic_id))`; members select, the owner inserts, updates (`name`, `sms_name`, `address`, `maps_url`, `active`, and `sort` only), and deletes
  - Trigger `keep_an_active_branch` (function `public.keep_an_active_branch()`, runnable by nobody directly): deactivating or deleting a clinic's last active branch raises SQLSTATE `BSLAB`
  - `public.working_hours.branch_id uuid not null`, foreign key `(branch_id, clinic_id)` to `branches (id, clinic_id)` on delete cascade; `public.appointments.branch_id uuid not null`, foreign key `(branch_id, clinic_id)` to `branches (id, clinic_id)`; every existing clinic gets one branch `Main` holding all its hours and appointments
  - New nullable `public.patients` columns: `middle_name`, `sex` (`female` or `male`), `address`, `occupation`, `email`, `guardian_name`, `hmo_number`, `previous_dentist`, `last_visit` (`YYYY-MM`), `visit_reason`, `emergency_name`, `emergency_mobile`, `waiver_name`, `waiver_version`, `waiver_at timestamptz`, `medical jsonb` (an object); constraints `patients_waiver_complete` and `patients_anonymized_clean`
  - `public.create_clinic(p jsonb) returns uuid`: the teams version, plus the first branch `Main` holding the onboarding hours
  - `public.create_booking(p_clinic_id uuid, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_procedure_names text[], p_source text, p_status text, p_manage_token text, p_patient_id uuid, p_first_name text, p_last_name text, p_mobile text, p_birthday date, p_hmo text, p_consent boolean, p_actor text, p_user_id uuid, p_branch_id uuid default null, p_form jsonb default null) returns uuid` (`authenticated` and `service_role`); SQLSTATE `BSBRA` for a branch that is not an active branch of the clinic
  - `public.change_booking(p_clinic_id uuid, p_id uuid, p_mobile text, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_procedure_names text[], p_patient_id uuid, p_first_name text, p_last_name text, p_birthday date, p_hmo text, p_form jsonb) returns boolean` (`service_role` only); false when the appointment cannot be changed, SQLSTATE `P0002` when the patient cannot be used, `23P01` on a clash
  - `deletePatient` in `@/lib/patients` also clears the form

Rules (spec 4, 5, 6, 10):
- The paste guard comes first: `perform 'public.clinic_invites'::regclass` fails fast when the teams migration is missing, as the teams migration's guard does for billing.
- `branches` follows the teams migration's pattern: RLS on, members select through `is_clinic_member`, the owner writes through `is_clinic_owner`, one policy per command (never a second select policy). Explicit grants: `authenticated` gets select, insert, delete, and update of `name`, `sms_name`, `address`, `maps_url`, `active`, and `sort` only (so a branch never moves to another clinic); `anon` nothing; `service_role` everything (the public booking page reads branches with the secret key).
- The last active branch is enforced in the database, for the owner and the secret key alike, by a `before update of active or delete` trigger. It takes a transaction advisory lock per clinic before counting, so two tabs cannot each retire "the other" last branch; deleting a clinic by hand still cascades because the check skips a clinic that no longer exists. The trigger function is `security invoker` and revoked from `public`, `anon`, and `authenticated` (triggers do not need execute), so the isolation test's function lists stay exact.
- The backfill copies each clinic's `address` and `maps_url` into its `Main` branch, sets `branch_id` on every working hour and appointment, then makes the columns `not null` and adds the composite keys. A branch with appointments cannot be deleted (plain foreign key), only deactivated; its hours go with it (on delete cascade). `no_overlap` stays per dentist, so one dentist is never booked at two branches at once.
- Working hours keep today's save-time validation (Task 3 extends it across branches); there is no database constraint on overlapping hours, because `saveDentist` inserts the new hours before it deletes the old ones.
- `create_clinic` is replaced with `create or replace`, copied from `20260926000100_teams.sql`, adding only the `v_branch` variable, the `Main` branch insert, and `branch_id` on the hours insert. A test compares the two definitions, so any other drift fails. The teams test's own comparison now reads the definition right after the teams migration.
- `create_booking` is dropped and created again with two trailing parameters that default to null, so every call without them (the staff New appointment, and the booking page until plan 8) keeps working and books at the clinic's first active branch (`order by sort, created_at`). A new patient is matched and created in one `insert ... on conflict` on `patients_identity` (race-safe; a patient without a mobile never matches, as before); a match keeps its form and only fills what is empty.
- `change_booking` checks everything spec 5 lists, plus the number: the appointment's patient must have `p_mobile`, and so must the patient it moves to (a new patient gets `p_mobile`). The eligibility check locks the appointment row (`for update of a`), then one update moves the time, dentist, services, and patient, sets `pending`, and clears `confirmed_at` and `reminder_sent_at`; the event is actor `patient`, reason `Changed by patient`. It is granted to `service_role` only.
- The patient form's checks mirror `INTAKE_LIMITS` (Task 1). `patients_anonymized_clean` refuses an anonymized row that keeps any of the form, so a `deletePatient` that forgot a field fails loudly instead of keeping health information; existing rows have no form, so adding it cannot fail. `deletePatient` clears every column of the form.
- Nothing in this plan changes `tests/db` or the Playwright test, and they keep typechecking; their seed helpers insert appointments without a branch, which a development database would now refuse (see Deferred).

- [ ] **Step 1: Write the failing database tests**

Create `tests/sql/branches.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, asService, asUser, freshDb, migrate, MIGRATIONS, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };

const BRANCHES = "20260928000100_branches_booking.sql";
const MOBILE = "+639171112222";

let db: PGlite;
let a: Clinic;
let aStaff: string;
let b: Clinic;
let tokens = 0;

/** The SQLSTATE a statement fails with, so each refusal is told apart by its code. */
async function sqlstate(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return "no error";
}

const one = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
const mainBranch = (clinicId: string) => one("select id from public.branches where clinic_id = $1 order by sort, created_at limit 1", [clinicId]);
const firstDentist = (clinicId: string) => one("select id from public.dentists where clinic_id = $1 order by created_at limit 1", [clinicId]);
const token = () => `Tok${String(++tokens).padStart(9, "0")}`;

/** create_booking through the secret key with named arguments, as supabase-js sends them; extra overrides the defaults. */
async function book(clinic: Clinic, startsAt: string, extra: Record<string, unknown> = {}): Promise<string> {
  const args: Record<string, unknown> = {
    p_clinic_id: clinic.clinicId,
    p_dentist_id: await firstDentist(clinic.clinicId),
    p_starts_at: startsAt,
    p_ends_at: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
    p_procedure_names: ["Consultation"],
    p_source: "online",
    p_status: "pending",
    p_manage_token: token(),
    p_patient_id: null,
    p_first_name: "Ana",
    p_last_name: "Cruz",
    p_mobile: MOBILE,
    p_birthday: null,
    p_hmo: "",
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
    ...extra,
  };
  const names = Object.keys(args);
  const casts: Record<string, string> = { p_procedure_names: "::text[]", p_form: "::jsonb", p_birthday: "::date" };
  const call = names.map((n, i) => `${n} => $${i + 1}${casts[n] ?? ""}`).join(", ");
  const values = names.map((n) => (n === "p_form" && args[n] !== null ? JSON.stringify(args[n]) : args[n]));
  const [row] = await asService<{ id: string }>(db, `select public.create_booking(${call}) as id`, values);
  return row.id;
}

/** change_booking through the secret key, as the change service calls it. */
async function change(clinic: Clinic, id: string, startsAt: string, patient: { id: string } | { form: Record<string, unknown> }, mobile = MOBILE) {
  const isNew = "form" in patient;
  const [row] = await asService<{ ok: boolean }>(
    db,
    `select public.change_booking($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, $12, $13::jsonb) as ok`,
    [
      clinic.clinicId,
      id,
      mobile,
      await firstDentist(clinic.clinicId),
      startsAt,
      new Date(new Date(startsAt).getTime() + 60 * 60_000).toISOString(),
      ["Consultation", "Cleaning"],
      isNew ? null : patient.id,
      isNew ? "Leo" : null,
      isNew ? "Cruz" : null,
      null,
      null,
      isNew ? JSON.stringify(patient.form) : null,
    ],
  );
  return row.ok;
}

const FORM = {
  middle_name: "Santos",
  sex: "female",
  address: "12 Rizal St, Makati",
  occupation: null,
  email: "ana@example.com",
  guardian_name: null,
  hmo_number: "MX-1234",
  previous_dentist: null,
  last_visit: "2025-06",
  visit_reason: "Toothache",
  emergency_name: "Ben Cruz",
  emergency_mobile: "+639175550000",
  waiver_name: "Ana Santos Cruz",
  waiver_version: "2026-09-26",
  medical: { goodHealth: true, allergies: ["latex"] },
};

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  aStaff = await addStaff(db, a);
}, 60_000);

describe("the migration on an existing database", () => {
  it("gives each clinic one branch, Main, from its address and map link, holding all its hours and appointments", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(BRANCHES));
    const old = await newClinic(early);
    const q = async (sql: string, params: unknown[] = []) => (await early.query<Record<string, unknown>>(sql, params)).rows;
    await q("update public.clinics set maps_url = 'https://maps.app.goo.gl/abc' where id = $1", [old.clinicId]);
    await q(
      `insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)
       select clinic_id, id, 3, '09:00', '12:00' from public.dentists where clinic_id = $1`,
      [old.clinicId],
    );
    await q("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Ana', 'Cruz', $2)", [old.clinicId, MOBILE]);
    await q(
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, d.id, p.id, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', 'OldVisit0001'
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id where d.clinic_id = $1`,
      [old.clinicId],
    );
    await migrate(early, BRANCHES);

    const branches = await q("select id, name, sms_name, address, maps_url, active from public.branches where clinic_id = $1", [old.clinicId]);
    expect(branches).toEqual([
      { id: expect.any(String), name: "Main", sms_name: "Main", address: "Makati", maps_url: "https://maps.app.goo.gl/abc", active: true },
    ]);
    const main = branches[0].id;
    expect(await q("select distinct branch_id from public.working_hours where clinic_id = $1", [old.clinicId])).toEqual([{ branch_id: main }]);
    expect(await q("select count(*)::int as n from public.working_hours where clinic_id = $1", [old.clinicId])).toEqual([{ n: 2 }]);
    expect(await q("select branch_id from public.appointments where clinic_id = $1", [old.clinicId])).toEqual([{ branch_id: main }]);
    await early.close();
  });
});

describe("create_clinic", () => {
  it("is the teams migration's version with only the first branch added", async () => {
    // Line endings follow each file's checkout (CRLF on Windows), so compare the text line by line.
    const definition = async (d: PGlite) =>
      (await d.query<{ def: string }>("select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure) as def")).rows[0].def.replace(/\r\n/g, "\n");
    const before = await freshDb(MIGRATIONS.indexOf(BRANCHES));
    const teams = await definition(before);
    await before.close();
    const expected = teams
      .replace("  v_dentist uuid;\n", () => "  v_dentist uuid;\n  v_branch uuid;\n")
      .replace(
        "  insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)\n  select v_clinic, v_dentist, (h->>'weekday')",
        () =>
          "  insert into public.branches (clinic_id, name, sms_name, address)\n  values (v_clinic, 'Main', 'Main', coalesce(p->>'address', ''))\n  returning id into v_branch;\n\n" +
          "  insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time)\n  select v_clinic, v_dentist, v_branch, (h->>'weekday')",
      );
    expect(expected).not.toBe(teams);
    const after = await freshDb(MIGRATIONS.indexOf(BRANCHES) + 1);
    expect(await definition(after)).toBe(expected);
    await after.close();
  });

  it("creates the first branch, Main, from the clinic's address, and puts the hours on it", async () => {
    const [branch] = await asUser<{ id: string; name: string; address: string }>(db, a.userId, "select id, name, address from public.branches");
    expect(branch).toEqual({ id: expect.any(String), name: "Main", address: "Makati" });
    expect(await asUser(db, a.userId, "select distinct branch_id from public.working_hours")).toEqual([{ branch_id: branch.id }]);
  });
});

describe("branches", () => {
  it("are read by every member of the clinic and nobody else", async () => {
    for (const user of [a.userId, aStaff]) {
      expect(await asUser(db, user, "select clinic_id from public.branches"), user).toEqual([{ clinic_id: a.clinicId }]);
    }
    expect(await asUser(db, b.userId, "select id from public.branches where clinic_id = $1", [a.clinicId])).toEqual([]);
  });

  it("change only when the owner changes them", async () => {
    const main = await mainBranch(a.clinicId);
    await expect(
      asUser(db, aStaff, "insert into public.branches (clinic_id, name, sms_name) values ($1, 'Sneaky', 'Sneaky')", [a.clinicId]),
    ).rejects.toThrow(/row-level security/);
    expect(await asUser(db, aStaff, "update public.branches set name = 'Renamed' returning id")).toEqual([]);
    expect(await asUser(db, aStaff, "delete from public.branches returning id")).toEqual([]);
    expect(await asUser(db, b.userId, "update public.branches set name = 'Renamed' where id = $1 returning id", [main])).toEqual([]);

    const [added] = await asUser<{ id: string }>(
      db,
      a.userId,
      "insert into public.branches (clinic_id, name, sms_name, address, sort) values ($1, 'Pasig', 'Pasig', 'Kapitolyo, Pasig', 1) returning id",
      [a.clinicId],
    );
    expect(await asUser(db, a.userId, "update public.branches set name = 'Makati', sort = 0 where id = $1 returning name", [main])).toEqual([{ name: "Makati" }]);
    expect(await asUser(db, a.userId, "delete from public.branches where id = $1 returning id", [added.id])).toEqual([added]);
  });

  it("never move to another clinic", async () => {
    await expect(asUser(db, a.userId, "update public.branches set clinic_id = $1", [b.clinicId])).rejects.toThrow(/permission denied/);
  });

  it("keep a short name for texts that fits beside the clinic's (at most 18 characters)", async () => {
    await expect(db.query("update public.branches set sms_name = $2 where clinic_id = $1", [a.clinicId, "x".repeat(19)])).rejects.toThrow(/branches_sms_name_check/);
  });
});

describe("the last active branch", () => {
  let c: Clinic;
  let main: string;

  beforeAll(async () => {
    c = await newClinic(db);
    main = await mainBranch(c.clinicId);
  });

  it("cannot be deactivated or deleted, by the owner or the secret key", async () => {
    expect(await sqlstate(asUser(db, c.userId, "update public.branches set active = false where id = $1", [main]))).toBe("BSLAB");
    expect(await sqlstate(asUser(db, c.userId, "delete from public.branches where id = $1", [main]))).toBe("BSLAB");
    expect(await sqlstate(asService(db, "update public.branches set active = false where id = $1", [main]))).toBe("BSLAB");
  });

  it("can be deactivated once another branch is active", async () => {
    const [other] = await asUser<{ id: string }>(db, c.userId, "insert into public.branches (clinic_id, name, sms_name) values ($1, 'Pasig', 'Pasig') returning id", [
      c.clinicId,
    ]);
    expect(await asUser(db, c.userId, "update public.branches set active = false where id = $1 returning active", [main])).toEqual([{ active: false }]);
    expect(await sqlstate(asUser(db, c.userId, "update public.branches set active = false where id = $1", [other.id]))).toBe("BSLAB");
  });

  it("goes with its clinic when the operator deletes the clinic", async () => {
    await db.query("delete from public.clinics where id = $1", [c.clinicId]);
    expect((await db.query("select id from public.branches where clinic_id = $1", [c.clinicId])).rows).toEqual([]);
  });
});

describe("hours and appointments", () => {
  it("refuse a branch of another clinic", async () => {
    const other = await mainBranch(b.clinicId);
    const dentist = await firstDentist(a.clinicId);
    await expect(
      db.query("insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) values ($1, $2, $3, 2, '09:00', '12:00')", [
        a.clinicId,
        dentist,
        other,
      ]),
    ).rejects.toThrow(/foreign key/);
    await expect(book(a, "2030-03-05T09:00:00+08:00", { p_branch_id: other })).rejects.toThrow(/branch not found/);
  });

  it("never book one dentist at two branches at once", async () => {
    const [pasig] = await asUser<{ id: string }>(db, a.userId, "insert into public.branches (clinic_id, name, sms_name, sort) values ($1, 'Pasig', 'Pasig', 5) returning id", [
      a.clinicId,
    ]);
    await book(a, "2030-03-06T09:00:00+08:00");
    expect(await sqlstate(book(a, "2030-03-06T09:15:00+08:00", { p_branch_id: pasig.id, p_first_name: "Leo" }))).toBe("23P01");
  });
});

describe("create_booking", () => {
  it("books at the clinic's first active branch when the caller names none, as today's pages do", async () => {
    const id = await book(a, "2030-03-11T09:00:00+08:00");
    // The staff New appointment's call, unchanged: 17 arguments through RLS, matching the patient booked above.
    const [staff] = await asUser<{ id: string }>(
      db,
      aStaff,
      "select public.create_booking($1, $2, $3, $4, '{Consultation}', 'manual', 'confirmed', $5, null, 'ana', 'CRUZ', $6, null, '', false, 'staff', $7) as id",
      [a.clinicId, await firstDentist(a.clinicId), "2030-03-11T11:00:00+08:00", "2030-03-11T11:30:00+08:00", token(), MOBILE, aStaff],
    );
    const { rows } = await db.query("select branch_id, patient_id from public.appointments where id in ($1, $2) order by starts_at", [id, staff.id]);
    const main = await mainBranch(a.clinicId);
    expect(rows).toEqual([
      { branch_id: main, patient_id: expect.any(String) },
      { branch_id: main, patient_id: (rows[0] as { patient_id: string }).patient_id },
    ]);
  });

  it("stores the branch it is given, and refuses one that is inactive", async () => {
    const [second] = await asUser<{ id: string }>(db, a.userId, "insert into public.branches (clinic_id, name, sms_name, sort) values ($1, 'Taguig', 'Taguig', 9) returning id", [
      a.clinicId,
    ]);
    const id = await book(a, "2030-03-12T09:00:00+08:00", { p_branch_id: second.id });
    expect((await db.query("select branch_id from public.appointments where id = $1", [id])).rows).toEqual([{ branch_id: second.id }]);
    await asUser(db, a.userId, "update public.branches set active = false where id = $1", [second.id]);
    expect(await sqlstate(book(a, "2030-03-13T09:00:00+08:00", { p_branch_id: second.id }))).toBe("BSBRA");
  });

  it("stores a new patient's form with the time of the waiver", async () => {
    const id = await book(b, "2030-03-11T10:00:00+08:00", { p_first_name: "Mia", p_form: FORM });
    const { rows } = await db.query<Record<string, unknown>>(
      `select p.sex, p.email, p.hmo_number, p.last_visit, p.emergency_mobile, p.waiver_name, p.waiver_version, p.medical,
              p.waiver_at is not null as signed, p.consent_at is not null as consented
       from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        sex: "female",
        email: "ana@example.com",
        hmo_number: "MX-1234",
        last_visit: "2025-06",
        emergency_mobile: "+639175550000",
        waiver_name: "Ana Santos Cruz",
        waiver_version: "2026-09-26",
        medical: { goodHealth: true, allergies: ["latex"] },
        signed: true,
        consented: true,
      },
    ]);
  });

  it("keeps the form of a patient it matches and fills only what is missing", async () => {
    await book(b, "2030-03-12T10:00:00+08:00", { p_first_name: "Joy" });
    const id = await book(b, "2030-03-13T10:00:00+08:00", { p_first_name: "JOY", p_form: FORM });
    await book(b, "2030-03-14T10:00:00+08:00", { p_first_name: "joy", p_form: { ...FORM, email: "other@example.com", waiver_name: "Someone Else" } });
    const { rows } = await db.query<Record<string, unknown>>(
      "select p.first_name, p.email, p.waiver_name, (select count(*)::int from public.appointments x where x.patient_id = p.id) as visits from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1",
      [id],
    );
    expect(rows).toEqual([{ first_name: "Joy", email: "ana@example.com", waiver_name: "Ana Santos Cruz", visits: 3 }]);
  });
});

describe("change_booking", () => {
  let c: Clinic;
  let visit: string;

  const row = async (id: string) =>
    (
      await db.query<Record<string, unknown>>(
        "select status, starts_at, confirmed_at, reminder_sent_at, procedure_names, patient_id from public.appointments where id = $1",
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    c = await newClinic(db);
    visit = await book(c, "2030-04-01T09:00:00+08:00", { p_status: "confirmed", p_source: "manual", p_actor: "staff" });
    await db.query("update public.appointments set reminder_sent_at = now() where id = $1", [visit]);
  });

  it("moves a future visit and sends it back to the clinic for approval", async () => {
    const before = await row(visit);
    expect(await change(c, visit, "2030-04-02T10:00:00+08:00", { id: before.patient_id as string })).toBe(true);
    expect(await row(visit)).toEqual({
      status: "pending",
      starts_at: new Date("2030-04-02T02:00:00Z"),
      confirmed_at: null,
      reminder_sent_at: null,
      procedure_names: ["Consultation", "Cleaning"],
      patient_id: before.patient_id,
    });
    const { rows } = await db.query("select from_status, to_status, actor, reason from public.appointment_events where appointment_id = $1 order by id desc limit 1", [visit]);
    expect(rows).toEqual([{ from_status: "confirmed", to_status: "pending", actor: "patient", reason: "Changed by patient" }]);
  });

  it("moves it to someone new on the same number, with their form", async () => {
    expect(await change(c, visit, "2030-04-03T10:00:00+08:00", { form: FORM })).toBe(true);
    const { rows } = await db.query<Record<string, unknown>>(
      "select p.first_name, p.mobile, p.waiver_name from public.appointments a join public.patients p on p.id = a.patient_id where a.id = $1",
      [visit],
    );
    expect(rows).toEqual([{ first_name: "Leo", mobile: MOBILE, waiver_name: "Ana Santos Cruz" }]);
  });

  it("refuses another number, a patient of another number, and a clash with another visit", async () => {
    const patient = (await row(visit)).patient_id as string;
    expect(await change(c, visit, "2030-04-04T10:00:00+08:00", { id: patient }, "+639179999999")).toBe(false);
    const stranger = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Zed', 'Uy', '+639178888888') returning id", [c.clinicId]);
    expect(await sqlstate(change(c, visit, "2030-04-04T10:00:00+08:00", { id: stranger }))).toBe("P0002");
    await book(c, "2030-04-05T10:30:00+08:00", { p_first_name: "Other", p_mobile: "+639177777777" });
    expect(await sqlstate(change(c, visit, "2030-04-05T10:00:00+08:00", { id: patient }))).toBe("23P01");
  });

  it("refuses a visit that is not pending or confirmed, has started, or starts within the minimum notice", async () => {
    const patient = (await row(visit)).patient_id as string;
    const soon = await book(c, new Date(Date.now() + 60 * 60_000).toISOString(), { p_first_name: "Soon" });
    expect(await change(c, soon, "2030-04-06T10:00:00+08:00", { id: patient })).toBe(false);
    const past = await book(c, "2030-04-07T10:00:00+08:00", { p_first_name: "Past" });
    await db.query("update public.appointments set starts_at = now() - interval '1 day', ends_at = now() - interval '23 hours' where id = $1", [past]);
    expect(await change(c, past, "2030-04-08T10:00:00+08:00", { id: patient })).toBe(false);
    await db.query("update public.appointments set status = 'cancelled' where id = $1", [visit]);
    expect(await change(c, visit, "2030-04-09T10:00:00+08:00", { id: patient })).toBe(false);
  });

  it("is only for the server's secret key", async () => {
    await expect(
      asUser(db, c.userId, "select public.change_booking($1, $2, $3, null, null, null, null, null, null, null, null, null, null)", [c.clinicId, visit, MOBILE]),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("the patient form", () => {
  let patient: string;

  beforeAll(async () => {
    patient = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Form', 'Test', $2) returning id", [b.clinicId, MOBILE]);
  });

  it("refuses values outside its rules", async () => {
    for (const [column, value] of [
      ["sex", "other"],
      ["email", "not-an-email"],
      ["emergency_mobile", "09171112222"],
      ["last_visit", "2025-13"],
      ["medical", "[]"],
    ]) {
      await expect(db.query(`update public.patients set ${column} = $2 where id = $1`, [patient, value]), column).rejects.toThrow(/check constraint/);
    }
    await expect(db.query("update public.patients set waiver_name = 'Form Test' where id = $1", [patient])).rejects.toThrow(/patients_waiver_complete/);
  });

  it("is cleared when the patient is anonymized, or the patient is not anonymized", async () => {
    await db.query("update public.patients set sex = 'male', medical = '{\"tobacco\": true}' where id = $1", [patient]);
    const anonymize = "update public.patients set first_name = 'Deleted', last_name = 'patient', mobile = null, anonymized_at = now()";
    await expect(db.query(`${anonymize} where id = $1`, [patient])).rejects.toThrow(/patients_anonymized_clean/);
    await db.query(`${anonymize}, sex = null, medical = null where id = $1`, [patient]);
  });
});
```

In `tests/sql/isolation.test.ts`, replace:

```ts
  "appointments",
  "clinic_invites",
```

with:

```ts
  "appointments",
  "branches",
  "clinic_invites",
```

replace:

```ts
    `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
     values ($1, $2, $3, '2030-01-07T09:00:00+08:00', '2030-01-07T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', $4) returning id`,
```

with:

```ts
    `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
     values ($1, (select id from public.branches where clinic_id = $1), $2, $3, '2030-01-07T09:00:00+08:00', '2030-01-07T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', $4) returning id`,
```

and replace:

```ts
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, d.id, p.id, $2, $3, $4, '{Consultation}', 'manual', substr(md5(random()::text), 1, 12)
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id where d.clinic_id = $1 limit 1`,
```

with:

```ts
      `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, b.id, d.id, p.id, $2, $3, $4, '{Consultation}', 'manual', substr(md5(random()::text), 1, 12)
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id join public.branches b on b.clinic_id = d.clinic_id
       where d.clinic_id = $1 limit 1`,
```

In `tests/sql/teams.test.ts`, replace:

```ts
    expect(expected).not.toBe(billing);
    expect(await definition(db)).toBe(expected);
```

with:

```ts
    expect(expected).not.toBe(billing);
    // Right after the teams migration: later migrations replace create_clinic again.
    const after = await freshDb(MIGRATIONS.indexOf(TEAMS) + 1);
    expect(await definition(after)).toBe(expected);
    await after.close();
```

replace:

```ts
      await asUser(db, a.userId, "insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 2, '09:00', '12:00') returning weekday", [
```

with:

```ts
      await asUser(db, a.userId, "insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time) select $1, $2, id, 2, '09:00', '12:00' from public.branches where clinic_id = $1 returning weekday", [
```

replace:

```ts
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       values ($1, $2, $3, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'manual', 'StaffVisit01') returning id`,
```

with:

```ts
      `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, id, $2, $3, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'manual', 'StaffVisit01'
       from public.branches where clinic_id = $1 returning id`,
```

and replace:

```ts
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, $2, p.id, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, '{Consultation}', $5, substr(md5(random()::text), 1, 12)
       from public.patients p where p.clinic_id = $1 limit 1`,
```

with:

```ts
      `insert into public.appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, b.id, $2, p.id, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, '{Consultation}', $5, substr(md5(random()::text), 1, 12)
       from public.patients p join public.branches b on b.clinic_id = p.clinic_id where p.clinic_id = $1 limit 1`,
```

Run: `npx vitest run tests/sql`
Expected: FAIL. `branches.test.ts` fails 20 tests and skips 3 (the migration file does not exist yet, so `relation "public.branches" does not exist`); `isolation.test.ts` stops in `beforeAll` on the same missing relation, so its 9 tests are skipped; `teams.test.ts` fails "changes when the owner changes it" and "is open to staff: patients, appointments, attendance, and time off", and its `clinic_week_stats` block stops in `beforeAll`. `billing.test.ts` still PASS.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260928000100_branches_booking.sql`:

```sql
-- Branches and the booking engine (booking flow spec sections 4 to 6): each clinic's branches with their own address
-- and calendar, the patient form and waiver, and a patient's own change to a booking. Plan 7 builds the data and the
-- server side; the new pages come in plan 8.

-- Refuses to run before the teams migration: regclass raises when clinic_invites does not exist yet, so pasting this
-- migration out of order fails fast instead of leaving the schema half migrated.
do $$ begin perform 'public.clinic_invites'::regclass; end $$;

-- 1. Branches (spec 4). One clinic keeps one account, one booking link, and one set of patients, procedures, and
-- staff; each branch has its own address and calendar. sms_name is the branch's short name for texts: with 2 or more
-- active branches a text's clinic field is the clinic's text name, a space, and this, at most 20 characters together
-- (smsClinicName and branchSmsNameProblem in src/lib/branches.ts), so a branch's is at most 18.
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sms_name text not null check (char_length(sms_name) between 1 and 18),
  address text not null default '' check (char_length(address) <= 200),
  maps_url text check (maps_url ~ '^https://'),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
create index branches_clinic on public.branches (clinic_id, sort);
alter table public.branches enable row level security;

-- Members read their clinic's branches; only the owner adds, edits, and deactivates them (spec 4), split per command
-- like the teams migration's setup policies.
create policy "members read branches" on public.branches
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner adds branches" on public.branches
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id));
create policy "owner updates branches" on public.branches
  for update to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));
create policy "owner deletes branches" on public.branches
  for delete to authenticated
  using (public.is_clinic_owner(clinic_id));

-- Explicit grants: a branch never moves to another clinic (clinic_id is not updatable), and visitors see branches only
-- through the server's secret key (the public booking page).
revoke all on public.branches from public, anon, authenticated;
grant select, insert, delete on public.branches to authenticated;
grant update (name, sms_name, address, maps_url, active, sort) on public.branches to authenticated;
grant all on public.branches to service_role;

-- 2. A clinic always keeps an active branch (spec 4), whoever deactivates or deletes it. The advisory lock serializes
-- changes to one clinic's branches, so two tabs can never each retire "the other" last branch. Deleting the clinic
-- itself (by hand, as the operator) still cascades: by then the clinic row is gone. BSLAB: the last active branch.
create function public.keep_an_active_branch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_retires boolean;
begin
  if tg_op = 'DELETE' then
    v_retires := old.active;
  else
    v_retires := old.active and not new.active;
  end if;
  if v_retires then
    perform pg_advisory_xact_lock(hashtext('branches:' || old.clinic_id::text));
    if exists (select 1 from public.clinics c where c.id = old.clinic_id)
       and not exists (
         select 1 from public.branches b where b.clinic_id = old.clinic_id and b.active and b.id <> old.id
       ) then
      raise exception 'a clinic keeps at least one active branch' using errcode = 'BSLAB';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public.keep_an_active_branch() from public, anon, authenticated;
create trigger keep_an_active_branch
  before update of active or delete on public.branches
  for each row execute function public.keep_an_active_branch();

-- 3. Every existing clinic gets one branch, "Main", from its address and map link, and all its working hours and
-- appointments move to it (spec 4). The owner renames it in Settings. Composite keys keep a branch, its clinic, and
-- the dentist's clinic consistent, like the existing ones.
insert into public.branches (clinic_id, name, sms_name, address, maps_url)
select id, 'Main', 'Main', address, maps_url from public.clinics;

alter table public.working_hours add column branch_id uuid;
update public.working_hours h set branch_id = b.id from public.branches b where b.clinic_id = h.clinic_id;
alter table public.working_hours alter column branch_id set not null;
alter table public.working_hours
  add foreign key (branch_id, clinic_id) references public.branches (id, clinic_id) on delete cascade;

-- A branch with appointments is deactivated, never deleted. The existing no_overlap guard is per dentist, so a dentist
-- can never be booked at two branches at once.
alter table public.appointments add column branch_id uuid;
update public.appointments a set branch_id = b.id from public.branches b where b.clinic_id = a.clinic_id;
alter table public.appointments alter column branch_id set not null;
alter table public.appointments
  add foreign key (branch_id, clinic_id) references public.branches (id, clinic_id);

-- 4. The patient form and waiver (spec 6), filled once per new patient on the public booking page. Health information
-- is sensitive personal information (RA 10173): only the clinic's members read it (the existing patients policy), it
-- never appears in texts, pushes, logs, or reports, and anonymizing a patient clears all of it. The limits match
-- src/lib/intake.ts; medical is the object parseMedical builds there.
alter table public.patients
  add column middle_name text check (char_length(middle_name) between 1 and 50),
  add column sex text check (sex in ('female', 'male')),
  add column address text check (char_length(address) between 1 and 200),
  add column occupation text check (char_length(occupation) between 1 and 60),
  add column email text check (char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column guardian_name text check (char_length(guardian_name) between 1 and 100),
  add column hmo_number text check (char_length(hmo_number) between 1 and 40),
  add column previous_dentist text check (char_length(previous_dentist) between 1 and 100),
  add column last_visit text check (last_visit ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  add column visit_reason text check (char_length(visit_reason) between 1 and 200),
  add column emergency_name text check (char_length(emergency_name) between 1 and 100),
  add column emergency_mobile text check (emergency_mobile ~ '^\+639[0-9]{9}$'),
  add column waiver_name text check (char_length(waiver_name) between 1 and 150),
  add column waiver_version text check (char_length(waiver_version) between 1 and 20),
  add column waiver_at timestamptz,
  add column medical jsonb check (jsonb_typeof(medical) = 'object' and octet_length(medical::text) <= 8000),
  -- The typed name, the waiver's version, and the time are stored together or not at all.
  add constraint patients_waiver_complete check (
    (waiver_name is null) = (waiver_version is null) and (waiver_name is null) = (waiver_at is null)
  ),
  -- "Delete patient" anonymizes (core spec 12): an anonymized patient keeps none of the form.
  add constraint patients_anonymized_clean check (
    anonymized_at is null or num_nonnulls(
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    ) = 0
  );

-- 5. Onboarding also creates the first branch, "Main", from the clinic's address, and puts the dentist's hours on it
-- (spec 4). The rest is 20260926000100_teams.sql unchanged.
create or replace function public.create_clinic(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_clinic uuid;
  v_dentist uuid;
  v_branch uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if exists (select 1 from public.clinic_members where user_id = v_user) then
    raise exception 'this account already has a clinic' using errcode = '23505';
  end if;

  insert into public.clinics (name, sms_name, slug, mobile, address)
  values (p->>'name', p->>'sms_name', p->>'slug', p->>'mobile', coalesce(p->>'address', ''))
  returning id into v_clinic;

  insert into public.clinic_members (clinic_id, user_id, email)
  values (v_clinic, v_user, (select u.email from auth.users u where u.id = v_user));

  insert into public.dentists (clinic_id, name, sms_name)
  values (v_clinic, p->'dentist'->>'name', p->'dentist'->>'sms_name')
  returning id into v_dentist;

  insert into public.branches (clinic_id, name, sms_name, address)
  values (v_clinic, 'Main', 'Main', coalesce(p->>'address', ''))
  returning id into v_branch;

  insert into public.working_hours (clinic_id, dentist_id, branch_id, weekday, start_time, end_time)
  select v_clinic, v_dentist, v_branch, (h->>'weekday')::smallint, (h->>'start')::time, (h->>'end')::time
  from jsonb_array_elements(p->'hours') h;

  insert into public.procedures (clinic_id, name, duration_minutes)
  select v_clinic, x->>'name', (x->>'minutes')::int
  from jsonb_array_elements(p->'procedures') x;

  insert into public.clinic_billing (clinic_id, trial_ends_at) values (v_clinic, now() + interval '14 days');

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;

-- 6. create_booking gains the branch and, for a new patient, the form (spec 4, 6). A caller that names no branch (the
-- staff New appointment and, until plan 8, the booking page) books at the clinic's first active branch, so the old
-- call shape keeps working. A new patient is matched by clinic, mobile, and name in one statement (patients_identity),
-- so two requests at once can no longer both insert them; a match keeps the form it has and only fills what it lacks.
-- BSBRA: no such active branch at this clinic.
drop function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid
);
create function public.create_booking(
  p_clinic_id uuid,
  p_dentist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_procedure_names text[],
  p_source text,
  p_status text,
  p_manage_token text,
  p_patient_id uuid,
  p_first_name text,
  p_last_name text,
  p_mobile text,
  p_birthday date,
  p_hmo text,
  p_consent boolean,
  p_actor text,
  p_user_id uuid,
  p_branch_id uuid default null,
  p_form jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_branch uuid;
  v_patient uuid := p_patient_id;
  v_id uuid;
begin
  select b.id into v_branch from public.branches b
  where b.clinic_id = p_clinic_id and b.active and (p_branch_id is null or b.id = p_branch_id)
  order by b.sort, b.created_at
  limit 1;
  if v_branch is null then
    raise exception 'branch not found' using errcode = 'BSBRA';
  end if;

  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    insert into public.patients as x (
      clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at,
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    )
    values (
      p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''),
      case when p_consent then now() end,
      p_form->>'middle_name', p_form->>'sex', p_form->>'address', p_form->>'occupation', p_form->>'email',
      p_form->>'guardian_name', p_form->>'hmo_number', p_form->>'previous_dentist', p_form->>'last_visit',
      p_form->>'visit_reason', p_form->>'emergency_name', p_form->>'emergency_mobile',
      p_form->>'waiver_name', p_form->>'waiver_version', case when p_form->>'waiver_name' is not null then now() end,
      nullif(p_form->'medical', 'null'::jsonb)
    )
    on conflict (clinic_id, mobile, lower(first_name), lower(last_name)) where anonymized_at is null
    do update set
      birthday = coalesce(excluded.birthday, x.birthday),
      hmo = coalesce(excluded.hmo, x.hmo),
      consent_at = coalesce(excluded.consent_at, x.consent_at),
      middle_name = coalesce(x.middle_name, excluded.middle_name),
      sex = coalesce(x.sex, excluded.sex),
      address = coalesce(x.address, excluded.address),
      occupation = coalesce(x.occupation, excluded.occupation),
      email = coalesce(x.email, excluded.email),
      guardian_name = coalesce(x.guardian_name, excluded.guardian_name),
      hmo_number = coalesce(x.hmo_number, excluded.hmo_number),
      previous_dentist = coalesce(x.previous_dentist, excluded.previous_dentist),
      last_visit = coalesce(x.last_visit, excluded.last_visit),
      visit_reason = coalesce(x.visit_reason, excluded.visit_reason),
      emergency_name = coalesce(x.emergency_name, excluded.emergency_name),
      emergency_mobile = coalesce(x.emergency_mobile, excluded.emergency_mobile),
      waiver_name = coalesce(x.waiver_name, excluded.waiver_name),
      waiver_version = case when x.waiver_name is null then excluded.waiver_version else x.waiver_version end,
      waiver_at = case when x.waiver_name is null then excluded.waiver_at else x.waiver_at end,
      medical = coalesce(x.medical, excluded.medical)
    returning id into v_patient;
  end if;

  insert into public.appointments
    (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token,
     confirmed_at)
  values
    (p_clinic_id, v_branch, p_dentist_id, v_patient, p_starts_at, p_ends_at, p_status, p_procedure_names, p_source,
     p_manage_token, case when p_status = 'confirmed' then now() end)
  returning id into v_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id)
  values (p_clinic_id, v_id, null, p_status, p_actor, p_user_id);

  return v_id;
end;
$$;
revoke execute on function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid,
  uuid, jsonb
) from public, anon;
grant execute on function public.create_booking(
  uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid,
  uuid, jsonb
) to authenticated, service_role;

-- 7. A patient's own change to a booking (spec 5), called with the secret key after the server checked the verified
-- number and re-validated the new time like a new booking. The appointment must be this clinic's, pending or
-- confirmed, and start in the future, at least the clinic's minimum notice from now, and its patient must have the
-- verified number; so must the patient it moves to, or a new patient gets that number. One update moves the time,
-- dentist, services, and patient, so the old time frees as the new one is taken, and no_overlap refuses a clash. The
-- clinic approves it again: pending, with confirmed_at and reminder_sent_at cleared. False when the appointment cannot
-- be changed; P0002 when the patient cannot be used.
create function public.change_booking(
  p_clinic_id uuid,
  p_id uuid,
  p_mobile text,
  p_dentist_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_procedure_names text[],
  p_patient_id uuid,
  p_first_name text,
  p_last_name text,
  p_birthday date,
  p_hmo text,
  p_form jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_from text;
  v_patient uuid := p_patient_id;
begin
  -- Locks the appointment, so a second change or a staff action waits for this one and then sees it.
  select a.status into v_from
  from public.appointments a
  join public.clinics c on c.id = a.clinic_id
  join public.patients p on p.id = a.patient_id
  where a.id = p_id and a.clinic_id = p_clinic_id
    and p.mobile = p_mobile and p.anonymized_at is null
    and a.status in ('pending', 'confirmed')
    and a.starts_at > now()
    and a.starts_at >= now() + make_interval(mins => c.min_notice_minutes)
  for update of a;
  if not found then
    return false;
  end if;

  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and mobile = p_mobile and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    insert into public.patients as x (
      clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at,
      middle_name, sex, address, occupation, email, guardian_name, hmo_number, previous_dentist, last_visit,
      visit_reason, emergency_name, emergency_mobile, waiver_name, waiver_version, waiver_at, medical
    )
    values (
      p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''), now(),
      p_form->>'middle_name', p_form->>'sex', p_form->>'address', p_form->>'occupation', p_form->>'email',
      p_form->>'guardian_name', p_form->>'hmo_number', p_form->>'previous_dentist', p_form->>'last_visit',
      p_form->>'visit_reason', p_form->>'emergency_name', p_form->>'emergency_mobile',
      p_form->>'waiver_name', p_form->>'waiver_version', case when p_form->>'waiver_name' is not null then now() end,
      nullif(p_form->'medical', 'null'::jsonb)
    )
    on conflict (clinic_id, mobile, lower(first_name), lower(last_name)) where anonymized_at is null
    do update set
      birthday = coalesce(excluded.birthday, x.birthday),
      hmo = coalesce(excluded.hmo, x.hmo),
      consent_at = coalesce(excluded.consent_at, x.consent_at),
      middle_name = coalesce(x.middle_name, excluded.middle_name),
      sex = coalesce(x.sex, excluded.sex),
      address = coalesce(x.address, excluded.address),
      occupation = coalesce(x.occupation, excluded.occupation),
      email = coalesce(x.email, excluded.email),
      guardian_name = coalesce(x.guardian_name, excluded.guardian_name),
      hmo_number = coalesce(x.hmo_number, excluded.hmo_number),
      previous_dentist = coalesce(x.previous_dentist, excluded.previous_dentist),
      last_visit = coalesce(x.last_visit, excluded.last_visit),
      visit_reason = coalesce(x.visit_reason, excluded.visit_reason),
      emergency_name = coalesce(x.emergency_name, excluded.emergency_name),
      emergency_mobile = coalesce(x.emergency_mobile, excluded.emergency_mobile),
      waiver_name = coalesce(x.waiver_name, excluded.waiver_name),
      waiver_version = case when x.waiver_name is null then excluded.waiver_version else x.waiver_version end,
      waiver_at = case when x.waiver_name is null then excluded.waiver_at else x.waiver_at end,
      medical = coalesce(x.medical, excluded.medical)
    returning id into v_patient;
  end if;

  update public.appointments
  set dentist_id = p_dentist_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      procedure_names = p_procedure_names,
      patient_id = v_patient,
      status = 'pending',
      confirmed_at = null,
      reminder_sent_at = null
  where id = p_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, reason)
  values (p_clinic_id, p_id, v_from, 'pending', 'patient', 'Changed by patient');
  return true;
end;
$$;
revoke execute on function public.change_booking(
  uuid, uuid, text, uuid, timestamptz, timestamptz, text[], uuid, text, text, date, text, jsonb
) from public, anon, authenticated;
grant execute on function public.change_booking(
  uuid, uuid, text, uuid, timestamptz, timestamptz, text[], uuid, text, text, date, text, jsonb
) to service_role;
```

Run: `npx vitest run tests/sql`
Expected: PASS: `branches.test.ts` 23 tests, `isolation.test.ts` 9 (its sweep now covers `branches`, and the function lists are unchanged: `change_booking` is not `authenticated`'s, and the trigger function is nobody's), `teams.test.ts` 27, `billing.test.ts` 18.

- [ ] **Step 3: Clear the form when a patient is deleted, and point at the new create_clinic**

In `src/lib/patients.ts`, replace:

```ts
const GONE = "This patient no longer exists.";
```

with:

```ts
const GONE = "This patient no longer exists.";

/** The patient form (booking flow spec 6): all of it goes when a patient is anonymized (patients_anonymized_clean). */
const FORM_CLEARED = {
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
```

and replace:

```ts
        hmo: null,
        anonymized_at: now.toISOString(),
```

with:

```ts
        hmo: null,
        ...FORM_CLEARED,
        anonymized_at: now.toISOString(),
```

In `src/lib/onboarding.ts`, replace:

```ts
/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260926000100_teams.sql). */
```

with:

```ts
/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260928000100_branches_booking.sql). */
```

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add supabase/migrations/20260928000100_branches_booking.sql tests/sql/branches.test.ts tests/sql/isolation.test.ts tests/sql/teams.test.ts src/lib/patients.ts src/lib/onboarding.ts
git commit -m "feat: add branches, the patient form, and change_booking to the database" -m "Each clinic gets branches with their own address and hours; existing clinics get one branch, Main, holding all their hours and appointments, and the last active branch can never be deactivated. create_clinic creates Main, create_booking takes a branch (the first active one by default) and a new patient's form, and change_booking lets the secret key move a verified number's upcoming visit back to pending in one statement. Anonymizing clears the form, enforced by a constraint. Proven offline in tests/sql."
```

### Task 3: Open times per branch; today's pages book at the first active branch

**Files:**
- Create: `tests/unit/availability.test.ts`
- Modify: `src/lib/booking-input.ts`, `src/lib/availability.ts`, `src/lib/booking.ts`, `src/app/[slug]/actions.ts`, `src/lib/dashboard.ts`, `src/lib/settings-input.ts`, `src/lib/clinic-settings.ts`, `tests/unit/booking-input.test.ts`, `tests/unit/settings-input.test.ts`

**Interfaces:**
- Consumes: `public.branches`, `working_hours.branch_id`, `create_booking(..., p_branch_id)` (Task 2); `openStarts`, `openDates` (they already take `ignoreId`) from `@/lib/slots`; `isUuid` from `@/lib/validate`.
- Produces:
  - From `@/lib/booking-input`: `type PublicBranch = { id: string; name: string; address: string; mapsUrl: string | null }`; `PublicClinic` gains `branch: PublicBranch` (the branch it was loaded for) and `branches: PublicBranch[]` (every active branch, by sort); `BookingPayload` gains `branchId?: string` (absent in codes requested before this change); `parseBookingInput` sets `branchId` to `clinic.branch.id`
  - From `@/lib/availability`: `loadClinic(by: { slug: string } | { id: string }, branchId?: string): Promise<PublicClinic | null>` (no branch: the first active one; null for a branch that is not active at the clinic); `monthOpenDates(clinic, dentist, durationMinutes, month, now, ignoreId?: string)`; `dayOpenStarts(clinic, dentist, durationMinutes, date, now, ignoreId?: string)`
  - From `@/lib/dashboard`: `staffOpenStarts(staff, q: { dentistId: string; date: string; duration: number; ignoreId?: string; branchId?: string }, now)`
  - From `@/lib/settings-input`: `DentistRow.hours[]` gains `branch_id: string | null`; a block may carry `branchId`
  - The actions `getOpenDates` and `getOpenStarts` read an optional `branchId` in their `selection`

Rules (spec 4 "Open times", "Working hours"):
- The slot engine is unchanged (`src/lib/slots.ts` is pure and works on blocks); the branch enters where the blocks are read. `loadClinic` reads the clinic's active branches and every working hour, keeps only the chosen branch's blocks, and lists the active dentists who have a block there. Every dentist has at least one block (onboarding and Settings require one), so for a clinic with one branch the page receives exactly what it did before, plus `branch` and `branches`.
- Every existing caller names no branch, so it gets the first active branch (`order by sort, created_at`): the booking page, `requestBooking`, and `resendCode`. A code's stored payload now carries `branchId`, and `verifyCode` books at that branch (a payload stored before this change has none and books at the first active branch, as `create_booking` does). `finalize` always passes `p_branch_id`, the branch whose open times it just checked.
- The no-overlap guard stays per dentist (`busyBetween` reads a dentist's appointments at every branch), so a dentist's time at one branch is never offered at another.
- `monthOpenDates` and `dayOpenStarts` take the appointment being changed (`ignoreId`), so its own time counts as free while a patient changes it (Task 6).
- Staff: `staffOpenStarts` reads the dentist's blocks at one branch: the one named, else a moved visit's own branch, else the first active branch (where `create_booking` puts a New appointment that names none). The dashboard pages do not change.
- Settings: `parseDentist` accepts an optional `branchId` per block (a uuid, or absent for the first active branch) and keeps today's overlap check, which runs over all of a dentist's blocks on a weekday together, so blocks at two branches can never overlap either. `saveDentist` refuses a branch that is not an active branch of the clinic before it writes anything, and puts unnamed blocks on the first active branch. The Settings page still sends no branch until plan 8.
- `saveProfile` keeps a one-branch clinic's branch address and map link in step with the profile, so the booking page (plan 8) never shows an address the owner already changed. With 2 or more branches, plan 8's Settings > Branches edits each branch.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/availability.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import type { PublicClinic } from "@/lib/booking-input";
import { formatTime } from "@/lib/time";

// The secret-key client as loadClinic and busyBetween read it: each table answers its rows below, whatever the
// filters. The database applies clinic_id and active; this checks what loadClinic does with the rows it gets.
const fake = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        lt: () => query,
        gt: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: fake.rows[table]?.[0] ?? null, error: null }),
        throwOnError: async () => ({ data: fake.rows[table] ?? [], error: null }),
      };
      return query;
    },
  }),
}));

const MAKATI = "b1";
const PASIG = "b2";
const now = new Date("2026-10-01T00:00:00Z");
const monday = "2026-10-05";

beforeEach(() => {
  fake.rows = {
    clinics: [
      {
        id: "c1",
        slug: "bright-dental",
        name: "Bright Dental",
        sms_name: "Bright Dental",
        mobile: "+639170000000",
        address: "Makati",
        maps_url: null,
        slot_minutes: 30,
        min_notice_minutes: 120,
        max_days_ahead: 60,
      },
    ],
    branches: [
      { id: MAKATI, name: "Makati", address: "Ayala Ave", maps_url: null },
      { id: PASIG, name: "Pasig", address: "Kapitolyo", maps_url: "https://maps.app.goo.gl/x" },
    ],
    dentists: [
      { id: "d1", name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
      { id: "d2", name: "Dr. Ben Lim", sms_name: "Dr. Lim" },
    ],
    working_hours: [
      { dentist_id: "d1", branch_id: MAKATI, weekday: 1, start_time: "09:00:00", end_time: "12:00:00" },
      { dentist_id: "d1", branch_id: PASIG, weekday: 1, start_time: "13:00:00", end_time: "17:00:00" },
      { dentist_id: "d2", branch_id: PASIG, weekday: 2, start_time: "09:00:00", end_time: "10:00:00" },
    ],
    procedures: [{ id: "p1", name: "Consultation", duration_minutes: 30 }],
    appointments: [],
    time_off: [],
  };
});

const times = async (clinic: PublicClinic, ignoreId?: string) =>
  (await dayOpenStarts(clinic, clinic.dentists[0], 60, monday, now, ignoreId)).map((s) => formatTime(s));

describe("loadClinic", () => {
  it("opens at the first active branch when none is named, as every page from before branches does", async () => {
    const clinic = await loadClinic({ slug: "bright-dental" });
    expect(clinic?.branch).toEqual({ id: MAKATI, name: "Makati", address: "Ayala Ave", mapsUrl: null });
    expect(clinic?.branches.map((b) => b.id)).toEqual([MAKATI, PASIG]);
    expect(clinic?.dentists.map((d) => d.id)).toEqual(["d1"]);
    expect(clinic?.dentists[0].hours[1]).toEqual([{ start: 540, end: 720 }]);
  });

  it("uses only the named branch's hours, and lists the dentists who work there", async () => {
    const clinic = await loadClinic({ slug: "bright-dental" }, PASIG);
    expect(clinic?.branch.name).toBe("Pasig");
    expect(clinic?.dentists.map((d) => [d.id, d.hours[1], d.hours[2]])).toEqual([
      ["d1", [{ start: 780, end: 1020 }], []],
      ["d2", [], [{ start: 540, end: 600 }]],
    ]);
  });

  it("is null for a branch that is not one of the clinic's active branches", async () => {
    expect(await loadClinic({ slug: "bright-dental" }, "b3")).toBeNull();
  });
});

describe("dayOpenStarts", () => {
  it("offers a dentist's times at the chosen branch only", async () => {
    expect(await times((await loadClinic({ slug: "bright-dental" }))!)).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
    expect(await times((await loadClinic({ slug: "bright-dental" }, PASIG))!)).toEqual([
      "1:00 PM",
      "1:30 PM",
      "2:00 PM",
      "2:30 PM",
      "3:00 PM",
      "3:30 PM",
      "4:00 PM",
    ]);
  });

  it("counts the appointment being changed as free, and every other one as busy", async () => {
    fake.rows.appointments = [{ id: "a1", starts_at: "2026-10-05T01:00:00Z", ends_at: "2026-10-05T02:00:00Z" }]; // 9:00 to 10:00 AM Manila
    const clinic = (await loadClinic({ slug: "bright-dental" }))!;
    expect(await times(clinic)).toEqual(["10:00 AM", "10:30 AM", "11:00 AM"]);
    expect(await times(clinic, "a1")).toEqual(["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM"]);
  });
});
```

In `tests/unit/booking-input.test.ts`, replace:

```ts
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  dentists: [
```

with:

```ts
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: { id: "b1", name: "Main", address: "Makati", mapsUrl: null },
  branches: [{ id: "b1", name: "Main", address: "Makati", mapsUrl: null }],
  dentists: [
```

replace:

```ts
        clinicId: "c1",
        slug: "bright-dental",
        dentistId: "d2",
```

with:

```ts
        clinicId: "c1",
        slug: "bright-dental",
        branchId: "b1",
        dentistId: "d2",
```

and replace:

```ts
    const result = parseBookingInput(clinic, { ...good, clinicId: "someone-else", endsAt: "2030-01-01T00:00:00Z" }, today);
    expect(result.ok && result.payload.clinicId).toBe("c1");
```

with:

```ts
    const result = parseBookingInput(clinic, { ...good, clinicId: "someone-else", branchId: "b9", endsAt: "2030-01-01T00:00:00Z" }, today);
    expect(result.ok && result.payload.clinicId).toBe("c1");
    expect(result.ok && result.payload.branchId).toBe("b1");
```

In `tests/unit/settings-input.test.ts`, replace:

```ts
        hours: [
          { weekday: 1, start_time: "09:00", end_time: "12:00" },
          { weekday: 1, start_time: "13:00", end_time: "17:00" },
        ],
      },
    });
  });
```

with:

```ts
        hours: [
          { weekday: 1, start_time: "09:00", end_time: "12:00", branch_id: null },
          { weekday: 1, start_time: "13:00", end_time: "17:00", branch_id: null },
        ],
      },
    });
  });

  it("keeps each block's branch, and refuses blocks that overlap even at different branches", () => {
    const makati = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
    const pasig = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
    const monday = (blocks: object[]) => [[], blocks, [], [], [], [], []];
    const dentist = { name: "Dr. Ben Lim", smsName: "Dr. Lim" };
    expect(
      parseDentist({ ...dentist, hours: monday([{ start: "09:00", end: "12:00", branchId: makati }, { start: "13:00", end: "17:00", branchId: pasig }]) }),
    ).toMatchObject({
      ok: true,
      value: {
        hours: [
          { weekday: 1, start_time: "09:00", end_time: "12:00", branch_id: makati },
          { weekday: 1, start_time: "13:00", end_time: "17:00", branch_id: pasig },
        ],
      },
    });
    expect(
      parseDentist({ ...dentist, hours: monday([{ start: "09:00", end: "12:00", branchId: makati }, { start: "11:00", end: "13:00", branchId: pasig }]) }),
    ).toEqual({ ok: false, field: "hours", error: "The blocks on Monday overlap." });
    expect(parseDentist({ ...dentist, hours: monday([{ start: "09:00", end: "12:00", branchId: "Makati" }]) })).toEqual({
      ok: false,
      field: "hours",
      error: "Choose a branch for each block.",
    });
  });
```

Run: `npx vitest run tests/unit/availability.test.ts tests/unit/booking-input.test.ts tests/unit/settings-input.test.ts`
Expected: FAIL: `loadClinic` has no `branch` yet and uses every branch's hours, `dayOpenStarts` ignores `ignoreId`, the stored payload has no `branchId`, and `parseDentist` returns no `branch_id` and accepts `"Makati"` as a branch.

- [ ] **Step 2: Give the public clinic its branch**

In `src/lib/booking-input.ts`, replace:

```ts
/** Everything the public booking page receives (spec 6): no patients and no busy intervals. */
```

with:

```ts
/** A branch as patients see it (booking flow spec 4): where to go. */
export type PublicBranch = { id: string; name: string; address: string; mapsUrl: string | null };

/**
 * Everything the public booking page receives (spec 6): no patients and no busy intervals. It is loaded for one
 * branch (booking flow spec 4): the dentists and their hours are that branch's; branches lists every active one.
 */
```

replace:

```ts
  rules: BookingRules;
  dentists: PublicDentist[];
```

with:

```ts
  rules: BookingRules;
  branch: PublicBranch;
  branches: PublicBranch[];
  dentists: PublicDentist[];
```

replace:

```ts
  clinicId: string;
  slug: string;
  dentistId: string;
```

with:

```ts
  clinicId: string;
  slug: string;
  /** Absent in codes requested before branches: they book at the clinic's first active branch. */
  branchId?: string;
  dentistId: string;
```

and replace:

```ts
      slug: clinic.slug,
      dentistId: chosen.dentist.id,
```

with:

```ts
      slug: clinic.slug,
      branchId: clinic.branch.id,
      dentistId: chosen.dentist.id,
```

- [ ] **Step 3: Read hours at one branch**

In `src/lib/availability.ts`, replace:

```ts
type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string };

/** The public booking page's clinic: active dentists with their weekly hours, active procedures, and rules. */
export async function loadClinic(by: { slug: string } | { id: string }): Promise<PublicClinic | null> {
```

with:

```ts
type HoursRow = { dentist_id: string; branch_id: string; weekday: number; start_time: string; end_time: string };
type BranchRow = { id: string; name: string; address: string; maps_url: string | null };

/**
 * The public booking page's clinic at one branch (booking flow spec 4): its active branches, the active dentists who
 * work at that branch with their weekly hours there, active procedures, and rules. Without a branch it is the clinic's
 * first active branch (by sort), where every page from before branches books. Null when the clinic does not exist or
 * the branch is not one of its active branches.
 */
export async function loadClinic(by: { slug: string } | { id: string }, branchId?: string): Promise<PublicClinic | null> {
```

replace:

```ts
  const [dentists, hours, procedures] = await Promise.all([
    db.from("dentists").select("id, name, sms_name").eq("clinic_id", c.id).eq("active", true).order("created_at").order("name").throwOnError(),
    db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", c.id).throwOnError(),
    db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", c.id).eq("active", true).order("name").throwOnError(),
  ]);
  const hourRows = hours.data as HoursRow[];
```

with:

```ts
  const [branches, dentists, hours, procedures] = await Promise.all([
    db.from("branches").select("id, name, address, maps_url").eq("clinic_id", c.id).eq("active", true).order("sort").order("created_at").throwOnError(),
    db.from("dentists").select("id, name, sms_name").eq("clinic_id", c.id).eq("active", true).order("created_at").order("name").throwOnError(),
    db.from("working_hours").select("dentist_id, branch_id, weekday, start_time, end_time").eq("clinic_id", c.id).throwOnError(),
    db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", c.id).eq("active", true).order("name").throwOnError(),
  ]);
  const active = (branches.data as BranchRow[]).map((b) => ({ id: b.id, name: b.name, address: b.address, mapsUrl: b.maps_url }));
  const branch = branchId === undefined ? active[0] : active.find((b) => b.id === branchId);
  if (!branch) return null;
  // Open times for a branch come from the working hours at that branch only (spec 4).
  const hourRows = (hours.data as HoursRow[]).filter((h) => h.branch_id === branch.id);
```

replace:

```ts
    rules: { slotMinutes: c.slot_minutes, minNoticeMinutes: c.min_notice_minutes, maxDaysAhead: c.max_days_ahead },
    dentists: (dentists.data as { id: string; name: string; sms_name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
      smsName: d.sms_name,
      hours: week(d.id),
    })),
```

with:

```ts
    rules: { slotMinutes: c.slot_minutes, minNoticeMinutes: c.min_notice_minutes, maxDaysAhead: c.max_days_ahead },
    branch,
    branches: active,
    // A dentist appears at the branches where they have hours. Every dentist has hours (onboarding and Settings
    // require a block), so a clinic with one branch lists every active dentist, as before.
    dentists: (dentists.data as { id: string; name: string; sms_name: string }[])
      .map((d) => ({ id: d.id, name: d.name, smsName: d.sms_name, hours: week(d.id) }))
      .filter((d) => d.hours.some((day) => day.length > 0)),
```

replace:

```ts
/** Dates of a "YYYY-MM" month with at least one open start for this dentist and duration (spec 8.3). */
export async function monthOpenDates(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  month: string,
  now: Date,
): Promise<string[]> {
```

with:

```ts
/**
 * Dates of a "YYYY-MM" month with at least one open start for this dentist and duration (spec 8.3). ignoreId is the
 * appointment being changed, whose own time counts as free (booking flow spec 3.4).
 */
export async function monthOpenDates(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  month: string,
  now: Date,
  ignoreId?: string,
): Promise<string[]> {
```

replace:

```ts
  return openDates({ dates, blocksByWeekday: dentist.hours, busy, durationMinutes, rules: clinic.rules, now });
```

with:

```ts
  return openDates({ dates, blocksByWeekday: dentist.hours, busy, durationMinutes, rules: clinic.rules, now, ignoreId });
```

replace:

```ts
/** Open start instants on one Manila date for this dentist and duration (spec 8). */
export async function dayOpenStarts(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  date: string,
  now: Date,
): Promise<Date[]> {
```

with:

```ts
/** Open start instants on one Manila date for this dentist and duration (spec 8), ignoring ignoreId's own time. */
export async function dayOpenStarts(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  date: string,
  now: Date,
  ignoreId?: string,
): Promise<Date[]> {
```

and replace:

```ts
  return openStarts({ date, blocks: dentist.hours[weekday(date)], busy, durationMinutes, rules: clinic.rules, now });
```

with:

```ts
  return openStarts({ date, blocks: dentist.hours[weekday(date)], busy, durationMinutes, rules: clinic.rules, now, ignoreId });
```

- [ ] **Step 4: Book at the branch the times came from**

In `src/lib/booking.ts`, replace:

```ts
    p_clinic_id: clinic.id,
    p_dentist_id: p.dentistId,
```

with:

```ts
    p_clinic_id: clinic.id,
    p_branch_id: clinic.branch.id,
    p_dentist_id: p.dentistId,
```

and replace:

```ts
    const clinic = await loadClinic({ id: row.booking.clinicId });
    if (!clinic) return done({ status: "unavailable" });
```

with:

```ts
    const clinic = await loadClinic({ id: row.booking.clinicId }, row.booking.branchId);
    if (!clinic) return done({ status: "unavailable" });
```

In `src/app/[slug]/actions.ts`, replace:

```ts
import { clientIp } from "@/lib/request";
```

with:

```ts
import { clientIp } from "@/lib/request";
import { isUuid } from "@/lib/validate";
```

and replace:

```ts
async function chosen(slug: unknown, selection: unknown) {
  const clinic = typeof slug === "string" ? await loadClinic({ slug }) : null;
```

with:

```ts
/** The branch, dentist, and procedures the client picked, checked against the clinic. No branch: the first active one. */
async function chosen(slug: unknown, selection: unknown) {
  const branchId = (selection as { branchId?: unknown } | null | undefined)?.branchId;
  const clinic = typeof slug === "string" ? await loadClinic({ slug }, isUuid(branchId) ? branchId : undefined) : null;
```

- [ ] **Step 5: Staff times and hours at a branch**

In `src/lib/dashboard.ts`, replace:

```ts
/**
 * Open start times for staff (New and Move): the clinic's slot spacing inside the dentist's hours, minus
 * appointments and time off. No minimum notice and a 365 day window, since those rules protect the public
 * page. Move passes ignoreId so the visit's own time counts as free (spec 8.4).
 */
export async function staffOpenStarts(
  staff: Staff,
  q: { dentistId: string; date: string; duration: number; ignoreId?: string },
  now: Date,
): Promise<Date[]> {
  // Values can come straight from a form, so check them before they reach a query.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(q.date) && addDays(q.date, 0) === q.date;
  const validDuration = Number.isInteger(q.duration) && q.duration >= 5 && q.duration <= 9600;
  if (!isUuid(q.dentistId) || !validDate || !validDuration || (q.ignoreId !== undefined && !isUuid(q.ignoreId))) return [];
  const [clinic, hours, busy] = await Promise.all([
    staff.db.from("clinics").select("slot_minutes").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("working_hours")
      .select("start_time, end_time")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", q.dentistId)
      .eq("weekday", weekday(q.date))
      .throwOnError(),
```

with:

```ts
/**
 * The branch staff times are for (booking flow spec 4): a moved visit's own branch, otherwise the clinic's first
 * active branch, where create_booking puts a New appointment that names none (until plan 8 asks for one).
 */
async function staffBranch(staff: Staff, appointmentId?: string): Promise<string | null> {
  if (appointmentId) {
    const { data } = await staff.db
      .from("appointments")
      .select("branch_id")
      .eq("id", appointmentId)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError();
    return (data as { branch_id: string } | null)?.branch_id ?? null;
  }
  const { data } = await staff.db
    .from("branches")
    .select("id")
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .order("sort")
    .order("created_at")
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Open start times for staff (New and Move): the clinic's slot spacing inside the dentist's hours at one branch
 * (staffBranch, unless named), minus appointments and time off at every branch. No minimum notice and a 365 day
 * window, since those rules protect the public page. Move passes ignoreId so the visit's own time counts as free
 * (spec 8.4).
 */
export async function staffOpenStarts(
  staff: Staff,
  q: { dentistId: string; date: string; duration: number; ignoreId?: string; branchId?: string },
  now: Date,
): Promise<Date[]> {
  // Values can come straight from a form, so check them before they reach a query.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(q.date) && addDays(q.date, 0) === q.date;
  const validDuration = Number.isInteger(q.duration) && q.duration >= 5 && q.duration <= 9600;
  const validIds = [q.ignoreId, q.branchId].every((id) => id === undefined || isUuid(id));
  if (!isUuid(q.dentistId) || !validDate || !validDuration || !validIds) return [];
  const branchId = q.branchId ?? (await staffBranch(staff, q.ignoreId));
  if (!branchId) return [];
  const [clinic, hours, busy] = await Promise.all([
    staff.db.from("clinics").select("slot_minutes").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("working_hours")
      .select("start_time, end_time")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", q.dentistId)
      .eq("branch_id", branchId)
      .eq("weekday", weekday(q.date))
      .throwOnError(),
```

In `src/lib/settings-input.ts`, replace:

```ts
import { cleanText, LIMITS } from "@/lib/validate";
```

with:

```ts
import { cleanText, isUuid, LIMITS } from "@/lib/validate";
```

replace:

```ts
export type DentistRow = { name: string; sms_name: string; hours: { weekday: number; start_time: string; end_time: string }[] };
```

with:

```ts
/** branch_id null: the clinic's first active branch (the Settings page names none until plan 8). */
export type DentistRow = {
  name: string;
  sms_name: string;
  hours: { weekday: number; start_time: string; end_time: string; branch_id: string | null }[];
};
```

and replace:

```ts
/** A dentist with weekly hours (several blocks per day), checked by the onboarding rules. */
export function parseDentist(value: unknown): Parsed<DentistRow> {
  const v = record(value);
  const input = { dentistName: text(v.name), dentistSmsName: text(v.smsName), hours: v.hours };
  const problem = Object.entries(dentistProblems(input as OnboardingInput))[0];
  if (problem) return fail(DENTIST_FIELD[problem[0]], problem[1]);
  const hours = (v.hours as Clock[][]).flatMap((blocks, weekday) => blocks.map((b) => ({ weekday, start_time: b.start, end_time: b.end })));
  return { ok: true, value: { name: input.dentistName.trim(), sms_name: input.dentistSmsName.trim(), hours } };
}
```

with:

```ts
/**
 * A dentist with weekly hours (several blocks per day), checked by the onboarding rules. A block may name its branch
 * (booking flow spec 4). The overlap check runs over all of a dentist's blocks on a weekday together, so blocks at
 * two branches can never overlap either.
 */
export function parseDentist(value: unknown): Parsed<DentistRow> {
  const v = record(value);
  const input = { dentistName: text(v.name), dentistSmsName: text(v.smsName), hours: v.hours };
  const problem = Object.entries(dentistProblems(input as OnboardingInput))[0];
  if (problem) return fail(DENTIST_FIELD[problem[0]], problem[1]);
  const blocks = (v.hours as (Clock & { branchId?: unknown })[][]).flatMap((day, weekday) => day.map((b) => ({ ...b, weekday })));
  if (blocks.some((b) => b.branchId !== undefined && b.branchId !== null && !isUuid(b.branchId))) return fail("hours", "Choose a branch for each block.");
  const hours = blocks.map((b) => ({
    weekday: b.weekday,
    start_time: b.start,
    end_time: b.end,
    branch_id: typeof b.branchId === "string" ? b.branchId : null,
  }));
  return { ok: true, value: { name: input.dentistName.trim(), sms_name: input.dentistSmsName.trim(), hours } };
}
```

In `src/lib/clinic-settings.ts`, replace:

```ts
    const { error } = await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId);
    if (error?.code === "23505") return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
    if (error) throw error;
    return { ok: true };
```

with:

```ts
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

replace:

```ts
  const { name, sms_name, hours } = parsed.value;
  try {
    let dentistId: string;
```

with:

```ts
  const { name, sms_name, hours } = parsed.value;
  try {
    // Each block at its branch (booking flow spec 4); a block that names none goes to the first active branch.
    const { data: branchRows } = await staff.db
      .from("branches")
      .select("id")
      .eq("clinic_id", staff.clinicId)
      .eq("active", true)
      .order("sort")
      .order("created_at")
      .throwOnError();
    const open = (branchRows as { id: string }[]).map((b) => b.id);
    if (open.length === 0 || hours.some((h) => h.branch_id !== null && !open.includes(h.branch_id))) {
      return { ok: false, field: "hours", error: "Choose an open branch for each block." };
    }
    let dentistId: string;
```

and replace:

```ts
      .insert(hours.map((h) => ({ clinic_id: staff.clinicId, dentist_id: dentistId, ...h })))
```

with:

```ts
      .insert(hours.map((h) => ({ clinic_id: staff.clinicId, dentist_id: dentistId, ...h, branch_id: h.branch_id ?? open[0] })))
```

Run: `npx vitest run tests/unit/availability.test.ts tests/unit/booking-input.test.ts tests/unit/settings-input.test.ts`
Expected: PASS (5, 16, and 12 tests).

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS (`booking-paused.test.ts` unchanged: a paused clinic still answers before any branch is read).

```powershell
git add tests/unit/availability.test.ts src/lib/booking-input.ts src/lib/availability.ts src/lib/booking.ts "src/app/[slug]/actions.ts" src/lib/dashboard.ts src/lib/settings-input.ts src/lib/clinic-settings.ts tests/unit/booking-input.test.ts tests/unit/settings-input.test.ts
git commit -m "feat: read open times at one branch" -m "loadClinic loads a clinic at one branch, the first active one unless named: only that branch's hours, and the dentists who work there. Today's booking page, codes, and staff times use the first active branch, so a clinic with one branch sees no change, and the request is booked at the branch whose times were checked. Settings accepts a branch per working block and still refuses overlapping blocks, now across branches, and a one-branch clinic's profile address follows to its branch."
```

### Task 4: Texts name the branch; the changed request alert

**Files:**
- Create: `tests/unit/appointment-actions.test.ts`
- Modify: `src/lib/sms/templates.ts`, `src/lib/push.ts`, `src/lib/appointment-actions.ts`, `src/lib/daily.ts`, `src/lib/daily-job.ts`, `tests/unit/sms-templates.test.ts`, `tests/unit/push.test.ts`, `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `smsClinicName` (Task 1); `branches.sms_name` and `appointments.branch_id` (Task 2).
- Produces:
  - `SmsKind` and `AlertKind` gain `"change_alert"`; `renderSms("change_alert", { first, lastInitial, date, time, dentist?, appUrl })`; `pushPayload("change_alert", startsAt, dentist)` has the title "Booking request changed". `alertClinic` (`@/lib/notify`) takes it unchanged.
  - From `@/lib/appointment-actions`: `Row` gains `branch: { sms_name: string }`; `activeBranchNames(staff: Staff): Promise<string[]>` (active branches' short names, first branch first); `rowText(row: Row, kind: PatientText["kind"], dentist: string | null, startsAt: Date, activeBranches: number, reason = ""): PatientText`
  - From `@/lib/daily`: `ReminderRow` gains `branch: { sms_name: string } | null`; `reminders(rows, activeDentists, now, paused = new Set(), activeBranches: Map<string, number> = new Map())`

Rules (spec 4 "Texts", spec 3.4 step 4):
- Every text about an appointment that carries the clinic's name gets it from `smsClinicName`: confirmed, declined, cancelled, and moved (staff actions), and the reminder (daily job). The appointment's own branch is named; a New appointment by staff is at the first active branch, where `create_booking` puts it. With one active branch every text is exactly as today. The code text names the clinic only (it is about a number, not an appointment), and the clinic's own alerts carry no clinic name.
- "changed request" is the clinic's alert for a patient's change (Task 6), sent like a new request: push first when the clinic chose push, a text to the clinic's mobile otherwise or when no push was delivered. Like every alert it carries the first name and last initial in the text and never a name in the push; health information never goes in either. Its worst case stays within one text (the templates test checks every kind at the field limits).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/appointment-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rowText, type Row } from "@/lib/appointment-actions";

const row: Row = {
  id: "a1",
  status: "confirmed",
  starts_at: "2026-10-05T02:00:00.000Z",
  ends_at: "2026-10-05T02:30:00.000Z",
  dentist_id: "d1",
  manage_token: "AbCdEfGhIjKl",
  patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
  dentist: { sms_name: "Dr. Reyes" },
  branch: { sms_name: "Makati" },
  clinic: { sms_name: "Bright Dental", slug: "bright-dental" },
};
const start = new Date(row.starts_at);

describe("rowText", () => {
  it("names the appointment's branch after the clinic once the clinic has 2 or more active branches", () => {
    expect(rowText(row, "confirmed", null, start, 1).clinicSmsName).toBe("Bright Dental");
    expect(rowText(row, "confirmed", null, start, 2).clinicSmsName).toBe("Bright Dental Makati");
  });

  it("keeps the reason and has no one to text for a deleted patient", () => {
    const deleted = { ...row, patient: { ...row.patient, anonymized_at: "2026-09-20T00:00:00Z" } };
    expect(rowText(deleted, "cancelled", null, start, 2, "Dentist unavailable")).toMatchObject({ mobile: null, reason: "Dentist unavailable" });
  });
});
```

In `tests/unit/sms-templates.test.ts`, replace:

```ts
  "otp", "request_alert", "confirmed", "declined", "moved",
```

with:

```ts
  "otp", "request_alert", "change_alert", "confirmed", "declined", "moved",
```

and replace:

```ts
  it("ends a reason with a period", () => {
```

with:

```ts
  it("tells the clinic that a patient changed a request, to approve again", () => {
    expect(renderSms("change_alert", {
      first: "Juan", lastInitial: "D", date: "Thu Sep 24", time: "10:00 AM", dentist: "Dr. Reyes", appUrl: "https://x.ph",
    })).toBe("Changed request: Juan D., Thu Sep 24 10:00 AM with Dr. Reyes. Approve at https://x.ph/app/requests");
  });

  it("ends a reason with a period", () => {
```

In `tests/unit/push.test.ts`, replace:

```ts
  it("has nowhere to put a patient's name (spec 10.4)", () => {
```

with:

```ts
  it("describes a changed request, which the clinic approves again", () => {
    expect(pushPayload("change_alert", start, null)).toEqual({ title: "Booking request changed", body: "Thu Sep 24, 10:00 AM", url: "/app/requests" });
  });

  it("has nowhere to put a patient's name (spec 10.4)", () => {
```

In `tests/unit/daily.test.ts`, replace:

```ts
    dentist: { sms_name: "Dr. Reyes" },
    clinic: { sms_name: "Bright Dental" },
```

with:

```ts
    dentist: { sms_name: "Dr. Reyes" },
    branch: { sms_name: "Makati" },
    clinic: { sms_name: "Bright Dental" },
```

and replace:

```ts
  it("sends nothing for a clinic whose booking is paused", () => {
```

with:

```ts
  it("names the branch after the clinic once the clinic has 2 or more active branches", () => {
    expect(reminders([row], one, now, new Set(), new Map([["c1", 2]]))[0].clinic).toBe("Bright Dental Makati");
    expect(reminders([row], one, now, new Set(), new Map([["c1", 1]]))[0].clinic).toBe("Bright Dental");
  });

  it("sends nothing for a clinic whose booking is paused", () => {
```

Run: `npx vitest run tests/unit/appointment-actions.test.ts tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts`
Expected: FAIL: `rowText` does not name the branch yet (and takes the branch count as the reason), `change_alert` has no template yet (its worst case and its text fail), its push title reads "Request cancelled", and the reminder's clinic field has no branch.

- [ ] **Step 2: The changed request alert**

In `src/lib/sms/templates.ts`, replace:

```ts
  | "request_alert"
  | "confirmed"
```

with:

```ts
  | "request_alert"
  | "change_alert"
  | "confirmed"
```

and replace:

```ts
    request_alert: () => `New request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
```

with:

```ts
    request_alert: () => `New request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
    change_alert: () => `Changed request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
```

In `src/lib/push.ts`, replace:

```ts
export type AlertKind = "request_alert" | "patient_cancel_alert";
```

with:

```ts
export type AlertKind = "request_alert" | "change_alert" | "patient_cancel_alert";
```

and replace:

```ts
/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: kind === "request_alert" ? "New booking request" : "Request cancelled", body: when, url: "/app/requests" };
}
```

with:

```ts
const ALERT_TITLE: Record<AlertKind, string> = {
  request_alert: "New booking request",
  change_alert: "Booking request changed",
  patient_cancel_alert: "Request cancelled",
};

/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: ALERT_TITLE[kind], body: when, url: "/app/requests" };
}
```

- [ ] **Step 3: Name the branch in patients' texts**

In `src/lib/appointment-actions.ts`, replace:

```ts
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
```

with:

```ts
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { smsClinicName } from "@/lib/branches";
```

replace:

```ts
  dentist: { sms_name: string };
  clinic: { sms_name: string; slug: string };
};

const ROW =
  "id, status, starts_at, ends_at, dentist_id, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name, slug)";
```

with:

```ts
  dentist: { sms_name: string };
  branch: { sms_name: string };
  clinic: { sms_name: string; slug: string };
};

const ROW =
  "id, status, starts_at, ends_at, dentist_id, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), branch:branches(sms_name), clinic:clinics(sms_name, slug)";
```

replace:

```ts
export type PatientText = {
```

with:

```ts
/** The short names for texts of the clinic's active branches, first branch first (booking flow spec 4). */
export async function activeBranchNames(staff: Staff): Promise<string[]> {
  const { data, error } = await staff.db
    .from("branches")
    .select("sms_name")
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .order("sort")
    .order("created_at");
  if (error) throw error;
  return (data as { sms_name: string }[]).map((b) => b.sms_name);
}

export type PatientText = {
```

replace:

```ts
/** The text for an existing appointment. A deleted (anonymized) patient has no mobile, so gets no text. */
export function rowText(row: Row, kind: PatientText["kind"], dentist: string | null, startsAt: Date, reason = ""): PatientText {
  return {
    kind,
    appointmentId: row.id,
    token: row.manage_token,
    first: row.patient.first_name,
    mobile: row.patient.anonymized_at ? null : row.patient.mobile,
    clinicSmsName: row.clinic.sms_name,
```

with:

```ts
/**
 * The text for an existing appointment. A deleted (anonymized) patient has no mobile, so gets no text. With 2 or more
 * active branches the clinic field names the appointment's branch (booking flow spec 4).
 */
export function rowText(
  row: Row,
  kind: PatientText["kind"],
  dentist: string | null,
  startsAt: Date,
  activeBranches: number,
  reason = "",
): PatientText {
  return {
    kind,
    appointmentId: row.id,
    token: row.manage_token,
    first: row.patient.first_name,
    mobile: row.patient.anonymized_at ? null : row.patient.mobile,
    clinicSmsName: smsClinicName(row.clinic.sms_name, row.branch.sms_name, activeBranches),
```

replace:

```ts
    const [row, dentistShown] = await Promise.all([loadRow(staff, id), showsDentist(staff)]);
```

with:

```ts
    const [row, dentistShown, branches] = await Promise.all([loadRow(staff, id), showsDentist(staff), activeBranchNames(staff)]);
```

replace:

```ts
      ? await textPatient(staff, rowText(row, kind, dentistShown ? row.dentist.sms_name : null, startsAt, reason))
```

with:

```ts
      ? await textPatient(staff, rowText(row, kind, dentistShown ? row.dentist.sms_name : null, startsAt, branches.length, reason))
```

replace:

```ts
    const [row, dentist, dentistShown] = await Promise.all([loadRow(staff, id), activeDentist(staff, slot.dentistId), showsDentist(staff)]);
```

with:

```ts
    const [row, dentist, dentistShown, branches] = await Promise.all([
      loadRow(staff, id),
      activeDentist(staff, slot.dentistId),
      showsDentist(staff),
      activeBranchNames(staff),
    ]);
```

replace:

```ts
    const text = await textPatient(staff, rowText(row, "moved", dentistShown ? dentist.sms_name : null, slot.startsAt));
```

with:

```ts
    const text = await textPatient(staff, rowText(row, "moved", dentistShown ? dentist.sms_name : null, slot.startsAt, branches.length));
```

replace:

```ts
    const [dentist, procedures, clinic, dentistShown] = await Promise.all([
```

with:

```ts
    const [dentist, procedures, clinic, dentistShown, branches] = await Promise.all([
```

replace:

```ts
      showsDentist(staff),
    ]);
```

with:

```ts
      showsDentist(staff),
      activeBranchNames(staff),
    ]);
```

and replace:

```ts
          clinicSmsName: sms_name,
```

with:

```ts
          // create_booking put it at the first active branch (staff name none until plan 8).
          clinicSmsName: smsClinicName(sms_name, branches[0], branches.length),
```

In `src/lib/daily.ts`, replace:

```ts
import { addDays, formatTime, manilaDate, manilaInstant, weekday } from "@/lib/time";
```

with:

```ts
import { smsClinicName } from "@/lib/branches";
import { addDays, formatTime, manilaDate, manilaInstant, weekday } from "@/lib/time";
```

replace:

```ts
  dentist: { sms_name: string } | null;
  clinic: { sms_name: string } | null;
};
```

with:

```ts
  dentist: { sms_name: string } | null;
  branch: { sms_name: string } | null;
  clinic: { sms_name: string } | null;
};
```

replace:

```ts
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1).
 * A clinic whose booking is paused gets no reminders (billing spec 7.5).
 */
export function reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date, paused: Set<string> = new Set()): Reminder[] {
```

with:

```ts
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1), and the
 * branch after the clinic's name only when it has 2 or more active branches (booking flow spec 4).
 * A clinic whose booking is paused gets no reminders (billing spec 7.5).
 */
export function reminders(
  rows: ReminderRow[],
  activeDentists: Map<string, number>,
  now: Date,
  paused: Set<string> = new Set(),
  activeBranches: Map<string, number> = new Map(),
): Reminder[] {
```

and replace:

```ts
        clinic: r.clinic.sms_name,
```

with:

```ts
        clinic: smsClinicName(r.clinic.sms_name, r.branch?.sms_name, activeBranches.get(r.clinic_id) ?? 1),
```

In `src/lib/daily-job.ts`, replace:

```ts
  "id, clinic_id, status, starts_at, confirmed_at, reminder_sent_at, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name)";
```

with:

```ts
  "id, clinic_id, status, starts_at, confirmed_at, reminder_sent_at, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), branch:branches(sms_name), clinic:clinics(sms_name)";
```

replace:

```ts
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);
```

with:

```ts
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);
  // Booking flow spec 4: a clinic with 2 or more active branches names the branch in its texts.
  const { data: branchRows, error: branchError } = await db.from("branches").select("clinic_id").eq("active", true).in("clinic_id", clinicIds);
  if (branchError) throw branchError;
  const branches = new Map<string, number>();
  for (const { clinic_id } of (branchRows ?? []) as { clinic_id: string }[]) branches.set(clinic_id, (branches.get(clinic_id) ?? 0) + 1);
```

and replace:

```ts
  for (const r of reminders(rows, active, now, paused)) {
```

with:

```ts
  for (const r of reminders(rows, active, now, paused, branches)) {
```

Run: `npx vitest run tests/unit/appointment-actions.test.ts tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts`
Expected: PASS.

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add tests/unit/appointment-actions.test.ts src/lib/sms/templates.ts src/lib/push.ts src/lib/appointment-actions.ts src/lib/daily.ts src/lib/daily-job.ts tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts
git commit -m "feat: name the branch in texts and add the changed request alert" -m "Confirmations, declines, cancellations, moves, and reminders name the appointment's branch after the clinic once a clinic has 2 or more active branches; with one branch every text is unchanged. The clinic gets a new changed request alert, by push or text like a new request, for the patient changes coming in the next task."
```

### Task 5: Number-first verification

**Files:**
- Create: `src/lib/number-booking.ts`, `tests/unit/number-booking.test.ts`
- Modify: `src/lib/booking.ts`, `src/app/[slug]/actions.ts`

**Interfaces:**
- Consumes: `issue_otp` and `otp_requests` (unchanged); `DEVICE_COOKIE`, `readDevice`, `signDevice`, `checkCode` from `@/lib/codes`; `bookingOpen` from `@/lib/billing-data`; `logError` from `@/lib/log`.
- Produces:
  - From `@/lib/booking`: `type CodeIssued` (now exported); `type VerifyRequest = { clinicId: string; verify: true }`; `type StoredRequest = BookingPayload | VerifyRequest` (what `otp_requests.booking` holds); `issueCode(clinic: Pick<PublicClinic, "id" | "smsName">, mobile: string, stored: StoredRequest, ctx: { ip: string; now: Date }): Promise<CodeIssued>`; `spendCode(requestId: string, code: string, now: Date, purpose: "booking" | "verify"): Promise<{ status: "ok"; row: OtpRow } | { status: "wrong"; attemptsLeft: number } | { status: "expired" | "locked" | "used" | "paused" }>`. `requestBooking`, `verifyCode`, and `resendCode` keep their signatures and behavior.
  - From `@/lib/number-booking` (server only): `type Device = { verifiedMobiles: string[]; now: Date }`; `type Refused`; `verifiedNumber(input: unknown, device: Device): string | null`; `startVerification(slug: string, mobileInput: unknown, ctx: Device & { ip: string }): Promise<StartOutcome>`; `checkVerification(requestId: string, code: string, now: Date): Promise<CheckOutcome>`; `numberPatients(slug: string, mobileInput: unknown, device: Device): Promise<PatientsOutcome>`; `numberAppointments(slug: string, mobileInput: unknown, device: Device): Promise<AppointmentsOutcome>`; the types `StartOutcome`, `CheckOutcome`, `NumberPatient`, `PatientsOutcome`, `NumberAppointment`, `AppointmentsOutcome`
  - Server Actions in `src/app/[slug]/actions.ts`: `startVerification(slug: string, mobile: string)`, `checkVerification(requestId: string, code: string)` (sets the cookie on success), `numberPatients(slug: string, mobile: string)`, `numberAppointments(slug: string, mobile: string)`; a new code for either kind of request is the existing `resendBookingCode(requestId)`

Rules (spec 2.1, 3.2, 8):
- The code is the one the clinic already sends, with the same limits: `issue_otp` (3 per number and 10 per connection in a rolling hour, 60 seconds between codes) stores a verification as `otp_requests.booking = { clinicId, verify: true }`, and `resendCode` already re-issues whatever the row holds. A booking page code and a verification code each work only for their own purpose (`spendCode` answers `expired` otherwise), so a verification can never create a booking and a booking code never only verifies.
- A phone that verified the number before (the existing `bs_verified` cookie: up to 5 numbers for 180 days, signed with `APP_SECRET`) goes straight on without a text. A right code adds the number to the cookie through the same helper `verifyBookingCode` uses.
- Every service re-checks the cookie: `verifiedNumber` normalizes the number and requires it in the device's list; anything else answers `unverified` before any read. Every query filters by this clinic and by the patient's mobile (`patients!inner` with `patients.mobile`), and never lists a deleted (anonymized) patient.
- A lapsed clinic sends no code and takes no code (billing spec 7.5), as the booking page already does; the pages show the paused notice instead of the three buttons (spec 3.1). The patient link keeps cancelling.
- The appointment list gives what plan 8's list and summary need: patient, branch with address and map link, dentist, services (names, plus the active procedures' ids a change starts from), date and time, status, and `changeable` (false within the minimum notice, spec 3.4 step 4).
- Logs carry where it failed and the error message only, never a number, a name, or a code.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/number-booking.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingOpen } from "@/lib/billing-data";
import { hashCode } from "@/lib/codes";
import { checkVerification, numberAppointments, numberPatients, startVerification, type Device } from "@/lib/number-booking";
import { sendSms } from "@/lib/sms/send";

// Booking flow spec 8: nothing is shown or changed for a number this phone has not verified. The fake secret-key
// client records every table and function it is asked for, so "touches nothing" is checked, not assumed. Reads
// answer fake.single (maybeSingle) or fake.list (throwOnError); writes answer one updated row.
const fake = vi.hoisted(() => ({
  single: {} as Record<string, unknown>,
  list: {} as Record<string, unknown[]>,
  tables: [] as string[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  rpcAnswer: {} as Record<string, { data: unknown; error: { code: string } | null }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => {
      fake.tables.push(table);
      let writing = false;
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        gt: () => query,
        order: () => query,
        limit: () => query,
        update: () => {
          writing = true;
          return query;
        },
        maybeSingle: () => {
          const answer = { data: fake.single[table] ?? null, error: null };
          return Object.assign(Promise.resolve(answer), { throwOnError: async () => answer });
        },
        throwOnError: async () => ({ data: writing ? [{ id: "updated" }] : (fake.list[table] ?? []), error: null }),
      };
      return query;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      fake.rpcs.push({ name, args });
      return fake.rpcAnswer[name] ?? { data: { status: "ok" }, error: null };
    },
  }),
}));
vi.mock("@/lib/billing-data", () => ({ bookingOpen: vi.fn(async () => true) }));
vi.mock("@/lib/sms/send", () => ({ sendSms: vi.fn(async () => "logged") }));
vi.mock("@/lib/notify", () => ({ alertClinic: vi.fn(async () => "push") }));

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REQUEST = "5b0d6c1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const MOBILE = "+639171112222";
const now = new Date("2026-10-13T02:00:00Z");
const verified: Device = { verifiedMobiles: [MOBILE], now };
const stranger: Device = { verifiedMobiles: ["+639179999999"], now };
const stored = (booking: Record<string, unknown>) => ({
  id: REQUEST,
  mobile: MOBILE,
  code_hash: hashCode(REQUEST, "123456"),
  booking,
  attempts: 0,
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
  verified_at: null,
});

beforeEach(() => {
  vi.stubEnv("APP_SECRET", "a-test-secret-for-hashing-codes-only");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.single = { clinics: { id: CLINIC, sms_name: "Bright Dental", min_notice_minutes: 120 } };
  fake.list = {};
  fake.tables = [];
  fake.rpcs = [];
  fake.rpcAnswer = {};
  vi.mocked(bookingOpen).mockResolvedValue(true);
  vi.mocked(sendSms).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a number this phone has not verified", () => {
  it("sees no patients and no appointments, and nothing is read", async () => {
    for (const device of [stranger, { verifiedMobiles: [], now }]) {
      expect(await numberPatients("bright-dental", "0917 111 2222", device)).toEqual({ status: "unverified" });
      expect(await numberAppointments("bright-dental", "0917 111 2222", device)).toEqual({ status: "unverified" });
    }
    expect(await numberPatients("bright-dental", { mobile: MOBILE }, verified)).toEqual({ status: "unverified" });
    expect(fake.tables).toEqual([]);
  });
});

describe("startVerification", () => {
  it("refuses what is not a Philippine mobile number", async () => {
    expect(await startVerification("bright-dental", "12345", { ...verified, ip: "203.0.113.5" })).toEqual({ status: "invalid" });
    expect(fake.tables).toEqual([]);
  });

  it("goes straight on for a number this phone verified before, without a code", async () => {
    expect(await startVerification("bright-dental", "0917 111 2222", { ...verified, ip: "203.0.113.5" })).toEqual({ status: "verified", mobile: MOBILE });
    expect(fake.rpcs).toEqual([]);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("otherwise texts a code within issue_otp's limits, for the number alone", async () => {
    const outcome = await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" });
    expect(outcome).toEqual({ status: "code", requestId: expect.any(String), mobile: MOBILE });
    expect(fake.rpcs).toEqual([{ name: "issue_otp", args: expect.objectContaining({ p_mobile: MOBILE, p_ip: "203.0.113.5", p_booking: { clinicId: CLINIC, verify: true } }) }]);
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ kind: "otp", to: MOBILE }));
    fake.rpcAnswer.issue_otp = { data: { status: "limited" }, error: null };
    expect(await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" })).toEqual({ status: "limited" });
  });

  it("sends no code for a paused clinic", async () => {
    vi.mocked(bookingOpen).mockResolvedValue(false);
    expect(await startVerification("bright-dental", "0917 111 2222", { ...stranger, ip: "203.0.113.5" })).toEqual({ status: "paused" });
    expect(fake.rpcs).toEqual([]);
  });
});

describe("checkVerification", () => {
  it("verifies the number with the right code", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, verify: true });
    expect(await checkVerification(REQUEST, "123456", now)).toEqual({ status: "verified", mobile: MOBILE });
  });

  it("spends an attempt on a wrong code", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, verify: true });
    expect(await checkVerification(REQUEST, "654321", now)).toEqual({ status: "wrong", attemptsLeft: 4 });
  });

  it("never takes a code sent with a booking page request", async () => {
    fake.single.otp_requests = stored({ clinicId: CLINIC, dentistId: "d1", startsAt: "2026-10-20T01:00:00Z", endsAt: "2026-10-20T01:30:00Z" });
    expect(await checkVerification(REQUEST, "123456", now)).toEqual({ status: "expired" });
  });
});
```

Run: `npx vitest run tests/unit/number-booking.test.ts`
Expected: FAIL with `Cannot find package '@/lib/number-booking'`.

- [ ] **Step 2: Share the code checks with a verification**

In `src/lib/booking.ts`, replace:

```ts
type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };
```

with:

```ts
export type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };
```

replace:

```ts
type Ctx = { ip: string; now: Date };
type OtpRow = {
  id: string;
  mobile: string;
  code_hash: string;
  booking: BookingPayload;
```

with:

```ts
type Ctx = { ip: string; now: Date };
/** A code sent for a number alone (booking flow spec 3.2): no booking comes with it. */
export type VerifyRequest = { clinicId: string; verify: true };
/** What otp_requests.booking holds: the booking page's request, or a number's verification. */
export type StoredRequest = BookingPayload | VerifyRequest;
type OtpRow = {
  id: string;
  mobile: string;
  code_hash: string;
  booking: StoredRequest;
```

replace:

```ts
  booking: BookingPayload,
  now: Date,
  resendOf: string | null,
```

with:

```ts
  booking: StoredRequest,
  now: Date,
  resendOf: string | null,
```

replace:

```ts
async function sendCode(clinic: PublicClinic, mobile: string, code: string, id: string): Promise<CodeIssued> {
```

with:

```ts
async function sendCode(clinic: Pick<PublicClinic, "id" | "smsName">, mobile: string, code: string, id: string): Promise<CodeIssued> {
```

replace:

```ts
/** Spec 10.3: rolling-hour limits, then a stored request holding the payload and the code hash, then the text. */
async function issueCode(clinic: PublicClinic, booking: BookingPayload, { ip, now }: Ctx): Promise<CodeIssued> {
  const id = randomUUID();
  const code = newCode();
  const result = await callIssueOtp(booking.mobile, ip, id, hashCode(id, code), booking, now, null);
  if (result.status === "limited") return { status: "limited" };
  if (result.status !== "ok") throw new Error(`unexpected issue_otp status for a new request: ${result.status}`);
  return sendCode(clinic, booking.mobile, code, id);
}
```

with:

```ts
/**
 * Spec 10.3: rolling-hour limits, then a stored request holding the payload (the booking page's request, or a number's
 * verification, booking flow spec 3.2) and the code hash, then the text. Both kinds share every limit.
 */
export async function issueCode(clinic: Pick<PublicClinic, "id" | "smsName">, mobile: string, stored: StoredRequest, { ip, now }: Ctx): Promise<CodeIssued> {
  const id = randomUUID();
  const code = newCode();
  const result = await callIssueOtp(mobile, ip, id, hashCode(id, code), stored, now, null);
  if (result.status === "limited") return { status: "limited" };
  if (result.status !== "ok") throw new Error(`unexpected issue_otp status for a new request: ${result.status}`);
  return sendCode(clinic, mobile, code, id);
}
```

replace:

```ts
    return await issueCode(clinic, parsed.payload, ctx);
```

with:

```ts
    return await issueCode(clinic, parsed.payload.mobile, parsed.payload, ctx);
```

and replace:

```ts
/** Spec 9.1 step 4: check the code, mark it verified, then book the payload stored with it. */
export async function verifyCode(
  requestId: string,
  code: string,
  now: Date,
): Promise<{ outcome: VerifyOutcome; verifiedMobile: string | null }> {
  let verifiedMobile: string | null = null;
  const done = (outcome: VerifyOutcome) => ({ outcome, verifiedMobile });
  if (!UUID.test(requestId)) return done({ status: "expired" });
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("otp_requests")
      .select("id, mobile, code_hash, booking, attempts, expires_at, verified_at")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return done({ status: "expired" });
    const row = data as OtpRow;

    const status = checkCode(
      {
        id: row.id,
        code_hash: row.code_hash,
        attempts: row.attempts,
        expires_at: new Date(row.expires_at),
        verified_at: row.verified_at ? new Date(row.verified_at) : null,
      },
      code,
      now,
    );
    if (status === "used" || status === "expired" || status === "locked") return done({ status });
    // Billing spec 7.5: a lapsed clinic takes no requests. Checked before the attempt or the code is spent.
    if (!(await bookingOpen(row.booking.clinicId, now))) return done({ status: "paused" });

    // Spend an attempt before acting on the comparison. The update only matches while attempts is
    // unchanged, so parallel guesses share the same 5 attempts instead of each getting their own.
    const { data: claimed } = await db
      .from("otp_requests")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .is("verified_at", null)
      .select("id")
      .throwOnError();
    const attemptsLeft = Math.max(0, OTP.maxAttempts - row.attempts - 1);
    if (claimed.length === 0 || status === "wrong") return done({ status: "wrong", attemptsLeft });

    const { data: marked } = await db
      .from("otp_requests")
      .update({ verified_at: now.toISOString() })
      .eq("id", row.id)
      .is("verified_at", null)
      .select("id")
      .throwOnError();
    if (marked.length === 0) return done({ status: "used" });
    verifiedMobile = row.mobile;

    const clinic = await loadClinic({ id: row.booking.clinicId }, row.booking.branchId);
    if (!clinic) return done({ status: "unavailable" });
    return done(await finalize(clinic, row.booking, now));
  } catch (e) {
    logFailure("verifyCode", e);
    return done({ status: "unavailable" });
  }
}
```

with:

```ts
type Spent =
  | { status: "ok"; row: OtpRow }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" | "locked" | "used" | "paused" };

/**
 * Spec 9.1 step 4 and booking flow spec 3.2: checks a code, spends an attempt, and marks it used. A code sent with a
 * booking page request and a code sent for a number alone each work only for their own purpose. Billing spec 7.5: a
 * lapsed clinic takes no code, checked before the attempt or the code is spent.
 */
export async function spendCode(requestId: string, code: string, now: Date, purpose: "booking" | "verify"): Promise<Spent> {
  if (!UUID.test(requestId)) return { status: "expired" };
  const db = adminClient();
  const { data, error } = await db
    .from("otp_requests")
    .select("id, mobile, code_hash, booking, attempts, expires_at, verified_at")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: "expired" };
  const row = data as OtpRow;
  if (("verify" in row.booking) !== (purpose === "verify")) return { status: "expired" };

  const status = checkCode(
    {
      id: row.id,
      code_hash: row.code_hash,
      attempts: row.attempts,
      expires_at: new Date(row.expires_at),
      verified_at: row.verified_at ? new Date(row.verified_at) : null,
    },
    code,
    now,
  );
  if (status === "used" || status === "expired" || status === "locked") return { status };
  if (!(await bookingOpen(row.booking.clinicId, now))) return { status: "paused" };

  // Spend an attempt before acting on the comparison. The update only matches while attempts is
  // unchanged, so parallel guesses share the same 5 attempts instead of each getting their own.
  const { data: claimed } = await db
    .from("otp_requests")
    .update({ attempts: row.attempts + 1 })
    .eq("id", row.id)
    .eq("attempts", row.attempts)
    .is("verified_at", null)
    .select("id")
    .throwOnError();
  const attemptsLeft = Math.max(0, OTP.maxAttempts - row.attempts - 1);
  if (claimed.length === 0 || status === "wrong") return { status: "wrong", attemptsLeft };

  const { data: marked } = await db
    .from("otp_requests")
    .update({ verified_at: now.toISOString() })
    .eq("id", row.id)
    .is("verified_at", null)
    .select("id")
    .throwOnError();
  return marked.length === 0 ? { status: "used" } : { status: "ok", row };
}

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

- [ ] **Step 3: Write the verification and listing services**

Create `src/lib/number-booking.ts`:

```ts
import "server-only";
import { bookingOpen } from "@/lib/billing-data";
import { issueCode, spendCode } from "@/lib/booking";
import { logError } from "@/lib/log";
import { normalizeMobile } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";

/**
 * The patient side of the booking flow (spec 3.2 to 3.5, 8). A number is verified on this phone first: the Server
 * Actions keep the verified numbers in the signed bs_verified cookie and pass them in as Device. Every function here
 * checks again that the cookie holds the number, and that each row belongs to that number and to this clinic, so
 * nothing below is reachable by calling an action directly. The secret key is used because patients have no session.
 * Logs say where it failed, never a number, a name, or a form.
 */

/** The numbers this phone verified (from the cookie), and the time. */
export type Device = { verifiedMobiles: string[]; now: Date };
/** What a function answers when it cannot act: an unverified number, an unknown booking link, or a failure. */
export type Refused = { status: "unverified" } | { status: "invalid" } | { status: "unavailable" };

type ClinicRef = { id: string; smsName: string; minNoticeMinutes: number };

/** The number in its stored form when this phone verified it, otherwise null (spec 3.2 step 3, 8). */
export function verifiedNumber(input: unknown, device: Device): string | null {
  const mobile = typeof input === "string" ? normalizeMobile(input) : null;
  return mobile && device.verifiedMobiles.includes(mobile) ? mobile : null;
}

/** The clinic of a booking link, or null. */
async function clinicOf(slug: string): Promise<ClinicRef | null> {
  const { data, error } = await adminClient().from("clinics").select("id, sms_name, min_notice_minutes").eq("slug", slug).maybeSingle();
  if (error) throw error;
  const c = data as { id: string; sms_name: string; min_notice_minutes: number } | null;
  return c ? { id: c.id, smsName: c.sms_name, minNoticeMinutes: c.min_notice_minutes } : null;
}

export type StartOutcome =
  | { status: "verified"; mobile: string }
  | { status: "code"; requestId: string; mobile: string }
  | { status: "limited" }
  | { status: "sms_failed" }
  | { status: "invalid" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.2: the start of every path. A phone that verified the number before goes straight on; otherwise the clinic
 * texts a 6 digit code within issue_otp's limits (3 per number and 10 per connection an hour, 60 seconds between
 * codes; a new code is resendBookingCode, as on the booking page). A lapsed clinic sends no code (billing spec 7.5).
 */
export async function startVerification(slug: string, mobileInput: unknown, ctx: Device & { ip: string }): Promise<StartOutcome> {
  const mobile = typeof mobileInput === "string" ? normalizeMobile(mobileInput) : null;
  if (!mobile) return { status: "invalid" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    if (!(await bookingOpen(clinic.id, ctx.now))) return { status: "paused" };
    if (ctx.verifiedMobiles.includes(mobile)) return { status: "verified", mobile };
    const issued = await issueCode(clinic, mobile, { clinicId: clinic.id, verify: true }, ctx);
    return issued.status === "code" ? { ...issued, mobile } : issued;
  } catch (e) {
    logError("startVerification", e);
    return { status: "unavailable" };
  }
}

export type CheckOutcome =
  | { status: "verified"; mobile: string }
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" | "locked" | "used" | "paused" | "unavailable" };

/** Spec 3.2 step 3: a right code verifies the number; the Server Action then remembers it on this phone. */
export async function checkVerification(requestId: string, code: string, now: Date): Promise<CheckOutcome> {
  try {
    const spent = await spendCode(requestId, code, now, "verify");
    return spent.status === "ok" ? { status: "verified", mobile: spent.row.mobile } : spent;
  } catch (e) {
    logError("checkVerification", e);
    return { status: "unavailable" };
  }
}

export type NumberPatient = { id: string; first: string; last: string };
export type PatientsOutcome = { status: "ok"; patients: NumberPatient[] } | Refused;

/** Spec 3.3 step 3: this number's patients at this clinic, not deleted, for "Who is the appointment for?". */
export async function numberPatients(slug: string, mobileInput: unknown, device: Device): Promise<PatientsOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    const { data } = await adminClient()
      .from("patients")
      .select("id, first_name, last_name")
      .eq("clinic_id", clinic.id)
      .eq("mobile", mobile)
      .is("anonymized_at", null)
      .order("first_name")
      .order("last_name")
      .limit(50)
      .throwOnError();
    const rows = data as { id: string; first_name: string; last_name: string }[];
    return { status: "ok", patients: rows.map((p) => ({ id: p.id, first: p.first_name, last: p.last_name })) };
  } catch (e) {
    logError("numberPatients", e);
    return { status: "unavailable" };
  }
}

export type NumberAppointment = {
  id: string;
  status: "pending" | "confirmed";
  startsAt: string;
  endsAt: string;
  procedures: string[];
  /** The clinic's active procedures with these names, where the services step of a change starts. */
  procedureIds: string[];
  patient: NumberPatient;
  dentist: { id: string; name: string };
  branch: { id: string; name: string; address: string; mapsUrl: string | null };
  /** False within the clinic's minimum notice: "Please call the clinic to change it." (spec 3.4 step 4). */
  changeable: boolean;
};
export type AppointmentsOutcome = { status: "ok"; appointments: NumberAppointment[] } | Refused;

type AppointmentRow = {
  id: string;
  status: "pending" | "confirmed";
  starts_at: string;
  ends_at: string;
  procedure_names: string[];
  patients: { id: string; first_name: string; last_name: string };
  dentist: { id: string; name: string };
  branch: { id: string; name: string; address: string; maps_url: string | null };
};

/**
 * Spec 3.4 and 3.5 step 2: every pending or confirmed appointment at this clinic, still ahead, whose patient has this
 * number and is not deleted, soonest first, with its branch.
 */
export async function numberAppointments(slug: string, mobileInput: unknown, device: Device): Promise<AppointmentsOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = await clinicOf(slug);
    if (!clinic) return { status: "invalid" };
    const db = adminClient();
    const [appointments, procedures] = await Promise.all([
      db
        .from("appointments")
        .select(
          "id, status, starts_at, ends_at, procedure_names, patients!inner(id, first_name, last_name, mobile, anonymized_at), dentist:dentists(id, name), branch:branches(id, name, address, maps_url)",
        )
        .eq("clinic_id", clinic.id)
        .eq("patients.mobile", mobile)
        .is("patients.anonymized_at", null)
        .in("status", ["pending", "confirmed"])
        .gt("starts_at", device.now.toISOString())
        .order("starts_at")
        .limit(20)
        .throwOnError(),
      db.from("procedures").select("id, name").eq("clinic_id", clinic.id).eq("active", true).throwOnError(),
    ]);
    const byName = new Map((procedures.data as { id: string; name: string }[]).map((p) => [p.name, p.id]));
    const earliest = device.now.getTime() + clinic.minNoticeMinutes * 60_000;
    return {
      status: "ok",
      appointments: (appointments.data as unknown as AppointmentRow[]).map((a) => ({
        id: a.id,
        status: a.status,
        startsAt: a.starts_at,
        endsAt: a.ends_at,
        procedures: a.procedure_names,
        procedureIds: a.procedure_names.flatMap((name) => byName.get(name) ?? []),
        patient: { id: a.patients.id, first: a.patients.first_name, last: a.patients.last_name },
        dentist: { id: a.dentist.id, name: a.dentist.name },
        branch: { id: a.branch.id, name: a.branch.name, address: a.branch.address, mapsUrl: a.branch.maps_url },
        changeable: new Date(a.starts_at).getTime() >= earliest,
      })),
    };
  } catch (e) {
    logError("numberAppointments", e);
    return { status: "unavailable" };
  }
}
```

Run: `npx vitest run tests/unit/number-booking.test.ts tests/unit/booking-paused.test.ts`
Expected: PASS (8 and 3 tests). `booking-paused.test.ts` proves `verifyCode` still answers `paused` before spending an attempt.

- [ ] **Step 4: The Server Actions**

In `src/app/[slug]/actions.ts`, replace:

```ts
import { DEVICE_COOKIE, readDevice, signDevice } from "@/lib/codes";
```

with:

```ts
import { DEVICE_COOKIE, readDevice, signDevice } from "@/lib/codes";
import * as numbers from "@/lib/number-booking";
```

replace:

```ts
const DEVICE_MAX_AGE = 180 * 86_400;
```

with:

```ts
const DEVICE_MAX_AGE = 180 * 86_400;

/** The numbers this phone verified (the signed bs_verified cookie, spec 10.3), as of now. */
async function device(now: Date): Promise<numbers.Device> {
  const store = await cookies();
  return { verifiedMobiles: readDevice(store.get(DEVICE_COOKIE)?.value, now), now };
}

/** Spec 10.3: remember up to 5 verified mobiles on this device for 180 days. */
async function remember(mobile: string, now: Date): Promise<void> {
  const store = await cookies();
  const known = readDevice(store.get(DEVICE_COOKIE)?.value, now).filter((m) => m !== mobile);
  store.set(DEVICE_COOKIE, signDevice([...known, mobile], now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_MAX_AGE,
  });
}
```

and replace:

```ts
export async function requestBooking(slug: string, input: unknown): Promise<booking.BookingOutcome> {
  const now = new Date();
  const store = await cookies();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const verifiedMobiles = readDevice(store.get(DEVICE_COOKIE)?.value, now);
  return booking.requestBooking(String(slug), input, { ip, now, verifiedMobiles });
}

export async function verifyBookingCode(requestId: string, code: string): Promise<booking.VerifyOutcome> {
  const now = new Date();
  const { outcome, verifiedMobile } = await booking.verifyCode(String(requestId), String(code), now);
  if (verifiedMobile) {
    // Spec 10.3: remember up to 5 verified mobiles on this device for 180 days.
    const store = await cookies();
    const known = readDevice(store.get(DEVICE_COOKIE)?.value, now).filter((m) => m !== verifiedMobile);
    store.set(DEVICE_COOKIE, signDevice([...known, verifiedMobile], now), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_MAX_AGE,
    });
  }
  return outcome;
}
```

with:

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

/** Booking flow spec 3.2: straight on for a number this phone verified before, otherwise a code by text. */
export async function startVerification(slug: string, mobile: string): Promise<numbers.StartOutcome> {
  const now = new Date();
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  return numbers.startVerification(String(slug), mobile, { ...(await device(now)), ip });
}

/** Spec 3.2 step 3: a right code remembers the number on this phone. A new code is resendBookingCode. */
export async function checkVerification(requestId: string, code: string): Promise<numbers.CheckOutcome> {
  const now = new Date();
  const outcome = await numbers.checkVerification(String(requestId), String(code), now);
  if (outcome.status === "verified") await remember(outcome.mobile, now);
  return outcome;
}

/** Spec 3.3 step 3: the verified number's patients at this clinic. */
export async function numberPatients(slug: string, mobile: string): Promise<numbers.PatientsOutcome> {
  return numbers.numberPatients(String(slug), mobile, await device(new Date()));
}

/** Spec 3.4 and 3.5 step 2: the verified number's upcoming appointments at this clinic. */
export async function numberAppointments(slug: string, mobile: string): Promise<numbers.AppointmentsOutcome> {
  return numbers.numberAppointments(String(slug), mobile, await device(new Date()));
}
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add src/lib/number-booking.ts tests/unit/number-booking.test.ts src/lib/booking.ts "src/app/[slug]/actions.ts"
git commit -m "feat: verify a patient's number before showing their records" -m "startVerification goes straight on for a number this phone verified before and otherwise texts the clinic's code within issue_otp's limits; checkVerification remembers the number in the existing verified-device cookie. A verification code never books and a booking code never only verifies. The verified number's patients and upcoming appointments at the clinic, with their branch, are listed only after the cookie holds the number, checked again by every service."
```

### Task 6: Booking, changing, and cancelling by number

**Files:**
- Modify: `src/lib/booking.ts`, `src/lib/number-booking.ts`, `src/app/[slug]/actions.ts`, `tests/unit/number-booking.test.ts`

**Interfaces:**
- Consumes: `create_booking(..., p_branch_id, p_form)` and `change_booking` (Task 2); `parseIntakeForm`, `formColumns`, `type IntakeForm` (Task 1); `loadClinic`, `dayOpenStarts` with `ignoreId` (Task 3); `change_alert` (Task 4); `verifiedNumber`, `Device`, `clinicOf` (Task 5); `cancelByPatient` from `@/lib/patient-link`; `resolveSelection` from `@/lib/booking-input`; `newToken` from `@/lib/codes`.
- Produces:
  - From `@/lib/booking`: `takenStarts(clinic: PublicClinic, dentistId: string, start: Date, end: Date, now: Date, ignoreId?: string): Promise<string[] | null>` and `overBookingCap(clinicId: string, mobile: string, now: Date): Promise<boolean>` (both now exported; the booking page uses them as before)
  - From `@/lib/number-booking`: `bookForNumber(slug: string, input: unknown, device: Device): Promise<BookOutcome>`, `changeForNumber(slug: string, input: unknown, device: Device): Promise<ChangeOutcome>`, `cancelForNumber(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<CancelOutcome>`, `changeScope(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<{ branchId: string; ignoreId: string } | null>`, and the types `BookOutcome`, `ChangeOutcome`, `CancelOutcome`
  - Input of `bookForNumber`: `{ mobile, branchId, dentistId, procedureIds, startsAt, patientId }` for one of the number's patients, or the same with `form` (the raw patient form, Task 1) instead of `patientId` for someone new. `changeForNumber` takes the same plus `appointmentId` (no `branchId`: the branch stays).
  - Server Actions in `src/app/[slug]/actions.ts`: `bookForNumber(slug: string, input: unknown)`, `changeForNumber(slug: string, input: unknown)`, `cancelForNumber(slug: string, mobile: string, appointmentId: string)`; `getOpenDates` and `getOpenStarts` accept `selection.changing` (an appointment id) with `selection.mobile` while a patient changes an appointment

Rules (spec 3.3 to 3.5, 5, 8):
- Every function starts with `verifiedNumber`: an unverified number reads nothing. A patient chosen by id must belong to this clinic, have the verified number, and not be deleted; someone new is the parsed form, with the verified number as their mobile (`create_booking` and `change_booking` match them by clinic, mobile, and name, as today).
- Booking re-validates exactly as the booking page does: an active branch of this clinic (`loadClinic` returns null otherwise), the services and dentist at that branch (`resolveSelection`), the cap on pending requests per number (`overBookingCap`), and the start among that branch's open times (`takenStarts`, which applies the minimum notice and days ahead). The request is pending and holds its time at once; the clinic gets today's new request alert. A lapsed clinic answers `paused`.
- Changing: the appointment must be this number's own, pending or confirmed, and ahead (`ownedAppointment`); within the minimum notice, or when its branch no longer takes bookings, it answers `call_clinic` ("Please call the clinic to change it."). The branch stays the appointment's. The new time is checked like a new booking, with the appointment's own time counting as free (`ignoreId`), and an unchanged request answers `unchanged` instead of sending it back to pending. `change_booking` does the rest in one statement (Task 2), and the clinic gets the changed request alert. A lapsed clinic answers `paused`.
- Cancelling reuses the patient link's cancel as it is: `ownedAppointment` finds the number's own appointment, and `cancelByPatient` cancels it by its manage token (compare-and-set, the event, and today's cancellation alert). It is not refused while the clinic is paused, like the link in every text.
- While a patient changes an appointment, the open dates and times come from `changeScope`: the appointment's own branch and id, only for the number this phone verified and only its own appointment. Without `changing`, a `branchId` in the selection picks the branch (Task 3).
- Alerts carry the first name and last initial (texts) or no name at all (pushes), never the form.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/number-booking.test.ts`, replace:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingOpen } from "@/lib/billing-data";
import { hashCode } from "@/lib/codes";
import { checkVerification, numberAppointments, numberPatients, startVerification, type Device } from "@/lib/number-booking";
import { sendSms } from "@/lib/sms/send";
```

with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import type { PublicClinic } from "@/lib/booking-input";
import { hashCode } from "@/lib/codes";
import { alertClinic } from "@/lib/notify";
import {
  bookForNumber,
  cancelForNumber,
  changeForNumber,
  checkVerification,
  numberAppointments,
  numberPatients,
  startVerification,
  type Device,
} from "@/lib/number-booking";
import { cancelByPatient } from "@/lib/patient-link";
import { sendSms } from "@/lib/sms/send";
```

Append to the end of `tests/unit/number-booking.test.ts`:

```ts

vi.mock("@/lib/availability", () => ({ loadClinic: vi.fn(), dayOpenStarts: vi.fn() }));
vi.mock("@/lib/patient-link", () => ({ cancelByPatient: vi.fn(async () => "cancelled") }));

const BRANCH = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const DENTIST = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
const PROCEDURE = "9e8d7c6b-5a49-4382-a716-151413121110";
const PATIENT = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const VISIT = "2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e";
const START = "2026-10-20T01:00:00.000Z"; // Tuesday 9:00 AM Manila, a week ahead
const clinic: PublicClinic = {
  id: CLINIC,
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: { id: BRANCH, name: "Main", address: "Makati", mapsUrl: null },
  branches: [{ id: BRANCH, name: "Main", address: "Makati", mapsUrl: null }],
  dentists: [{ id: DENTIST, name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: [[], [], [{ start: 540, end: 1020 }], [], [], [], []] }],
  procedures: [{ id: PROCEDURE, name: "Consultation", minutes: 30 }],
};
const request = { mobile: "0917 111 2222", branchId: BRANCH, dentistId: DENTIST, procedureIds: [PROCEDURE], startsAt: START, patientId: PATIENT };
const owned = (startsAt: string) => ({
  id: VISIT,
  status: "confirmed",
  starts_at: startsAt,
  ends_at: new Date(new Date(startsAt).getTime() + 30 * 60_000).toISOString(),
  dentist_id: DENTIST,
  branch_id: BRANCH,
  patient_id: PATIENT,
  procedure_names: ["Consultation"],
  manage_token: "AbCdEfGhIjKl",
});
const called = (name: string) => fake.rpcs.filter((r) => r.name === name).map((r) => r.args);

describe("booking, changing, and cancelling by number", () => {
  beforeEach(() => {
    vi.mocked(loadClinic).mockReset().mockResolvedValue(clinic);
    vi.mocked(dayOpenStarts).mockReset().mockResolvedValue([new Date(START)]);
    vi.mocked(alertClinic).mockClear();
    vi.mocked(cancelByPatient).mockClear();
    fake.single.patients = { id: PATIENT, first_name: "Ana", last_name: "Cruz" };
  });

  it("answer unverified for a number this phone has not verified, and read nothing", async () => {
    expect(await bookForNumber("bright-dental", request, stranger)).toEqual({ status: "unverified" });
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, stranger)).toEqual({ status: "unverified" });
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, stranger)).toBe("unverified");
    expect(fake.tables).toEqual([]);
    expect(loadClinic).not.toHaveBeenCalled();
  });

  it("book one of the number's patients at the chosen branch after checking the time again, and alert the clinic", async () => {
    fake.rpcAnswer.create_booking = { data: VISIT, error: null };
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "sent", token: expect.any(String) });
    expect(loadClinic).toHaveBeenCalledWith({ slug: "bright-dental" }, BRANCH);
    expect(called("create_booking")).toEqual([
      expect.objectContaining({
        p_branch_id: BRANCH,
        p_patient_id: PATIENT,
        p_mobile: MOBILE,
        p_procedure_names: ["Consultation"],
        p_starts_at: START,
        p_ends_at: "2026-10-20T01:30:00.000Z",
        p_status: "pending",
        p_form: null,
      }),
    ]);
    expect(alertClinic).toHaveBeenCalledWith(expect.objectContaining({ kind: "request_alert", appointmentId: VISIT, first: "Ana", last: "Cruz" }));
  });

  it("book someone new with the form and the verified number", async () => {
    const form = { last: "Cruz", first: "Leo", birthday: "1990-05-17", sex: "male", address: "Makati", agree: true, signature: "Leo Cruz" };
    expect(await bookForNumber("bright-dental", { ...request, patientId: undefined, form }, verified)).toMatchObject({ status: "sent" });
    expect(called("create_booking")).toEqual([
      expect.objectContaining({
        p_patient_id: null,
        p_first_name: "Leo",
        p_last_name: "Cruz",
        p_mobile: MOBILE,
        p_birthday: "1990-05-17",
        p_form: expect.objectContaining({ sex: "male", address: "Makati", waiver_name: "Leo Cruz", waiver_version: "2026-09-26" }),
      }),
    ]);
  });

  it("refuse a patient of another number, a form with problems, and a time that is no longer open", async () => {
    delete fake.single.patients;
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "invalid", errors: { patient: "Choose who the visit is for again." } });
    expect(await bookForNumber("bright-dental", { ...request, patientId: undefined, form: {} }, verified)).toMatchObject({
      status: "invalid",
      errors: { first: expect.any(String), agree: expect.any(String) },
    });
    fake.single.patients = { id: PATIENT, first_name: "Ana", last_name: "Cruz" };
    vi.mocked(dayOpenStarts).mockResolvedValue([new Date("2026-10-20T02:00:00.000Z")]);
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "taken", starts: ["2026-10-20T02:00:00.000Z"] });
    expect(called("create_booking")).toEqual([]);
  });

  it("take no booking and no change while the clinic is paused", async () => {
    vi.mocked(bookingOpen).mockResolvedValue(false);
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    expect(await bookForNumber("bright-dental", request, verified)).toEqual({ status: "paused" });
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "paused" });
    expect(fake.rpcs).toEqual([]);
  });

  it("send a change back to the clinic for approval, counting the appointment's own time as free", async () => {
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    fake.rpcAnswer.change_booking = { data: true, error: null };
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "sent" });
    expect(loadClinic).toHaveBeenCalledWith({ id: CLINIC }, BRANCH);
    expect(vi.mocked(dayOpenStarts).mock.calls[0][5]).toBe(VISIT);
    expect(called("change_booking")).toEqual([
      expect.objectContaining({ p_clinic_id: CLINIC, p_id: VISIT, p_mobile: MOBILE, p_starts_at: START, p_patient_id: PATIENT, p_form: null }),
    ]);
    expect(alertClinic).toHaveBeenCalledWith(expect.objectContaining({ kind: "change_alert", appointmentId: VISIT }));
  });

  it("do not change an appointment of another number, one within the minimum notice, or one that did not change", async () => {
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "gone" });
    fake.single.appointments = owned(new Date(now.getTime() + 60 * 60_000).toISOString());
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "call_clinic" });
    fake.single.appointments = owned(START);
    expect(await changeForNumber("bright-dental", { ...request, appointmentId: VISIT }, verified)).toEqual({ status: "unchanged" });
    expect(fake.rpcs).toEqual([]);
  });

  it("cancel only the number's own appointment, exactly as the patient link does", async () => {
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, verified)).toBe("gone");
    expect(cancelByPatient).not.toHaveBeenCalled();
    fake.single.appointments = owned("2026-10-27T01:00:00.000Z");
    expect(await cancelForNumber("bright-dental", request.mobile, VISIT, verified)).toBe("cancelled");
    expect(cancelByPatient).toHaveBeenCalledWith("AbCdEfGhIjKl", now);
  });
});
```

Run: `npx vitest run tests/unit/number-booking.test.ts`
Expected: FAIL: `bookForNumber`, `changeForNumber`, and `cancelForNumber` are not functions yet (the 8 verification tests still PASS).

- [ ] **Step 2: Share the booking page's checks**

In `src/lib/booking.ts`, replace:

```ts
/** Null while the payload's start is still open; otherwise that dentist's fresh open starts on that date (spec 13). */
async function takenStarts(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<string[] | null> {
  const dentist = clinic.dentists.find((d) => d.id === p.dentistId);
  const start = new Date(p.startsAt);
  const duration = (new Date(p.endsAt).getTime() - start.getTime()) / 60_000;
  const starts = dentist ? await dayOpenStarts(clinic, dentist, duration, manilaDate(start), now) : [];
  return starts.some((s) => s.getTime() === start.getTime()) ? null : starts.map((s) => s.toISOString());
}
```

with:

```ts
/**
 * Null while this start is still open for the dentist at the clinic's branch; otherwise that dentist's fresh open
 * starts on that date (spec 13). ignoreId is an appointment being changed, whose own time counts as free.
 */
export async function takenStarts(
  clinic: PublicClinic,
  dentistId: string,
  start: Date,
  end: Date,
  now: Date,
  ignoreId?: string,
): Promise<string[] | null> {
  const dentist = clinic.dentists.find((d) => d.id === dentistId);
  const duration = (end.getTime() - start.getTime()) / 60_000;
  const starts = dentist ? await dayOpenStarts(clinic, dentist, duration, manilaDate(start), now, ignoreId) : [];
  return starts.some((s) => s.getTime() === start.getTime()) ? null : starts.map((s) => s.toISOString());
}

/** takenStarts for the booking page's stored payload. */
function payloadTaken(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<string[] | null> {
  return takenStarts(clinic, p.dentistId, new Date(p.startsAt), new Date(p.endsAt), now);
}
```

replace:

```ts
async function overBookingCap(clinicId: string, mobile: string, now: Date): Promise<boolean> {
```

with:

```ts
export async function overBookingCap(clinicId: string, mobile: string, now: Date): Promise<boolean> {
```

replace:

```ts
  const fresh = await takenStarts(clinic, p, now);
```

with:

```ts
  const fresh = await payloadTaken(clinic, p, now);
```

replace:

```ts
  if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, p, now)) ?? [] };
```

with:

```ts
  if (error?.code === "23P01") return { status: "taken", starts: (await payloadTaken(clinic, p, now)) ?? [] };
```

and replace:

```ts
    const starts = await takenStarts(clinic, parsed.payload, ctx.now);
```

with:

```ts
    const starts = await payloadTaken(clinic, parsed.payload, ctx.now);
```

- [ ] **Step 3: Book, change, and cancel by number**

In `src/lib/number-booking.ts`, replace:

```ts
import "server-only";
import { bookingOpen } from "@/lib/billing-data";
import { issueCode, spendCode } from "@/lib/booking";
import { logError } from "@/lib/log";
import { normalizeMobile } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
```

with:

```ts
import "server-only";
import { loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import { issueCode, overBookingCap, spendCode, takenStarts } from "@/lib/booking";
import { resolveSelection } from "@/lib/booking-input";
import { newToken } from "@/lib/codes";
import { formColumns, parseIntakeForm, type IntakeForm } from "@/lib/intake";
import { logError } from "@/lib/log";
import { alertClinic } from "@/lib/notify";
import { cancelByPatient } from "@/lib/patient-link";
import { normalizeMobile } from "@/lib/phone";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";
import { isUuid } from "@/lib/validate";
```

Append to the end of `src/lib/number-booking.ts`:

```ts

const PICK_PATIENT = "Choose who the visit is for again.";
const PICK_TIME = "Pick the visit and time again.";

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

type Who = { patientId: string | null; first: string; last: string; form: IntakeForm | null };

/**
 * Who the visit is for (spec 3.3 steps 3 and 4): one of this number's patients at this clinic, by id, or someone new
 * with the patient form. The patient's mobile is always the verified number, never a field.
 */
async function whoFor(clinicId: string, mobile: string, v: Record<string, unknown>, today: string): Promise<Who | { errors: Record<string, string> }> {
  if (v.patientId !== undefined && v.patientId !== null) {
    if (!isUuid(v.patientId)) return { errors: { patient: PICK_PATIENT } };
    const { data } = await adminClient()
      .from("patients")
      .select("id, first_name, last_name")
      .eq("id", v.patientId)
      .eq("clinic_id", clinicId)
      .eq("mobile", mobile)
      .is("anonymized_at", null)
      .maybeSingle()
      .throwOnError();
    const p = data as { id: string; first_name: string; last_name: string } | null;
    return p ? { patientId: p.id, first: p.first_name, last: p.last_name, form: null } : { errors: { patient: PICK_PATIENT } };
  }
  const parsed = parseIntakeForm(v.form, today);
  return parsed.ok ? { patientId: null, first: parsed.form.first, last: parsed.form.last, form: parsed.form } : { errors: parsed.errors };
}

export type BookOutcome =
  | { status: "sent"; token: string }
  | { status: "taken"; starts: string[] }
  | { status: "too_many" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unverified" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.3 step 7 "Send request": for a verified number, at an active branch, for one of the number's patients or
 * someone new with the form. Re-validated exactly like the booking page's request: the services and dentist against
 * the branch, the cap on pending requests, and the time against the branch's open times (minimum notice, days ahead).
 * The request holds its time at once (spec 2.4) and the clinic gets today's new request alert.
 */
export async function bookForNumber(slug: string, input: unknown, device: Device): Promise<BookOutcome> {
  const v = record(input);
  const mobile = verifiedNumber(v.mobile, device);
  if (!mobile) return { status: "unverified" };
  try {
    const clinic = isUuid(v.branchId) ? await loadClinic({ slug }, v.branchId) : null;
    if (!clinic) return { status: "invalid", errors: { branch: "Choose the branch again." } };
    if (!(await bookingOpen(clinic.id, device.now))) return { status: "paused" };
    const chosen = resolveSelection(clinic, v);
    const start = new Date(typeof v.startsAt === "string" ? v.startsAt : Number.NaN);
    if (!chosen || Number.isNaN(start.getTime())) return { status: "invalid", errors: { slot: PICK_TIME } };
    const who = await whoFor(clinic.id, mobile, v, manilaDate(device.now));
    if ("errors" in who) return { status: "invalid", errors: who.errors };
    if (await overBookingCap(clinic.id, mobile, device.now)) return { status: "too_many" };
    const end = new Date(start.getTime() + chosen.duration * 60_000);
    const taken = await takenStarts(clinic, chosen.dentist.id, start, end, device.now);
    if (taken) return { status: "taken", starts: taken };

    const token = newToken();
    const { data: appointmentId, error } = await adminClient().rpc("create_booking", {
      p_clinic_id: clinic.id,
      p_branch_id: clinic.branch.id,
      p_dentist_id: chosen.dentist.id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_procedure_names: chosen.procedures.map((p) => p.name),
      p_source: "online",
      p_status: "pending",
      p_manage_token: token,
      p_patient_id: who.patientId,
      p_first_name: who.first,
      p_last_name: who.last,
      p_mobile: mobile,
      p_birthday: who.form?.birthday ?? null,
      p_hmo: who.form?.hmo ?? "",
      p_consent: true,
      p_actor: "patient",
      p_user_id: null,
      p_form: who.form ? formColumns(who.form) : null,
    });
    // 23P01: the overlap guard caught a booking that landed between the check above and this insert.
    if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, chosen.dentist.id, start, end, device.now)) ?? [] };
    if (error?.code === "P0002") return { status: "invalid", errors: { patient: PICK_PATIENT } };
    if (error) throw error;

    await alertClinic({
      kind: "request_alert",
      clinicId: clinic.id,
      appointmentId: appointmentId as string,
      first: who.first,
      last: who.last,
      startsAt: start,
      dentist: clinic.dentists.length > 1 ? chosen.dentist.smsName : null,
    });
    return { status: "sent", token };
  } catch (e) {
    logError("bookForNumber", e);
    return { status: "unavailable" };
  }
}

type OwnedRow = {
  id: string;
  status: "pending" | "confirmed";
  starts_at: string;
  ends_at: string;
  dentist_id: string;
  branch_id: string;
  patient_id: string;
  procedure_names: string[];
  manage_token: string;
};

/** One of this number's pending or confirmed appointments at this clinic, still ahead, or null (spec 8). */
async function ownedAppointment(clinicId: string, mobile: string, id: unknown, now: Date): Promise<OwnedRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await adminClient()
    .from("appointments")
    .select("id, status, starts_at, ends_at, dentist_id, branch_id, patient_id, procedure_names, manage_token, patients!inner(mobile, anonymized_at)")
    .eq("id", id)
    .eq("clinic_id", clinicId)
    .eq("patients.mobile", mobile)
    .is("patients.anonymized_at", null)
    .in("status", ["pending", "confirmed"])
    .gt("starts_at", now.toISOString())
    .maybeSingle()
    .throwOnError();
  return data as OwnedRow | null;
}

/**
 * For open times while a patient changes an appointment (spec 3.4 step 3): its branch, where it stays, and its id,
 * whose own time counts as free. Only for a number this phone verified, and only that number's own appointment.
 */
export async function changeScope(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<{ branchId: string; ignoreId: string } | null> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return null;
  const clinic = await clinicOf(slug);
  const owned = clinic ? await ownedAppointment(clinic.id, mobile, appointmentId, device.now) : null;
  return owned ? { branchId: owned.branch_id, ignoreId: owned.id } : null;
}

export type ChangeOutcome =
  | { status: "sent" }
  | { status: "taken"; starts: string[] }
  /** Within the clinic's minimum notice, or its branch no longer takes bookings: "Please call the clinic to change it." */
  | { status: "call_clinic" }
  | { status: "unchanged" }
  /** Not this number's upcoming pending or confirmed appointment at this clinic (any more). */
  | { status: "gone" }
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unverified" }
  | { status: "paused" }
  | { status: "unavailable" };

/**
 * Spec 3.4 step 4 "Send changes" and spec 5. The branch stays the appointment's; the new time is re-validated exactly
 * like a new booking (open times at that branch, minimum notice, days ahead), counting the appointment's own time as
 * free. change_booking then moves it in one statement, so the old time frees as the new one is taken, and sends it
 * back to pending; the clinic gets the changed request alert.
 */
export async function changeForNumber(slug: string, input: unknown, device: Device): Promise<ChangeOutcome> {
  const v = record(input);
  const mobile = verifiedNumber(v.mobile, device);
  if (!mobile) return { status: "unverified" };
  try {
    const ref = await clinicOf(slug);
    const owned = ref ? await ownedAppointment(ref.id, mobile, v.appointmentId, device.now) : null;
    if (!ref || !owned) return { status: "gone" };
    if (!(await bookingOpen(ref.id, device.now))) return { status: "paused" };
    if (new Date(owned.starts_at).getTime() < device.now.getTime() + ref.minNoticeMinutes * 60_000) return { status: "call_clinic" };
    const clinic = await loadClinic({ id: ref.id }, owned.branch_id);
    if (!clinic) return { status: "call_clinic" };
    const chosen = resolveSelection(clinic, v);
    const start = new Date(typeof v.startsAt === "string" ? v.startsAt : Number.NaN);
    if (!chosen || Number.isNaN(start.getTime())) return { status: "invalid", errors: { slot: PICK_TIME } };
    const who = await whoFor(ref.id, mobile, v, manilaDate(device.now));
    if ("errors" in who) return { status: "invalid", errors: who.errors };
    const end = new Date(start.getTime() + chosen.duration * 60_000);
    const names = chosen.procedures.map((p) => p.name);
    const same =
      who.patientId === owned.patient_id &&
      chosen.dentist.id === owned.dentist_id &&
      start.getTime() === new Date(owned.starts_at).getTime() &&
      names.join("\n") === owned.procedure_names.join("\n");
    if (same) return { status: "unchanged" };
    const taken = await takenStarts(clinic, chosen.dentist.id, start, end, device.now, owned.id);
    if (taken) return { status: "taken", starts: taken };

    const { data: changed, error } = await adminClient().rpc("change_booking", {
      p_clinic_id: ref.id,
      p_id: owned.id,
      p_mobile: mobile,
      p_dentist_id: chosen.dentist.id,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_procedure_names: names,
      p_patient_id: who.patientId,
      p_first_name: who.form ? who.first : null,
      p_last_name: who.form ? who.last : null,
      p_birthday: who.form?.birthday ?? null,
      p_hmo: who.form?.hmo ?? null,
      p_form: who.form ? formColumns(who.form) : null,
    });
    if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, chosen.dentist.id, start, end, device.now, owned.id)) ?? [] };
    if (error?.code === "P0002") return { status: "invalid", errors: { patient: PICK_PATIENT } };
    if (error) throw error;
    // False: staff changed it, or it came within the minimum notice, a moment ago.
    if (!changed) return { status: "gone" };

    await alertClinic({
      kind: "change_alert",
      clinicId: ref.id,
      appointmentId: owned.id,
      first: who.first,
      last: who.last,
      startsAt: start,
      dentist: clinic.dentists.length > 1 ? chosen.dentist.smsName : null,
    });
    return { status: "sent" };
  } catch (e) {
    logError("changeForNumber", e);
    return { status: "unavailable" };
  }
}

export type CancelOutcome = "cancelled" | "not_allowed" | "gone" | "unverified" | "unavailable";

/**
 * Spec 3.5 step 3 "Yes, cancel it": one of this number's appointments, cancelled exactly as the patient link cancels
 * it (cancelByPatient): the time frees, the clinic gets today's cancellation alert, and the event is recorded. Like
 * the link in every text, it works while the clinic is paused.
 */
export async function cancelForNumber(slug: string, mobileInput: unknown, appointmentId: unknown, device: Device): Promise<CancelOutcome> {
  const mobile = verifiedNumber(mobileInput, device);
  if (!mobile) return "unverified";
  try {
    const clinic = await clinicOf(slug);
    const owned = clinic ? await ownedAppointment(clinic.id, mobile, appointmentId, device.now) : null;
    if (!owned) return "gone";
    const result = await cancelByPatient(owned.manage_token, device.now);
    return result === "not_found" ? "gone" : result;
  } catch (e) {
    logError("cancelForNumber", e);
    return "unavailable";
  }
}
```

Run: `npx vitest run tests/unit/number-booking.test.ts tests/unit/booking-paused.test.ts`
Expected: PASS (16 and 3 tests).

- [ ] **Step 4: The Server Actions, and open times while changing**

In `src/app/[slug]/actions.ts`, replace:

```ts
/** The branch, dentist, and procedures the client picked, checked against the clinic. No branch: the first active one. */
async function chosen(slug: unknown, selection: unknown) {
  const branchId = (selection as { branchId?: unknown } | null | undefined)?.branchId;
  const clinic = typeof slug === "string" ? await loadClinic({ slug }, isUuid(branchId) ? branchId : undefined) : null;
  const picked = clinic ? resolveSelection(clinic, selection) : null;
  return clinic && picked ? { clinic, picked } : null;
}
```

with:

```ts
/**
 * The branch, dentist, and procedures the client picked, checked against the clinic. No branch: the first active one.
 * While a patient changes an appointment (booking flow spec 3.4), selection.changing names it and selection.mobile its
 * number: the times are then at the appointment's own branch, and its own time counts as free. Only for a number this
 * phone verified, and only that number's own appointment.
 */
async function chosen(slug: unknown, selection: unknown) {
  if (typeof slug !== "string") return null;
  const v = (typeof selection === "object" && selection !== null ? selection : {}) as Record<string, unknown>;
  let branchId = isUuid(v.branchId) ? v.branchId : undefined;
  let ignoreId: string | undefined;
  if (v.changing !== undefined) {
    const scope = await numbers.changeScope(slug, v.mobile, v.changing, await device(new Date()));
    if (!scope) return null;
    ({ branchId, ignoreId } = scope);
  }
  const clinic = await loadClinic({ slug }, branchId);
  const picked = clinic ? resolveSelection(clinic, selection) : null;
  return clinic && picked ? { clinic, picked, ignoreId } : null;
}
```

replace:

```ts
  return monthOpenDates(found.clinic, found.picked.dentist, found.picked.duration, month, new Date());
```

with:

```ts
  return monthOpenDates(found.clinic, found.picked.dentist, found.picked.duration, month, new Date(), found.ignoreId);
```

replace:

```ts
  const starts = await dayOpenStarts(found.clinic, found.picked.dentist, found.picked.duration, date, new Date());
```

with:

```ts
  const starts = await dayOpenStarts(found.clinic, found.picked.dentist, found.picked.duration, date, new Date(), found.ignoreId);
```

Append to the end of `src/app/[slug]/actions.ts`:

```ts

/** Booking flow spec 3.3 step 7 "Send request", for a verified number only. */
export async function bookForNumber(slug: string, input: unknown): Promise<numbers.BookOutcome> {
  return numbers.bookForNumber(String(slug), input, await device(new Date()));
}

/** Spec 3.4 step 4 "Send changes", for a verified number's own appointment only. */
export async function changeForNumber(slug: string, input: unknown): Promise<numbers.ChangeOutcome> {
  return numbers.changeForNumber(String(slug), input, await device(new Date()));
}

/** Spec 3.5 step 3 "Yes, cancel it", for a verified number's own appointment only. */
export async function cancelForNumber(slug: string, mobile: string, appointmentId: string): Promise<numbers.CancelOutcome> {
  return numbers.cancelForNumber(String(slug), mobile, appointmentId, await device(new Date()));
}
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add src/lib/booking.ts src/lib/number-booking.ts "src/app/[slug]/actions.ts" tests/unit/number-booking.test.ts
git commit -m "feat: book, change, and cancel by a verified number" -m "bookForNumber books one of the number's patients, or someone new with the patient form, at an active branch, re-validated like the booking page's request. changeForNumber keeps the branch, checks the new time like a new booking with the appointment's own time free, refuses changes within the minimum notice, and sends the appointment back to the clinic with the changed request alert through change_booking. cancelForNumber reuses the patient link's cancel. Each checks the verified number and that the rows are its own at this clinic; booking and changing respect the billing pause."
```

### Task 7: The booking flow as one pure reducer

**Files:**
- Create: `src/lib/booking-flow.ts`, `tests/unit/booking-flow.test.ts`

**Interfaces:**
- Consumes: `type IntakeForm` (Task 1). What the moves carry comes from the actions of Tasks 5 and 6 (`startVerification`, `checkVerification`, `resendBookingCode`, `numberPatients`, `numberAppointments`, `getOpenStarts`, `bookForNumber`, `changeForNumber`, `cancelForNumber`), which plan 8's page calls.
- Produces (from `@/lib/booking-flow`, pure, safe for client components):
  - `type Path = "book" | "change" | "cancel"`; `type Step = "main" | "branch" | "number" | "code" | "who" | "form" | "services" | "time" | "summary" | "list" | "details" | "confirm_cancel" | "done"`
  - `type FlowAppointment = { id: string; branchId: string; patientId: string; procedureIds: string[]; dentistId: string; startsAt: string }` (a `NumberAppointment` from Task 5 has every field)
  - `type FlowState` (the step, the path, `editing`, the choices so far: `branchId`, `mobile`, `requestId`, `hasPatients`, `appointmentId`, `patientId`, `form`, `procedureIds`, `dentistId`, `startsAt`, and `history` for Back)
  - `type FlowAction`: `start { path, onlyBranchId }`, `branch { branchId }`, `code_sent { mobile, requestId }`, `verified { mobile, hasPatients }`, `patient { patientId }`, `someone_new`, `form { form }`, `services { procedureIds, dentistId, timeFits }`, `time { startsAt }`, `change { part: "time" | "services" | "patient" }`, `taken`, `appointment { appointment }`, `keep`, `done`, `back`, `home`
  - `START: FlowState`; `flow(state: FlowState, action: FlowAction): FlowState` (for `useReducer(flow, START)`)

Rules (spec 2, 3.3 to 3.5, 7):
- Book (3.3): main, branch (skipped when `onlyBranchId` names the clinic's one active branch), number, code (skipped when the phone verified the number before), who (skipped straight to the form when the number has no patients), form (someone new), services (with the dentist when the branch has 2 or more), time, summary, done. Reschedule or edit (3.4): number, code, list, details, done. Cancel (3.5): number, code, list, the question, done; "No, keep it" returns to the list.
- The summary (book) and the booking details (change) have Change for time, services, and patient (spec 2.2: "Send request" is the one primary button, and `done` is the only way out besides Back and home). A Change opens its step with `editing` on and finishing it returns to the summary or the details: a new time; services that still fit the time (the page asks the server, `timeFits`), or services and then a new time (spec 2.3); a patient of the number or someone new with the form (the flowchart's "add another patient"). The branch never changes in a reschedule (spec 2.5): no move sets it after `appointment`.
- `taken` (the server answered that the time is gone, on send) returns to the time step, and choosing a time returns to the summary or the details.
- Back walks the history, skips a used code (Back from "who" or the list returns to the number), cancels an open Change with the summary's values untouched, never walks into a finished Change, and does nothing on the main page or after `done`. `home` forgets everything. `done` also forgets the form (it holds health information) and the history.
- A move that is not allowed from the current step returns the same state object, so the page can never skip a step by sending the wrong move.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/booking-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { flow, START, type FlowAction, type FlowState } from "@/lib/booking-flow";
import type { IntakeForm } from "@/lib/intake";

// Booking flow spec 3 and 7, move by move. The reducer only carries the form, so a partial one stands in for it.
const MOBILE = "+639171112222";
const MAKATI = "branch-makati";
const FORM = { first: "Leo", last: "Cruz" } as IntakeForm;
const NINE = "2026-10-20T01:00:00.000Z";
const TEN = "2026-10-20T02:00:00.000Z";
const APPOINTMENT = { id: "a1", branchId: MAKATI, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE };

const run = (actions: FlowAction[], from: FlowState = START) => actions.reduce(flow, from);
const steps = (actions: FlowAction[], from: FlowState = START) => {
  const seen: string[] = [];
  actions.reduce((s, a) => {
    const next = flow(s, a);
    seen.push(next.step);
    return next;
  }, from);
  return seen;
};

const bookOne: FlowAction = { type: "start", path: "book", onlyBranchId: MAKATI };
const codeSent: FlowAction = { type: "code_sent", mobile: MOBILE, requestId: "r1" };
const verified = (hasPatients: boolean): FlowAction => ({ type: "verified", mobile: MOBILE, hasPatients });
const services = (timeFits: boolean, procedureIds = ["x1"]): FlowAction => ({ type: "services", procedureIds, dentistId: "d1", timeFits });
const toSummary: FlowAction[] = [bookOne, codeSent, verified(true), { type: "patient", patientId: "p1" }, services(false), { type: "time", startsAt: NINE }];
const summary = run(toSummary);
const details = (path: "change" | "cancel") =>
  run([{ type: "start", path, onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }]);

describe("book an appointment (spec 3.3)", () => {
  it("goes number, code, who, services, time, summary, sent, with no branch step for a clinic with one branch", () => {
    expect(steps([...toSummary, { type: "done" }])).toEqual(["number", "code", "who", "services", "time", "summary", "done"]);
    expect(summary).toMatchObject({ path: "book", branchId: MAKATI, mobile: MOBILE, requestId: null, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE });
    expect(flow(summary, { type: "done" })).toMatchObject({ step: "done", branchId: MAKATI, startsAt: NINE, history: [] });
  });

  it("asks for the branch first when the clinic has several", () => {
    expect(steps([{ type: "start", path: "book", onlyBranchId: null }, { type: "branch", branchId: "b2" }])).toEqual(["branch", "number"]);
    expect(run([{ type: "start", path: "book", onlyBranchId: null }, { type: "branch", branchId: "b2" }]).branchId).toBe("b2");
  });

  it("goes straight on for a number this phone verified before", () => {
    expect(steps([bookOne, verified(true)])).toEqual(["number", "who"]);
  });

  it("opens the new patient form at once for a number with no patients, then the services", () => {
    expect(steps([bookOne, codeSent, verified(false), { type: "form", form: FORM }])).toEqual(["number", "code", "form", "services"]);
    expect(run([bookOne, verified(false), { type: "form", form: FORM }])).toMatchObject({ patientId: null, form: FORM });
  });

  it("offers someone new beside the number's patients", () => {
    expect(steps([bookOne, verified(true), { type: "someone_new" }, { type: "form", form: FORM }])).toEqual(["number", "who", "form", "services"]);
  });

  it("keeps the code step for a new code", () => {
    expect(run([bookOne, codeSent, { type: "code_sent", mobile: MOBILE, requestId: "r2" }])).toMatchObject({ step: "code", requestId: "r2" });
  });

  it("changes the date and time from the summary and returns to it (spec 3.3 step 7)", () => {
    expect(steps([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary)).toEqual(["time", "summary"]);
    expect(run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary)).toMatchObject({ startsAt: TEN, editing: false });
  });

  it("changes the services from the summary and returns to it while the time still fits", () => {
    const s = run([{ type: "change", part: "services" }, services(true, ["x1", "x2"])], summary);
    expect(s).toMatchObject({ step: "summary", procedureIds: ["x1", "x2"], startsAt: NINE, editing: false });
  });

  it("asks for a new time when the changed services no longer fit it (spec 2.3)", () => {
    const s = run([{ type: "change", part: "services" }, services(false, ["x1", "x2"])], summary);
    expect(s).toMatchObject({ step: "time", procedureIds: ["x1", "x2"], startsAt: null, editing: true });
    expect(flow(s, { type: "time", startsAt: TEN })).toMatchObject({ step: "summary", startsAt: TEN, editing: false });
  });

  it("changes the patient from the summary: one of the number's records, or someone new (add another patient)", () => {
    expect(run([{ type: "change", part: "patient" }, { type: "patient", patientId: "p2" }], summary)).toMatchObject({ step: "summary", patientId: "p2" });
    const s = run([{ type: "change", part: "patient" }, { type: "someone_new" }, { type: "form", form: FORM }], summary);
    expect(s).toMatchObject({ step: "summary", patientId: null, form: FORM, editing: false });
  });

  it("picks a time again when the server says the time was taken, then returns to the summary", () => {
    const s = flow(summary, { type: "taken" });
    expect(s).toMatchObject({ step: "time", startsAt: null, editing: true });
    expect(flow(s, { type: "time", startsAt: TEN })).toMatchObject({ step: "summary", startsAt: TEN });
  });
});

describe("back", () => {
  it("returns step by step and skips a code that was used", () => {
    const who = run([bookOne, codeSent, verified(true)]);
    expect(flow(who, { type: "back" })).toMatchObject({ step: "number" });
    expect(flow(run([bookOne, codeSent]), { type: "back" })).toMatchObject({ step: "number" });
    expect(flow(run([{ type: "start", path: "book", onlyBranchId: null }]), { type: "back" })).toEqual(START);
    expect(flow(summary, { type: "back" })).toMatchObject({ step: "time", startsAt: null });
  });

  it("cancels an open Change and keeps what the summary had", () => {
    const open = run([{ type: "change", part: "services" }, services(false, ["x2"])], summary);
    expect(run([{ type: "back" }, { type: "back" }], open)).toMatchObject({ step: "summary", procedureIds: ["x1"], startsAt: NINE, editing: false });
  });

  it("never walks back into a finished Change", () => {
    const changed = run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary);
    expect(flow(changed, { type: "back" })).toMatchObject({ step: "time", editing: false });
    expect(flow(changed, { type: "back" }).history).toEqual(flow(summary, { type: "back" }).history);
  });

  it("does nothing on the main page or once the request is sent", () => {
    expect(flow(START, { type: "back" })).toBe(START);
    const sent = flow(summary, { type: "done" });
    expect(flow(sent, { type: "back" })).toBe(sent);
  });
});

describe("reschedule or edit a booking (spec 3.4)", () => {
  it("goes number, code, appointments, booking details, sent", () => {
    expect(
      steps([{ type: "start", path: "change", onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }, { type: "done" }]),
    ).toEqual(["number", "code", "list", "details", "done"]);
    expect(details("change")).toMatchObject({ step: "details", appointmentId: "a1", branchId: MAKATI, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE });
  });

  it("lists the appointments even for a number with no patients (the list says there are none)", () => {
    expect(run([{ type: "start", path: "change", onlyBranchId: null }, verified(false)]).step).toBe("list");
  });

  it("changes the date and time, or the services with a new time when it no longer fits, and returns to the details", () => {
    expect(run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], details("change"))).toMatchObject({ step: "details", startsAt: TEN });
    expect(steps([{ type: "change", part: "services" }, services(false, ["x2"]), { type: "time", startsAt: TEN }], details("change"))).toEqual([
      "services",
      "time",
      "details",
    ]);
    expect(run([{ type: "change", part: "services" }, services(true, ["x2"])], details("change"))).toMatchObject({ step: "details", procedureIds: ["x2"], startsAt: NINE });
  });

  it("changes the patient to another record of the number or someone new", () => {
    expect(run([{ type: "change", part: "patient" }, { type: "patient", patientId: "p2" }], details("change"))).toMatchObject({ step: "details", patientId: "p2" });
    expect(run([{ type: "change", part: "patient" }, { type: "someone_new" }, { type: "form", form: FORM }], details("change"))).toMatchObject({
      step: "details",
      patientId: null,
      form: FORM,
    });
  });

  it("goes back from the details to the list, and picks a time again when the new one was taken", () => {
    expect(flow(details("change"), { type: "back" })).toMatchObject({ step: "list" });
    expect(run([{ type: "taken" }, { type: "time", startsAt: TEN }], details("change"))).toMatchObject({ step: "details", startsAt: TEN });
  });
});

describe("cancel a booking (spec 3.5)", () => {
  it("goes number, code, appointments, the question, cancelled", () => {
    expect(
      steps([{ type: "start", path: "cancel", onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }, { type: "done" }]),
    ).toEqual(["number", "code", "list", "confirm_cancel", "done"]);
  });

  it("keeps the appointment and returns to the list on No", () => {
    expect(flow(details("cancel"), { type: "keep" })).toMatchObject({ step: "list" });
  });
});

describe("moves that are not allowed", () => {
  it("change nothing", () => {
    const cases: [FlowState, FlowAction][] = [
      [START, { type: "time", startsAt: NINE }],
      [START, { type: "done" }],
      [summary, { type: "start", path: "cancel", onlyBranchId: null }],
      [summary, { type: "appointment", appointment: APPOINTMENT }],
      [summary, { type: "keep" }],
      [details("change"), { type: "patient", patientId: "p2" }],
      [details("cancel"), { type: "change", part: "time" }],
      [run([bookOne]), { type: "form", form: FORM }],
      [run([bookOne, verified(true)]), { type: "code_sent", mobile: MOBILE, requestId: "r9" }],
    ];
    for (const [state, action] of cases) expect(flow(state, action), `${state.step} ${action.type}`).toBe(state);
  });

  it("home forgets everything, and a sent request forgets the form", () => {
    const withForm = run([bookOne, verified(false), { type: "form", form: FORM }, services(false), { type: "time", startsAt: NINE }]);
    expect(withForm).toMatchObject({ step: "summary", form: FORM });
    expect(flow(withForm, { type: "home" })).toEqual(START);
    expect(flow(withForm, { type: "done" })).toMatchObject({ step: "done", form: null });
  });
});
```

Run: `npx vitest run tests/unit/booking-flow.test.ts`
Expected: FAIL with `Cannot find package '@/lib/booking-flow'`.

- [ ] **Step 2: Write the reducer**

Create `src/lib/booking-flow.ts`:

```ts
import type { IntakeForm } from "@/lib/intake";

/**
 * The public booking page's flow (booking flow spec 3 and 7) as one pure reducer: the steps of booking (3.3),
 * rescheduling or editing (3.4), and cancelling (3.5), and every allowed move between them. The page renders the
 * current step and calls the Server Actions with what the state holds; it never decides the next step itself. The
 * server re-checks everything, so this only decides what the patient sees next.
 *
 * Moves carry what the page learned from the server (a code was sent, the number is verified, the time was taken)
 * and what the patient chose. A move that is not allowed from the current step changes nothing.
 */

export type Path = "book" | "change" | "cancel";

export type Step =
  | "main"
  | "branch"
  | "number"
  | "code"
  | "who"
  | "form"
  | "services"
  | "time"
  | "summary"
  | "list"
  | "details"
  | "confirm_cancel"
  | "done";

/** An upcoming appointment of the verified number (numberAppointments), where a change or a cancel starts. */
export type FlowAppointment = {
  id: string;
  branchId: string;
  patientId: string;
  procedureIds: string[];
  dentistId: string;
  startsAt: string;
};

type Snapshot = {
  path: Path | null;
  step: Step;
  /** True while a Change from the summary (booking) or the booking details (change) is open: finishing it returns there. */
  editing: boolean;
  branchId: string | null;
  mobile: string | null;
  /** The code request while the code step is open. */
  requestId: string | null;
  /** Whether the verified number had patients at the clinic: the booking goes to "Who" or straight to the form. */
  hasPatients: boolean;
  appointmentId: string | null;
  /** One of the number's patients, or null for someone new (then form holds them). */
  patientId: string | null;
  form: IntakeForm | null;
  procedureIds: string[];
  dentistId: string | null;
  startsAt: string | null;
};

/** The flow's state. history holds earlier states for Back, newest last. */
export type FlowState = Snapshot & { history: Snapshot[] };

export type FlowAction =
  /** A main page button. onlyBranchId: the clinic's one active branch, so booking skips the branch step. */
  | { type: "start"; path: Path; onlyBranchId: string | null }
  | { type: "branch"; branchId: string }
  /** The server texted a code (startVerification, or resendBookingCode on the code step). */
  | { type: "code_sent"; mobile: string; requestId: string }
  /** The number is verified on this phone: straight away, or after a right code. hasPatients from numberPatients. */
  | { type: "verified"; mobile: string; hasPatients: boolean }
  | { type: "patient"; patientId: string }
  | { type: "someone_new" }
  | { type: "form"; form: IntakeForm }
  /** timeFits: the chosen time is still open for these services and this dentist (the page asked the server). */
  | { type: "services"; procedureIds: string[]; dentistId: string; timeFits: boolean }
  | { type: "time"; startsAt: string }
  /** A summary line's Change button (spec 3.3 step 7, 3.4 step 3). */
  | { type: "change"; part: "time" | "services" | "patient" }
  /** The server answered that the chosen time is no longer open. */
  | { type: "taken" }
  | { type: "appointment"; appointment: FlowAppointment }
  /** "No, keep it" (spec 3.5 step 3). */
  | { type: "keep" }
  /** The server sent the request, sent the changes, or cancelled. */
  | { type: "done" }
  | { type: "back" }
  /** Back to the main page, forgetting everything. */
  | { type: "home" };

export const START: FlowState = {
  path: null,
  step: "main",
  editing: false,
  branchId: null,
  mobile: null,
  requestId: null,
  hasPatients: false,
  appointmentId: null,
  patientId: null,
  form: null,
  procedureIds: [],
  dentistId: null,
  startsAt: null,
  history: [],
};

/** The step each path ends on before "done": the booking's summary, the change's details, the cancel's question. */
const LAST: Record<Path, Step> = { book: "summary", change: "details", cancel: "confirm_cancel" };

export function flow(state: FlowState, action: FlowAction): FlowState {
  const { history, ...now } = state;
  // Forward: remember this state, so Back returns to it.
  const go = (next: Partial<Snapshot>): FlowState => ({ ...now, ...next, history: [...history, now] });
  // In place: Back skips this state (a used code, a time that was taken).
  const stay = (next: Partial<Snapshot>): FlowState => ({ ...now, ...next, history });
  // Finishing a Change returns to the summary or the booking details with the history it had there, so Back from it
  // never walks into the finished Change.
  const finish = (next: Partial<Snapshot>): FlowState => {
    const home = state.path === "change" ? "details" : "summary";
    const at = history.map((h) => h.step).lastIndexOf(home);
    return { ...now, ...next, step: home, editing: false, history: at >= 0 ? history.slice(0, at) : history };
  };
  const at = (...steps: Step[]) => steps.includes(state.step);

  switch (action.type) {
    case "home":
      return START;
    case "back":
      if (state.step === "done" || history.length === 0) return state;
      return { ...history[history.length - 1], history: history.slice(0, -1) };
    case "start":
      if (!at("main")) return state;
      if (action.path === "book" && action.onlyBranchId === null) return go({ path: "book", step: "branch" });
      return go({ path: action.path, step: "number", branchId: action.path === "book" ? action.onlyBranchId : null });
    case "branch":
      return at("branch") ? go({ step: "number", branchId: action.branchId }) : state;
    case "code_sent":
      if (at("number")) return go({ step: "code", mobile: action.mobile, requestId: action.requestId });
      return at("code") ? stay({ requestId: action.requestId }) : state;
    case "verified": {
      if (!at("number", "code")) return state;
      const step: Step = state.path !== "book" ? "list" : action.hasPatients ? "who" : "form";
      const next = { step, mobile: action.mobile, requestId: null, hasPatients: action.hasPatients };
      // Back from the next step returns to the number, never to a code that is already used.
      return at("code") ? stay(next) : go(next);
    }
    case "patient":
      if (!at("who")) return state;
      return state.editing ? finish({ patientId: action.patientId, form: null }) : go({ step: "services", patientId: action.patientId, form: null });
    case "someone_new":
      return at("who") ? go({ step: "form" }) : state;
    case "form":
      if (!at("form")) return state;
      return state.editing ? finish({ patientId: null, form: action.form }) : go({ step: "services", patientId: null, form: action.form });
    case "services": {
      if (!at("services")) return state;
      const chosen = { procedureIds: action.procedureIds, dentistId: action.dentistId };
      // Spec 2.3: new services change the visit's length, so a time that no longer fits is chosen again.
      if (state.editing && action.timeFits && state.startsAt !== null) return finish(chosen);
      return go({ ...chosen, step: "time", startsAt: null });
    }
    case "time":
      if (!at("time")) return state;
      return state.editing ? finish({ startsAt: action.startsAt }) : go({ step: "summary", startsAt: action.startsAt });
    case "change":
      if (!at("summary", "details")) return state;
      return go({ step: action.part === "patient" ? "who" : action.part, editing: true });
    case "taken":
      return at("summary", "details") ? stay({ step: "time", startsAt: null, editing: true }) : state;
    case "appointment": {
      if (!at("list")) return state;
      const a = action.appointment;
      return go({
        step: state.path === "cancel" ? "confirm_cancel" : "details",
        appointmentId: a.id,
        branchId: a.branchId,
        patientId: a.patientId,
        form: null,
        procedureIds: a.procedureIds,
        dentistId: a.dentistId,
        startsAt: a.startsAt,
      });
    }
    case "keep":
      return at("confirm_cancel") ? flow(state, { type: "back" }) : state;
    case "done":
      // The form holds health information: forget it once it is sent. Back is over; the main page is next.
      return state.path !== null && at(LAST[state.path]) ? { ...now, step: "done", editing: false, form: null, history: [] } : state;
  }
}
```

Run: `npx vitest run tests/unit/booking-flow.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 3: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add src/lib/booking-flow.ts tests/unit/booking-flow.test.ts
git commit -m "feat: add the booking flow as a pure reducer" -m "flow() holds every step and allowed move of booking, rescheduling or editing, and cancelling: the branch and code steps skipped when they are not needed, the Change buttons of the summary and the booking details, a new time when changed services no longer fit, a taken time, Back that skips a used code and cancels an open Change, and home. Unit tested move by move against the spec, so plan 8's page only renders the step."
```

### Task 8: README and final verification

**Files:**
- Modify: `README.md`

The controller runs this task after Tasks 1 to 7 are committed. It changes only the README unless a check fails; a fix gets its own `fix:` commit.

- [ ] **Step 1: Document branches and the migration**

In `README.md`, replace:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migrations 7 and 8 are pasted as described under "Billing" and "Teams and reports" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

with:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migrations 7 to 9 are pasted as described under "Billing", "Teams and reports", and "Branches and the booking engine" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

replace:

```markdown
   | 8 | `20260926000100_teams.sql` |
```

with:

```markdown
   | 8 | `20260926000100_teams.sql` |
   | 9 | `20260928000100_branches_booking.sql` |
```

replace:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260925000200 20260926000100
```

with:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260925000200 20260926000100 20260928000100
```

and append to the end of the file:

````markdown

## Branches and the booking engine

A clinic can have several branches, each with its own address and calendar, and the server side of the new patient booking flow is in place (spec: `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`): patients verify their number first, then book for one of their patients or for someone new with the clinic's patient form and waiver, change a booking (it goes back to the clinic for approval, and the clinic gets a "Changed request" alert), or cancel one. The pages for it come in the next plan; until then every clinic has one branch, "Main", and every page works as before. Once a clinic has 2 or more active branches, patients' texts name the branch after the clinic (for example "Bright Dental Makati").

Answers on the patient form are health information, sensitive personal information under RA 10173: only the clinic's members read them, they never appear in texts, pushes, logs, or reports, and deleting a patient clears all of them. The waiver's wording (`src/lib/waiver.ts`) still needs legal review before the pages show it.

### Apply the branches migration (once, before merging the branches branch)

Every merge to `main` deploys, and the new code reads the new table, columns, and functions, so the migration goes first. The teams migration must already be in production: this migration checks it and refuses to run (it fails on its first statement) if `clinic_invites` does not exist yet.

1. Make sure production's `create_clinic` is still the one in the teams migration and `create_booking` still the one in the hardening migration, because this migration replaces both and a fix made there by hand would be lost. In the production **SQL Editor**, run `select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure);` and compare the body (between the `$function$` markers) with `create_clinic` in `supabase/migrations/20260926000100_teams.sql`; then run `select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'create_booking';` and compare it with `create_booking` in `supabase/migrations/20260924000100_hardening.sql`. If either differs, stop and fold the difference into the branches migration first.
2. Open `supabase/migrations/20260928000100_branches_booking.sql`, paste it into the production **SQL Editor**, and run it. Every clinic gets one branch, "Main", with the clinic's address and map link, holding all its working hours and appointments. `npm test` has already applied it to an offline copy of the schema (`tests/sql`).
3. Run `notify pgrst, 'reload schema';` so the API sees the new `create_booking` and `change_booking` at once.
4. Check it: `select count(*) from public.clinics c where (select count(*) from public.branches b where b.clinic_id = c.id and b.active) <> 1;` must return `0`.
5. Merge the branch right away. Until the deploy finishes, saving a dentist's working hours in Settings fails (the old code names no branch); saving again after the deploy works. Everything else keeps working in between.
6. If you ever link the project for `npm run db:push`, mark it applied first: `npx supabase migration repair --status applied 20260928000100`.
````

- [ ] **Step 2: Run every automated check**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run build`
Expected: lint clean; `tsc` silent; every unit test and the `tests/sql` suite PASS (`branches.test.ts` 23, `isolation.test.ts` 9, `teams.test.ts` 27, `billing.test.ts` 18); the build finishes with the same route list as before this plan. `;` keeps going after a failure, so read every result.

- [ ] **Step 3: No dashes slipped in, no page changed, and the other suites are untouched**

Run: `git grep -n -P "[\x{2013}\x{2014}]" -- src tests supabase public README.md CONTRIBUTING.md docs/superpowers/plans/2026-09-28-plan-7-branches-booking-engine.md`
Expected: no output.

Run: `git diff --name-only plan-6-teams...HEAD -- src/app src/components public`
Expected: exactly one line, `src/app/[slug]/actions.ts` (Server Actions, not a page).

Run: `git diff --stat plan-6-teams...HEAD -- tests/db tests/e2e playwright.config.ts`
Expected: no output (this plan neither edits nor runs them).

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: explain branches and the branches migration" -m "The README gains the Branches and the booking engine section: what exists before the pages come, how health information is kept, the checks before pasting the migration, pasting it and reloading the API schema before the merge, and the check query. Migration 9 joins the table and the repair command."
```

- [ ] **Step 5: Report to Kai**

Write the summary for Kai: what shipped (no page changed; every clinic gets one branch; the server side of the new flow), the test counts, that no dependency was added, the one migration and that it must be pasted before the merge (after the teams one) with the two definition checks, the schema reload, and the check query, and the list in "What Kai must do" below. Say plainly that nothing new is visible until plan 8, that the waiver and form fields still need Kai's corrections and legal review, and that the short Settings window between the paste and the deploy is expected.

## What Kai must do (outside the code)

Before merging the branches branch (after the billing and teams branches, which this one sits on; every merge to `main` deploys production):
- Review `supabase/migrations/20260928000100_branches_booking.sql`. Run the two definition checks in the README's "Branches and the booking engine" section (production's `create_clinic` matches the teams migration's, and `create_booking` the hardening migration's), then paste the migration into the production **SQL Editor**, run it, run `notify pgrst, 'reload schema';`, and run the check query (it must return `0`).
- Merge right after the paste: until the deploy finishes, saving a dentist's working hours in Settings fails, and works again after it.
- Nothing else: no new environment variables, no Supabase setting or email template changes.

Before plan 8 shows the patient form (not needed for this merge):
- Correct the form's fields (`src/lib/intake.ts`) and the waiver's wording (`src/lib/waiver.ts`), and have the waiver reviewed (the wording, a cancellation and no-show policy, and minors signing through a guardian). Changing the words means a new `WAIVER_VERSION`.

After the deploy, a short walk on production (nothing new is visible yet):
- The demo clinic's booking page looks as before. Request a visit, approve it in Requests: the confirmation text reads as before, with the clinic's name alone (the clinic has one branch).
- In Settings, save a dentist's hours: it saves. Move a visit on the schedule: the times offered are as before.
- Cancel a visit through the link in its text: it cancels and the clinic is alerted, as before.
- In the SQL Editor, `select b.name, b.address from public.branches b join public.clinics c on c.id = b.clinic_id where c.slug = '<demo slug>';` shows one row, `Main`, with the demo clinic's address.

## Self-review

**Spec coverage.**

| Spec | Where |
|---|---|
| 1: branches (one account and link, own address and calendar, shared patients, procedures, staff, a dentist at several branches), approval unchanged, the patient form drafted by us, verification in all three paths | Task 2 (data model), Task 3 (hours per branch, a dentist's blocks at several branches), Tasks 5 and 6 (verification first in every service), Task 1 (form and waiver) |
| 2.1: a code after the number, skipped on a phone that verified it | Task 5 (`startVerification`, `checkVerification`, the existing cookie); Task 7 (`verified` straight from the number step) |
| 2.2: Confirm means send; a Change button per summary line | Task 7 (`change`, `done`) |
| 2.3: changed services re-check the time | Task 7 (`services` with `timeFits`), Task 6 (the server re-checks every time on send) |
| 2.4: saving a booking holds the time; approval sends the confirmation | Tasks 2 and 6 (`create_booking` pending, `no_overlap`), today's approval unchanged |
| 2.5: the branch stays fixed when rescheduling | Task 6 (`changeForNumber` and `changeScope` use the appointment's branch; `change_booking` has no branch), Task 7 (no move sets the branch after `appointment`) |
| 3.1: the main page, branches listed, the paused notice | Server side only: `PublicClinic.branches` (Task 3), `bookingOpen` in every service (Tasks 5, 6); the page is plan 8 |
| 3.2: number and code, the existing limits, the cookie checked by every later action | Task 5 |
| 3.3: branch, number, who, form, services, time, summary with Change, sent, new request alert | Task 7 (steps and moves), Task 6 (`bookForNumber`), Task 5 (`numberPatients`), Task 3 (times per branch) |
| 3.4: the number's upcoming pending or confirmed appointments, details with Change, send changes (pending again, changed request alert), the minimum notice, sent | Task 5 (`numberAppointments` with `changeable`), Task 6 (`changeForNumber`, `call_clinic`), Task 2 (`change_booking`), Task 4 (`change_alert`), Task 7 |
| 3.5: cancel as the patient link does, "No, keep it" | Task 6 (`cancelForNumber` reuses `cancelByPatient`), Task 7 (`keep`) |
| 4: `branches` and its rules, the last active branch, hours and appointments with a branch, composite keys, open times per branch, no-overlap per dentist, texts within 20 characters, onboarding and the backfill | Task 2, Task 3, Task 1 and Task 4 (texts); the dashboard and Settings > Branches pages are plan 8 |
| 5: `change_booking` | Task 2 (function), Task 6 (the server re-validates first) |
| 6: the form and waiver fields, required fields, a guardian for minors, the medical shape, the waiver's version and time, storage, RA 10173, anonymizing clears it | Task 1 (parser, waiver), Task 2 (columns, constraints, `create_booking`), Task 2 Step 3 (`deletePatient`); the dashboard's "Patient form" section and the Privacy Notice paragraph are plan 8 |
| 7: the flow as one pure reducer, tested move by move | Task 7 |
| 8: security and privacy | Tasks 2, 5, 6 (the number checked in every service and in `change_booking`; rows filtered by clinic and number; logs without details) |
| 9: out of scope | Not built: changing branch when rescheduling, branch staff permissions, per-branch procedures, prices, or reports, patients editing their form, staff editing medical answers, drawn signatures, a form builder, printing |
| 10: tests | Database: `tests/sql/branches.test.ts` (every item of 10's database list) and `isolation.test.ts`. Unit: the reducer (Task 7), the form (Task 1), the text name limit (Task 1), open times per branch (Task 3), the verified-number checks (Tasks 5, 6) |

**Decisions worth a second look.**
- `create_booking` is dropped and created with two trailing parameters that default to null (`p_branch_id`, `p_form`), rather than overloaded, so every existing call (the staff New appointment, the booking page, codes stored before the deploy) keeps working and books at the first active branch. Its new patient path is now one `insert ... on conflict` on `patients_identity`: the same matching as before (clinic, mobile, and name; never without a mobile), race-safe, and a match keeps its form and only fills what is empty. `change_booking` carries the same statement for someone new.
- `change_booking` also checks the number in SQL: the appointment's patient must have `p_mobile`, and so must the patient it moves to. The spec asks the server to check; the database now refuses a mistake too.
- `change_booking` returns false (not an error) when the appointment cannot be changed, and the service answers `gone` for that race; within the minimum notice the service answers `call_clinic` before calling it.
- An unchanged "Send changes" answers `unchanged` and does not send a confirmed visit back to pending.
- A verification code is stored as `otp_requests.booking = { clinicId, verify: true }` and works only for verification; a booking page code works only there. Both share `issue_otp`'s limits and `resendCode`.
- A lapsed clinic sends and takes no verification code, as the booking page's codes already do (spec 3.1 shows the paused notice instead of the three paths); cancelling by number is not refused.
- `loadClinic` lists only the active dentists with hours at the branch. Every dentist has hours (onboarding and Settings require a block), so a clinic with one branch lists every active dentist, as before.
- The last active branch is enforced by a trigger with a per-clinic advisory lock, for the owner and the secret key alike, and still lets the operator delete a whole clinic.
- There is no database constraint on overlapping working hours: `saveDentist` inserts the new hours before deleting the old ones, which such a constraint would refuse. The save-time check now runs across branches.
- `saveProfile` copies a one-branch clinic's address and map link to its branch, so plan 8's booking page never shows an address the owner already changed in Settings.
- The waiver's words leave out the spec's bracketed legal review note, which is for Kai, not patients; a comment in `src/lib/waiver.ts` keeps it.
- `patients.last_visit` is a `"YYYY-MM"` text (the spec asks for month and year), and the medical answers are Yes, No, or empty: spec 6 marks only its required fields.
- `numberAppointments` maps an appointment's procedure names to the clinic's active procedure ids for the services step of a change; a name no longer active is dropped there and the patient picks the services again.
- `staffOpenStarts` resolves its branch (named, else a moved visit's own, else the first active), so the dashboard's New and Move keep offering the same times without a page change.

**Deferred to plan 8 (explicitly).** Every page: the public booking page's main page, branch list, and the three paths on `flow` (`BookingSheet` today still books at the first active branch through `requestBooking`, `verifyBookingCode`, and `resendBookingCode`); the dashboard with 2 or more branches (branch on each appointment, the branch filter, the branch for a New appointment, the branch per working block in the hours editor, the "Outside hours" marker per branch; today `loadDay` still checks a dentist's blocks at every branch together); Settings > Branches (add, rename, edit the address and map link, order, deactivate), which calls `branchSmsNameProblem` for every active branch once a second becomes active and after the clinic's own text name changes; the patient page's "Patient form" section; the Privacy Notice paragraph on health information; the `/a/` page naming the branch. Also deferred: `tests/db` seed helpers insert appointments and hours without a branch, which a development database would now refuse; they need `branch_id` when a development project exists.

**Placeholder scan.** Every step has complete code or exact text. Kai supplies nothing but the migration paste, the checks, and the production walk.

**How this plan was checked.** Every Create, replace, and append instruction was applied by script, in order, to a clean export of commit `0fb25ec` (the plan's base, `plan-7-booking-flow`): each replaced text occurs exactly once in its file at that point, as the Edit tool needs. After each task the copy passed the tests that task names and typechecked; each "Expected: FAIL" step failed for the reason given; after Task 7 the whole copy passed `npx tsc --noEmit`, `npx eslint`, and `npm test` (unit and `tests/sql`). The migration was also checked the other way: with `clinic_id` updatable by the owner, without the last active branch trigger, or without `change_booking`'s check of the appointment's number, a test in `branches.test.ts` fails. The build was not run on the copy (it has no environment file); Task 8 runs it.

**Type consistency.** `PublicBranch` and `PublicClinic.branch`/`branches` (Task 3) are what `loadClinic` returns and what `bookForNumber`, `changeForNumber`, and `takenStarts` read (Task 6). `BookingPayload.branchId` is optional, so payloads stored before the deploy still parse. `StoredRequest` (`BookingPayload | VerifyRequest`) types `otp_requests.booking` in `issueCode`, `spendCode`, `callIssueOtp`, and `resendCode`. `Device` (Task 5) is what the actions build from the cookie and what every number service takes. `IntakeForm` and `formColumns` (Task 1) match the `p_form` keys `create_booking` and `change_booking` read (Task 2), and `INTAKE_LIMITS` matches the column checks. `NumberAppointment` has every field of `FlowAppointment` (Task 7). `AlertKind` and `SmsKind` both gain `"change_alert"`, so `alertClinic` sends it by push or text. `rowText` takes the active branch count, `activeBranchNames` gives it, and `reminders` takes a per-clinic count map.
