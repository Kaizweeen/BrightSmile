# BrightSmile Plan 3: Clinic Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic runs its whole day from `/app`: it approves and declines requests, works a day schedule (move, cancel, completed, no-show), adds walk-in and phone bookings, looks up and edits patients (and deletes them by anonymizing), and manages its profile, dentists, hours, time off, procedures, booking rules, alerts, and password.

**Architecture:** Every dashboard page and Server Action starts with `requireStaff()`, which returns the cookie-bound Supabase client (RLS applies) with the staff member's user id and clinic id. Business logic lives in server-only services under `src/lib` that take that `Staff` value (`appointment-actions`, `dashboard`, `patients`, `clinic-settings`), so the database tests call the same functions with a signed-in test client and prove both behavior and clinic isolation. Pure rules (which actions an appointment offers, schedule flags, "text not delivered", patient search terms, manual booking and settings validation) live in client-safe modules with unit tests. Status changes go through `canTransition` and the existing SQL functions (`set_appointment_status`, `move_appointment`, `create_booking`); patient texts go through `sendSms` and never fail the action. Open times for New and Move reuse `src/lib/slots` with the clinic's slot spacing, no minimum notice, and a one year window. Pages are Server Components; forms that need state are small Client Components calling Server Actions and `refresh()`.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions, `next/form`, `proxy.ts`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (sections 5.3, 8, 9.2, 10.1, 12, 13 drive this plan).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| Layouts (they do not re-render on navigation and get no `searchParams` or pathname) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` |
| `params` and `searchParams` are Promises | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` |
| `usePathname` (active nav item, Client Component only) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md` |
| `<Form>` from `next/form` (GET forms that update search params: schedule date jump, patient search) | `node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md` |
| `<Link>` | `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` |
| Server Actions (public POST endpoints, validate every argument) and forms | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, `node_modules/next/dist/docs/01-app/02-guides/forms.md` |
| `refresh` (re-render after an action, Server Actions only) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` |
| `redirect` (throws; call it outside `try`) and `notFound` | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md` |
| Proxy (Server Actions are POSTs to their page's route, so `/app/:path*` covers every dashboard action) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/(auth)"` and `"src/app/app/patients/[id]/page.tsx"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer the session adds (CONTRIBUTING.md). The commit commands in this plan leave it out; add your own. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-2-accounts-booking` (Plan 3 continues on it after Plan 2), one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone. Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and clock times as minutes after midnight (or `"HH:MM"` in forms and Postgres). Datetime inputs in Settings are read as Manila wall-clock time with `manilaInstant`.
- Mobile numbers are stored as `+639XXXXXXXXX`. Semaphore gets `09XXXXXXXXX` (`localMobile`). A patient's mobile is optional for manual bookings; no mobile means no texts.
- Field limits (from `LIMITS` in `src/lib/validate.ts`): clinic name 80; clinic short name for texts 20 (must not start with "test"); dentist name 60; dentist short name 16; first and last name 50 each; status reason 36; procedure name 60 with a duration of 5 to 480 minutes; HMO 60; address 200; map link 300 (must start with `https://`); time off note 100; booking link 3 to 24 characters of `[a-z0-9-]`, not reserved. At most 20 procedures per appointment.
- Booking rules: slot spacing 15, 30, or 60 minutes; minimum notice 0 to 10080 minutes; booking window 1 to 365 days; alerts `push` or `sms`. Staff open times (New and Move) use the clinic's slot spacing with no minimum notice and a 365 day window: the rules protect the public page, not the front desk.
- Texts are printable ASCII, at most 160 characters with worst-case inputs (`renderSms` guarantees this). Patient texts from the dashboard (spec 10.1): `confirmed` on approve and on a manual booking when "Send confirmation text" is on, `declined` on decline, `moved` on move, `cancelled` on staff cancel. The dentist's short name goes in only when the clinic has 2 or more active dentists. Completed and No-show send nothing.
- A text that fails never fails the action (spec 13): `sendSms` records `status = 'failed'` in `sms_log`, the action succeeds, and the UI says "The text was not delivered. Please call the patient." The schedule's "Text not delivered" flag comes from the latest patient text (`confirmed`, `declined`, `moved`, `cancelled`, `reminder`) for that appointment having `status = 'failed'`.
- `SMS_MODE=log` writes texts to `sms_log` with status `logged` and prints them to the server console. Tests and local development always use `log`.
- Never log full patient details. Error logs carry the error message only.
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies). The secret-key client is used only inside `sendSms` (staff have no insert right on `sms_log`) and the existing public flow; this plan adds no other use.
- Every service scopes its queries with `.eq("clinic_id", staff.clinicId)` as well as RLS, checks ids with `isUuid` before querying, and answers "not found" for another clinic's rows. Every Server Action treats its arguments as untrusted input (spec 12).
- Status changes: `canTransition(from, to, "staff")` first, then the SQL function with `p_from` as a compare-and-set. A `false` answer means someone else changed it: "This appointment changed a moment ago. Reload to see it."
- Custom times may fall outside working hours but never overlap: the database's `no_overlap` constraint (`23P01`) answers "That time overlaps another visit for this dentist. Pick another time."
- UI: targets at least 44px, status never rests on colour alone (every chip carries a word), reuse the classes in `src/app/globals.css` and add only the dashboard shell classes this plan lists.
- No database migrations in this plan. The applied schema already has every table, policy, and function the dashboard needs (staff select and update `clinics`; manage dentists, hours, time off, procedures, patients, appointments; read `sms_log`; the three SQL functions are `security invoker`).
- Database tests run only against the development project (`tests/db/helpers.ts` refuses anything else), and each test creates and removes its own clinics and users.
- Dev server port: 3600 (`.claude/launch.json` entry `brightsmile`).
- Dependencies: none added.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. **Clinic dashboard (this plan):** shell and navigation, Requests, Schedule, New appointment and Move, Patients, Settings. Deliverable: a clinic runs its whole day from the dashboard.
4. Launch readiness: PWA (manifest, service worker) and push, the daily job with Vercel Cron, landing and legal pages, the Playwright happy path, and a polish and audit pass.

## File map for this plan

| File | Responsibility |
|---|---|
| `src/lib/supabase/server.ts` | Adds `type Staff` and `requireStaff()` |
| `src/lib/validate.ts` | Adds `isUuid`, `LIMITS.mapsUrl`, `LIMITS.timeOffNote` |
| `src/app/globals.css` | 44px minimum on `.btn`; dashboard shell, nav, and row classes |
| `src/app/app/layout.tsx`, `src/app/app/AppNav.tsx` | Dashboard shell: clinic name, nav (bottom on phones, top on wider screens), pending badge |
| `src/app/app/page.tsx` | Replaced: redirects `/app` to `/app/requests` |
| `src/lib/schedule.ts` | Pure: status words, `actionsFor`, `failedTexts`, `parseDay`, `assembleDay` (flags) |
| `src/lib/appointment-actions.ts` | Server: `changeStatus`, `moveAppointment`, `createAppointment`, patient texts |
| `src/lib/availability.ts` | `busyBetween` exported, takes a client, returns appointment ids |
| `src/lib/dashboard.ts` | Server loaders: `loadRequests`, `loadDay`, `staffOpenStarts`, `loadBookingOptions`, `loadMoveTarget` |
| `src/lib/staff-input.ts` | Pure: `Saved`, patient fields, slot and manual booking parsing, patient search terms |
| `src/lib/patients.ts` | Server: `searchPatients`, `loadPatient`, `updatePatient`, `deletePatient` (anonymize) |
| `src/lib/settings-input.ts` | Pure: profile, rules, dentist, time off, procedure validation |
| `src/lib/clinic-settings.ts` | Server: `loadSettings` and every Settings write |
| `src/components/HoursEditor.tsx` | Weekly hours editor, extracted from onboarding and reused in Settings |
| `src/app/onboarding/Onboarding.tsx` | Uses `HoursEditor` |
| `src/app/app/actions.ts` | Server Actions: status changes, open times, new appointment, move |
| `src/app/app/AppointmentActions.tsx` | Approve, Decline, Move, Cancel, Completed, No-show buttons with reason step |
| `src/app/app/SlotPicker.tsx` | Dentist, date, open times or a custom time |
| `src/app/app/requests/page.tsx` | Requests |
| `src/app/app/schedule/page.tsx` | Schedule day view |
| `src/app/app/schedule/move/[id]/page.tsx`, `MoveForm.tsx` | Move |
| `src/app/app/new/page.tsx`, `NewAppointment.tsx` | New appointment |
| `src/app/app/patients/page.tsx`, `actions.ts`, `[id]/page.tsx`, `[id]/PatientEditor.tsx` | Patients search and detail |
| `src/app/app/settings/page.tsx`, `actions.ts`, `ClinicForms.tsx`, `DentistEditor.tsx`, `ProcedureEditor.tsx` | Settings |
| `tests/unit/schedule.test.ts`, `tests/unit/staff-input.test.ts`, `tests/unit/settings-input.test.ts`, `tests/unit/validate.test.ts` | Unit tests |
| `tests/db/helpers.ts` | Adds `staffClinic()` and `dropStaffClinic()` |
| `tests/db/appointment-actions.test.ts`, `tests/db/dashboard.test.ts`, `tests/db/patients.test.ts`, `tests/db/clinic-settings.test.ts` | Database tests (real SQL functions, texts in log mode, clinic isolation) |

## Tasks

1. Dashboard shell and navigation
2. Staff status changes and patient texts
3. Requests page and appointment actions
4. Schedule day view
5. Open times, Move, and manual booking services
6. Patients: search, detail, edit, delete
7. New appointment and Move screens
8. Settings validation and services
9. Settings screens
10. Verify the deliverable end to end

---

### Task 1: Dashboard shell and navigation

**Files:**
- Modify: `src/lib/supabase/server.ts`, `src/app/globals.css`
- Create: `src/app/app/layout.tsx`, `src/app/app/AppNav.tsx`
- Replace: `src/app/app/page.tsx` (Plan 2's interim home)

**Interfaces:**
- Consumes: `signedInStaff()` from `@/lib/supabase/server`; `redirect` and `usePathname` from `next/navigation`.
- Produces:
  - `type Staff = { db: SupabaseClient; userId: string; clinicId: string }` and `requireStaff(): Promise<Staff>` from `@/lib/supabase/server` (redirects to `/login` without a session and to `/onboarding` without a clinic)
  - The `/app` layout with the clinic name, a "Booking page" link, and `AppNav` (Requests with a pending badge, Schedule, New, Patients, Settings)
  - `/app` redirects to `/app/requests`
  - CSS classes: `.app-shell`, `.app-top`, `.app-clinic`, `.app-nav`, `.nav-item` (`.on`), `.nav-badge`, `.app-main`, `.page-head`, `.appt` (`.when`, `.who`, `.what`), `.chip-row`, `.action-row`, `.btn-danger`, `.settings-section`; `.btn` gets `min-height: 44px`

The layout runs on navigation between dashboard pages, but a Server Action does not pass through it, so every page and every action still calls `requireStaff()` itself. The proxy already guards `/app/:path*`.

- [ ] **Step 1: Add `Staff` and `requireStaff`**

In `src/lib/supabase/server.ts`, replace the imports at the top:

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
```

with:

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
```

Then append to the end of the file:

```ts
/** A signed-in staff member with a clinic. Services take this and query through `db`, so RLS applies. */
export type Staff = { db: SupabaseClient; userId: string; clinicId: string };

/**
 * For dashboard pages and Server Actions: visitors without a session go to log in, accounts without
 * a clinic go to onboarding. Call it outside try blocks, because redirect throws.
 */
export async function requireStaff(): Promise<Staff> {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId) redirect("/onboarding");
  return { db: staff.db, userId: staff.userId, clinicId: staff.clinicId };
}
```

- [ ] **Step 2: Add the shell styles**

In `src/app/globals.css`, replace:

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
```

with:

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  gap: 8px;
```

Then replace:

```css
.screen-in {
  animation: fadeUp 0.25s ease;
}
```

with:

```css
/* ---------- dashboard shell ---------- */
.app-shell {
  min-height: 100dvh;
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
}
.app-top {
  max-width: 880px;
  margin: 0 auto;
  padding: 14px 16px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.app-clinic {
  font-weight: 700;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Phones: a bottom tab bar within thumb reach. Wider screens: a sticky top bar (media query below). */
.app-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  background: #fff;
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 56px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}
.nav-item.on {
  color: var(--primary-strong);
  box-shadow: inset 0 3px 0 var(--primary);
}
.nav-badge {
  position: absolute;
  top: 5px;
  right: 6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
  font-variant-numeric: tabular-nums;
}
.app-main {
  max-width: 880px;
  margin: 0 auto;
  padding: 10px 16px 32px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.page-head h1 {
  font-size: 21px;
  font-weight: 700;
}
.appt {
  padding: 16px 18px;
  margin-bottom: 12px;
}
.appt .when {
  font-family: var(--font-poppins), "Poppins", sans-serif;
  font-weight: 700;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.appt .who {
  font-weight: 600;
  font-size: 15px;
  margin-top: 2px;
}
.appt .what {
  color: var(--text-2);
  font-size: 13px;
  margin-top: 2px;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.btn-danger {
  border: 1px solid #f1c4bf;
  background: #fff;
  color: var(--red-deep);
}
.btn-danger:hover {
  background: var(--red-soft);
}
.settings-section {
  margin-bottom: 16px;
}
.settings-section h2 {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 4px;
}
@media (min-width: 768px) {
  .app-shell {
    padding-bottom: 0;
  }
  .app-nav {
    position: sticky;
    top: 0;
    bottom: auto;
    display: flex;
    justify-content: center;
    gap: 4px;
    border-top: none;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0;
  }
  .nav-item {
    padding: 0 18px;
    min-height: 48px;
    font-size: 13.5px;
  }
  .nav-item.on {
    box-shadow: inset 0 -3px 0 var(--primary);
  }
  .nav-badge {
    position: static;
  }
}

.screen-in {
  animation: fadeUp 0.25s ease;
}
```

- [ ] **Step 3: Write the navigation**

Create `src/app/app/AppNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app/requests", label: "Requests" },
  { href: "/app/schedule", label: "Schedule" },
  { href: "/app/new", label: "New" },
  { href: "/app/patients", label: "Patients" },
  { href: "/app/settings", label: "Settings" },
];

/** Bottom tab bar on phones, top bar on wider screens. The current page is marked with aria-current, not colour alone. */
export default function AppNav({ pending }: { pending: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Dashboard" className="app-nav">
      {ITEMS.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item${active ? " on" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.href === "/app/requests" && pending > 0 && (
              <span className="nav-badge">
                {pending > 99 ? "99+" : pending}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Write the layout and replace the interim home**

Create `src/app/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import AppNav from "./AppNav";
import { requireStaff } from "@/lib/supabase/server";

/** The dashboard shell. Pages and actions still call requireStaff themselves (actions skip layouts). */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const [clinic, pending] = await Promise.all([
    staff.db.from("clinics").select("name, slug").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", staff.clinicId)
      .eq("status", "pending")
      .gt("starts_at", new Date().toISOString())
      .throwOnError(),
  ]);
  const { name, slug } = clinic.data as { name: string; slug: string };

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="app-top">
        <span className="font-display app-clinic">{name}</span>
        <Link href={`/${slug}`} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center">
          Booking page
        </Link>
      </header>
      <AppNav pending={pending.count ?? 0} />
      <main id="main" className="app-main">
        {children}
      </main>
    </div>
  );
}
```

Replace the whole of `src/app/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/** The dashboard opens on Requests. Log in and the proxy send staff to /app, which lands here. */
export default function AppHome() {
  redirect("/app/requests");
}
```

- [ ] **Step 5: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass (nothing they cover changed), and the build lists `/app`. The nav links return 404 until Tasks 3, 4, 6, 7, and 9 add their pages.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/supabase/server.ts src/app/globals.css src/app/app; git commit -m "feat: add the dashboard shell and navigation" -m "Replaces the interim /app page: /app now redirects to Requests."
```

---

### Task 2: Staff status changes and patient texts

**Files:**
- Modify: `src/lib/validate.ts`, `tests/unit/validate.test.ts`, `tests/db/helpers.ts`
- Create: `src/lib/appointment-actions.ts`
- Test: `tests/db/appointment-actions.test.ts`

**Interfaces:**
- Consumes: `canTransition`, `canMarkAttendance`, `type Status` from `@/lib/appointments`; `sendSms`, `type SmsStatus` from `@/lib/sms/send`; `type Staff` from `@/lib/supabase/server`; `formatDate`, `formatTime` from `@/lib/time`; `cleanText`, `LIMITS` from `@/lib/validate`; SQL `set_appointment_status(p_id, p_from, p_to, p_actor, p_user_id, p_reason) returns boolean` (security invoker, so RLS applies).
- Produces:
  - `isUuid(value: unknown): value is string` from `@/lib/validate`
  - From `@/lib/appointment-actions` (server only): `type StaffTarget = "confirmed" | "declined" | "cancelled" | "completed" | "no_show"`, `type ActionResult = { ok: true; text: SmsStatus | "none" } | { ok: false; error: string }`, `MESSAGES` (`generic`, `gone`, `changed`, `notNow`, `overlap`), `changeStatus(staff: Staff, id: string, to: StaffTarget, reason: string, now: Date): Promise<ActionResult>`
  - Internal helpers reused by Task 5: `logFailure`, `loadRow`, `showsDentist`, `textPatient`, `rowText`, `type Row`, `type PatientText`
  - From `tests/db/helpers.ts`: `staffClinic(): Promise<StaffSeed>`, `type StaffSeed = { staff: Staff-like; seed: { clinic; dentist; patient }; procedures }`, `dropStaffClinic(s: StaffSeed): Promise<void>`

Rules (spec 9.2): staff may approve or decline a pending request, cancel a confirmed visit, and set Completed or No-show once the start time has passed (and switch between them). Approving a request whose time has passed is refused (it will expire). Texts: approve sends `confirmed`, decline sends `declined` with the reason, cancel sends `cancelled` with the reason; attendance sends nothing.

- [ ] **Step 1: Add `isUuid` with a test**

In `tests/unit/validate.test.ts`, replace the import line:

```ts
import { cleanBirthday, cleanEmail, cleanText, passwordProblem, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";
```

with:

```ts
import { cleanBirthday, cleanEmail, cleanText, isUuid, passwordProblem, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";
```

and append to the end of the file:

```ts
describe("isUuid", () => {
  it("accepts uuids in either case", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E2F-8B1A-0C9D8E7F6A5B")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b,x")).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
```

In `src/lib/validate.ts`, replace:

```ts
  hmo: 60,
  address: 200,
} as const;
```

with:

```ts
  hmo: 60,
  address: 200,
  mapsUrl: 300,
  timeOffNote: 100,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checked before an id reaches a query, so a bad id reads as "not found" instead of a database error. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
```

Run: `npx vitest run tests/unit/validate.test.ts`
Expected: PASS.

- [ ] **Step 2: Add a staff clinic to the database test helpers**

Append to `tests/db/helpers.ts`:

```ts
/**
 * A clinic made through create_clinic by a signed-in staff user, so `staff.db` acts under RLS exactly
 * like the dashboard: one dentist ("Dr. Ana Reyes", short name "Dr. Reyes") working 9:00 to 17:00 every
 * day, procedures Cleaning (60) and Consultation (30), and one patient with a mobile.
 */
export async function staffClinic() {
  const user = await signedInUser();
  const { data: clinicId } = await user.db
    .rpc("create_clinic", {
      p: {
        name: "Staff Clinic",
        sms_name: "Staff Clinic",
        slug: `st-${rand()}`,
        mobile: "+639170000002",
        address: "Makati",
        dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
        hours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })),
        procedures: [
          { name: "Consultation", minutes: 30 },
          { name: "Cleaning", minutes: 60 },
        ],
      },
    })
    .throwOnError();
  const db = adminDb();
  const { data: clinic } = await db.from("clinics").select("*").eq("id", clinicId).single().throwOnError();
  const { data: dentist } = await db.from("dentists").select("*").eq("clinic_id", clinicId).single().throwOnError();
  const { data: procedures } = await db.from("procedures").select("*").eq("clinic_id", clinicId).order("name").throwOnError();
  const { data: patient } = await db
    .from("patients")
    .insert({
      clinic_id: clinicId,
      first_name: "Ana",
      last_name: "Cruz",
      mobile: `+63917${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
    })
    .select()
    .single()
    .throwOnError();
  return {
    staff: { db: user.db, userId: user.userId, clinicId: clinicId as string },
    seed: { clinic, dentist, patient },
    procedures: procedures as { id: string; name: string; duration_minutes: number }[],
  };
}

export type StaffSeed = Awaited<ReturnType<typeof staffClinic>>;

export async function dropStaffClinic(s: StaffSeed) {
  await deleteClinic(s.staff.clinicId);
  await deleteUser(s.staff.userId);
}
```

- [ ] **Step 3: Write the failing database test**

Create `tests/db/appointment-actions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeStatus, MESSAGES } from "@/lib/appointment-actions";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

process.env.SMS_MODE = "log";
process.env.APP_URL = "https://brightsmile.ph";
const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;
let n = 0;

/** A fresh appointment in its own half hour (16 per day), in the future or in the past. */
async function book(s: StaffSeed, status: string, when: "future" | "past" = "future", patientId?: string) {
  const k = n++;
  const day = when === "future" ? addDays(today, 3 + Math.floor(k / 16)) : addDays(today, -1 - Math.floor(k / 16));
  const start = manilaInstant(day, 540 + 30 * (k % 16));
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  const { data } = await db
    .from("appointments")
    .insert({ ...row, patient_id: patientId ?? row.patient_id })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

async function current(id: string) {
  const { data } = await db.from("appointments").select("status, status_reason").eq("id", id).single().throwOnError();
  return data as { status: string; status_reason: string | null };
}

async function texts(id: string) {
  const { data } = await db.from("sms_log").select("kind, body, status").eq("appointment_id", id).order("id").throwOnError();
  return data as { kind: string; body: string; status: string }[];
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("changeStatus", () => {
  it("approves a request and texts the confirmation without the dentist (one dentist)", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(a.staff, id, "confirmed", "", new Date())).toEqual({ ok: true, text: "logged" });
    expect((await current(id)).status).toBe("confirmed");
    const [text] = await texts(id);
    expect(text.kind).toBe("confirmed");
    expect(text.body).toContain("Staff Clinic: Ana's visit on");
    expect(text.body).toContain("is confirmed. View or cancel: https://");
    expect(text.body).not.toContain(" with ");
  });

  it("declines with a reason and puts the reason in the text", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(a.staff, id, "declined", "Dentist unavailable", new Date())).toEqual({ ok: true, text: "logged" });
    expect(await current(id)).toEqual({ status: "declined", status_reason: "Dentist unavailable" });
    const [text] = await texts(id);
    expect(text.kind).toBe("declined");
    expect(text.body).toContain("Dentist unavailable. Rebook: https://");
  });

  it("refuses a reason over 36 characters and changes nothing", async () => {
    const id = await book(a, "pending");
    const result = await changeStatus(a.staff, id, "declined", "x".repeat(37), new Date());
    expect(result.ok).toBe(false);
    expect((await current(id)).status).toBe("pending");
    expect(await texts(id)).toEqual([]);
  });

  it("cancels a confirmed visit and texts the patient", async () => {
    const id = await book(a, "confirmed");
    expect(await changeStatus(a.staff, id, "cancelled", "Please call the clinic", new Date())).toEqual({ ok: true, text: "logged" });
    expect((await current(id)).status).toBe("cancelled");
    expect((await texts(id)).map((t) => t.kind)).toEqual(["cancelled"]);
  });

  it("refuses changes the status table does not allow", async () => {
    const pending = await book(a, "pending");
    expect(await changeStatus(a.staff, pending, "cancelled", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    expect(await changeStatus(a.staff, pending, "completed", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    const confirmed = await book(a, "confirmed");
    expect(await changeStatus(a.staff, confirmed, "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    expect(await texts(pending)).toEqual([]);
    expect(await texts(confirmed)).toEqual([]);
  });

  it("refuses to approve a request whose time has passed", async () => {
    const id = await book(a, "pending", "past");
    const result = await changeStatus(a.staff, id, "confirmed", "", new Date());
    expect(result.ok).toBe(false);
    expect((await current(id)).status).toBe("pending");
  });

  it("records attendance only after the start, switches it, and sends no text", async () => {
    const upcoming = await book(a, "confirmed");
    expect((await changeStatus(a.staff, upcoming, "completed", "", new Date())).ok).toBe(false);

    const id = await book(a, "confirmed", "past");
    expect(await changeStatus(a.staff, id, "completed", "", new Date())).toEqual({ ok: true, text: "none" });
    expect(await changeStatus(a.staff, id, "no_show", "", new Date())).toEqual({ ok: true, text: "none" });
    expect((await current(id)).status).toBe("no_show");
    expect(await texts(id)).toEqual([]);
  });

  it("changes a double tap once and texts once", async () => {
    const id = await book(a, "pending");
    const results = await Promise.all([
      changeStatus(a.staff, id, "confirmed", "", new Date()),
      changeStatus(a.staff, id, "confirmed", "", new Date()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: MESSAGES.changed }]);
    expect(await texts(id)).toHaveLength(1);
  });

  it("sends nothing to a patient without a mobile", async () => {
    const { data: patient } = await db
      .from("patients")
      .insert({ clinic_id: a.staff.clinicId, first_name: "Lolo", last_name: "Santos", mobile: null })
      .select("id")
      .single()
      .throwOnError();
    const id = await book(a, "pending", "future", patient.id);
    expect(await changeStatus(a.staff, id, "confirmed", "", new Date())).toEqual({ ok: true, text: "none" });
    expect(await texts(id)).toEqual([]);
  });

  it("names the dentist once the clinic has 2 active dentists", async () => {
    const { data: second } = await db
      .from("dentists")
      .insert({ clinic_id: a.staff.clinicId, name: "Dr. Ben Lim", sms_name: "Dr. Lim" })
      .select("id")
      .single()
      .throwOnError();
    try {
      const id = await book(a, "pending");
      await changeStatus(a.staff, id, "confirmed", "", new Date());
      const [text] = await texts(id);
      expect(text.body).toContain(" with Dr. Reyes is confirmed.");
    } finally {
      await db.from("dentists").delete().eq("id", second.id);
    }
  });

  it("lets no one change another clinic's appointment", async () => {
    const id = await book(a, "pending");
    expect(await changeStatus(b.staff, id, "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect(await changeStatus(b.staff, id, "declined", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect((await current(id)).status).toBe("pending");
    expect(await texts(id)).toEqual([]);
  });

  it("treats a malformed id as not found", async () => {
    expect(await changeStatus(a.staff, "not-a-uuid", "confirmed", "", new Date())).toEqual({ ok: false, error: MESSAGES.gone });
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/db/appointment-actions.test.ts`
Expected: FAIL, cannot resolve `@/lib/appointment-actions`.

- [ ] **Step 5: Write the status service**

Create `src/lib/appointment-actions.ts`:

```ts
import "server-only";
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { sendSms, type SmsStatus } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { cleanText, isUuid, LIMITS } from "@/lib/validate";

export type StaffTarget = "confirmed" | "declined" | "cancelled" | "completed" | "no_show";
/** `text` is what happened to the patient's text: "none" when no text was due or there is no mobile. */
export type ActionResult = { ok: true; text: SmsStatus | "none" } | { ok: false; error: string };

export const MESSAGES = {
  generic: "Something went wrong. Please try again.",
  gone: "This appointment no longer exists.",
  changed: "This appointment changed a moment ago. Reload to see it.",
  notNow: "That change isn't possible for this appointment.",
  overlap: "That time overlaps another visit for this dentist. Pick another time.",
} as const;

export type Row = {
  id: string;
  status: Status;
  starts_at: string;
  ends_at: string;
  dentist_id: string;
  manage_token: string;
  patient: { first_name: string; mobile: string | null; anonymized_at: string | null };
  dentist: { sms_name: string };
  clinic: { sms_name: string; slug: string };
};

const ROW =
  "id, status, starts_at, ends_at, dentist_id, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name, slug)";

/** Logs the error message only, never patient details (spec 12). */
export function logFailure(where: string, e: unknown) {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}

/** One appointment of this clinic, or null for a malformed id, another clinic's row, or a deleted one. */
export async function loadRow(staff: Staff, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await staff.db
    .from("appointments")
    .select(ROW)
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Row | null;
}

/** Spec 10.1: texts name the dentist only when the clinic has 2 or more active dentists. */
export async function showsDentist(staff: Staff): Promise<boolean> {
  const { count, error } = await staff.db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", staff.clinicId)
    .eq("active", true);
  if (error) throw error;
  return (count ?? 0) > 1;
}

export type PatientText = {
  kind: "confirmed" | "declined" | "moved" | "cancelled";
  appointmentId: string;
  token: string;
  first: string;
  mobile: string | null;
  clinicSmsName: string;
  slug: string;
  dentist: string | null;
  startsAt: Date;
  reason: string;
};

/** One patient text (spec 10.1). No mobile means no text. sendSms never throws, so a text never fails the action. */
export async function textPatient(staff: Staff, t: PatientText): Promise<SmsStatus | "none"> {
  if (!t.mobile) return "none";
  const app = process.env.APP_URL ?? "http://localhost:3600";
  return sendSms({
    kind: t.kind,
    to: t.mobile,
    clinicId: staff.clinicId,
    appointmentId: t.appointmentId,
    vars: {
      clinic: t.clinicSmsName,
      first: t.first,
      dentist: t.dentist ?? undefined,
      date: formatDate(t.startsAt),
      time: formatTime(t.startsAt),
      reason: t.reason || undefined,
      link: `${app}/a/${t.token}`,
      bookLink: `${app}/${t.slug}`,
    },
  });
}

/** The text for an existing appointment. A deleted (anonymized) patient has no mobile, so gets no text. */
export function rowText(row: Row, kind: PatientText["kind"], dentist: string | null, startsAt: Date, reason = ""): PatientText {
  return {
    kind,
    appointmentId: row.id,
    token: row.manage_token,
    first: row.patient.first_name,
    mobile: row.patient.anonymized_at ? null : row.patient.mobile,
    clinicSmsName: row.clinic.sms_name,
    slug: row.clinic.slug,
    dentist,
    startsAt,
    reason,
  };
}

const TEXT_OF: Partial<Record<StaffTarget, PatientText["kind"]>> = {
  confirmed: "confirmed",
  declined: "declined",
  cancelled: "cancelled",
};

/**
 * Approve, decline, cancel, or record attendance (spec 9.2), then text the patient (spec 10.1).
 * p_from makes the SQL function a compare-and-set, so a double tap or a second device changes it once.
 */
export async function changeStatus(staff: Staff, id: string, to: StaffTarget, reasonInput: string, now: Date): Promise<ActionResult> {
  const reason = cleanText(reasonInput, LIMITS.reason, true);
  if (reason === null) return { ok: false, error: `Keep the reason to ${LIMITS.reason} characters or fewer.` };
  try {
    const [row, dentistShown] = await Promise.all([loadRow(staff, id), showsDentist(staff)]);
    if (!row) return { ok: false, error: MESSAGES.gone };
    const startsAt = new Date(row.starts_at);
    if (row.status === to || !canTransition(row.status, to, "staff")) return { ok: false, error: MESSAGES.notNow };
    const attendance = to === "completed" || to === "no_show";
    if (attendance && !canMarkAttendance({ status: row.status, starts_at: startsAt }, now)) {
      return { ok: false, error: "You can mark this once the visit has started." };
    }
    if (to === "confirmed" && startsAt <= now) {
      return { ok: false, error: "This request's time has passed. Decline it, or add a new appointment." };
    }

    const { data: changed, error } = await staff.db.rpc("set_appointment_status", {
      p_id: row.id,
      p_from: row.status,
      p_to: to,
      p_actor: "staff",
      p_user_id: staff.userId,
      p_reason: attendance ? null : reason || null,
    });
    if (error) throw error;
    if (!changed) return { ok: false, error: MESSAGES.changed };

    const kind = TEXT_OF[to];
    const text = kind
      ? await textPatient(staff, rowText(row, kind, dentistShown ? row.dentist.sms_name : null, startsAt, reason))
      : "none";
    return { ok: true, text };
  } catch (e) {
    logFailure("changeStatus", e);
    return { ok: false, error: MESSAGES.generic };
  }
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run tests/db/appointment-actions.test.ts`
Expected: PASS, 12 tests. The console shows `[sms confirmed]`, `[sms declined]`, and `[sms cancelled]` lines from log mode.

- [ ] **Step 7: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build succeeds.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/validate.ts src/lib/appointment-actions.ts tests/unit/validate.test.ts tests/db/helpers.ts tests/db/appointment-actions.test.ts; git commit -m "feat: add staff status changes with patient texts" -m "Approve, decline, cancel, and attendance go through canTransition and set_appointment_status under RLS, and a failed text never fails the change."
```

---

### Task 3: Requests page and appointment actions

**Files:**
- Create: `src/lib/schedule.ts`, `src/lib/dashboard.ts`, `src/app/app/actions.ts`, `src/app/app/AppointmentActions.tsx`, `src/app/app/requests/page.tsx`
- Test: `tests/unit/schedule.test.ts`, `tests/db/dashboard.test.ts`

**Interfaces:**
- Consumes: `changeStatus`, `type ActionResult`, `type StaffTarget` from `@/lib/appointment-actions`; `requireStaff`, `type Staff`; `type Status` from `@/lib/appointments`; `refresh` from `next/cache`; `localMobile`; `formatDate`, `formatTime`.
- Produces:
  - From `@/lib/schedule` (pure, client-safe): `type StaffAction = "approve" | "decline" | "move" | "cancel" | "completed" | "no_show"`, `STATUS_LABEL: Record<Status, { word: string; chip: string }>`, `actionsFor(status: Status, startsAt: Date, now: Date): StaffAction[]`
  - From `@/lib/dashboard` (server only): `type RequestItem = { id; startsAt; requestedAt; procedures: string[]; dentistName; patientId; first; last; mobile: string | null; returning: boolean; actions: StaffAction[] }`, `loadRequests(staff: Staff, now: Date): Promise<RequestItem[]>`
  - From `src/app/app/actions.ts`: `type Done = { ok: true; notice?: string } | { ok: false; error: string }`, `done(r: ActionResult): Done` (not exported from a `"use server"` file; kept module-private), `setStatus(id: unknown, to: unknown, reason: unknown): Promise<Done>`
  - `AppointmentActions` (`{ id: string; actions: StaffAction[] }`): Approve, Decline (reason step), Move (link to `/app/schedule/move/{id}`), Cancel visit (reason step), Completed, No-show
  - Route `/app/requests`

Requests (spec 5.3) lists pending requests whose time is still ahead, soonest first: patient name (links to the patient), mobile with Call and Text links, procedures, dentist, time, when requested, and a New or Returning badge (Returning means the patient has a completed visit at this clinic). Pending requests whose time has passed stay visible on the Schedule until the daily job (Plan 4) expires them.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/schedule.test.ts`:

```ts
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
```

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL, cannot resolve `@/lib/schedule`.

- [ ] **Step 2: Write the pure schedule rules**

Create `src/lib/schedule.ts`:

```ts
import type { Status } from "@/lib/appointments";

export type StaffAction = "approve" | "decline" | "move" | "cancel" | "completed" | "no_show";

/** Every status carries a word, never colour alone. */
export const STATUS_LABEL: Record<Status, { word: string; chip: string }> = {
  pending: { word: "Pending", chip: "chip-amber" },
  confirmed: { word: "Confirmed", chip: "chip-green" },
  declined: { word: "Declined", chip: "chip-red" },
  cancelled: { word: "Cancelled", chip: "chip-red" },
  completed: { word: "Completed", chip: "chip-blue" },
  no_show: { word: "No-show", chip: "chip-red" },
  expired: { word: "Expired", chip: "chip-gold" },
};

/**
 * The buttons an appointment offers staff (spec 5.3 and 9.2). Matches what changeStatus and
 * moveAppointment accept, so a button never leads to a refusal unless something changed meanwhile.
 */
export function actionsFor(status: Status, startsAt: Date, now: Date): StaffAction[] {
  const started = startsAt <= now;
  switch (status) {
    case "pending":
      return started ? ["decline"] : ["approve", "decline"];
    case "confirmed":
      return started ? ["completed", "no_show"] : ["move", "cancel"];
    case "completed":
      return ["no_show"];
    case "no_show":
      return ["completed"];
    default:
      return [];
  }
}
```

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test**

Create `tests/db/dashboard.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadRequests } from "@/lib/dashboard";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;

async function book(s: StaffSeed, day: string, minutes: number, status: string, patientId?: string) {
  const start = manilaInstant(day, minutes);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  const { data } = await db
    .from("appointments")
    .insert({ ...row, patient_id: patientId ?? row.patient_id })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("loadRequests", () => {
  it("lists upcoming pending requests soonest first, with New and Returning", async () => {
    const { data: newcomer } = await db
      .from("patients")
      .insert({ clinic_id: a.staff.clinicId, first_name: "Bea", last_name: "Lim", mobile: null })
      .select("id")
      .single()
      .throwOnError();
    await book(a, addDays(today, -3), 540, "completed"); // Ana has visited before
    const later = await book(a, addDays(today, 5), 600, "pending", newcomer.id);
    const sooner = await book(a, addDays(today, 4), 540, "pending");
    await book(a, addDays(today, -1), 540, "pending"); // its time passed
    await book(a, addDays(today, 4), 660, "confirmed");

    const items = await loadRequests(a.staff, new Date());
    expect(items.map((i) => i.id)).toEqual([sooner, later]);
    expect(items[0]).toMatchObject({
      first: "Ana",
      last: "Cruz",
      mobile: a.seed.patient.mobile,
      dentistName: "Dr. Ana Reyes",
      procedures: ["Consultation"],
      returning: true,
      actions: ["approve", "decline"],
    });
    expect(items[1]).toMatchObject({ first: "Bea", mobile: null, returning: false });
  });

  it("shows another clinic nothing", async () => {
    expect(await loadRequests(b.staff, new Date())).toEqual([]);
  });
});
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: FAIL, cannot resolve `@/lib/dashboard`.

- [ ] **Step 4: Write the requests loader**

Create `src/lib/dashboard.ts`:

```ts
import "server-only";
import { actionsFor, type StaffAction } from "@/lib/schedule";
import type { Staff } from "@/lib/supabase/server";

export type RequestItem = {
  id: string;
  startsAt: string;
  requestedAt: string;
  procedures: string[];
  dentistName: string;
  patientId: string;
  first: string;
  last: string;
  mobile: string | null;
  returning: boolean;
  actions: StaffAction[];
};

type RequestRow = {
  id: string;
  starts_at: string;
  created_at: string;
  procedure_names: string[];
  patient_id: string;
  dentist: { name: string };
  patient: { first_name: string; last_name: string; mobile: string | null };
};

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
  const rows = data as unknown as RequestRow[];

  const visited = new Set<string>();
  const patientIds = [...new Set(rows.map((r) => r.patient_id))];
  if (patientIds.length > 0) {
    const { data: done } = await staff.db
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", staff.clinicId)
      .eq("status", "completed")
      .in("patient_id", patientIds)
      .throwOnError();
    for (const d of done as { patient_id: string }[]) visited.add(d.patient_id);
  }

  return rows.map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    requestedAt: r.created_at,
    procedures: r.procedure_names,
    dentistName: r.dentist.name,
    patientId: r.patient_id,
    first: r.patient.first_name,
    last: r.patient.last_name,
    mobile: r.patient.mobile,
    returning: visited.has(r.patient_id),
    actions: actionsFor("pending", new Date(r.starts_at), now),
  }));
}
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the status Server Action**

Create `src/app/app/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import { changeStatus, type ActionResult, type StaffTarget } from "@/lib/appointment-actions";
import { requireStaff } from "@/lib/supabase/server";

export type Done = { ok: true; notice?: string } | { ok: false; error: string };

const TARGETS: StaffTarget[] = ["confirmed", "declined", "cancelled", "completed", "no_show"];

/** Spec 13: a failed text never fails the action, but staff are told so they can call. */
function done(r: ActionResult): Done {
  if (!r.ok) return r;
  return r.text === "failed" ? { ok: true, notice: "Saved. The text was not delivered. Please call the patient." } : { ok: true };
}

/** Approve, decline, cancel, completed, or no-show. Arguments are untrusted (spec 12). */
export async function setStatus(id: unknown, to: unknown, reason: unknown): Promise<Done> {
  const staff = await requireStaff();
  if (!TARGETS.includes(to as StaffTarget)) return { ok: false, error: "That change isn't possible for this appointment." };
  const result = await changeStatus(staff, String(id), to as StaffTarget, typeof reason === "string" ? reason : "", new Date());
  if (result.ok) refresh();
  return done(result);
}
```

- [ ] **Step 6: Write the action buttons**

Create `src/app/app/AppointmentActions.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StaffAction } from "@/lib/schedule";
import { setStatus, type Done } from "./actions";

type Target = "confirmed" | "declined" | "cancelled" | "completed" | "no_show";

// Spec 5.3 quick picks. Each fits the 36 character reason limit.
const REASONS = ["Dentist unavailable", "Please call the clinic"];

/** Staff buttons for one appointment. Decline and Cancel ask for an optional reason first. */
export default function AppointmentActions({ id, actions }: { id: string; actions: StaffAction[] }) {
  const [asking, setAsking] = useState<"declined" | "cancelled" | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  if (actions.length === 0) return null;

  function run(to: Target, why = "") {
    startTransition(async () => {
      const r = await setStatus(id, to, why);
      setResult(r);
      if (r.ok) {
        setAsking(null);
        setReason("");
      }
    });
  }

  const message = result ? (result.ok ? result.notice : result.error) : undefined;
  const feedback = message && (
    <p className={result?.ok ? "f-hint" : "field-err"} role={result?.ok ? "status" : "alert"}>
      {message}
    </p>
  );

  if (asking) {
    const verb = asking === "declined" ? "Decline" : "Cancel visit";
    return (
      <div className="note-box warn mt-3" role="group" aria-label={`${verb}: reason`}>
        <label className="block">
          <span className="f-label">
            Reason for the patient <span className="f-optional">Optional</span>
          </span>
          <input className="f-input" maxLength={36} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="chip-row">
          {REASONS.map((r) => (
            <button key={r} type="button" className="btn btn-ghost" onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="action-row">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setAsking(null)}>
            Back
          </button>
          <button type="button" className="btn btn-danger flex-1" disabled={pending} onClick={() => run(asking, reason)}>
            {pending ? "Saving..." : `${verb} and text the patient`}
          </button>
        </div>
        {feedback}
      </div>
    );
  }

  return (
    <div>
      <div className="action-row">
        {actions.includes("approve") && (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run("confirmed")}>
            {pending ? "Saving..." : "Approve"}
          </button>
        )}
        {actions.includes("decline") && (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => setAsking("declined")}>
            Decline
          </button>
        )}
        {actions.includes("move") && (
          <Link href={`/app/schedule/move/${id}`} className="btn btn-ghost">
            Move
          </Link>
        )}
        {actions.includes("cancel") && (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => setAsking("cancelled")}>
            Cancel visit
          </button>
        )}
        {actions.includes("completed") && (
          <button type="button" className="btn btn-soft" disabled={pending} onClick={() => run("completed")}>
            Completed
          </button>
        )}
        {actions.includes("no_show") && (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run("no_show")}>
            No-show
          </button>
        )}
      </div>
      {feedback}
    </div>
  );
}
```

- [ ] **Step 7: Write the Requests page**

Create `src/app/app/requests/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import AppointmentActions from "../AppointmentActions";
import { loadRequests } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Requests" };

/** Spec 5.3: pending requests, soonest first, each with Approve and Decline. */
export default async function RequestsPage() {
  const staff = await requireStaff();
  const requests = await loadRequests(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Requests</h1>
        <span className="f-hint">{requests.length === 1 ? "1 waiting" : `${requests.length} waiting`}</span>
      </div>

      {requests.length === 0 && (
        <div className="card empty-note">No requests waiting. New ones from your booking page appear here.</div>
      )}

      {requests.map((r) => {
        const start = new Date(r.startsAt);
        const requested = new Date(r.requestedAt);
        return (
          <article key={r.id} className="card appt">
            <p className="when">
              {formatDate(start)}, {formatTime(start)}
            </p>
            <p className="who">
              <Link href={`/app/patients/${r.patientId}`} className="hover:underline">
                {r.first} {r.last}
              </Link>
            </p>
            <p className="what">
              {r.procedures.join(", ")} with {r.dentistName}
            </p>
            <p className="what">
              Requested {formatDate(requested)}, {formatTime(requested)}
            </p>
            <div className="chip-row">
              <span className="chip chip-amber">Pending</span>
              <span className={`chip ${r.returning ? "chip-blue" : "chip-brand"}`}>{r.returning ? "Returning" : "New"}</span>
            </div>
            {r.mobile && (
              <div className="flex flex-wrap gap-5">
                <a href={`tel:${r.mobile}`} className="link inline-flex min-h-11 items-center">
                  Call {localMobile(r.mobile)}
                </a>
                <a href={`sms:${r.mobile}`} className="link inline-flex min-h-11 items-center">
                  Text
                </a>
              </div>
            )}
            <AppointmentActions id={r.id} actions={r.actions} />
          </article>
        );
      })}
    </>
  );
}
```

- [ ] **Step 8: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build lists `/app/requests`.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/schedule.ts src/lib/dashboard.ts src/app/app/actions.ts src/app/app/AppointmentActions.tsx src/app/app/requests tests/unit/schedule.test.ts tests/db/dashboard.test.ts; git commit -m "feat: add the Requests page with approve and decline"
```

---

### Task 4: Schedule day view

**Files:**
- Modify: `src/lib/schedule.ts`, `src/lib/dashboard.ts`, `tests/unit/schedule.test.ts`, `tests/db/dashboard.test.ts`
- Create: `src/app/app/schedule/page.tsx`

**Interfaces:**
- Consumes: `withinHours`, `type Block`, `type Busy` from `@/lib/slots`; `addDays`, `manilaDate`, `manilaInstant`, `parseClock`, `formatDate`, `formatTime` from `@/lib/time`; `isUuid`; `AppointmentActions`; `Form` from `next/form`.
- Produces:
  - From `@/lib/schedule`: `type SmsLogRow = { id: number; appointment_id: string; kind: string; status: string }`, `failedTexts(rows: SmsLogRow[]): Set<string>`, `parseDay(value: unknown, today: string): string`, `type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string }`, `hoursByDentist(rows: HoursRow[]): Map<string, Block[][]>`, `type DayRow`, `type ScheduleItem = { id; status: Status; startsAt; endsAt; procedures: string[]; dentistId; patientId; patientName; mobile: string | null; outsideHours: boolean; textFailed: boolean; actions: StaffAction[] }`, `assembleDay(rows: DayRow[], ctx: { hours: Map<string, Block[][]>; timeOff: Map<string, Busy[]>; failed: Set<string>; now: Date }): ScheduleItem[]`
  - From `@/lib/dashboard`: `type DayView = { dentists: { id: string; name: string; active: boolean }[]; items: ScheduleItem[] }`, `loadDay(staff: Staff, date: string, dentistId: string | null, now: Date): Promise<DayView>`
  - Route `/app/schedule?date=YYYY-MM-DD&dentist={id}`

The day view (spec 5.3) lists every appointment starting that Manila day except expired ones, in time order, including pending requests (they hold their time) and cancelled or declined ones (so a "Text not delivered" flag on a cancel or decline text stays visible). "Outside hours" is set on a pending or confirmed visit that is not inside one working block of its dentist or overlaps that dentist's time off (spec 13). The dentist filter shows when the clinic has 2 or more active dentists. Previous and next day are links; the native date input jumps through a GET `<Form>`.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/schedule.test.ts`, replace the import lines:

```ts
import { describe, expect, it } from "vitest";
import { actionsFor, STATUS_LABEL } from "@/lib/schedule";
```

with:

```ts
import { describe, expect, it } from "vitest";
import { actionsFor, assembleDay, failedTexts, hoursByDentist, parseDay, STATUS_LABEL, type DayRow } from "@/lib/schedule";
import { manilaInstant } from "@/lib/time";
```

and append to the end of the file:

```ts
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
```

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL, `assembleDay` (and the other new names) are not exported.

- [ ] **Step 2: Add the schedule assembly**

In `src/lib/schedule.ts`, replace the first line:

```ts
import type { Status } from "@/lib/appointments";
```

with:

```ts
import type { Status } from "@/lib/appointments";
import { withinHours, type Block, type Busy } from "@/lib/slots";
import { parseClock } from "@/lib/time";
```

and append to the end of the file:

```ts
// Texts to the patient. Clinic alerts (request_alert, patient_cancel_alert) also carry an appointment id but don't count.
const PATIENT_TEXTS = new Set(["confirmed", "declined", "moved", "cancelled", "reminder"]);

export type SmsLogRow = { id: number; appointment_id: string; kind: string; status: string };

/** Spec 13: appointments whose latest patient text failed, so staff know to call. */
export function failedTexts(rows: SmsLogRow[]): Set<string> {
  const latest = new Map<string, SmsLogRow>();
  for (const r of rows) {
    if (!PATIENT_TEXTS.has(r.kind)) continue;
    const seen = latest.get(r.appointment_id);
    if (!seen || r.id > seen.id) latest.set(r.appointment_id, r);
  }
  return new Set([...latest.values()].filter((r) => r.status === "failed").map((r) => r.appointment_id));
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** The schedule's date from the URL, or today when it is missing or not a real date. */
export function parseDay(value: unknown, today: string): string {
  if (typeof value !== "string" || !DATE.test(value)) return today;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : today;
}

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
  patient: { first_name: string; last_name: string; mobile: string | null };
};

export type ScheduleItem = {
  id: string;
  status: Status;
  startsAt: string;
  endsAt: string;
  procedures: string[];
  dentistId: string;
  patientId: string;
  patientName: string;
  mobile: string | null;
  outsideHours: boolean;
  textFailed: boolean;
  actions: StaffAction[];
};

const NO_HOURS: Block[][] = Array.from({ length: 7 }, () => []);

/**
 * One day's appointments in time order with their flags (spec 5.3 and 13). "Outside hours" applies to
 * pending and confirmed visits that are not inside one working block, or that overlap time off.
 */
export function assembleDay(
  rows: DayRow[],
  ctx: { hours: Map<string, Block[][]>; timeOff: Map<string, Busy[]>; failed: Set<string>; now: Date },
): ScheduleItem[] {
  return rows
    .map((r) => ({ r, start: new Date(r.starts_at), end: new Date(r.ends_at) }))
    .sort((x, y) => x.start.getTime() - y.start.getTime())
    .map(({ r, start, end }) => {
      const active = r.status === "pending" || r.status === "confirmed";
      const inTimeOff = (ctx.timeOff.get(r.dentist_id) ?? []).some((t) => t.start < end && start < t.end);
      const outside = !withinHours(start, end, ctx.hours.get(r.dentist_id) ?? NO_HOURS) || inTimeOff;
      return {
        id: r.id,
        status: r.status,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        procedures: r.procedure_names,
        dentistId: r.dentist_id,
        patientId: r.patient_id,
        patientName: `${r.patient.first_name} ${r.patient.last_name}`,
        mobile: r.patient.mobile,
        outsideHours: active && outside,
        textFailed: ctx.failed.has(r.id),
        actions: actionsFor(r.status, start, ctx.now),
      };
    });
}
```

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test**

In `tests/db/dashboard.test.ts`, replace:

```ts
import { loadRequests } from "@/lib/dashboard";
```

with:

```ts
import { loadDay, loadRequests } from "@/lib/dashboard";
```

and append to the end of the file:

```ts
describe("loadDay", () => {
  const day = addDays(today, 6);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ids.fine = await book(a, day, 540, "confirmed");
    ids.pending = await book(a, day, 600, "pending");
    ids.cancelled = await book(a, day, 660, "cancelled");
    ids.expired = await book(a, day, 720, "expired");
    ids.inTimeOff = await book(a, day, 840, "confirmed");
    ids.evening = await book(a, day, 1080, "confirmed");
    await db
      .from("time_off")
      .insert({
        clinic_id: a.staff.clinicId,
        dentist_id: a.seed.dentist.id,
        starts_at: manilaInstant(day, 840).toISOString(),
        ends_at: manilaInstant(day, 900).toISOString(),
      })
      .throwOnError();
    const log = (appointment_id: string, kind: string, status: string) => ({
      clinic_id: a.staff.clinicId,
      appointment_id,
      to_mobile: "+639171112222",
      kind,
      body: "test",
      credits: 0,
      status,
    });
    await db
      .from("sms_log")
      .insert([log(ids.cancelled, "cancelled", "failed"), log(ids.pending, "request_alert", "failed")])
      .throwOnError();
  });

  it("lists the day in time order without expired visits, with flags", async () => {
    const { items, dentists } = await loadDay(a.staff, day, null, new Date());
    expect(dentists).toEqual([{ id: a.seed.dentist.id, name: "Dr. Ana Reyes", active: true }]);
    expect(items.map((i) => [i.id, i.status, i.outsideHours, i.textFailed])).toEqual([
      [ids.fine, "confirmed", false, false],
      [ids.pending, "pending", false, false],
      [ids.cancelled, "cancelled", false, true],
      [ids.inTimeOff, "confirmed", true, false],
      [ids.evening, "confirmed", true, false],
    ]);
    expect(items[1].actions).toEqual(["approve", "decline"]);
  });

  it("filters by dentist", async () => {
    expect((await loadDay(a.staff, day, a.seed.dentist.id, new Date())).items).toHaveLength(5);
    expect((await loadDay(a.staff, day, b.seed.dentist.id, new Date())).items).toEqual([]);
  });

  it("shows another clinic nothing of this clinic", async () => {
    const view = await loadDay(b.staff, day, null, new Date());
    expect(view.items).toEqual([]);
    expect(view.dentists.map((d) => d.id)).toEqual([b.seed.dentist.id]);
  });
});
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: FAIL, `loadDay` is not exported.

- [ ] **Step 4: Write the day loader**

In `src/lib/dashboard.ts`, replace:

```ts
import "server-only";
import { actionsFor, type StaffAction } from "@/lib/schedule";
import type { Staff } from "@/lib/supabase/server";
```

with:

```ts
import "server-only";
import {
  actionsFor,
  assembleDay,
  failedTexts,
  hoursByDentist,
  type DayRow,
  type HoursRow,
  type ScheduleItem,
  type SmsLogRow,
  type StaffAction,
} from "@/lib/schedule";
import type { Busy } from "@/lib/slots";
import type { Staff } from "@/lib/supabase/server";
import { addDays, manilaInstant } from "@/lib/time";
```

and append to the end of the file:

```ts
export type DayView = { dentists: { id: string; name: string; active: boolean }[]; items: ScheduleItem[] };

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

  const [dentists, hours, timeOff, list] = await Promise.all([
    staff.db.from("dentists").select("id, name, active").eq("clinic_id", staff.clinicId).order("created_at").order("name").throwOnError(),
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
    staff.db
      .from("time_off")
      .select("dentist_id, starts_at, ends_at")
      .eq("clinic_id", staff.clinicId)
      .lt("starts_at", to)
      .gt("ends_at", from)
      .throwOnError(),
    appointments.throwOnError(),
  ]);
  const rows = list.data as unknown as DayRow[];

  let logs: SmsLogRow[] = [];
  if (rows.length > 0) {
    const { data } = await staff.db
      .from("sms_log")
      .select("id, appointment_id, kind, status")
      .eq("clinic_id", staff.clinicId)
      .in("appointment_id", rows.map((r) => r.id))
      .throwOnError();
    logs = data as SmsLogRow[];
  }

  const off = new Map<string, Busy[]>();
  for (const t of timeOff.data as { dentist_id: string; starts_at: string; ends_at: string }[]) {
    off.set(t.dentist_id, [...(off.get(t.dentist_id) ?? []), { start: new Date(t.starts_at), end: new Date(t.ends_at) }]);
  }

  return {
    dentists: dentists.data as DayView["dentists"],
    items: assembleDay(rows, { hours: hoursByDentist(hours.data as HoursRow[]), timeOff: off, failed: failedTexts(logs), now }),
  };
}
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the Schedule page**

Create `src/app/app/schedule/page.tsx`:

```tsx
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import AppointmentActions from "../AppointmentActions";
import { loadDay } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { parseDay, STATUS_LABEL } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { addDays, formatDate, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "Schedule" };

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

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Schedule</h1>
        <Link href="/app/new" className="btn btn-primary">
          New appointment
        </Link>
      </div>

      <div className="card card-pad mb-3">
        <div className="flex items-center gap-2">
          <Link href={href(addDays(date, -1))} className="btn btn-ghost" aria-label="Previous day">
            Prev
          </Link>
          <p className="flex-1 text-center font-display text-[16px] font-bold" aria-live="polite">
            {formatDate(manilaInstant(date, 0))}
            {date === today && " (today)"}
          </p>
          <Link href={href(addDays(date, 1))} className="btn btn-ghost" aria-label="Next day">
            Next
          </Link>
        </div>
        <Form action="/app/schedule" className="mt-3 flex gap-2">
          <input key={date} type="date" name="date" defaultValue={date} className="f-input" aria-label="Jump to a date" />
          {dentistId && <input type="hidden" name="dentist" value={dentistId} />}
          <button type="submit" className="btn btn-soft">
            Go
          </button>
        </Form>
        {active.length > 1 && (
          <div className="chip-row mt-3" role="group" aria-label="Dentist">
            <Link href={href(date, null)} className={`btn ${dentistId ? "btn-ghost" : "btn-primary"}`} aria-current={dentistId ? undefined : "true"}>
              All dentists
            </Link>
            {active.map((d) => (
              <Link
                key={d.id}
                href={href(date, d.id)}
                className={`btn ${dentistId === d.id ? "btn-primary" : "btn-ghost"}`}
                aria-current={dentistId === d.id ? "true" : undefined}
              >
                {d.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 && <div className="card empty-note">Nothing booked on this day.</div>}

      {items.map((item) => {
        const label = STATUS_LABEL[item.status];
        return (
          <article key={item.id} className="card appt">
            <p className="when">
              {formatTime(new Date(item.startsAt))} to {formatTime(new Date(item.endsAt))}
            </p>
            <p className="who">
              <Link href={`/app/patients/${item.patientId}`} className="hover:underline">
                {item.patientName}
              </Link>
            </p>
            <p className="what">
              {item.procedures.join(", ")}
              {active.length > 1 && ` with ${nameOf.get(item.dentistId) ?? "a former dentist"}`}
            </p>
            <div className="chip-row">
              <span className={`chip ${label.chip}`}>{label.word}</span>
              {item.outsideHours && <span className="chip chip-gold">Outside hours</span>}
              {item.textFailed && <span className="chip chip-red">Text not delivered</span>}
            </div>
            {item.textFailed && item.mobile && (
              <a href={`tel:${item.mobile}`} className="link inline-flex min-h-11 items-center">
                Call {localMobile(item.mobile)}
              </a>
            )}
            <AppointmentActions id={item.id} actions={item.actions} />
          </article>
        );
      })}
    </>
  );
}
```

- [ ] **Step 6: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build lists `/app/schedule`.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/schedule.ts src/lib/dashboard.ts src/app/app/schedule tests/unit/schedule.test.ts tests/db/dashboard.test.ts; git commit -m "feat: add the Schedule day view with outside hours and text flags"
```

---

### Task 5: Open times, Move, and manual booking services

**Files:**
- Modify: `src/lib/availability.ts`, `src/lib/dashboard.ts`, `src/lib/appointment-actions.ts`, `tests/db/appointment-actions.test.ts`
- Create: `src/lib/staff-input.ts`
- Test: `tests/unit/staff-input.test.ts`

**Interfaces:**
- Consumes: `openStarts`, `type Busy` from `@/lib/slots`; `newToken` from `@/lib/codes`; `normalizeMobile`; `cleanText`, `cleanBirthday`, `isUuid`, `LIMITS`; SQL `move_appointment(p_id, p_dentist_id, p_starts_at, p_ends_at, p_user_id) returns boolean` (only while `confirmed`; sets `confirmed_at`, clears `reminder_sent_at`, writes a `moved` event) and `create_booking(...)` (17 arguments as in `src/lib/booking.ts`); Task 2's `loadRow`, `showsDentist`, `textPatient`, `rowText`, `logFailure`, `MESSAGES`.
- Produces:
  - `busyBetween(db: SupabaseClient, dentistId: string, from: Date, to: Date): Promise<Busy[]>` exported from `@/lib/availability` (appointments carry their `id`)
  - From `@/lib/staff-input` (pure): `type Saved = { ok: true } | { ok: false; error: string; field?: string }`, `type PatientFields = { first: string; last: string; mobile: string | null; birthday: string | null; hmo: string }`, `parsePatientFields(value: unknown, today: string)`, `type SlotChoice = { dentistId: string; startsAt: Date; custom: boolean }`, `parseSlot(value: unknown): SlotChoice | null`, `type ManualBooking = { patientId: string | null; patient: PatientFields | null; procedureIds: string[]; slot: SlotChoice; sendText: boolean }`, `parseManualBooking(value: unknown, today: string)`
  - From `@/lib/dashboard`: `staffOpenStarts(staff: Staff, q: { dentistId: string; date: string; duration: number; ignoreId?: string }, now: Date): Promise<Date[]>`
  - From `@/lib/appointment-actions`: `moveAppointment(staff: Staff, id: string, slot: unknown, now: Date): Promise<ActionResult>`, `createAppointment(staff: Staff, input: unknown, now: Date): Promise<ActionResult>`

Rules: an open time must still be in `staffOpenStarts` when saved (Move ignores the visit's own time). A custom time may fall outside hours or in time off but must be today or later; the database refuses any overlap (`23P01`). Move keeps the visit's length, works only on a confirmed visit that has not started, and texts `moved`. A manual booking is `confirmed`, `source = 'manual'`, with no consent timestamp; it texts `confirmed` only when "Send confirmation text" is on and the patient has a mobile. A new patient with the same mobile and name as an existing one is matched by `create_booking`; without a mobile a new patient is always created.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/staff-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseManualBooking, parsePatientFields, parseSlot } from "@/lib/staff-input";

const today = "2026-09-25";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("parsePatientFields", () => {
  it("cleans names, makes the mobile optional, and normalizes it", () => {
    expect(parsePatientFields({ first: " Ana ", last: "Cruz", mobile: "0917 123 4567", birthday: "", hmo: "" }, today)).toEqual({
      ok: true,
      value: { first: "Ana", last: "Cruz", mobile: "+639171234567", birthday: null, hmo: "" },
    });
    expect(parsePatientFields({ first: "Lolo", last: "Santos", mobile: "  " }, today)).toEqual({
      ok: true,
      value: { first: "Lolo", last: "Santos", mobile: null, birthday: null, hmo: "" },
    });
  });

  it("reports each bad field", () => {
    const result = parsePatientFields({ first: "", last: "x".repeat(51), mobile: "02 8123 4567", birthday: "2999-01-01", hmo: "y".repeat(61) }, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["birthday", "first", "hmo", "last", "mobile"]);
  });
});

describe("parseSlot", () => {
  it("accepts an open or custom time on a whole minute", () => {
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:00.000Z", custom: false })).toEqual({
      dentistId: uuid(1),
      startsAt: new Date("2026-09-28T01:00:00.000Z"),
      custom: false,
    });
  });

  it("rejects anything malformed", () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot({ dentistId: "x", startsAt: "2026-09-28T01:00:00Z", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "soon", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:30Z", custom: false })).toBeNull();
    expect(parseSlot({ dentistId: uuid(1), startsAt: "2026-09-28T01:00:00Z", custom: "yes" })).toBeNull();
  });
});

describe("parseManualBooking", () => {
  const slot = { dentistId: uuid(1), startsAt: "2026-09-28T01:00:00Z", custom: true };

  it("takes an existing patient by id and ignores typed details", () => {
    const result = parseManualBooking({ patientId: uuid(2), procedureIds: [uuid(3)], slot, sendText: true }, today);
    expect(result).toEqual({
      ok: true,
      value: { patientId: uuid(2), patient: null, procedureIds: [uuid(3)], slot: parseSlot(slot), sendText: true },
    });
  });

  it("takes a new patient's details when there is no id, and sendText only when true", () => {
    const result = parseManualBooking({ patient: { first: "Lolo", last: "Santos" }, procedureIds: [uuid(3)], slot, sendText: "yes" }, today);
    expect(result.ok && result.value.patient).toEqual({ first: "Lolo", last: "Santos", mobile: null, birthday: null, hmo: "" });
    expect(result.ok && result.value.sendText).toBe(false);
  });

  it("needs procedures, a time, and a patient", () => {
    const result = parseManualBooking({ procedureIds: [], slot: null }, today);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["first", "last", "procedures", "slot"]);
    const dupes = parseManualBooking({ patientId: uuid(2), procedureIds: [uuid(3), uuid(3)], slot }, today);
    expect(dupes.ok).toBe(false);
    const tooMany = parseManualBooking({ patientId: uuid(2), procedureIds: Array.from({ length: 21 }, (_, i) => uuid(i + 10)), slot }, today);
    expect(tooMany.ok).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/staff-input.test.ts`
Expected: FAIL, cannot resolve `@/lib/staff-input`.

- [ ] **Step 2: Write the staff input parsing**

Create `src/lib/staff-input.ts`:

```ts
import { normalizeMobile } from "@/lib/phone";
import { cleanBirthday, cleanText, isUuid, LIMITS } from "@/lib/validate";

/** What a staff form gets back from a save. */
export type Saved = { ok: true } | { ok: false; error: string; field?: string };

export type PatientFields = { first: string; last: string; mobile: string | null; birthday: string | null; hmo: string };
export type SlotChoice = { dentistId: string; startsAt: Date; custom: boolean };
export type ManualBooking = {
  patientId: string | null;
  patient: PatientFields | null;
  procedureIds: string[];
  slot: SlotChoice;
  sendText: boolean;
};

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

// appointments.procedure_names holds 1 to 20 names.
const MAX_PROCEDURES = 20;

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;

/** Patient details typed by staff (spec 5.3): names required, mobile optional (no mobile means no texts). */
export function parsePatientFields(value: unknown, today: string): Parsed<PatientFields> {
  const v = record(value);
  const errors: Record<string, string> = {};
  const first = cleanText(v.first, LIMITS.personName);
  const last = cleanText(v.last, LIMITS.personName);
  const typedMobile = typeof v.mobile === "string" ? v.mobile.trim() : "";
  const mobile = typedMobile ? normalizeMobile(typedMobile) : null;
  const birthday = cleanBirthday(v.birthday, today);
  const hmo = cleanText(v.hmo, LIMITS.hmo, true);
  if (!first) errors.first = `Enter a first name, up to ${LIMITS.personName} characters.`;
  if (!last) errors.last = `Enter a last name, up to ${LIMITS.personName} characters.`;
  if (typedMobile && !mobile) errors.mobile = "Enter a Philippine mobile number, like 0917 123 4567, or leave it blank.";
  if (birthday === null) errors.birthday = "Use a real past date, or leave this blank.";
  if (hmo === null) errors.hmo = `Keep this under ${LIMITS.hmo} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { first: first!, last: last!, mobile, birthday: birthday || null, hmo: hmo! } };
}

/** A chosen time: an open time from the list or a custom time, on a whole minute. */
export function parseSlot(value: unknown): SlotChoice | null {
  const v = record(value);
  const start = typeof v.startsAt === "string" ? new Date(v.startsAt) : null;
  if (!isUuid(v.dentistId) || !start || Number.isNaN(start.getTime()) || start.getTime() % 60_000 !== 0) return null;
  if (typeof v.custom !== "boolean") return null;
  return { dentistId: v.dentistId, startsAt: start, custom: v.custom };
}

/** New appointment (spec 5.3): an existing patient by id, or a new patient's details; procedures; a time. */
export function parseManualBooking(value: unknown, today: string): Parsed<ManualBooking> {
  const v = record(value);
  const errors: Record<string, string> = {};
  const patientId = isUuid(v.patientId) ? v.patientId : null;
  let patient: PatientFields | null = null;
  if (!patientId) {
    const parsed = parsePatientFields(v.patient, today);
    if (parsed.ok) patient = parsed.value;
    else Object.assign(errors, parsed.errors);
  }
  const ids: unknown[] = Array.isArray(v.procedureIds) ? v.procedureIds : [];
  if (ids.length === 0 || ids.length > MAX_PROCEDURES || !ids.every((id) => isUuid(id)) || new Set(ids).size !== ids.length) {
    errors.procedures = "Choose one or more procedures.";
  }
  const slot = parseSlot(v.slot);
  if (!slot) errors.slot = "Choose a time.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { patientId, patient, procedureIds: ids as string[], slot: slot!, sendText: v.sendText === true } };
}
```

Run: `npx vitest run tests/unit/staff-input.test.ts`
Expected: PASS.

- [ ] **Step 3: Share the busy loader with staff**

In `src/lib/availability.ts`, replace:

```ts
import "server-only";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
```

with:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
```

Replace the whole `busyBetween` function (from its `/** Pending and confirmed appointments plus time off` comment to its closing brace) with:

```ts
/**
 * Pending and confirmed appointments (with their ids, so a move can ignore its own) plus time off for one
 * dentist, overlapping [from, to). The public flow passes the secret-key client; staff pass their RLS
 * client, which only sees their own clinic. Never leaves the server.
 */
export async function busyBetween(db: SupabaseClient, dentistId: string, from: Date, to: Date): Promise<Busy[]> {
  const [appointments, timeOff] = await Promise.all([
    db
      .from("appointments")
      .select("id, starts_at, ends_at")
      .eq("dentist_id", dentistId)
      .in("status", ["pending", "confirmed"])
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .throwOnError(),
    db
      .from("time_off")
      .select("starts_at, ends_at")
      .eq("dentist_id", dentistId)
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString())
      .throwOnError(),
  ]);
  const booked = (appointments.data as { id: string; starts_at: string; ends_at: string }[]).map((r) => ({
    id: r.id,
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
  }));
  const off = (timeOff.data as { starts_at: string; ends_at: string }[]).map((r) => ({
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
  }));
  return [...booked, ...off];
}
```

Then replace both calls `await busyBetween(dentist.id, ` with `await busyBetween(adminClient(), dentist.id, ` (one in `monthOpenDates`, one in `dayOpenStarts`).

- [ ] **Step 4: Write the failing database tests**

In `tests/db/appointment-actions.test.ts`, replace:

```ts
import { changeStatus, MESSAGES } from "@/lib/appointment-actions";
```

with:

```ts
import { changeStatus, createAppointment, MESSAGES, moveAppointment } from "@/lib/appointment-actions";
import { staffOpenStarts } from "@/lib/dashboard";
```

and append to the end of the file:

```ts
/** An appointment at an exact Manila time (days 20 and later, clear of book()). */
async function bookAt(s: StaffSeed, day: string, minutes: number, status: string, length = 30) {
  const start = manilaInstant(day, minutes);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + length * 60_000).toISOString(), status);
  const { data } = await db.from("appointments").insert(row).select("id").single().throwOnError();
  return data.id as string;
}

async function times(id: string) {
  const { data } = await db.from("appointments").select("starts_at, ends_at, dentist_id, reminder_sent_at").eq("id", id).single().throwOnError();
  return { start: new Date(data.starts_at), end: new Date(data.ends_at), dentistId: data.dentist_id, reminderSentAt: data.reminder_sent_at };
}

const consultation = (s: StaffSeed) => s.procedures.find((p) => p.name === "Consultation")!.id;
const slotAt = (s: StaffSeed, day: string, minutes: number, custom = false) => ({
  dentistId: s.seed.dentist.id,
  startsAt: manilaInstant(day, minutes).toISOString(),
  custom,
});

describe("staffOpenStarts", () => {
  const day = addDays(today, 20);

  it("lists the dentist's open times without notice rules, minus appointments and time off", async () => {
    const taken = await bookAt(a, day, 600, "confirmed");
    await db
      .from("time_off")
      .insert({
        clinic_id: a.staff.clinicId,
        dentist_id: a.seed.dentist.id,
        starts_at: manilaInstant(day, 780).toISOString(),
        ends_at: manilaInstant(day, 840).toISOString(),
      })
      .throwOnError();
    const q = { dentistId: a.seed.dentist.id, date: day, duration: 30 };
    const open = (await staffOpenStarts(a.staff, q, new Date())).map((d) => d.getTime());
    expect(open).toHaveLength(16 - 1 - 2);
    expect(open).not.toContain(manilaInstant(day, 600).getTime());
    expect(open).not.toContain(manilaInstant(day, 780).getTime());

    const moving = (await staffOpenStarts(a.staff, { ...q, ignoreId: taken }, new Date())).map((d) => d.getTime());
    expect(moving).toContain(manilaInstant(day, 600).getTime());
  });

  it("sees nothing of another clinic's dentist", async () => {
    expect(await staffOpenStarts(b.staff, { dentistId: a.seed.dentist.id, date: day, duration: 30 }, new Date())).toEqual([]);
  });
});

describe("moveAppointment", () => {
  const day = addDays(today, 21);

  it("moves a confirmed visit to an open time, keeps its length, and texts the patient", async () => {
    const id = await bookAt(a, day, 540, "confirmed", 60);
    await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id).throwOnError();
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 660), new Date())).toEqual({ ok: true, text: "logged" });
    const moved = await times(id);
    expect(moved.start).toEqual(manilaInstant(day, 660));
    expect(moved.end).toEqual(manilaInstant(day, 720));
    expect(moved.reminderSentAt).toBeNull();
    expect((await texts(id)).map((t) => t.kind)).toEqual(["moved"]);
  });

  it("refuses a time that is no longer open, and an overlapping custom time", async () => {
    const id = await bookAt(a, day, 900, "confirmed");
    await bookAt(a, day, 960, "confirmed");
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 960), new Date())).toEqual({
      ok: false,
      error: "That time is no longer open. Pick another.",
    });
    expect(await moveAppointment(a.staff, id, slotAt(a, day, 960, true), new Date())).toEqual({ ok: false, error: MESSAGES.overlap });
    expect((await times(id)).start).toEqual(manilaInstant(day, 900));
    expect(await texts(id)).toEqual([]);
  });

  it("allows a custom time outside working hours", async () => {
    const id = await bookAt(a, day, 990, "confirmed");
    expect((await moveAppointment(a.staff, id, slotAt(a, day, 1110, true), new Date())).ok).toBe(true);
    expect((await times(id)).start).toEqual(manilaInstant(day, 1110));
  });

  it("moves only confirmed visits that have not started", async () => {
    const pending = await bookAt(a, addDays(today, 22), 540, "pending");
    expect(await moveAppointment(a.staff, pending, slotAt(a, addDays(today, 22), 600), new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
    const started = await book(a, "confirmed", "past");
    expect(await moveAppointment(a.staff, started, slotAt(a, addDays(today, 22), 660), new Date())).toEqual({ ok: false, error: MESSAGES.notNow });
  });

  it("lets no one move another clinic's visit, or move a visit to another clinic's dentist", async () => {
    const id = await bookAt(a, addDays(today, 23), 540, "confirmed");
    expect(await moveAppointment(b.staff, id, slotAt(b, addDays(today, 23), 600), new Date())).toEqual({ ok: false, error: MESSAGES.gone });
    expect(await moveAppointment(a.staff, id, slotAt(b, addDays(today, 23), 600), new Date())).toEqual({
      ok: false,
      error: "Choose an active dentist.",
    });
    expect((await times(id)).start).toEqual(manilaInstant(addDays(today, 23), 540));
  });
});

describe("createAppointment", () => {
  const day = addDays(today, 24);

  async function onlyAppointmentAt(clinicId: string, minutes: number) {
    const { data } = await db
      .from("appointments")
      .select("id, status, source, procedure_names, patient:patients(first_name, mobile, consent_at)")
      .eq("clinic_id", clinicId)
      .eq("starts_at", manilaInstant(day, minutes).toISOString())
      .throwOnError();
    return data as unknown as {
      id: string;
      status: string;
      source: string;
      procedure_names: string[];
      patient: { first_name: string; mobile: string | null; consent_at: string | null };
    }[];
  }

  it("books a walk-in without a mobile at a custom time, confirmed, with no text", async () => {
    const input = {
      patient: { first: "Lolo", last: "Walk-in" },
      procedureIds: [consultation(a)],
      slot: slotAt(a, day, 1140, true),
      sendText: true,
    };
    expect(await createAppointment(a.staff, input, new Date())).toEqual({ ok: true, text: "none" });
    const [row] = await onlyAppointmentAt(a.staff.clinicId, 1140);
    expect(row).toMatchObject({
      status: "confirmed",
      source: "manual",
      procedure_names: ["Consultation"],
      patient: { first_name: "Lolo", mobile: null, consent_at: null },
    });
    expect(await texts(row.id)).toEqual([]);
  });

  it("books an existing patient at an open time and sends the confirmation only when asked", async () => {
    const texted = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 540), sendText: true };
    expect(await createAppointment(a.staff, texted, new Date())).toEqual({ ok: true, text: "logged" });
    const [first] = await onlyAppointmentAt(a.staff.clinicId, 540);
    expect((await texts(first.id)).map((t) => t.kind)).toEqual(["confirmed"]);

    const quiet = { ...texted, slot: slotAt(a, day, 600), sendText: false };
    expect(await createAppointment(a.staff, quiet, new Date())).toEqual({ ok: true, text: "none" });
    const [second] = await onlyAppointmentAt(a.staff.clinicId, 600);
    expect(await texts(second.id)).toEqual([]);
  });

  it("refuses a taken open time and an overlapping custom time", async () => {
    const input = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 540), sendText: false };
    expect(await createAppointment(a.staff, input, new Date())).toEqual({ ok: false, error: "That time is no longer open. Pick another." });
    expect(await createAppointment(a.staff, { ...input, slot: slotAt(a, day, 555, true) }, new Date())).toEqual({
      ok: false,
      error: MESSAGES.overlap,
    });
  });

  it("refuses archived procedures and bad input", async () => {
    const { data: old } = await db
      .from("procedures")
      .insert({ clinic_id: a.staff.clinicId, name: "Old", duration_minutes: 30, active: false })
      .select("id")
      .single()
      .throwOnError();
    const input = { patientId: a.seed.patient.id, procedureIds: [old.id], slot: slotAt(a, day, 720), sendText: false };
    expect((await createAppointment(a.staff, input, new Date())).ok).toBe(false);
    expect(await createAppointment(a.staff, { nonsense: true }, new Date())).toMatchObject({ ok: false });
    expect(await onlyAppointmentAt(a.staff.clinicId, 720)).toEqual([]);
  });

  it("never books with another clinic's patient, dentist, or procedures", async () => {
    const own = { patientId: a.seed.patient.id, procedureIds: [consultation(a)], slot: slotAt(a, day, 780), sendText: false };
    expect(await createAppointment(a.staff, { ...own, patientId: b.seed.patient.id }, new Date())).toEqual({
      ok: false,
      error: "That patient was deleted or can't be found. Pick another.",
    });
    expect(await createAppointment(a.staff, { ...own, procedureIds: [consultation(b)] }, new Date())).toEqual({
      ok: false,
      error: "A chosen procedure was archived. Choose again.",
    });
    expect(await createAppointment(a.staff, { ...own, slot: slotAt(b, day, 780) }, new Date())).toEqual({
      ok: false,
      error: "Choose an active dentist.",
    });
    expect(await onlyAppointmentAt(a.staff.clinicId, 780)).toEqual([]);
    expect(await onlyAppointmentAt(b.staff.clinicId, 780)).toEqual([]);
  });
});
```

Run: `npx vitest run tests/db/appointment-actions.test.ts`
Expected: FAIL, `createAppointment`, `moveAppointment`, and `staffOpenStarts` are not exported.

- [ ] **Step 5: Add staff open times**

In `src/lib/dashboard.ts`, replace:

```ts
import type { Busy } from "@/lib/slots";
```

with:

```ts
import { busyBetween } from "@/lib/availability";
import { openStarts, type Busy } from "@/lib/slots";
```

replace:

```ts
import { addDays, manilaInstant } from "@/lib/time";
```

with:

```ts
import { addDays, manilaInstant, parseClock, weekday } from "@/lib/time";
```

and append to the end of the file:

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
  const [clinic, hours, busy] = await Promise.all([
    staff.db.from("clinics").select("slot_minutes").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("working_hours")
      .select("start_time, end_time")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", q.dentistId)
      .eq("weekday", weekday(q.date))
      .throwOnError(),
    busyBetween(staff.db, q.dentistId, manilaInstant(q.date, 0), manilaInstant(addDays(q.date, 1), 0)),
  ]);
  const blocks = (hours.data as { start_time: string; end_time: string }[]).map((h) => ({
    start: parseClock(h.start_time),
    end: parseClock(h.end_time),
  }));
  return openStarts({
    date: q.date,
    blocks,
    busy,
    durationMinutes: q.duration,
    rules: { slotMinutes: (clinic.data as { slot_minutes: number }).slot_minutes, minNoticeMinutes: 0, maxDaysAhead: 365 },
    now,
    ignoreId: q.ignoreId,
  });
}
```

- [ ] **Step 6: Add Move and New to the appointment service**

In `src/lib/appointment-actions.ts`, replace the import block at the top:

```ts
import "server-only";
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { sendSms, type SmsStatus } from "@/lib/sms/send";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";
import { cleanText, isUuid, LIMITS } from "@/lib/validate";
```

with:

```ts
import "server-only";
import { canMarkAttendance, canTransition, type Status } from "@/lib/appointments";
import { newToken } from "@/lib/codes";
import { staffOpenStarts } from "@/lib/dashboard";
import { sendSms, type SmsStatus } from "@/lib/sms/send";
import { parseManualBooking, parseSlot, type PatientFields, type SlotChoice } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";
import { cleanText, isUuid, LIMITS } from "@/lib/validate";
```

and append to the end of the file:

```ts
const NOT_OPEN = "That time is no longer open. Pick another.";
const PATIENT_GONE = "That patient was deleted or can't be found. Pick another.";
const NO_DENTIST = "Choose an active dentist.";

/** An active dentist of this clinic, or null. */
async function activeDentist(staff: Staff, id: string): Promise<{ id: string; sms_name: string } | null> {
  const { data, error } = await staff.db
    .from("dentists")
    .select("id, sms_name")
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; sms_name: string } | null;
}

/**
 * Null when the time can be saved, otherwise why not. An open time must still be open; a custom time
 * only needs to be today or later, because the database refuses any overlap (spec 5.3).
 */
async function timeProblem(staff: Staff, slot: SlotChoice, duration: number, now: Date, ignoreId?: string): Promise<string | null> {
  if (manilaDate(slot.startsAt) < manilaDate(now)) return "Pick today or a later date.";
  if (slot.custom) return null;
  const open = await staffOpenStarts(staff, { dentistId: slot.dentistId, date: manilaDate(slot.startsAt), duration, ignoreId }, now);
  return open.some((s) => s.getTime() === slot.startsAt.getTime()) ? null : NOT_OPEN;
}

/** Spec 9.2 "moved": a confirmed visit that has not started gets a new time or dentist, keeps its length, and the patient is texted. */
export async function moveAppointment(staff: Staff, id: string, slotInput: unknown, now: Date): Promise<ActionResult> {
  const slot = parseSlot(slotInput);
  if (!slot) return { ok: false, error: "Choose a time." };
  try {
    const [row, dentist, dentistShown] = await Promise.all([loadRow(staff, id), activeDentist(staff, slot.dentistId), showsDentist(staff)]);
    if (!row) return { ok: false, error: MESSAGES.gone };
    const oldStart = new Date(row.starts_at);
    if (row.status !== "confirmed" || !canTransition(row.status, "confirmed", "staff") || oldStart <= now) {
      return { ok: false, error: MESSAGES.notNow };
    }
    if (!dentist) return { ok: false, error: NO_DENTIST };
    if (slot.dentistId === row.dentist_id && slot.startsAt.getTime() === oldStart.getTime()) {
      return { ok: false, error: "That is the current time. Pick a different one." };
    }
    const duration = (new Date(row.ends_at).getTime() - oldStart.getTime()) / 60_000;
    const problem = await timeProblem(staff, slot, duration, now, row.id);
    if (problem) return { ok: false, error: problem };

    const { data: moved, error } = await staff.db.rpc("move_appointment", {
      p_id: row.id,
      p_dentist_id: slot.dentistId,
      p_starts_at: slot.startsAt.toISOString(),
      p_ends_at: new Date(slot.startsAt.getTime() + duration * 60_000).toISOString(),
      p_user_id: staff.userId,
    });
    if (error?.code === "23P01") return { ok: false, error: MESSAGES.overlap };
    if (error) throw error;
    if (!moved) return { ok: false, error: MESSAGES.changed };

    const text = await textPatient(staff, rowText(row, "moved", dentistShown ? dentist.sms_name : null, slot.startsAt));
    return { ok: true, text };
  } catch (e) {
    logFailure("moveAppointment", e);
    return { ok: false, error: MESSAGES.generic };
  }
}

type ProcedureRow = { id: string; name: string; duration_minutes: number };

/**
 * Spec 5.3 New appointment: confirmed immediately, source manual. The confirmation text goes out only
 * when sendText is on and the patient has a mobile.
 */
export async function createAppointment(staff: Staff, input: unknown, now: Date): Promise<ActionResult> {
  const parsed = parseManualBooking(input, manilaDate(now));
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] };
  const b = parsed.value;
  try {
    const [dentist, procedures, clinic, dentistShown] = await Promise.all([
      activeDentist(staff, b.slot.dentistId),
      staff.db
        .from("procedures")
        .select("id, name, duration_minutes")
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .in("id", b.procedureIds)
        .throwOnError(),
      staff.db.from("clinics").select("sms_name, slug").eq("id", staff.clinicId).single().throwOnError(),
      showsDentist(staff),
    ]);
    if (!dentist) return { ok: false, error: NO_DENTIST };
    const chosen = b.procedureIds.map((pid) => (procedures.data as ProcedureRow[]).find((p) => p.id === pid));
    if (chosen.some((p) => !p)) return { ok: false, error: "A chosen procedure was archived. Choose again." };
    const picked = chosen as ProcedureRow[];
    const duration = picked.reduce((sum, p) => sum + p.duration_minutes, 0);

    let person: PatientFields;
    if (b.patientId) {
      const { data } = await staff.db
        .from("patients")
        .select("first_name, last_name, mobile")
        .eq("id", b.patientId)
        .eq("clinic_id", staff.clinicId)
        .is("anonymized_at", null)
        .maybeSingle()
        .throwOnError();
      if (!data) return { ok: false, error: PATIENT_GONE };
      person = { first: data.first_name, last: data.last_name, mobile: data.mobile, birthday: null, hmo: "" };
    } else {
      person = b.patient!;
    }

    const problem = await timeProblem(staff, b.slot, duration, now);
    if (problem) return { ok: false, error: problem };

    const token = newToken();
    const startsAt = b.slot.startsAt;
    const { data: appointmentId, error } = await staff.db.rpc("create_booking", {
      p_clinic_id: staff.clinicId,
      p_dentist_id: dentist.id,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
      p_procedure_names: picked.map((p) => p.name),
      p_source: "manual",
      p_status: "confirmed",
      p_manage_token: token,
      p_patient_id: b.patientId,
      p_first_name: person.first,
      p_last_name: person.last,
      p_mobile: person.mobile,
      p_birthday: person.birthday,
      p_hmo: person.hmo,
      p_consent: false,
      p_actor: "staff",
      p_user_id: staff.userId,
    });
    if (error?.code === "23P01") return { ok: false, error: MESSAGES.overlap };
    if (error?.code === "P0002") return { ok: false, error: PATIENT_GONE };
    if (error) throw error;

    const { sms_name, slug } = clinic.data as { sms_name: string; slug: string };
    const text = b.sendText
      ? await textPatient(staff, {
          kind: "confirmed",
          appointmentId: appointmentId as string,
          token,
          first: person.first,
          mobile: person.mobile,
          clinicSmsName: sms_name,
          slug,
          dentist: dentistShown ? dentist.sms_name : null,
          startsAt,
          reason: "",
        })
      : "none";
    return { ok: true, text };
  } catch (e) {
    logFailure("createAppointment", e);
    return { ok: false, error: MESSAGES.generic };
  }
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/db/appointment-actions.test.ts tests/db/availability.test.ts tests/db/booking-service.test.ts`
Expected: PASS. The public availability and booking tests still pass with the shared `busyBetween`.

- [ ] **Step 8: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build succeeds.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/staff-input.ts src/lib/availability.ts src/lib/dashboard.ts src/lib/appointment-actions.ts tests/unit/staff-input.test.ts tests/db/appointment-actions.test.ts; git commit -m "feat: add staff open times, move, and manual booking services" -m "Open times reuse the slot engine with the visit's own time ignored on a move; custom times may fall outside hours and the database still refuses overlaps."
```

---

### Task 6: Patients: search, detail, edit, delete

**Files:**
- Modify: `src/lib/staff-input.ts`, `tests/unit/staff-input.test.ts`
- Create: `src/lib/patients.ts`, `src/app/app/patients/page.tsx`, `src/app/app/patients/actions.ts`, `src/app/app/patients/[id]/page.tsx`, `src/app/app/patients/[id]/PatientEditor.tsx`
- Test: `tests/db/patients.test.ts`

**Interfaces:**
- Consumes: `parsePatientFields`, `type Saved` from `@/lib/staff-input`; `STATUS_LABEL` from `@/lib/schedule`; `type Status`; `isUuid`; `requireStaff`, `type Staff`; `Field` from `@/components/Field`; `localMobile`; `formatDate`, `formatTime`, `manilaDate`; `Form` from `next/form`; `notFound` from `next/navigation`.
- Produces:
  - From `@/lib/staff-input`: `type PatientQuery = { kind: "mobile"; prefix: string } | { kind: "name"; words: string[] }`, `patientSearch(input: unknown): PatientQuery | null`, `matchesWords(p: { first: string; last: string }, words: string[]): boolean`
  - From `@/lib/patients` (server only): `type PatientHit = { id: string; first: string; last: string; mobile: string | null }`, `searchPatients(staff: Staff, input: unknown): Promise<PatientHit[]>`, `type PatientDetail`, `loadPatient(staff: Staff, id: string): Promise<PatientDetail | null>`, `updatePatient(staff: Staff, id: string, input: unknown, now: Date): Promise<Saved>`, `deletePatient(staff: Staff, id: string, now: Date): Promise<Saved>`
  - From `src/app/app/patients/actions.ts`: `findPatients(query: unknown): Promise<PatientHit[]>`, `savePatient(id: unknown, input: unknown): Promise<Saved>`, `removePatient(id: unknown): Promise<Saved>`
  - Routes `/app/patients?q=...` and `/app/patients/[id]`

Search (spec 5.3): 3 or more digits search mobiles by prefix in the stored `+639` form, so "0918 123" finds `+63918123...`; anything else searches first and last names by word, case-insensitive (every word must match). Deleted (anonymized) patients never appear in search. Delete follows spec 12: names become "Deleted patient", mobile, birthday, and HMO are cleared, `anonymized_at` is set, and appointments stay for counts.

- [ ] **Step 1: Write the failing unit tests**

In `tests/unit/staff-input.test.ts`, replace:

```ts
import { parseManualBooking, parsePatientFields, parseSlot } from "@/lib/staff-input";
```

with:

```ts
import { matchesWords, parseManualBooking, parsePatientFields, parseSlot, patientSearch } from "@/lib/staff-input";
```

and append to the end of the file:

```ts
describe("patientSearch", () => {
  it("searches mobiles by prefix in the stored form", () => {
    expect(patientSearch("0918 123")).toEqual({ kind: "mobile", prefix: "+63918123" });
    expect(patientSearch("+63 918-123")).toEqual({ kind: "mobile", prefix: "+63918123" });
    expect(patientSearch("918")).toEqual({ kind: "mobile", prefix: "+63918" });
  });

  it("searches names by lowercase word, dropping characters that could change the query", () => {
    expect(patientSearch("  Maria  Santos ")).toEqual({ kind: "name", words: ["maria", "santos"] });
    expect(patientSearch("ana,(x)%*")).toEqual({ kind: "name", words: ["anax"] });
    expect(patientSearch("O'Brien Dela-Cruz")).toEqual({ kind: "name", words: ["o'brien", "dela-cruz"] });
    expect(patientSearch("Ñino")).toEqual({ kind: "name", words: ["ñino"] });
  });

  it("returns null for nothing useful", () => {
    expect(patientSearch("")).toBeNull();
    expect(patientSearch("  ,,  ")).toBeNull();
    expect(patientSearch(42)).toBeNull();
  });

  it("treats one or two digits as a name search, not a mobile search", () => {
    expect(patientSearch("12")).toEqual({ kind: "name", words: ["12"] });
  });
});

describe("matchesWords", () => {
  it("needs every word somewhere in the full name", () => {
    expect(matchesWords({ first: "Maria", last: "Santos" }, ["mar", "san"])).toBe(true);
    expect(matchesWords({ first: "Mario", last: "Reyes" }, ["mar", "san"])).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/staff-input.test.ts`
Expected: FAIL, `patientSearch` is not exported.

- [ ] **Step 2: Add the search terms**

Append to `src/lib/staff-input.ts`:

```ts
export type PatientQuery = { kind: "mobile"; prefix: string } | { kind: "name"; words: string[] };

/**
 * Search terms from what staff typed (spec 5.3). Three or more digits search mobiles by prefix in the
 * stored +639 form ("0918 123" finds +63918123...). Anything else searches names by word; only letters,
 * digits, apostrophes, and hyphens are kept, so nothing typed can change the database filter.
 */
export function patientSearch(input: unknown): PatientQuery | null {
  const text = typeof input === "string" ? input.trim().slice(0, 60) : "";
  const digits = text.replace(/[\s().+-]/g, "");
  if (/^\d{3,}$/.test(digits)) return { kind: "mobile", prefix: `+63${digits.replace(/^(63|0)/, "")}` };
  const words = text
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((w) => w.length > 0)
    .slice(0, 4);
  return words.length > 0 ? { kind: "name", words } : null;
}

/** True when every search word appears in the patient's full name. */
export function matchesWords(p: { first: string; last: string }, words: string[]): boolean {
  const name = `${p.first} ${p.last}`.normalize("NFC").toLowerCase();
  return words.every((w) => name.includes(w));
}
```

Run: `npx vitest run tests/unit/staff-input.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test**

Create `tests/db/patients.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deletePatient, loadPatient, searchPatients, updatePatient } from "@/lib/patients";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const today = manilaDate(new Date());
let a: StaffSeed;
let b: StaffSeed;
let maria: string;
let mario: string;
const suffix = String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
const MARIA = `+63918123${suffix}`;
const MARIO = `+63918124${suffix}`;

async function addPatient(s: StaffSeed, first: string, last: string, mobile: string | null) {
  const { data } = await db
    .from("patients")
    .insert({ clinic_id: s.staff.clinicId, first_name: first, last_name: last, mobile, birthday: "1990-05-01", hmo: "Maxicare" })
    .select("id")
    .single()
    .throwOnError();
  return data.id as string;
}

async function visit(s: StaffSeed, patientId: string, day: string, status: string) {
  const start = manilaInstant(day, 540);
  const row = appointmentRow(s.seed, start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString(), status);
  await db.from("appointments").insert({ ...row, patient_id: patientId }).throwOnError();
}

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
  maria = await addPatient(a, "Maria", "Santos", MARIA);
  mario = await addPatient(a, "Mario", "Reyes", MARIO);
  await visit(a, maria, addDays(today, -10), "completed");
  await visit(a, maria, addDays(today, -5), "no_show");
  await visit(a, maria, addDays(today, 5), "confirmed");
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

describe("searchPatients", () => {
  it("finds patients by name words, any case", async () => {
    expect((await searchPatients(a.staff, "MARIA")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, "mar san")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, "mar")).map((p) => p.id).sort()).toEqual([maria, mario].sort());
  });

  it("finds patients by mobile prefix typed the local way", async () => {
    expect((await searchPatients(a.staff, "0918 123")).map((p) => p.id)).toEqual([maria]);
    expect((await searchPatients(a.staff, `0918123${suffix}`))[0]).toEqual({ id: maria, first: "Maria", last: "Santos", mobile: MARIA });
  });

  it("never shows another clinic's patients", async () => {
    expect(await searchPatients(b.staff, "maria")).toEqual([]);
    expect(await searchPatients(b.staff, "0918")).toEqual([]);
  });
});

describe("loadPatient", () => {
  it("returns details, history newest first, and the no-show count", async () => {
    const detail = await loadPatient(a.staff, maria);
    expect(detail?.patient).toEqual({
      id: maria,
      first: "Maria",
      last: "Santos",
      mobile: MARIA,
      birthday: "1990-05-01",
      hmo: "Maxicare",
      anonymized: false,
    });
    expect(detail?.history.map((h) => h.status)).toEqual(["confirmed", "no_show", "completed"]);
    expect(detail?.history[0].dentistName).toBe("Dr. Ana Reyes");
    expect(detail?.noShows).toBe(1);
  });

  it("returns null for another clinic's patient or a malformed id", async () => {
    expect(await loadPatient(b.staff, maria)).toBeNull();
    expect(await loadPatient(a.staff, "nope")).toBeNull();
  });
});

describe("updatePatient", () => {
  it("saves edits and can clear the mobile", async () => {
    const id = await addPatient(a, "Pedro", "Penduko", "+639189990000");
    const input = { first: "Pedro", last: "Penduko Jr", mobile: "", birthday: "", hmo: "" };
    expect(await updatePatient(a.staff, id, input, new Date())).toEqual({ ok: true });
    const { data } = await db.from("patients").select("last_name, mobile, birthday, hmo").eq("id", id).single().throwOnError();
    expect(data).toEqual({ last_name: "Penduko Jr", mobile: null, birthday: null, hmo: null });
  });

  it("reports the field that is wrong", async () => {
    expect(await updatePatient(a.staff, maria, { first: "", last: "Santos" }, new Date())).toMatchObject({ ok: false, field: "first" });
  });

  it("refuses a second patient with the same name and mobile", async () => {
    const clash = { first: "Maria", last: "Santos", mobile: MARIA, birthday: "", hmo: "" };
    expect(await updatePatient(a.staff, mario, clash, new Date())).toMatchObject({ ok: false, field: "mobile" });
    expect((await loadPatient(a.staff, mario))?.patient.first).toBe("Mario");
  });

  it("changes nothing in another clinic", async () => {
    expect(await updatePatient(b.staff, maria, { first: "Hacked", last: "Name" }, new Date())).toMatchObject({ ok: false });
    expect((await loadPatient(a.staff, maria))?.patient.first).toBe("Maria");
  });
});

describe("deletePatient", () => {
  it("anonymizes the patient and keeps the appointments", async () => {
    const id = await addPatient(a, "Juan", "Delacruz", "+639187770000");
    await visit(a, id, addDays(today, -2), "completed");
    expect(await deletePatient(b.staff, id, new Date())).toMatchObject({ ok: false });
    expect(await deletePatient(a.staff, id, new Date())).toEqual({ ok: true });

    const detail = await loadPatient(a.staff, id);
    expect(detail?.patient).toMatchObject({ first: "Deleted", last: "patient", mobile: null, birthday: null, hmo: null, anonymized: true });
    expect(detail?.history).toHaveLength(1);
    expect(await searchPatients(a.staff, "juan")).toEqual([]);
    expect(await searchPatients(a.staff, "0918777")).toEqual([]);
    expect(await updatePatient(a.staff, id, { first: "Juan", last: "Delacruz" }, new Date())).toMatchObject({ ok: false });
    expect(await deletePatient(a.staff, id, new Date())).toMatchObject({ ok: false });
  });
});
```

Run: `npx vitest run tests/db/patients.test.ts`
Expected: FAIL, cannot resolve `@/lib/patients`.

- [ ] **Step 4: Write the patients service**

Create `src/lib/patients.ts`:

```ts
import "server-only";
import type { Status } from "@/lib/appointments";
import { matchesWords, parsePatientFields, patientSearch, type Saved } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { manilaDate } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export type PatientHit = { id: string; first: string; last: string; mobile: string | null };

export type PatientDetail = {
  patient: {
    id: string;
    first: string;
    last: string;
    mobile: string | null;
    birthday: string | null;
    hmo: string | null;
    anonymized: boolean;
  };
  history: { id: string; startsAt: string; status: Status; procedures: string[]; dentistName: string }[];
  noShows: number;
};

const GONE = "This patient no longer exists.";
const GENERIC = "Something went wrong. Please try again.";

type HitRow = { id: string; first_name: string; last_name: string; mobile: string | null };

/** Spec 5.3: search by name or mobile. Deleted patients never appear. */
export async function searchPatients(staff: Staff, input: unknown): Promise<PatientHit[]> {
  const q = patientSearch(input);
  if (!q) return [];
  let query = staff.db
    .from("patients")
    .select("id, first_name, last_name, mobile")
    .eq("clinic_id", staff.clinicId)
    .is("anonymized_at", null);
  if (q.kind === "mobile") {
    query = query.like("mobile", `${q.prefix}%`);
  } else {
    // The database narrows by the longest word; every word is then checked here.
    const longest = [...q.words].sort((x, y) => y.length - x.length)[0];
    query = query.or(`first_name.ilike.%${longest}%,last_name.ilike.%${longest}%`);
  }
  const { data } = await query.order("last_name").order("first_name").limit(200).throwOnError();
  const hits = (data as HitRow[]).map((r) => ({ id: r.id, first: r.first_name, last: r.last_name, mobile: r.mobile }));
  return (q.kind === "name" ? hits.filter((h) => matchesWords(h, q.words)) : hits).slice(0, 30);
}

type PatientRow = HitRow & { birthday: string | null; hmo: string | null; anonymized_at: string | null };
type HistoryRow = { id: string; starts_at: string; status: Status; procedure_names: string[]; dentist: { name: string } };

/** Spec 5.3 patient detail: details, appointment history (newest first), and the no-show count. */
export async function loadPatient(staff: Staff, id: string): Promise<PatientDetail | null> {
  if (!isUuid(id)) return null;
  const [patient, history] = await Promise.all([
    staff.db
      .from("patients")
      .select("id, first_name, last_name, mobile, birthday, hmo, anonymized_at")
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError(),
    staff.db
      .from("appointments")
      .select("id, starts_at, status, procedure_names, dentist:dentists(name)")
      .eq("clinic_id", staff.clinicId)
      .eq("patient_id", id)
      .order("starts_at", { ascending: false })
      .limit(200)
      .throwOnError(),
  ]);
  const p = patient.data as PatientRow | null;
  if (!p) return null;
  const rows = history.data as unknown as HistoryRow[];
  return {
    patient: {
      id: p.id,
      first: p.first_name,
      last: p.last_name,
      mobile: p.mobile,
      birthday: p.birthday,
      hmo: p.hmo,
      anonymized: p.anonymized_at !== null,
    },
    history: rows.map((r) => ({ id: r.id, startsAt: r.starts_at, status: r.status, procedures: r.procedure_names, dentistName: r.dentist.name })),
    noShows: rows.filter((r) => r.status === "no_show").length,
  };
}

/** Saves edited details. A deleted patient can't be edited. */
export async function updatePatient(staff: Staff, id: string, input: unknown, now: Date): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  const parsed = parsePatientFields(input, manilaDate(now));
  if (!parsed.ok) {
    const [field, error] = Object.entries(parsed.errors)[0];
    return { ok: false, field, error };
  }
  const p = parsed.value;
  try {
    const { data, error } = await staff.db
      .from("patients")
      .update({ first_name: p.first, last_name: p.last, mobile: p.mobile, birthday: p.birthday, hmo: p.hmo || null })
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .is("anonymized_at", null)
      .select("id");
    // patients_identity: one patient per clinic, mobile, and name.
    if (error?.code === "23505") return { ok: false, field: "mobile", error: "Another patient already has this name and mobile." };
    if (error) throw error;
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    console.error("updatePatient failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return { ok: false, error: GENERIC };
  }
}

/** Spec 12: "Delete patient" anonymizes. Appointments stay for counts. */
export async function deletePatient(staff: Staff, id: string, now: Date): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    const { data, error } = await staff.db
      .from("patients")
      .update({
        first_name: "Deleted",
        last_name: "patient",
        mobile: null,
        birthday: null,
        hmo: null,
        anonymized_at: now.toISOString(),
      })
      .eq("id", id)
      .eq("clinic_id", staff.clinicId)
      .is("anonymized_at", null)
      .select("id");
    if (error) throw error;
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    console.error("deletePatient failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return { ok: false, error: GENERIC };
  }
}
```

Run: `npx vitest run tests/db/patients.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the patient Server Actions**

Create `src/app/app/patients/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import { deletePatient, searchPatients, updatePatient, type PatientHit } from "@/lib/patients";
import type { Saved } from "@/lib/staff-input";
import { requireStaff } from "@/lib/supabase/server";

/** The New appointment patient finder. Arguments are untrusted (spec 12). */
export async function findPatients(query: unknown): Promise<PatientHit[]> {
  const staff = await requireStaff();
  try {
    return await searchPatients(staff, query);
  } catch (e) {
    console.error("findPatients failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return [];
  }
}

export async function savePatient(id: unknown, input: unknown): Promise<Saved> {
  const staff = await requireStaff();
  const result = await updatePatient(staff, String(id), input, new Date());
  if (result.ok) refresh();
  return result;
}

export async function removePatient(id: unknown): Promise<Saved> {
  const staff = await requireStaff();
  return deletePatient(staff, String(id), new Date());
}
```

- [ ] **Step 6: Write the Patients search page**

Create `src/app/app/patients/page.tsx`:

```tsx
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { searchPatients } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Patients" };

type Props = { searchParams: Promise<{ q?: string | string[] }> };

/** Spec 5.3: search by name or mobile. */
export default async function PatientsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 60) : "";
  const hits = query ? await searchPatients(staff, query) : [];

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Patients</h1>
        <Link href="/app/new" className="btn btn-primary">
          New appointment
        </Link>
      </div>

      <Form action="/app/patients" className="card card-pad mb-3 flex gap-2" role="search">
        <input
          key={query}
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Name or mobile"
          aria-label="Search patients by name or mobile"
          className="f-input"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </Form>

      {!query && <p className="f-hint">Search by first or last name, or by mobile number.</p>}
      {query && hits.length === 0 && <div className="card empty-note">No patients match that search.</div>}
      {hits.length > 0 && (
        <div className="card card-pad">
          <div className="member-list">
            {hits.map((h) => (
              <Link key={h.id} href={`/app/patients/${h.id}`} className="member-row">
                <span className="nm">
                  {h.first} {h.last}
                </span>
                <span className="meta">{h.mobile ? localMobile(h.mobile) : "No mobile"}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 7: Write the patient detail page and editor**

Create `src/app/app/patients/[id]/PatientEditor.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import Field from "@/components/Field";
import { localMobile } from "@/lib/phone";
import type { Saved } from "@/lib/staff-input";
import { removePatient, savePatient } from "../actions";

type Patient = { id: string; first: string; last: string; mobile: string | null; birthday: string | null; hmo: string | null };

/** Editable details (spec 5.3) and Delete, which anonymizes (spec 12) after a confirm step. */
export default function PatientEditor({ patient }: { patient: Patient }) {
  const router = useRouter();
  const [form, setForm] = useState({
    first: patient.first,
    last: patient.last,
    mobile: patient.mobile ? localMobile(patient.mobile) : "",
    birthday: patient.birthday ?? "",
    hmo: patient.hmo ?? "",
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const fieldError = (field: string) => (result && !result.ok && result.field === field ? result.error : undefined);

  return (
    <>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => setResult(await savePatient(patient.id, form)));
        }}
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="First name" error={fieldError("first")}>
            <input className="f-input" value={form.first} onChange={set("first")} maxLength={50} autoComplete="off" required />
          </Field>
          <Field label="Last name" error={fieldError("last")}>
            <input className="f-input" value={form.last} onChange={set("last")} maxLength={50} autoComplete="off" required />
          </Field>
          <Field label="Mobile" optional hint="No mobile means no texts." error={fieldError("mobile")}>
            <input className="f-input" type="tel" inputMode="tel" value={form.mobile} onChange={set("mobile")} autoComplete="off" />
          </Field>
          <Field label="Birthday" optional error={fieldError("birthday")}>
            <input className="f-input" type="date" value={form.birthday} onChange={set("birthday")} />
          </Field>
          <Field label="HMO provider" optional error={fieldError("hmo")}>
            <input className="f-input" value={form.hmo} onChange={set("hmo")} maxLength={60} autoComplete="off" />
          </Field>
        </div>
        {result && !result.ok && !result.field && (
          <p className="field-err" role="alert">
            {result.error}
          </p>
        )}
        {result?.ok && (
          <p className="f-hint" role="status">
            Saved.
          </p>
        )}
        <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
          {pending ? "Saving..." : "Save details"}
        </button>
      </form>

      {!confirming ? (
        <button type="button" className="btn btn-danger mt-6" onClick={() => setConfirming(true)}>
          Delete patient
        </button>
      ) : (
        <div className="note-box warn mt-6" role="group" aria-label="Confirm deleting this patient">
          <p>
            Delete {patient.first} {patient.last}? Their name, mobile, birthday, and HMO are removed for good. Their appointments
            stay, shown as Deleted patient, so your counts stay right. Cancel any upcoming visits first if they will not come.
          </p>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Keep patient
            </button>
            <button
              type="button"
              className="btn btn-danger flex-1"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removePatient(patient.id);
                  if (r.ok) router.push("/app/patients");
                  else setResult(r);
                })
              }
            >
              {pending ? "Deleting..." : "Yes, delete"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
```

Create `src/app/app/patients/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PatientEditor from "./PatientEditor";
import { loadPatient } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { STATUS_LABEL } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "Patient" };

type Props = { params: Promise<{ id: string }> };

/** Spec 5.3 patient detail: editable details, appointment history, no-show count, and Delete. */
export default async function PatientPage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const detail = await loadPatient(staff, id);
  if (!detail) notFound();
  const { patient, history, noShows } = detail;

  return (
    <>
      <Link href="/app/patients" className="back-arrow min-h-11">
        Back to patients
      </Link>
      <div className="page-head">
        <h1 className="font-display">
          {patient.first} {patient.last}
        </h1>
        {!patient.anonymized && (
          <Link href={`/app/new?patient=${patient.id}`} className="btn btn-primary">
            New appointment
          </Link>
        )}
      </div>

      <div className="card card-pad mb-3">
        <div className="chip-row mt-0">
          <span className={`chip ${noShows > 0 ? "chip-red" : "chip-green"}`}>{noShows === 1 ? "1 no-show" : `${noShows} no-shows`}</span>
          <span className="chip chip-brand">{history.length === 1 ? "1 appointment" : `${history.length} appointments`}</span>
        </div>
        {patient.mobile && (
          <div className="flex flex-wrap gap-5">
            <a href={`tel:${patient.mobile}`} className="link inline-flex min-h-11 items-center">
              Call {localMobile(patient.mobile)}
            </a>
            <a href={`sms:${patient.mobile}`} className="link inline-flex min-h-11 items-center">
              Text
            </a>
          </div>
        )}
        {patient.anonymized ? (
          <p className="note-box mt-3">This patient was deleted. Their details were removed; past appointments stay for your counts.</p>
        ) : (
          <PatientEditor patient={patient} />
        )}
      </div>

      <section className="card card-pad">
        <h2 className="font-display text-[17px] font-bold">History</h2>
        {history.length === 0 ? (
          <p className="empty-note">No appointments yet.</p>
        ) : (
          <div className="member-list mt-2">
            {history.map((h) => {
              const start = new Date(h.startsAt);
              const label = STATUS_LABEL[h.status];
              return (
                <div key={h.id} className="member-row cursor-default">
                  <span className="nm">
                    {formatDate(start)} {manilaDate(start).slice(0, 4)}, {formatTime(start)}
                    <span className="meta block">
                      {h.procedures.join(", ")} with {h.dentistName}
                    </span>
                  </span>
                  <span className={`chip ${label.chip}`}>{label.word}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 8: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build lists `/app/patients` and `/app/patients/[id]`.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/staff-input.ts src/lib/patients.ts "src/app/app/patients" tests/unit/staff-input.test.ts tests/db/patients.test.ts; git commit -m "feat: add patient search, details, history, and delete by anonymizing"
```

---

### Task 7: New appointment and Move screens

**Files:**
- Modify: `src/lib/dashboard.ts`, `src/app/app/actions.ts`, `tests/db/dashboard.test.ts`
- Create: `src/app/app/SlotPicker.tsx`, `src/app/app/new/page.tsx`, `src/app/app/new/NewAppointment.tsx`, `src/app/app/schedule/move/[id]/page.tsx`, `src/app/app/schedule/move/[id]/MoveForm.tsx`

**Interfaces:**
- Consumes: `staffOpenStarts` (Task 5), `createAppointment`, `moveAppointment` (Task 5), `findPatients` (Task 6), `loadPatient`, `type PatientHit`; `parseDay`; `isUuid`; `Field`; `formatTime`, `formatDate`, `manilaDate`, `manilaInstant`, `parseClock`; `localMobile`; `useRouter`, `notFound`.
- Produces:
  - From `@/lib/dashboard`: `type BookingOptions = { dentists: { id: string; name: string }[]; procedures: { id: string; name: string; minutes: number }[] }`, `loadBookingOptions(staff: Staff): Promise<BookingOptions>` (active only), `type MoveTarget = { id: string; status: Status; startsAt: string; duration: number; dentistId: string; patientName: string; procedures: string[] }`, `loadMoveTarget(staff: Staff, id: string): Promise<MoveTarget | null>`
  - From `src/app/app/actions.ts`: `openTimes(q: unknown): Promise<string[]>` (`q = { dentistId, date, duration, ignoreId? }`), `createVisit(input: unknown): Promise<Done>`, `moveVisit(id: unknown, slot: unknown): Promise<Done>`
  - `SlotPicker` (`{ dentists; duration; today; initialDentistId?; ignoreId?; onChange(slot: Slot | null) }`) and `type Slot = { dentistId: string; startsAt: string; custom: boolean }`
  - Routes `/app/new?patient={id}` and `/app/schedule/move/[id]`

New appointment (spec 5.3): find a patient (search by name or mobile) or add a new one (mobile optional), choose procedures (total length shown), then dentist, date, and an open time or a custom time. "Send confirmation text" shows only when the patient has a mobile and is on by default. After saving, the Schedule opens on that day, where a failed text shows as "Text not delivered". Move uses the same picker with the visit's own time ignored.

- [ ] **Step 1: Write the failing database test**

In `tests/db/dashboard.test.ts`, replace:

```ts
import { loadDay, loadRequests } from "@/lib/dashboard";
```

with:

```ts
import { loadBookingOptions, loadDay, loadMoveTarget, loadRequests } from "@/lib/dashboard";
```

and append to the end of the file:

```ts
describe("loadBookingOptions", () => {
  it("offers active dentists and procedures only, of this clinic only", async () => {
    const { data: archived } = await db
      .from("procedures")
      .insert({ clinic_id: a.staff.clinicId, name: "Archived thing", duration_minutes: 30, active: false })
      .select("id")
      .single()
      .throwOnError();
    const options = await loadBookingOptions(a.staff);
    expect(options.dentists).toEqual([{ id: a.seed.dentist.id, name: "Dr. Ana Reyes" }]);
    expect(options.procedures.map((p) => [p.name, p.minutes])).toEqual([
      ["Cleaning", 60],
      ["Consultation", 30],
    ]);
    expect(options.procedures.map((p) => p.id)).not.toContain(archived.id);
    expect((await loadBookingOptions(b.staff)).dentists).toEqual([{ id: b.seed.dentist.id, name: "Dr. Ana Reyes" }]);
  });
});

describe("loadMoveTarget", () => {
  it("returns the visit with its length, and nothing for another clinic", async () => {
    const id = await book(a, addDays(today, 7), 600, "confirmed");
    expect(await loadMoveTarget(a.staff, id)).toEqual({
      id,
      status: "confirmed",
      startsAt: expect.any(String),
      duration: 30,
      dentistId: a.seed.dentist.id,
      patientName: "Ana Cruz",
      procedures: ["Consultation"],
    });
    expect(await loadMoveTarget(b.staff, id)).toBeNull();
    expect(await loadMoveTarget(a.staff, "nope")).toBeNull();
  });
});
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: FAIL, `loadBookingOptions` and `loadMoveTarget` are not exported.

- [ ] **Step 2: Add the loaders**

In `src/lib/dashboard.ts`, replace:

```ts
import "server-only";
import { busyBetween } from "@/lib/availability";
```

with:

```ts
import "server-only";
import type { Status } from "@/lib/appointments";
import { busyBetween } from "@/lib/availability";
```

replace:

```ts
import { addDays, manilaInstant, parseClock, weekday } from "@/lib/time";
```

with:

```ts
import { addDays, manilaInstant, parseClock, weekday } from "@/lib/time";
import { isUuid } from "@/lib/validate";
```

and append to the end of the file:

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
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
    })),
  };
}

export type MoveTarget = {
  id: string;
  status: Status;
  startsAt: string;
  duration: number;
  dentistId: string;
  patientName: string;
  procedures: string[];
};

/** The visit the Move screen works on, or null for a malformed id or another clinic's visit. */
export async function loadMoveTarget(staff: Staff, id: string): Promise<MoveTarget | null> {
  if (!isUuid(id)) return null;
  const { data } = await staff.db
    .from("appointments")
    .select("id, status, starts_at, ends_at, dentist_id, procedure_names, patient:patients(first_name, last_name)")
    .eq("id", id)
    .eq("clinic_id", staff.clinicId)
    .maybeSingle()
    .throwOnError();
  const row = data as unknown as {
    id: string;
    status: Status;
    starts_at: string;
    ends_at: string;
    dentist_id: string;
    procedure_names: string[];
    patient: { first_name: string; last_name: string };
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    duration: (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000,
    dentistId: row.dentist_id,
    patientName: `${row.patient.first_name} ${row.patient.last_name}`,
    procedures: row.procedure_names,
  };
}
```

Run: `npx vitest run tests/db/dashboard.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 3: Add the open times, New, and Move actions**

In `src/app/app/actions.ts`, replace:

```ts
import { refresh } from "next/cache";
import { changeStatus, type ActionResult, type StaffTarget } from "@/lib/appointment-actions";
import { requireStaff } from "@/lib/supabase/server";
```

with:

```ts
import { refresh } from "next/cache";
import { changeStatus, createAppointment, moveAppointment, type ActionResult, type StaffTarget } from "@/lib/appointment-actions";
import { staffOpenStarts } from "@/lib/dashboard";
import { parseDay } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validate";
```

and append to the end of the file:

```ts
// 20 procedures of up to 480 minutes each.
const MAX_DURATION = 20 * 480;

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
    return starts.map((s) => s.toISOString());
  } catch (e) {
    console.error("openTimes failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return [];
  }
}

/** Spec 5.3 New appointment. */
export async function createVisit(input: unknown): Promise<Done> {
  const staff = await requireStaff();
  const result = await createAppointment(staff, input, new Date());
  if (result.ok) refresh();
  return done(result);
}

/** Spec 9.2 moved. */
export async function moveVisit(id: unknown, slot: unknown): Promise<Done> {
  const staff = await requireStaff();
  const result = await moveAppointment(staff, String(id), slot, new Date());
  if (result.ok) refresh();
  return done(result);
}
```

- [ ] **Step 4: Write the time picker**

Create `src/app/app/SlotPicker.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import Field from "@/components/Field";
import { formatTime, manilaInstant, parseClock } from "@/lib/time";
import { openTimes } from "./actions";

export type Slot = { dentistId: string; startsAt: string; custom: boolean };

type Props = {
  dentists: { id: string; name: string }[];
  duration: number;
  today: string;
  initialDentistId?: string;
  ignoreId?: string;
  onChange: (slot: Slot | null) => void;
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Dentist, date, then an open time or a custom time (spec 5.3). The parent remounts it (key) when the
 * duration changes, so nothing here reacts to props in an effect.
 */
export default function SlotPicker({ dentists, duration, today, initialDentistId, ignoreId, onChange }: Props) {
  const [dentistId, setDentistId] = useState(initialDentistId ?? dentists[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [starts, setStarts] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [clock, setClock] = useState("");
  const loads = useRef(0);

  function choose(slot: Slot | null) {
    setPicked(slot && !slot.custom ? slot.startsAt : null);
    onChange(slot);
  }

  async function load(nextDentist: string, nextDate: string) {
    const n = ++loads.current; // drop any answer still in flight for an older choice
    setStarts(null);
    setClock("");
    choose(null);
    if (!nextDentist || !nextDate) return;
    try {
      const list = await openTimes({ dentistId: nextDentist, date: nextDate, duration, ignoreId });
      if (n === loads.current) setStarts(list);
    } catch {
      if (n === loads.current) setStarts([]);
    }
  }

  function setCustomClock(value: string) {
    setClock(value);
    choose(CLOCK.test(value) && date ? { dentistId, startsAt: manilaInstant(date, parseClock(value)).toISOString(), custom: true } : null);
  }

  return (
    <fieldset>
      <legend className="sr-only">Time</legend>
      {dentists.length > 1 && (
        <label className="block">
          <span className="f-label">Dentist</span>
          <select
            className="f-input"
            value={dentistId}
            onChange={(e) => {
              setDentistId(e.target.value);
              void load(e.target.value, date);
            }}
          >
            {dentists.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mt-4 block">
        <span className="f-label">Date</span>
        <input
          type="date"
          className="f-input"
          min={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            void load(dentistId, e.target.value);
          }}
        />
      </label>

      {date && !custom && (
        <div className="mt-4" aria-live="polite">
          {starts === null && <p className="f-hint">Finding open times...</p>}
          {starts?.length === 0 && <p className="f-hint">No open times on this day. Try another day, or use a custom time.</p>}
          {starts && starts.length > 0 && (
            <div className="slot-grid" role="radiogroup" aria-label="Open times">
              {starts.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={picked === iso}
                  className={`slot${picked === iso ? " sel" : ""}`}
                  onClick={() => choose({ dentistId, startsAt: iso, custom: false })}
                >
                  {formatTime(new Date(iso))}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {date && (
        <label className="member-row mt-3">
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => {
              setCustom(e.target.checked);
              setClock("");
              choose(null);
            }}
          />
          <span className="nm">Use a custom time</span>
        </label>
      )}

      {date && custom && (
        <Field label="Start time" hint="A custom time may be outside working hours. It can never overlap another visit.">
          <input type="time" step={300} className="f-input" value={clock} onChange={(e) => setCustomClock(e.target.value)} />
        </Field>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 5: Write the New appointment screen**

Create `src/app/app/new/NewAppointment.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import Field from "@/components/Field";
import type { BookingOptions } from "@/lib/dashboard";
import type { PatientHit } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { manilaDate } from "@/lib/time";
import { createVisit } from "../actions";
import { findPatients } from "../patients/actions";
import SlotPicker, { type Slot } from "../SlotPicker";

type Props = BookingOptions & { today: string; initialPatient: PatientHit | null };

/** Spec 5.3 New appointment: for walk-ins, phone and Messenger bookings, seniors and PWDs. Confirmed immediately. */
export default function NewAppointment({ dentists, procedures, today, initialPatient }: Props) {
  const router = useRouter();
  const [patient, setPatient] = useState<PatientHit | null>(initialPatient);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState({ first: "", last: "", mobile: "" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [procedureIds, setProcedureIds] = useState<string[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [sendText, setSendText] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const searches = useRef(0);

  const duration = procedures.filter((p) => procedureIds.includes(p.id)).reduce((sum, p) => sum + p.minutes, 0);
  const hasMobile = patient ? Boolean(patient.mobile) : adding && fields.mobile.trim() !== "";
  const hasPatient = patient !== null || (adding && fields.first.trim() !== "" && fields.last.trim() !== "");
  const ready = hasPatient && procedureIds.length > 0 && slot !== null;

  async function search(e: FormEvent) {
    e.preventDefault();
    const n = ++searches.current;
    setHits(null);
    const list = await findPatients(query);
    if (n === searches.current) setHits(list);
  }

  function toggleProcedure(id: string) {
    setProcedureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setSlot(null); // the picker remounts (its key is the chosen procedures)
  }

  function submit() {
    if (!slot) return;
    setError("");
    const input = {
      patientId: patient?.id ?? null,
      patient: patient ? null : fields,
      procedureIds,
      slot,
      sendText: hasMobile && sendText,
    };
    startTransition(async () => {
      const result = await createVisit(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/app/schedule?date=${manilaDate(new Date(slot.startsAt))}`);
    });
  }

  return (
    <>
      <section className="card card-pad mb-3" aria-labelledby="patient-h">
        <h2 id="patient-h" className="font-display text-[17px] font-bold">
          Patient
        </h2>
        {patient ? (
          <div className="member-row cursor-default">
            <span className="nm">
              {patient.first} {patient.last}
              <span className="meta block">{patient.mobile ? localMobile(patient.mobile) : "No mobile, so no texts"}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setPatient(null)}>
              Change
            </button>
          </div>
        ) : adding ? (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="First name">
                <input className="f-input" maxLength={50} value={fields.first} onChange={(e) => setFields({ ...fields, first: e.target.value })} />
              </Field>
              <Field label="Last name">
                <input className="f-input" maxLength={50} value={fields.last} onChange={(e) => setFields({ ...fields, last: e.target.value })} />
              </Field>
            </div>
            <Field label="Mobile" optional hint="Leave blank for patients without a phone. No mobile means no texts.">
              <input
                className="f-input"
                type="tel"
                inputMode="tel"
                value={fields.mobile}
                onChange={(e) => setFields({ ...fields, mobile: e.target.value })}
              />
            </Field>
            <button type="button" className="link py-3" onClick={() => setAdding(false)}>
              Find an existing patient instead
            </button>
          </>
        ) : (
          <>
            <form onSubmit={search} role="search" className="mt-2 flex gap-2">
              <input
                className="f-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or mobile"
                aria-label="Find a patient by name or mobile"
              />
              <button type="submit" className="btn btn-soft">
                Find
              </button>
            </form>
            {hits?.length === 0 && <p className="f-hint mt-2">No patient matches. Add them as a new patient.</p>}
            {hits && hits.length > 0 && (
              <div className="member-list mt-2">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="member-row w-full text-left"
                    onClick={() => {
                      setPatient(h);
                      setHits(null);
                    }}
                  >
                    <span className="nm">
                      {h.first} {h.last}
                    </span>
                    <span className="meta">{h.mobile ? localMobile(h.mobile) : "No mobile"}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost mt-3" onClick={() => setAdding(true)}>
              New patient
            </button>
          </>
        )}
      </section>

      <section className="card card-pad mb-3" aria-labelledby="what-h">
        <h2 id="what-h" className="font-display text-[17px] font-bold">
          Procedures
        </h2>
        <div className="member-list mt-2">
          {procedures.map((p) => (
            <label key={p.id} className="member-row">
              <input type="checkbox" checked={procedureIds.includes(p.id)} onChange={() => toggleProcedure(p.id)} />
              <span className="nm">{p.name}</span>
              <span className="meta">{p.minutes} min</span>
            </label>
          ))}
        </div>
        {duration > 0 && <p className="f-hint">Total: {duration} minutes</p>}
      </section>

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

      <section className="card card-pad">
        {hasMobile && (
          <label className="member-row">
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            <span className="nm">Send confirmation text</span>
          </label>
        )}
        {error && (
          <p className="field-err" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary wide-btn mt-3" disabled={!ready || pending} onClick={submit}>
          {pending ? "Booking..." : "Book and confirm"}
        </button>
      </section>
    </>
  );
}
```

Create `src/app/app/new/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import NewAppointment from "./NewAppointment";
import { loadBookingOptions } from "@/lib/dashboard";
import { loadPatient } from "@/lib/patients";
import { requireStaff } from "@/lib/supabase/server";
import { manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "New appointment" };

type Props = { searchParams: Promise<{ patient?: string | string[] }> };

/** Spec 5.3 New appointment. `?patient={id}` starts with that patient chosen (from the patient page). */
export default async function NewAppointmentPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { patient } = await searchParams;
  const [options, detail] = await Promise.all([
    loadBookingOptions(staff),
    typeof patient === "string" ? loadPatient(staff, patient) : Promise.resolve(null),
  ]);
  const initialPatient =
    detail && !detail.patient.anonymized
      ? { id: detail.patient.id, first: detail.patient.first, last: detail.patient.last, mobile: detail.patient.mobile }
      : null;

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">New appointment</h1>
      </div>
      {options.dentists.length === 0 || options.procedures.length === 0 ? (
        <p className="note-box warn">
          Add an active dentist and a procedure in{" "}
          <Link href="/app/settings" className="link">
            Settings
          </Link>{" "}
          first.
        </p>
      ) : (
        <NewAppointment {...options} today={manilaDate(new Date())} initialPatient={initialPatient} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Write the Move screen**

Create `src/app/app/schedule/move/[id]/MoveForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { manilaDate } from "@/lib/time";
import { moveVisit } from "../../../actions";
import SlotPicker, { type Slot } from "../../../SlotPicker";

type Props = {
  id: string;
  dentists: { id: string; name: string }[];
  duration: number;
  dentistId: string;
  today: string;
};

/** Pick the new time, then move and text the patient (spec 9.2 moved). */
export default function MoveForm({ id, dentists, duration, dentistId, today }: Props) {
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!slot) return;
    setError("");
    startTransition(async () => {
      const result = await moveVisit(id, slot);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/app/schedule?date=${manilaDate(new Date(slot.startsAt))}`);
    });
  }

  return (
    <div className="card card-pad">
      <SlotPicker
        dentists={dentists}
        duration={duration}
        today={today}
        initialDentistId={dentists.some((d) => d.id === dentistId) ? dentistId : undefined}
        ignoreId={id}
        onChange={setSlot}
      />
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary wide-btn mt-5" disabled={!slot || pending} onClick={submit}>
        {pending ? "Moving..." : "Move and text the patient"}
      </button>
    </div>
  );
}
```

Create `src/app/app/schedule/move/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MoveForm from "./MoveForm";
import { loadBookingOptions, loadMoveTarget } from "@/lib/dashboard";
import { requireStaff } from "@/lib/supabase/server";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

export const metadata: Metadata = { title: "Move appointment" };

type Props = { params: Promise<{ id: string }> };

/** Move a confirmed visit that has not started to a new time or dentist. */
export default async function MovePage({ params }: Props) {
  const staff = await requireStaff();
  const { id } = await params;
  const [target, options] = await Promise.all([loadMoveTarget(staff, id), loadBookingOptions(staff)]);
  if (!target) notFound();
  const now = new Date();
  const start = new Date(target.startsAt);
  const movable = target.status === "confirmed" && start > now;

  return (
    <>
      <Link href={`/app/schedule?date=${manilaDate(start)}`} className="back-arrow min-h-11">
        Back to the schedule
      </Link>
      <div className="page-head">
        <h1 className="font-display">Move appointment</h1>
      </div>
      <div className="card card-pad mb-3">
        <p className="who font-semibold">{target.patientName}</p>
        <p className="f-hint">
          Now: {formatDate(start)}, {formatTime(start)} ({target.duration} min). {target.procedures.join(", ")}
        </p>
      </div>
      {movable ? (
        <MoveForm id={target.id} dentists={options.dentists} duration={target.duration} dentistId={target.dentistId} today={manilaDate(now)} />
      ) : (
        <p className="note-box warn">Only upcoming confirmed visits can be moved.</p>
      )}
    </>
  );
}
```

- [ ] **Step 7: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build lists `/app/new` and `/app/schedule/move/[id]`.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/dashboard.ts src/app/app/actions.ts src/app/app/SlotPicker.tsx src/app/app/new "src/app/app/schedule/move" tests/db/dashboard.test.ts; git commit -m "feat: add the New appointment and Move screens"
```

---

### Task 8: Settings validation and services

**Files:**
- Create: `src/lib/settings-input.ts`, `src/lib/clinic-settings.ts`
- Test: `tests/unit/settings-input.test.ts`, `tests/db/clinic-settings.test.ts`

**Interfaces:**
- Consumes: `clinicProblems`, `dentistProblems`, `type Clock`, `type OnboardingInput` from `@/lib/onboarding` (the same rules as onboarding: names, short names that can't start with "test", booking link, mobile, address, weekly hours with up to 6 non-overlapping blocks per day and at least one block); `normalizeMobile`; `manilaInstant`, `formatClock`, `parseClock`; `cleanText`, `isUuid`, `LIMITS`; `type Saved`; `type Staff`.
- Produces:
  - From `@/lib/settings-input` (pure): `type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string }`, `parseProfile(value: unknown): Parsed<ProfileRow>`, `parseRules(value: unknown): Parsed<RulesRow>`, `parseDentist(value: unknown): Parsed<DentistRow>`, `parseTimeOff(value: unknown, now: Date): Parsed<TimeOffRow>`, `parseProcedure(value: unknown): Parsed<ProcedureRow>`, and the row types (`ProfileRow` uses database column names so it can be written as is)
  - From `@/lib/clinic-settings` (server only): `type SettingsView`, `loadSettings(staff: Staff, now: Date): Promise<SettingsView>`, `saveProfile(staff, input: unknown): Promise<Saved>`, `saveRules(staff, input: unknown): Promise<Saved>`, `saveDentist(staff, id: string | null, input: unknown): Promise<Saved>`, `setDentistActive(staff, id: string, active: boolean): Promise<Saved>`, `addTimeOff(staff, dentistId: string, input: unknown, now: Date): Promise<Saved>`, `removeTimeOff(staff, id: string): Promise<Saved>`, `saveProcedure(staff, id: string | null, input: unknown): Promise<Saved>`, `setProcedureActive(staff, id: string, active: boolean): Promise<Saved>`

Settings (spec 5.3): the profile adds the map link Plan 2 deferred (optional, `https://` only, up to 300 characters). A clinic must keep at least one active dentist and one active procedure, or its booking page stops working. Changing hours or adding time off never cancels anything; affected visits show "Outside hours" on the Schedule (spec 13). Procedures are archived, never deleted, so past appointments keep their names. Time off is entered with two `datetime-local` inputs and read as Manila time.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/settings-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
import { manilaInstant } from "@/lib/time";

const profile = {
  name: " Elite Dental ",
  smsName: "Elite Dental",
  slug: "elite-dental",
  mobile: "0917 123 4567",
  address: "Makati",
  mapsUrl: "",
};

describe("parseProfile", () => {
  it("cleans the profile and stores an empty map link as null", () => {
    expect(parseProfile(profile)).toEqual({
      ok: true,
      value: { name: "Elite Dental", sms_name: "Elite Dental", slug: "elite-dental", mobile: "+639171234567", address: "Makati", maps_url: null },
    });
  });

  it("keeps an https map link and refuses anything else", () => {
    const url = "https://maps.app.goo.gl/abc123";
    expect(parseProfile({ ...profile, mapsUrl: url })).toMatchObject({ ok: true, value: { maps_url: url } });
    expect(parseProfile({ ...profile, mapsUrl: "http://maps.example" })).toMatchObject({ ok: false, field: "mapsUrl" });
    expect(parseProfile({ ...profile, mapsUrl: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "mapsUrl" });
    expect(parseProfile({ ...profile, mapsUrl: `https://x.example/${"a".repeat(300)}` })).toMatchObject({ ok: false, field: "mapsUrl" });
  });

  it("uses the onboarding rules for the rest", () => {
    expect(parseProfile({ ...profile, slug: "app" })).toMatchObject({ ok: false, field: "slug" });
    expect(parseProfile({ ...profile, smsName: "Test Clinic" })).toMatchObject({ ok: false, field: "smsName" });
    expect(parseProfile({ ...profile, mobile: "02 8123 4567" })).toMatchObject({ ok: false, field: "mobile" });
  });
});

describe("parseRules", () => {
  const rules = { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60, alertChannel: "sms" };

  it("accepts the allowed values", () => {
    expect(parseRules(rules)).toEqual({
      ok: true,
      value: { slot_minutes: 30, min_notice_minutes: 120, max_days_ahead: 60, alert_channel: "sms" },
    });
    expect(parseRules({ ...rules, slotMinutes: "15", minNoticeMinutes: "0", maxDaysAhead: "365", alertChannel: "push" }).ok).toBe(true);
  });

  it("refuses anything outside them", () => {
    expect(parseRules({ ...rules, slotMinutes: 20 })).toMatchObject({ field: "slotMinutes" });
    expect(parseRules({ ...rules, minNoticeMinutes: 10081 })).toMatchObject({ field: "minNoticeMinutes" });
    expect(parseRules({ ...rules, minNoticeMinutes: -1 })).toMatchObject({ field: "minNoticeMinutes" });
    expect(parseRules({ ...rules, maxDaysAhead: 0 })).toMatchObject({ field: "maxDaysAhead" });
    expect(parseRules({ ...rules, maxDaysAhead: 1.5 })).toMatchObject({ field: "maxDaysAhead" });
    expect(parseRules({ ...rules, alertChannel: "email" })).toMatchObject({ field: "alertChannel" });
  });
});

describe("parseDentist", () => {
  const week = [[], [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }], [], [], [], [], []];

  it("flattens several blocks per day into rows", () => {
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: week })).toEqual({
      ok: true,
      value: {
        name: "Dr. Ben Lim",
        sms_name: "Dr. Lim",
        hours: [
          { weekday: 1, start_time: "09:00", end_time: "12:00" },
          { weekday: 1, start_time: "13:00", end_time: "17:00" },
        ],
      },
    });
  });

  it("names the field that is wrong", () => {
    expect(parseDentist({ name: "", smsName: "Dr. Lim", hours: week })).toMatchObject({ field: "name" });
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "x".repeat(17), hours: week })).toMatchObject({ field: "smsName" });
    const overlap = [[], [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }], [], [], [], [], []];
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: overlap })).toMatchObject({ field: "hours" });
    expect(parseDentist({ name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: "all day" })).toMatchObject({ field: "hours" });
  });
});

describe("parseTimeOff", () => {
  const now = new Date("2026-09-25T00:00:00Z");

  it("reads datetime-local values as Manila time", () => {
    expect(parseTimeOff({ from: "2026-10-01T09:00", to: "2026-10-01T12:30", note: " Seminar " }, now)).toEqual({
      ok: true,
      value: {
        starts_at: manilaInstant("2026-10-01", 540).toISOString(),
        ends_at: manilaInstant("2026-10-01", 750).toISOString(),
        note: "Seminar",
      },
    });
    expect(parseTimeOff({ from: "2026-10-01T09:00:00", to: "2026-10-02T09:00:00", note: "" }, now).ok).toBe(true);
  });

  it("refuses bad, reversed, past, or long input", () => {
    expect(parseTimeOff({ from: "2026-02-30T09:00", to: "2026-03-01T09:00" }, now)).toMatchObject({ field: "from" });
    expect(parseTimeOff({ from: "2026-10-01T12:00", to: "2026-10-01T09:00" }, now)).toMatchObject({ field: "to" });
    expect(parseTimeOff({ from: "2026-09-01T09:00", to: "2026-09-02T09:00" }, now)).toMatchObject({ field: "to" });
    expect(parseTimeOff({ from: "2026-10-01T09:00", to: "2026-10-01T10:00", note: "n".repeat(101) }, now)).toMatchObject({ field: "note" });
  });
});

describe("parseProcedure", () => {
  it("accepts a name and 5 to 480 minutes", () => {
    expect(parseProcedure({ name: " Braces Adjustment ", minutes: "45" })).toEqual({
      ok: true,
      value: { name: "Braces Adjustment", duration_minutes: 45 },
    });
  });

  it("refuses the rest", () => {
    expect(parseProcedure({ name: "", minutes: 30 })).toMatchObject({ field: "name" });
    expect(parseProcedure({ name: "X", minutes: 4 })).toMatchObject({ field: "minutes" });
    expect(parseProcedure({ name: "X", minutes: 481 })).toMatchObject({ field: "minutes" });
    expect(parseProcedure({ name: "X", minutes: "" })).toMatchObject({ field: "minutes" });
  });
});
```

Run: `npx vitest run tests/unit/settings-input.test.ts`
Expected: FAIL, cannot resolve `@/lib/settings-input`.

- [ ] **Step 2: Write the settings validation**

Create `src/lib/settings-input.ts`:

```ts
import { clinicProblems, dentistProblems, type Clock, type OnboardingInput } from "@/lib/onboarding";
import { normalizeMobile } from "@/lib/phone";
import { manilaInstant } from "@/lib/time";
import { cleanText, LIMITS } from "@/lib/validate";

export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; error: string };

export type ProfileRow = { name: string; sms_name: string; slug: string; mobile: string; address: string; maps_url: string | null };
export type RulesRow = { slot_minutes: number; min_notice_minutes: number; max_days_ahead: number; alert_channel: "push" | "sms" };
export type DentistRow = { name: string; sms_name: string; hours: { weekday: number; start_time: string; end_time: string }[] };
export type TimeOffRow = { starts_at: string; ends_at: string; note: string };
export type ProcedureRow = { name: string; duration_minutes: number };

const record = (value: unknown) => (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const fail = (field: string, error: string) => ({ ok: false as const, field, error });

function mapsUrlOk(url: string): boolean {
  if (url.length > LIMITS.mapsUrl || !url.startsWith("https://")) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Clinic profile (spec 5.3): the onboarding rules, plus an optional https map link (a Plan 2 deferral). */
export function parseProfile(value: unknown): Parsed<ProfileRow> {
  const v = record(value);
  const input = { name: text(v.name), smsName: text(v.smsName), slug: text(v.slug), mobile: text(v.mobile), address: text(v.address) };
  const problem = Object.entries(clinicProblems(input as OnboardingInput))[0];
  if (problem) return fail(problem[0], problem[1]);
  const mapsUrl = text(v.mapsUrl).trim();
  if (mapsUrl && !mapsUrlOk(mapsUrl)) return fail("mapsUrl", `Paste a map link that starts with https://, up to ${LIMITS.mapsUrl} characters.`);
  return {
    ok: true,
    value: {
      name: input.name.trim(),
      sms_name: input.smsName.trim(),
      slug: input.slug,
      mobile: normalizeMobile(input.mobile)!,
      address: input.address.trim(),
      maps_url: mapsUrl || null,
    },
  };
}

/** Booking rules and the alert channel (spec 5.3 and 7). Form values may arrive as strings. */
export function parseRules(value: unknown): Parsed<RulesRow> {
  const v = record(value);
  const slot = Number(v.slotMinutes);
  const notice = Number(v.minNoticeMinutes);
  const days = Number(v.maxDaysAhead);
  const channel = v.alertChannel;
  if (![15, 30, 60].includes(slot)) return fail("slotMinutes", "Choose 15, 30, or 60 minutes.");
  if (!Number.isInteger(notice) || notice < 0 || notice > 10080) return fail("minNoticeMinutes", "Use no notice up to 7 days.");
  if (!Number.isInteger(days) || days < 1 || days > 365) return fail("maxDaysAhead", "Use 1 to 365 days.");
  if (channel !== "push" && channel !== "sms") return fail("alertChannel", "Choose push or text.");
  return { ok: true, value: { slot_minutes: slot, min_notice_minutes: notice, max_days_ahead: days, alert_channel: channel } };
}

const DENTIST_FIELD = { dentistName: "name", dentistSmsName: "smsName", hours: "hours" } as Record<string, string>;

/** A dentist with weekly hours (several blocks per day), checked by the onboarding rules. */
export function parseDentist(value: unknown): Parsed<DentistRow> {
  const v = record(value);
  const input = { dentistName: text(v.name), dentistSmsName: text(v.smsName), hours: v.hours };
  const problem = Object.entries(dentistProblems(input as OnboardingInput))[0];
  if (problem) return fail(DENTIST_FIELD[problem[0]], problem[1]);
  const hours = (v.hours as Clock[][]).flatMap((blocks, weekday) => blocks.map((b) => ({ weekday, start_time: b.start, end_time: b.end })));
  return { ok: true, value: { name: input.dentistName.trim(), sms_name: input.dentistSmsName.trim(), hours } };
}

const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::00)?$/;

/** A datetime-local value ("2026-10-01T09:00") as a Manila wall-clock instant, or null. */
function manilaLocal(value: unknown): Date | null {
  const m = typeof value === "string" ? LOCAL.exec(value) : null;
  if (!m) return null;
  const day = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== m[1]) return null;
  return manilaInstant(m[1], Number(m[2]) * 60 + Number(m[3]));
}

/** Time off (spec 7): start before end, not already over, a note up to 100 characters. */
export function parseTimeOff(value: unknown, now: Date): Parsed<TimeOffRow> {
  const v = record(value);
  const start = manilaLocal(v.from);
  const end = manilaLocal(v.to);
  if (!start) return fail("from", "Enter when the time off starts.");
  if (!end || end <= start) return fail("to", "The end must be after the start.");
  if (end <= now) return fail("to", "This time off is already over.");
  const note = cleanText(v.note, LIMITS.timeOffNote, true);
  if (note === null) return fail("note", `Keep the note to ${LIMITS.timeOffNote} characters or fewer.`);
  return { ok: true, value: { starts_at: start.toISOString(), ends_at: end.toISOString(), note } };
}

/** A procedure: name up to 60 characters, 5 to 480 minutes. */
export function parseProcedure(value: unknown): Parsed<ProcedureRow> {
  const v = record(value);
  const name = cleanText(v.name, LIMITS.procedureName);
  if (!name) return fail("name", `Enter a name, up to ${LIMITS.procedureName} characters.`);
  const minutes = typeof v.minutes === "string" && v.minutes.trim() === "" ? NaN : Number(v.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return fail("minutes", "Use 5 to 480 minutes.");
  return { ok: true, value: { name, duration_minutes: minutes } };
}
```

Run: `npx vitest run tests/unit/settings-input.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test**

Create `tests/db/clinic-settings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTimeOff,
  loadSettings,
  removeTimeOff,
  saveDentist,
  saveProcedure,
  saveProfile,
  saveRules,
  setDentistActive,
  setProcedureActive,
} from "@/lib/clinic-settings";
import { addDays, manilaDate } from "@/lib/time";
import { adminDb, dropStaffClinic, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
let a: StaffSeed;
let b: StaffSeed;
const week = (start: string, end: string) => [[], [{ start, end }], [], [], [], [], []];
const later = addDays(manilaDate(new Date()), 10);

beforeAll(async () => {
  a = await staffClinic();
  b = await staffClinic();
});

afterAll(async () => {
  await dropStaffClinic(a);
  await dropStaffClinic(b);
});

async function clinicRow(id: string) {
  const { data } = await db.from("clinics").select("*").eq("id", id).single().throwOnError();
  return data;
}

describe("profile and rules", () => {
  it("saves the profile with a map link", async () => {
    const input = {
      name: "Renamed Clinic",
      smsName: "Renamed",
      slug: a.seed.clinic.slug,
      mobile: "0917 555 0000",
      address: "Cebu City",
      mapsUrl: "https://maps.app.goo.gl/abc",
    };
    expect(await saveProfile(a.staff, input)).toEqual({ ok: true });
    expect(await clinicRow(a.staff.clinicId)).toMatchObject({
      name: "Renamed Clinic",
      sms_name: "Renamed",
      mobile: "+639175550000",
      address: "Cebu City",
      maps_url: "https://maps.app.goo.gl/abc",
    });
    expect((await clinicRow(b.staff.clinicId)).name).toBe("Staff Clinic");
  });

  it("reports a booking link another clinic uses", async () => {
    const input = { name: "X", smsName: "X", slug: b.seed.clinic.slug, mobile: "09175550000", address: "Cebu", mapsUrl: "" };
    expect(await saveProfile(a.staff, input)).toEqual({ ok: false, field: "slug", error: "That booking link is taken. Try another." });
    expect((await clinicRow(a.staff.clinicId)).slug).toBe(a.seed.clinic.slug);
  });

  it("saves booking rules and the alert channel", async () => {
    const rules = { slotMinutes: 15, minNoticeMinutes: 60, maxDaysAhead: 30, alertChannel: "sms" };
    expect(await saveRules(a.staff, rules)).toEqual({ ok: true });
    expect(await clinicRow(a.staff.clinicId)).toMatchObject({ slot_minutes: 15, min_notice_minutes: 60, max_days_ahead: 30, alert_channel: "sms" });
    expect(await saveRules(a.staff, { ...rules, slotMinutes: 45 })).toMatchObject({ ok: false, field: "slotMinutes" });
  });
});

describe("dentists and hours", () => {
  let lim: string;

  it("adds a dentist with hours and replaces the hours on edit", async () => {
    expect(await saveDentist(a.staff, null, { name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: week("09:00", "12:00") })).toEqual({ ok: true });
    let view = await loadSettings(a.staff, new Date());
    const added = view.dentists.find((d) => d.name === "Dr. Ben Lim")!;
    lim = added.id;
    expect(added.hours[1]).toEqual([{ start: "09:00", end: "12:00" }]);

    const twoBlocks = [[], [{ start: "08:00", end: "11:00" }, { start: "14:00", end: "18:00" }], [], [], [], [], []];
    expect(await saveDentist(a.staff, lim, { name: "Dr. Ben Lim", smsName: "Dr. Lim", hours: twoBlocks })).toEqual({ ok: true });
    view = await loadSettings(a.staff, new Date());
    expect(view.dentists.find((d) => d.id === lim)!.hours[1]).toEqual([
      { start: "08:00", end: "11:00" },
      { start: "14:00", end: "18:00" },
    ]);
    const { count } = await db.from("working_hours").select("id", { count: "exact", head: true }).eq("dentist_id", lim).throwOnError();
    expect(count).toBe(2);
  });

  it("deactivates a dentist but never the last active one", async () => {
    expect(await setDentistActive(a.staff, lim, false)).toEqual({ ok: true });
    expect(await setDentistActive(a.staff, a.seed.dentist.id, false)).toMatchObject({ ok: false });
    expect(await setDentistActive(a.staff, lim, true)).toEqual({ ok: true });
  });

  it("changes nothing for another clinic", async () => {
    expect(await saveDentist(b.staff, lim, { name: "Hacked", smsName: "Hacked", hours: week("01:00", "02:00") })).toMatchObject({ ok: false });
    expect(await setDentistActive(b.staff, lim, false)).toMatchObject({ ok: false });
    const view = await loadSettings(a.staff, new Date());
    expect(view.dentists.find((d) => d.id === lim)).toMatchObject({ name: "Dr. Ben Lim", active: true });
    expect((await loadSettings(b.staff, new Date())).dentists.map((d) => d.id)).toEqual([b.seed.dentist.id]);
  });
});

describe("time off", () => {
  it("adds and removes time off, only in the owner's clinic", async () => {
    const input = { from: `${later}T09:00`, to: `${later}T12:00`, note: "Seminar" };
    expect(await addTimeOff(b.staff, a.seed.dentist.id, input, new Date())).toMatchObject({ ok: false });
    expect(await addTimeOff(a.staff, a.seed.dentist.id, input, new Date())).toEqual({ ok: true });
    const [off] = (await loadSettings(a.staff, new Date())).dentists.find((d) => d.id === a.seed.dentist.id)!.timeOff;
    expect(off.note).toBe("Seminar");

    expect(await removeTimeOff(b.staff, off.id)).toMatchObject({ ok: false });
    expect(await removeTimeOff(a.staff, off.id)).toEqual({ ok: true });
    expect((await loadSettings(a.staff, new Date())).dentists.find((d) => d.id === a.seed.dentist.id)!.timeOff).toEqual([]);
  });
});

describe("procedures", () => {
  it("adds, edits, and archives procedures, keeping at least one active", async () => {
    expect(await saveProcedure(a.staff, null, { name: "Whitening", minutes: 90 })).toEqual({ ok: true });
    let view = await loadSettings(a.staff, new Date());
    const whitening = view.procedures.find((p) => p.name === "Whitening")!;
    expect(await saveProcedure(a.staff, whitening.id, { name: "Teeth Whitening", minutes: 75 })).toEqual({ ok: true });

    for (const p of view.procedures.filter((x) => x.id !== whitening.id)) {
      expect(await setProcedureActive(a.staff, p.id, false)).toEqual({ ok: true });
    }
    expect(await setProcedureActive(a.staff, whitening.id, false)).toMatchObject({ ok: false });
    view = await loadSettings(a.staff, new Date());
    expect(view.procedures.filter((p) => p.active).map((p) => [p.name, p.minutes])).toEqual([["Teeth Whitening", 75]]);
  });

  it("changes nothing for another clinic", async () => {
    const [p] = (await loadSettings(a.staff, new Date())).procedures;
    expect(await saveProcedure(b.staff, p.id, { name: "Hacked", minutes: 30 })).toMatchObject({ ok: false });
    expect(await setProcedureActive(b.staff, p.id, true)).toMatchObject({ ok: false });
    expect((await loadSettings(a.staff, new Date())).procedures.find((x) => x.id === p.id)!.name).toBe(p.name);
  });
});
```

Run: `npx vitest run tests/db/clinic-settings.test.ts`
Expected: FAIL, cannot resolve `@/lib/clinic-settings`.

- [ ] **Step 4: Write the settings service**

Create `src/lib/clinic-settings.ts`:

```ts
import "server-only";
import type { Clock } from "@/lib/onboarding";
import { parseDentist, parseProcedure, parseProfile, parseRules, parseTimeOff } from "@/lib/settings-input";
import type { Saved } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { formatClock, parseClock } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export type SettingsView = {
  clinic: {
    name: string;
    smsName: string;
    slug: string;
    mobile: string;
    address: string;
    mapsUrl: string;
    slotMinutes: number;
    minNoticeMinutes: number;
    maxDaysAhead: number;
    alertChannel: "push" | "sms";
  };
  dentists: {
    id: string;
    name: string;
    smsName: string;
    active: boolean;
    hours: Clock[][];
    timeOff: { id: string; startsAt: string; endsAt: string; note: string }[];
  }[];
  procedures: { id: string; name: string; minutes: number; active: boolean }[];
};

const GENERIC = "Something went wrong. Please try again.";
const GONE = "That item no longer exists. Reload the page.";

function failure(where: string, e: unknown): Saved {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
  return { ok: false, error: GENERIC };
}

/** Everything the Settings page edits. Time off lists only entries that are not over yet. */
export async function loadSettings(staff: Staff, now: Date): Promise<SettingsView> {
  const [clinic, dentists, hours, timeOff, procedures] = await Promise.all([
    staff.db
      .from("clinics")
      .select("name, sms_name, slug, mobile, address, maps_url, slot_minutes, min_notice_minutes, max_days_ahead, alert_channel")
      .eq("id", staff.clinicId)
      .single()
      .throwOnError(),
    staff.db.from("dentists").select("id, name, sms_name, active").eq("clinic_id", staff.clinicId).order("created_at").order("name").throwOnError(),
    staff.db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", staff.clinicId).throwOnError(),
    staff.db
      .from("time_off")
      .select("id, dentist_id, starts_at, ends_at, note")
      .eq("clinic_id", staff.clinicId)
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .throwOnError(),
    staff.db.from("procedures").select("id, name, duration_minutes, active").eq("clinic_id", staff.clinicId).order("name").throwOnError(),
  ]);
  const c = clinic.data as {
    name: string;
    sms_name: string;
    slug: string;
    mobile: string;
    address: string;
    maps_url: string | null;
    slot_minutes: number;
    min_notice_minutes: number;
    max_days_ahead: number;
    alert_channel: "push" | "sms";
  };
  const hourRows = hours.data as { dentist_id: string; weekday: number; start_time: string; end_time: string }[];
  const offRows = timeOff.data as { id: string; dentist_id: string; starts_at: string; ends_at: string; note: string }[];
  const clock = (value: string) => formatClock(parseClock(value));

  return {
    clinic: {
      name: c.name,
      smsName: c.sms_name,
      slug: c.slug,
      mobile: c.mobile,
      address: c.address,
      mapsUrl: c.maps_url ?? "",
      slotMinutes: c.slot_minutes,
      minNoticeMinutes: c.min_notice_minutes,
      maxDaysAhead: c.max_days_ahead,
      alertChannel: c.alert_channel,
    },
    dentists: (dentists.data as { id: string; name: string; sms_name: string; active: boolean }[]).map((d) => ({
      id: d.id,
      name: d.name,
      smsName: d.sms_name,
      active: d.active,
      hours: Array.from({ length: 7 }, (_, day) =>
        hourRows
          .filter((h) => h.dentist_id === d.id && h.weekday === day)
          .map((h) => ({ start: clock(h.start_time), end: clock(h.end_time) }))
          .sort((x, y) => x.start.localeCompare(y.start)),
      ),
      timeOff: offRows
        .filter((t) => t.dentist_id === d.id)
        .map((t) => ({ id: t.id, startsAt: t.starts_at, endsAt: t.ends_at, note: t.note })),
    })),
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number; active: boolean }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
      active: p.active,
    })),
  };
}

/** Clinic profile. RLS lets staff update only their own clinic row. */
export async function saveProfile(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseProfile(input);
  if (!parsed.ok) return parsed;
  try {
    const { error } = await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId);
    if (error?.code === "23505") return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return failure("saveProfile", e);
  }
}

/** Booking rules and the alert channel. */
export async function saveRules(staff: Staff, input: unknown): Promise<Saved> {
  const parsed = parseRules(input);
  if (!parsed.ok) return parsed;
  try {
    await staff.db.from("clinics").update(parsed.value).eq("id", staff.clinicId).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("saveRules", e);
  }
}

/** Adds a dentist (id null) or edits one, and replaces their weekly hours. */
export async function saveDentist(staff: Staff, id: string | null, input: unknown): Promise<Saved> {
  if (id !== null && !isUuid(id)) return { ok: false, error: GONE };
  const parsed = parseDentist(input);
  if (!parsed.ok) return parsed;
  const { name, sms_name, hours } = parsed.value;
  try {
    let dentistId: string;
    if (id === null) {
      const { data } = await staff.db
        .from("dentists")
        .insert({ clinic_id: staff.clinicId, name, sms_name })
        .select("id")
        .single()
        .throwOnError();
      dentistId = (data as { id: string }).id;
    } else {
      const { data } = await staff.db
        .from("dentists")
        .update({ name, sms_name })
        .eq("id", id)
        .eq("clinic_id", staff.clinicId)
        .select("id")
        .throwOnError();
      if (data.length === 0) return { ok: false, error: GONE };
      dentistId = id;
    }
    // ponytail: two statements, not one transaction. The new hours go in before the old rows go, so a
    // failure never leaves a dentist with no hours, and saving again removes any leftover rows.
    const { data: old } = await staff.db
      .from("working_hours")
      .select("id")
      .eq("clinic_id", staff.clinicId)
      .eq("dentist_id", dentistId)
      .throwOnError();
    await staff.db
      .from("working_hours")
      .insert(hours.map((h) => ({ clinic_id: staff.clinicId, dentist_id: dentistId, ...h })))
      .throwOnError();
    const oldIds = (old as { id: string }[]).map((o) => o.id);
    if (oldIds.length > 0) await staff.db.from("working_hours").delete().in("id", oldIds).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("saveDentist", e);
  }
}

/** Deactivates or reactivates a dentist. The clinic keeps at least one active dentist. */
export async function setDentistActive(staff: Staff, id: string, active: boolean): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    if (!active) {
      const { count } = await staff.db
        .from("dentists")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .neq("id", id)
        .throwOnError();
      if ((count ?? 0) === 0) return { ok: false, error: "Keep at least one active dentist, or patients can't book." };
    }
    const { data } = await staff.db.from("dentists").update({ active }).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("setDentistActive", e);
  }
}

/** Time off for one of this clinic's dentists. Existing visits stay and show "Outside hours" (spec 13). */
export async function addTimeOff(staff: Staff, dentistId: string, input: unknown, now: Date): Promise<Saved> {
  if (!isUuid(dentistId)) return { ok: false, error: GONE };
  const parsed = parseTimeOff(input, now);
  if (!parsed.ok) return parsed;
  try {
    const { data: dentist } = await staff.db
      .from("dentists")
      .select("id")
      .eq("id", dentistId)
      .eq("clinic_id", staff.clinicId)
      .maybeSingle()
      .throwOnError();
    if (!dentist) return { ok: false, error: GONE };
    await staff.db.from("time_off").insert({ clinic_id: staff.clinicId, dentist_id: dentistId, ...parsed.value }).throwOnError();
    return { ok: true };
  } catch (e) {
    return failure("addTimeOff", e);
  }
}

export async function removeTimeOff(staff: Staff, id: string): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    const { data } = await staff.db.from("time_off").delete().eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("removeTimeOff", e);
  }
}

/** Adds a procedure (id null) or edits one. Past appointments keep the names they were booked with. */
export async function saveProcedure(staff: Staff, id: string | null, input: unknown): Promise<Saved> {
  if (id !== null && !isUuid(id)) return { ok: false, error: GONE };
  const parsed = parseProcedure(input);
  if (!parsed.ok) return parsed;
  try {
    if (id === null) {
      await staff.db.from("procedures").insert({ clinic_id: staff.clinicId, ...parsed.value }).throwOnError();
      return { ok: true };
    }
    const { data } = await staff.db.from("procedures").update(parsed.value).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("saveProcedure", e);
  }
}

/** Archives or restores a procedure (spec 13: removed means archived). The clinic keeps at least one active. */
export async function setProcedureActive(staff: Staff, id: string, active: boolean): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: GONE };
  try {
    if (!active) {
      const { count } = await staff.db
        .from("procedures")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", staff.clinicId)
        .eq("active", true)
        .neq("id", id)
        .throwOnError();
      if ((count ?? 0) === 0) return { ok: false, error: "Keep at least one active procedure, or patients can't book." };
    }
    const { data } = await staff.db.from("procedures").update({ active }).eq("id", id).eq("clinic_id", staff.clinicId).select("id").throwOnError();
    return data.length > 0 ? { ok: true } : { ok: false, error: GONE };
  } catch (e) {
    return failure("setProcedureActive", e);
  }
}
```

Run: `npx vitest run tests/db/clinic-settings.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/settings-input.ts src/lib/clinic-settings.ts tests/unit/settings-input.test.ts tests/db/clinic-settings.test.ts; git commit -m "feat: add settings validation and services for the clinic, dentists, and procedures" -m "Reuses the onboarding rules, adds the map link Plan 2 deferred, and keeps at least one active dentist and procedure."
```

---

### Task 9: Settings screens

**Files:**
- Create: `src/components/HoursEditor.tsx`, `src/app/app/settings/page.tsx`, `src/app/app/settings/actions.ts`, `src/app/app/settings/ClinicForms.tsx`, `src/app/app/settings/DentistEditor.tsx`, `src/app/app/settings/ProcedureEditor.tsx`
- Modify: `src/app/onboarding/Onboarding.tsx` (uses `HoursEditor`)

**Interfaces:**
- Consumes: every service in `@/lib/clinic-settings` (Task 8), `type SettingsView`; `type Saved`; `type Clock`, `DEFAULT_HOURS` from `@/lib/onboarding`; `passwordProblem` from `@/lib/validate`; `signOut` from `@/app/(auth)/actions`; `Field`; `localMobile`; `formatDate`, `formatTime`.
- Produces:
  - `HoursEditor` (`{ hours: Clock[][]; onChange(hours: Clock[][]): void; error?: string }`) from `@/components/HoursEditor`
  - From `src/app/app/settings/actions.ts`: `updateProfile(input)`, `updateRules(input)`, `saveDentistAction(dentistId: unknown | null, input)`, `setDentistActiveAction(dentistId, active)`, `addTimeOffAction(dentistId, input)`, `removeTimeOffAction(timeOffId)`, `saveProcedureAction(procedureId: unknown | null, input)`, `setProcedureActiveAction(procedureId, active)`, `changePassword(current, next)`, all `Promise<Saved>`
  - From `ClinicForms.tsx`: `ProfileForm`, `RulesForm`, `AccountForms`, `Feedback`, `errorFor`
  - Route `/app/settings`

Settings (spec 5.3): clinic profile (name, short name for texts, booking link with a warning that the old link stops working, mobile, address, map link), booking rules (slot spacing, minimum notice, booking window), alerts (push or text; enabling push on a device comes with Plan 4's installable app, so the screen says alerts arrive by text until then), dentists (add, edit, deactivate or reactivate, weekly hours with several blocks per day, time off), procedures (add, edit, archive or restore), and account (change password after re-entering the current one, sign out).

- [ ] **Step 1: Extract the weekly hours editor**

Create `src/components/HoursEditor.tsx`:

```tsx
"use client";

import type { Clock } from "@/lib/onboarding";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weekly working hours with several blocks per day (spec 5.3 and 5.4). Used by onboarding and Settings. */
export default function HoursEditor({ hours, onChange, error }: { hours: Clock[][]; onChange: (hours: Clock[][]) => void; error?: string }) {
  function setDay(day: number, blocks: Clock[]) {
    onChange(hours.map((b, d) => (d === day ? blocks : b)));
  }

  return (
    <fieldset className="mt-5">
      <legend className="f-label">Working hours</legend>
      {hours.map((blocks, day) => (
        <div key={day} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="font-semibold">
            {DAYS[day]}
            {blocks.length === 0 && <span className="meta"> (closed)</span>}
          </p>
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
              Add hours
            </button>
            {blocks.length > 0 && (
              <button type="button" className="link py-3" onClick={() => setDay(day, blocks.slice(0, -1))}>
                {blocks.length === 1 ? "Mark closed" : "Remove last"}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <p className="field-err">{error}</p>}
    </fieldset>
  );
}
```

In `src/app/onboarding/Onboarding.tsx`:

1. Replace `import Field from "@/components/Field";` with:

```tsx
import Field from "@/components/Field";
import HoursEditor from "@/components/HoursEditor";
```

2. Delete the line `  type Clock,` from the `@/lib/onboarding` import.
3. Delete the line `const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];`.
4. Delete the `setDay` function:

```tsx
  function setDay(day: number, blocks: Clock[]) {
    setInput((i) => ({ ...i, hours: i.hours.map((b, d) => (d === day ? blocks : b)) }));
  }
```

5. Replace the whole Working hours block, from `<fieldset className="mt-5">` (the only fieldset in the file) to its closing `</fieldset>`, with:

```tsx
            <HoursEditor hours={input.hours} onChange={(hours) => set("hours", hours)} error={errors.hours} />
```

Run: `npm run lint; npx vitest run tests/unit/onboarding.test.ts`
Expected: no lint errors (no unused `DAYS`, `Clock`, or `setDay`), and the onboarding tests pass. The onboarding screen renders the same hours editor as before.

- [ ] **Step 2: Write the settings Server Actions**

Create `src/app/app/settings/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import * as settings from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { requireStaff, type Staff } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validate";

/** Every settings action: signed-in staff only, untrusted arguments (spec 12), re-render on success. */
async function run(save: (staff: Staff) => Promise<Saved>): Promise<Saved> {
  const staff = await requireStaff();
  const result = await save(staff);
  if (result.ok) refresh();
  return result;
}

const idOrNull = (value: unknown) => (value === null ? null : String(value));

export async function updateProfile(input: unknown): Promise<Saved> {
  return run((staff) => settings.saveProfile(staff, input));
}

export async function updateRules(input: unknown): Promise<Saved> {
  return run((staff) => settings.saveRules(staff, input));
}

export async function saveDentistAction(dentistId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.saveDentist(staff, idOrNull(dentistId), input));
}

export async function setDentistActiveAction(dentistId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setDentistActive(staff, String(dentistId), active === true));
}

export async function addTimeOffAction(dentistId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.addTimeOff(staff, String(dentistId), input, new Date()));
}

export async function removeTimeOffAction(timeOffId: unknown): Promise<Saved> {
  return run((staff) => settings.removeTimeOff(staff, String(timeOffId)));
}

export async function saveProcedureAction(procedureId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.saveProcedure(staff, idOrNull(procedureId), input));
}

export async function setProcedureActiveAction(procedureId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true));
}

/** Spec 5.3 account: the current password is checked first, so an unlocked phone alone can't change it. */
export async function changePassword(current: unknown, next: unknown): Promise<Saved> {
  const staff = await requireStaff();
  const password = typeof next === "string" ? next : "";
  const weak = passwordProblem(password);
  if (weak) return { ok: false, field: "next", error: weak };
  const { data } = await staff.db.auth.getClaims();
  const email = data?.claims?.email;
  if (!email || typeof current !== "string" || current === "") return { ok: false, field: "current", error: "Enter your current password." };
  const { error: wrong } = await staff.db.auth.signInWithPassword({ email, password: current });
  if (wrong) return { ok: false, field: "current", error: "That is not your current password." };
  const { error } = await staff.db.auth.updateUser({ password });
  if (error) {
    return {
      ok: false,
      error: error.code === "same_password" ? "Choose a password you have not used here before." : "Something went wrong. Please try again.",
    };
  }
  return { ok: true };
}
```

- [ ] **Step 3: Write the clinic, rules, and account forms**

Create `src/app/app/settings/ClinicForms.tsx`:

```tsx
"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { signOut } from "@/app/(auth)/actions";
import Field from "@/components/Field";
import type { SettingsView } from "@/lib/clinic-settings";
import { localMobile } from "@/lib/phone";
import type { Saved } from "@/lib/staff-input";
import { changePassword, updateProfile, updateRules } from "./actions";

type Clinic = SettingsView["clinic"];

/** The error for one field, when the last save failed on it. */
export const errorFor = (result: Saved | null) => (field: string) =>
  result && !result.ok && result.field === field ? result.error : undefined;

/** "Saved." or an error that no field shows inline. */
export function Feedback({ result, inline }: { result: Saved | null; inline: string[] }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="f-hint" role="status">
        Saved.
      </p>
    );
  }
  if (result.field && inline.includes(result.field)) return null;
  return (
    <p className="field-err" role="alert">
      {result.error}
    </p>
  );
}

const PROFILE_FIELDS = ["name", "smsName", "slug", "mobile", "address", "mapsUrl"];

/** Clinic profile, including the map link. Warns before the booking link changes (spec 5.3). */
export function ProfileForm({ clinic, appUrl }: { clinic: Clinic; appUrl: string }) {
  const [form, setForm] = useState({
    name: clinic.name,
    smsName: clinic.smsName,
    slug: clinic.slug,
    mobile: localMobile(clinic.mobile),
    address: clinic.address,
    mapsUrl: clinic.mapsUrl,
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="card card-pad settings-section"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await updateProfile(form)));
      }}
    >
      <h2 className="font-display">Clinic profile</h2>
      <Field label="Clinic name" error={err("name")}>
        <input className="f-input" maxLength={80} value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Short name for texts" hint="Up to 20 characters. Every text to patients starts with it." error={err("smsName")}>
        <input className="f-input" maxLength={20} value={form.smsName} onChange={set("smsName")} />
      </Field>
      <Field label="Booking link" hint={`${appUrl}/${form.slug}`} error={err("slug")}>
        <input
          className="f-input"
          maxLength={24}
          autoCapitalize="none"
          spellCheck={false}
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
        />
      </Field>
      {form.slug !== clinic.slug && (
        <p className="note-box warn mt-3" role="alert">
          If you change the booking link, the old link stops working right away, including in texts and posts that already have it.
        </p>
      )}
      <Field label="Clinic mobile" hint="Shown to patients and used for text alerts." error={err("mobile")}>
        <input className="f-input" type="tel" inputMode="tel" value={form.mobile} onChange={set("mobile")} />
      </Field>
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
      <Feedback result={result} inline={PROFILE_FIELDS} />
      <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}

const NOTICE = [0, 60, 120, 180, 240, 360, 720, 1440, 2880, 4320, 10080];

function noticeLabel(minutes: number): string {
  if (minutes === 0) return "No notice";
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Booking rules (spec 5.3) and where new request alerts go (spec 10.4). */
export function RulesForm({ clinic }: { clinic: Clinic }) {
  const [form, setForm] = useState({
    slotMinutes: clinic.slotMinutes,
    minNoticeMinutes: clinic.minNoticeMinutes,
    maxDaysAhead: String(clinic.maxDaysAhead),
    alertChannel: clinic.alertChannel,
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const notices = NOTICE.includes(form.minNoticeMinutes) ? NOTICE : [...NOTICE, form.minNoticeMinutes].sort((x, y) => x - y);

  return (
    <form
      className="card card-pad settings-section"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await updateRules(form)));
      }}
    >
      <h2 className="font-display">Booking rules</h2>
      <Field label="Time between start times">
        <select className="f-input" value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })}>
          {[15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </Field>
      <Field label="Minimum notice" hint="How soon before a visit patients can still book online.">
        <select className="f-input" value={form.minNoticeMinutes} onChange={(e) => setForm({ ...form, minNoticeMinutes: Number(e.target.value) })}>
          {notices.map((m) => (
            <option key={m} value={m}>
              {noticeLabel(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Booking window" hint="How many days ahead patients can book online, 1 to 365.">
        <input
          className="f-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={form.maxDaysAhead}
          onChange={(e) => setForm({ ...form, maxDaysAhead: e.target.value })}
        />
      </Field>
      <fieldset className="mt-4">
        <legend className="f-label">New request alerts</legend>
        <label className="member-row">
          <input type="radio" name="alertChannel" checked={form.alertChannel === "push"} onChange={() => setForm({ ...form, alertChannel: "push" })} />
          <span className="nm">Push notification, with a text if no device gets it</span>
        </label>
        <label className="member-row">
          <input type="radio" name="alertChannel" checked={form.alertChannel === "sms"} onChange={() => setForm({ ...form, alertChannel: "sms" })} />
          <span className="nm">Text to the clinic mobile</span>
        </label>
        <p className="f-hint">Push needs the installable app, which comes in a later update. Until a device turns push on, alerts arrive by text.</p>
      </fieldset>
      <Feedback result={result} inline={[]} />
      <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
        {pending ? "Saving..." : "Save rules"}
      </button>
    </form>
  );
}

/** Change password and sign out (spec 5.3). */
export function AccountForms() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);

  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Account</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await changePassword(current, next);
            setResult(r);
            if (r.ok) {
              setCurrent("");
              setNext("");
            }
          });
        }}
      >
        <Field label="Current password" error={err("current")}>
          <input className="f-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters." error={err("next")}>
          <input
            className="f-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Feedback result={result} inline={["current", "next"]} />
        <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
          {pending ? "Saving..." : "Change password"}
        </button>
      </form>
      <form action={signOut}>
        <button type="submit" className="btn btn-ghost wide-btn mt-6">
          Sign out
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Write the dentist editor**

Create `src/app/app/settings/DentistEditor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Field from "@/components/Field";
import HoursEditor from "@/components/HoursEditor";
import type { SettingsView } from "@/lib/clinic-settings";
import { DEFAULT_HOURS } from "@/lib/onboarding";
import type { Saved } from "@/lib/staff-input";
import { formatDate, formatTime } from "@/lib/time";
import { addTimeOffAction, removeTimeOffAction, saveDentistAction, setDentistActiveAction } from "./actions";
import { errorFor, Feedback } from "./ClinicForms";

type Dentist = SettingsView["dentists"][number];

function span(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return `${formatDate(s)}, ${formatTime(s)} to ${formatDate(e)}, ${formatTime(e)}`;
}

/** One dentist (or "Add a dentist" when null): name, short name, weekly hours, active, and time off. */
export default function DentistEditor({ dentist }: { dentist: Dentist | null }) {
  const blank = { name: "", smsName: "", hours: DEFAULT_HOURS };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(dentist ? { name: dentist.name, smsName: dentist.smsName, hours: dentist.hours } : blank);
  const [result, setResult] = useState<Saved | null>(null);
  const [off, setOff] = useState({ from: "", to: "", note: "" });
  const [offResult, setOffResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const offErr = errorFor(offResult);

  if (!open) {
    return dentist ? (
      <div className="member-row cursor-default">
        <span className="nm">
          {dentist.name}
          <span className="meta block">Texts say {dentist.smsName}</span>
        </span>
        <span className={`chip ${dentist.active ? "chip-green" : "chip-gold"}`}>{dentist.active ? "Active" : "Inactive"}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-soft mt-3" onClick={() => setOpen(true)}>
        Add a dentist
      </button>
    );
  }

  return (
    <div className="cf-box mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await saveDentistAction(dentist?.id ?? null, form);
            setResult(r);
            if (r.ok && !dentist) {
              setForm(blank);
              setOpen(false);
            }
          });
        }}
      >
        <Field label="Display name" hint='For example "Dr. Ana Reyes".' error={err("name")}>
          <input
            className="f-input"
            maxLength={60}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Short name for texts" hint="Up to 16 characters, like Dr. Reyes." error={err("smsName")}>
          <input className="f-input" maxLength={16} value={form.smsName} onChange={(e) => setForm({ ...form, smsName: e.target.value })} />
        </Field>
        <HoursEditor hours={form.hours} onChange={(hours) => setForm({ ...form, hours })} error={err("hours")} />
        <p className="f-hint mt-2">Changing hours cancels nothing. Visits outside the new hours show Outside hours on the schedule.</p>
        <Feedback result={result} inline={["name", "smsName", "hours"]} />
        <div className="action-row">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
            {pending ? "Saving..." : dentist ? "Save dentist" : "Add dentist"}
          </button>
        </div>
      </form>

      {dentist && (
        <>
          <button
            type="button"
            className={`btn mt-5 ${dentist.active ? "btn-danger" : "btn-soft"}`}
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await setDentistActiveAction(dentist.id, !dentist.active)))}
          >
            {dentist.active ? "Deactivate" : "Reactivate"}
          </button>
          <p className="f-hint">Inactive dentists leave the booking page and New appointment. Their appointments stay.</p>

          <h3 className="f-label mt-6">Time off</h3>
          {dentist.timeOff.length === 0 && <p className="f-hint">None planned.</p>}
          {dentist.timeOff.map((t) => (
            <div key={t.id} className="member-row cursor-default">
              <span className="nm">
                {span(t.startsAt, t.endsAt)}
                {t.note && <span className="meta block">{t.note}</span>}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => startTransition(async () => setOffResult(await removeTimeOffAction(t.id)))}
              >
                Remove
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await addTimeOffAction(dentist.id, off);
                setOffResult(r);
                if (r.ok) setOff({ from: "", to: "", note: "" });
              });
            }}
          >
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="From" error={offErr("from")}>
                <input className="f-input" type="datetime-local" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} />
              </Field>
              <Field label="To" error={offErr("to")}>
                <input className="f-input" type="datetime-local" value={off.to} onChange={(e) => setOff({ ...off, to: e.target.value })} />
              </Field>
            </div>
            <Field label="Note" optional error={offErr("note")}>
              <input className="f-input" maxLength={100} value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} />
            </Field>
            <p className="f-hint mt-2">Visits already booked in this time stay, and show Outside hours on the schedule.</p>
            <Feedback result={offResult} inline={["from", "to", "note"]} />
            <button type="submit" className="btn btn-soft mt-3" disabled={pending}>
              Add time off
            </button>
          </form>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the procedure editor**

Create `src/app/app/settings/ProcedureEditor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { SettingsView } from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { saveProcedureAction, setProcedureActiveAction } from "./actions";
import { Feedback } from "./ClinicForms";

type Procedure = SettingsView["procedures"][number];

/** One procedure row, or the "add" row when procedure is null. */
function ProcedureRow({ procedure }: { procedure: Procedure | null }) {
  const [form, setForm] = useState({ name: procedure?.name ?? "", minutes: String(procedure?.minutes ?? 30) });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const label = procedure?.name ?? "New procedure";

  return (
    <form
      className="mt-3 grid grid-cols-[1fr_96px] items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await saveProcedureAction(procedure?.id ?? null, form);
          setResult(r);
          if (r.ok && !procedure) setForm({ name: "", minutes: "30" });
        });
      }}
    >
      <input
        className="f-input"
        aria-label={`${label}: name`}
        placeholder={procedure ? undefined : "New procedure"}
        maxLength={60}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        className="f-input"
        aria-label={`${label}: minutes`}
        type="number"
        inputMode="numeric"
        min={5}
        max={480}
        step={5}
        value={form.minutes}
        onChange={(e) => setForm({ ...form, minutes: e.target.value })}
      />
      <div className="col-span-2 flex flex-wrap items-center gap-2">
        {procedure && !procedure.active && <span className="chip chip-gold">Archived</span>}
        <button type="submit" className="btn btn-soft" disabled={pending}>
          {procedure ? "Save" : "Add procedure"}
        </button>
        {procedure && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await setProcedureActiveAction(procedure.id, !procedure.active)))}
          >
            {procedure.active ? "Archive" : "Restore"}
          </button>
        )}
      </div>
      <div className="col-span-2">
        <Feedback result={result} inline={[]} />
      </div>
    </form>
  );
}

/** Procedures (spec 5.3): add, edit, archive. Archived ones leave the booking page; past visits keep their names. */
export default function ProcedureEditor({ procedures }: { procedures: Procedure[] }) {
  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Procedures</h2>
      <p className="f-hint">Minutes set how long each visit takes. Archived procedures leave the booking page; past appointments keep their names.</p>
      {procedures.map((p) => (
        <ProcedureRow key={p.id} procedure={p} />
      ))}
      <ProcedureRow procedure={null} />
    </section>
  );
}
```

- [ ] **Step 6: Write the Settings page**

Create `src/app/app/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AccountForms, ProfileForm, RulesForm } from "./ClinicForms";
import DentistEditor from "./DentistEditor";
import ProcedureEditor from "./ProcedureEditor";
import { loadSettings } from "@/lib/clinic-settings";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

/** Spec 5.3 Settings: clinic profile, booking rules and alerts, dentists, procedures, account. */
export default async function SettingsPage() {
  const staff = await requireStaff();
  const settings = await loadSettings(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Settings</h1>
      </div>
      <ProfileForm clinic={settings.clinic} appUrl={process.env.APP_URL ?? "http://localhost:3600"} />
      <RulesForm clinic={settings.clinic} />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Dentists</h2>
        <p className="f-hint">Patients choose a dentist only when 2 or more are active.</p>
        <div className="member-list mt-2">
          {settings.dentists.map((d) => (
            <DentistEditor key={d.id} dentist={d} />
          ))}
        </div>
        <DentistEditor dentist={null} />
      </section>
      <ProcedureEditor procedures={settings.procedures} />
      <AccountForms />
    </>
  );
}
```

- [ ] **Step 7: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit and database tests pass, and the build lists `/app/settings`.

- [ ] **Step 8: Commit**

```powershell
git add src/components/HoursEditor.tsx src/app/onboarding/Onboarding.tsx src/app/app/settings; git commit -m "feat: add Settings for the clinic, rules, alerts, dentists, procedures, and account" -m "The weekly hours editor moves out of onboarding so Settings reuses it."
```

---

### Task 10: Verify the deliverable end to end

**Files:** none changed unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: the Plan 3 deliverable, proven: a clinic runs its whole day from the dashboard.

The controller runs this task (browser steps included); implementer tasks above skip the browser.

- [ ] **Step 1: Run every check**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors; all unit tests pass (Plan 1 and 2 files plus `schedule`, `staff-input`, `settings-input`, and the new `validate` cases); all database tests pass (earlier files plus `appointment-actions`, `dashboard`, `patients`, `clinic-settings`); the build lists `/app`, `/app/requests`, `/app/schedule`, `/app/schedule/move/[id]`, `/app/new`, `/app/patients`, `/app/patients/[id]`, and `/app/settings`.

- [ ] **Step 2: Walk a clinic day in the browser at phone width**

1. preview_start with the `brightsmile` launch entry (port 3600), then resize_window with preset `mobile` (375 by 812). Log in with the Plan 2 walk's account (or sign up and onboard a fresh clinic as in Plan 2 Task 10). Expect `/app` to land on `/app/requests` with the bottom nav, the current tab marked.
2. **Request comes in:** in a second tab with no staff session, book a slot on the clinic's booking page with a new mobile and verify the code (read it with preview_logs, search `[sms otp]`). Back in the staff tab, reload Requests: the request shows name, Call and Text links, procedures, dentist, time, "Requested ...", "Pending", and "New". The Requests tab shows a badge.
3. **Approve:** press Approve. The request leaves the list; preview_logs shows `[sms confirmed]`. Open Schedule on that day: the visit shows "Confirmed" with Move and Cancel visit.
4. **Decline:** book a second request from the patient tab, then Decline it with the quick pick "Dentist unavailable". preview_logs shows `[sms declined]` ending with the rebook link. On Schedule the row shows "Declined" and no buttons.
5. **Walk-in without a mobile:** New appointment, New patient "Lolo Walk-in" with no mobile, Consultation, today, "Use a custom time" at a time outside working hours (for example 7:00 PM). "Send confirmation text" is not shown. Book and confirm: Schedule opens on today and shows the visit with "Confirmed" and "Outside hours". No text in the logs.
6. **Attendance:** New appointment for the same patient at a custom time earlier today (already passed). On Schedule it offers Completed and No-show. Press No-show, then Completed: the chip follows. Open the patient from the row: history shows both visits and "0 no-shows".
7. **Move:** on the approved visit press Move, pick another day and an open time, then "Move and text the patient". Schedule opens on the new day; preview_logs shows `[sms moved]`.
8. **Text not delivered:** in the Supabase SQL Editor (development project) run `update sms_log set status = 'failed' where id = (select max(id) from sms_log where kind = 'moved');`. Reload Schedule: that visit shows "Text not delivered" and a Call link.
9. **Cancel:** Cancel visit on the moved visit with "Please call the clinic". preview_logs shows `[sms cancelled]`; the row shows "Cancelled" and the flag clears (the newest patient text was logged, not failed).
10. **Patients:** search by part of the patient's name, then by the first digits of the mobile typed as `09...`. Open the patient, change the HMO, Save details, and see "Saved." Delete a test patient: after "Yes, delete" the list opens and the patient no longer appears in search; their appointments on Schedule show "Deleted patient".
11. **Settings, profile:** add a map link (`https://maps.app.goo.gl/test`) and save; the booking page shows it. Type a different booking link and see the warning; put the old link back without saving.
12. **Settings, dentists:** add "Dr. Ben Lim" (short name "Dr. Lim") with Monday hours in two blocks. Schedule now shows the dentist filter; the booking page now asks patients to choose a dentist. Add time off for the first dentist over a confirmed visit: that visit shows "Outside hours". Deactivate Dr. Lim: the filter disappears.
13. **Settings, procedures and rules:** archive a procedure (it leaves the booking page), restore it. Change slot spacing to 15 minutes and see 15 minute times on the booking page, then set it back. Switch alerts to Text and save.
14. **Account:** change the password (current password first), sign out, log back in with the new password.
15. Take a screenshot of each dashboard screen at phone width, then again at desktop width (resize_window preset `desktop`) to check the top nav. Check each in light and dark (resize_window `colorScheme`); the app is light-only by design, so dark must still look like the light theme with readable contrast.
16. Reset the viewport with resize_window preset `desktop`.

- [ ] **Step 3: Fix anything that failed, then commit**

If a check or a walk step failed, use superpowers:systematic-debugging to find the root cause, fix it, re-run Steps 1 and 2, and commit the fix with a message describing it. If everything passed, there is nothing to commit.

- [ ] **Step 4: Report**

Tell Kai: the test counts from Step 1, the screenshots from Step 2, anything that failed and how it was fixed, the rows the walk left in the development project (the test clinic, patients, and the `sms_log` row set to failed), and that Plan 4 (PWA and push, the daily job, landing and legal pages, the Playwright happy path) is next.

---

## Self-review

**Spec coverage**

| Spec | Where |
|---|---|
| 5.3 dashboard under `/app`, mobile first | Task 1 (bottom nav on phones, top nav on wider screens, `/app` redirects to Requests) |
| 5.3 Requests: soonest first, name, mobile tap to call or text, procedures, dentist, time, when requested, New or Returning, Approve, Decline with reason and quick picks | Tasks 2 and 3 |
| 5.3 Schedule: day view, dentist filter with 2+, previous and next, native date jump, time range, patient, procedures, status, "outside hours", "text not delivered", Move, Cancel with reason, Completed or No-show after start, pending with Approve and Decline | Tasks 3 and 4 (`actionsFor`, `assembleDay`, `failedTexts`, `loadDay`), Task 5 and 7 (Move) |
| 5.3 New appointment: find or create patient with optional mobile, dentist and procedures, open or custom time, custom may be outside hours but never overlaps, confirmed immediately, "Send confirmation text" on by default with a mobile | Tasks 5 and 7 |
| 5.3 Patients: search by name or mobile, editable details, history, no-show count, Delete anonymizes | Task 6 |
| 5.3 Settings: profile with map link and booking link warning, dentists add, edit, deactivate, weekly hours with multiple blocks, time off, procedures add, edit, archive, booking rules, alerts, account password and sign out | Tasks 8 and 9 |
| 8 scheduling rules; 8.4 a move excludes its own interval | Task 5 (`staffOpenStarts` reuses `openStarts` with `ignoreId`) |
| 9.2 status table, compare-and-set, `confirmed_at`, `reminder_sent_at` cleared on move, events | Tasks 2 and 5 (`canTransition`, `set_appointment_status`, `move_appointment`, `create_booking`) |
| 10.1 texts on confirm, decline, move, cancel; dentist only with 2+ active dentists | Tasks 2 and 5 (`textPatient`, `showsDentist`), tested in `appointment-actions.test.ts` |
| 12 delete anonymizes; isolation | Task 6; every service test includes a clinic B case |
| 13 failed text never fails the action and shows "text not delivered"; hours or time off changed flags "outside hours"; procedure removed is archived | Tasks 2, 4, 8 |
| Plan 2 deferral: editing the map link | Tasks 8 and 9 |

**Deferred (not in this plan)**

- Push: "enable push on this device" and the iPhone home screen note (spec 10.4) come with Plan 4's service worker and web-push. Until then Settings says alerts arrive by text, which is what `alertClinic` already does.
- Expiry: pending requests whose time passed stay on the Schedule (decline only) until Plan 4's daily job marks them expired.
- An anonymized patient's past `sms_log` rows keep `to_mobile` (and their body until the 90 day wipe in Plan 4). Spec 12 only lists the patient row; staff have no delete right on `sms_log`. Decide in Plan 4 whether the daily job or the delete should null `to_mobile`.
- Delete does not cancel a patient's upcoming visits (spec 12 says appointments stay); the confirm text tells staff to cancel them first.
- A changed booking link has no redirect from the old one (spec 5.3 only asks for the warning).

**Placeholder scan:** every step carries the full code or the exact text to replace; no "TBD", "similar to", or unstated helpers. Edits to existing files quote the exact text they replace, except two whole-block replacements that name unambiguous anchors (`busyBetween` in `availability.ts`, the only `<fieldset>` in `Onboarding.tsx`).

**Type consistency:** `Staff` (Task 1) is the first argument of every service. `ActionResult` (Task 2) is returned by `changeStatus`, `moveAppointment`, `createAppointment` and mapped to `Done` in `src/app/app/actions.ts`. `Saved` (Task 5, `staff-input.ts`) is returned by the patient and settings services and their actions; `Parsed<T>` failures in `settings-input.ts` have the same `{ ok: false; field; error }` shape, so services return them as `Saved`. `StaffAction` and `ScheduleItem` (Tasks 3 and 4) feed `AppointmentActions`. `Slot` in `SlotPicker` matches what `parseSlot` accepts (`dentistId`, ISO `startsAt`, `custom`). `busyBetween` now takes a client first; both of its Plan 2 callers are updated in Task 5.

**Migrations:** none.

**New dependencies:** none.
