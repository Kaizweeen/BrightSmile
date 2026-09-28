# BrightSmile Plan 6: Teams and Reports Implementation Plan

> **Revision (2026-09-28):** Kai decided BrightSmile is free, so billing was removed before release; every reference to billing, paying, trials, or a lapsed/paused clinic below no longer applies.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic's owner invites staff with a join link that works once, for 7 days. Staff run the day (requests, schedule, new appointments, patients, dentists' time off); only the owner changes the clinic's setup, pays, and manages the team, and the database refuses staff everything else even when a Server Action is called directly. Every clinic gets a Reports page (visits, no-shows, the no-show rate, cancellations, and more, by Manila week and by dentist) and a free Monday 9:00 AM push that sums up the week before. Every database change is proven offline before Kai pastes it into production.

**Architecture:** One migration widens `clinic_members.role` to `owner` or `staff`, adds each member's `email` (copied from `auth.users` when the membership is made, and backfilled), adds `clinic_invites` (only the SHA-256 of a join token is stored), `clinics.weekly_report_for`, and `is_clinic_owner`, and splits the setup tables' policies into "members read, the owner writes". Three functions do what RLS alone cannot: `accept_invite` (security definer: hashes the token, locks the invite, refuses unknown, revoked, used, and expired links and accounts that already have a clinic with distinct SQLSTATEs, then adds the caller as staff), `remove_member` (security definer: only the owner of the member's clinic, never an owner row, and the person's push subscriptions go in the same transaction), and `clinic_week_stats` (security invoker, so RLS limits it to the caller's clinic; one row per Manila week and dentist). Because members can now read every membership of their clinic, the proxy and `signedInStaff` look up the signed-in user's own row by user id (`ownMembership`). `requireStaff` returns the member's role, and `requireOwner` guards owner-only pages and actions, which answer staff "Only the clinic's owner can change this." The Team page (`/app/settings/team`) creates a join link and shows it once; `/join/{token}` names the clinic (a secret-key lookup by token hash that reveals only the name), keeps the token in an HttpOnly cookie through sign-up or log-in, and joins through `accept_invite`; onboarding follows that cookie while the link still works. The Reports page reads `clinic_week_stats` through the staff RLS client. The daily job gains a Monday step: for each clinic that is not lapsed, had an appointment last week, and has no summary for this Monday, it claims `weekly_report_for` with a compare-and-set and pushes counts only; the service worker opens `/app/reports` for `type: "weekly"` and `/app/requests` for everything else.

**Tech Stack:** Next.js 16.3 (App Router, Server Actions with `useActionState`, `refresh`, `cookies`, `next/form`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5, `@electric-sql/pglite` 0.4.6 (dev, already installed). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-brightsmile-teams-reports-design.md` (every section). It builds on `docs/superpowers/specs/2026-09-25-brightsmile-billing-design.md` (5 status rules, 7.5 banner) and `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (10.4 push, 11 daily job).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| `cookies()`: read in Server Components; `set` and `delete` only in Server Actions and Route Handlers (why the join page cannot set its own cookie) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` |
| Dynamic segments: `params` is a Promise (`/join/[token]`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` |
| `page.tsx` props: `searchParams` is a Promise (the Reports week) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` |
| Forms with Server Actions, `useActionState` (the action gets the previous state first), hidden inputs | `node_modules/next/dist/docs/01-app/02-guides/forms.md` |
| Server Action security: every action authenticates and authorizes itself | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (section "Security"), `node_modules/next/dist/docs/01-app/02-guides/data-security.md` |
| `redirect` (throws, so call it outside `try`), `refresh()` after a mutation | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` |
| `<Form>` from `next/form` (the week picker, a GET form that navigates) | `node_modules/next/dist/docs/01-app/03-api-reference/02-components/form.md` |
| Proxy matcher (gains `/join/:path*`); Server Actions posted on a matched path pass through the proxy too | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` |
| Dynamic pages are sent `private, no-cache, no-store, max-age=0, must-revalidate`; `export const dynamic = "force-dynamic"` (the caching model this project uses, as `src/app/a/[token]/page.tsx` does) | `node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md` (section "Cache-Control headers"), `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` (section "Route segment config") |
| `headers` in `next.config` (the `X-Robots-Tag` rules in `src/lib/security-headers.ts`) | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, SQL comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/(auth)/AuthForm.tsx"` and `"src/app/join/[token]/page.tsx"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer (CONTRIBUTING.md). The commit commands in this plan leave it out; add `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` as the final `-m` paragraph of every commit. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-6-teams`, which sits on `plan-5-billing` (its PR is still open), one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone (Vercel runs in UTC; the offline tests run the database in UTC). Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings. A report week is Monday to Sunday on the Manila calendar, by the appointment's start (`weekStart` in `src/lib/reports.ts`, `date_trunc('week', starts_at at time zone 'Asia/Manila')` in SQL).
- Roles (spec 4): staff may do requests, the schedule, new appointments, moves, attendance, patients, dentists' time off, Reports, and their own password and push. Only the owner changes the clinic profile, booking rules, alert channel, dentists, working hours, procedures, billing, and the team. RLS enforces every "no"; owner-only Server Actions also call `requireOwner` first and answer staff with `OWNER_ONLY` ("Only the clinic's owner can change this."), and pages hide what staff cannot use.
- Membership lookups filter by the signed-in user's id (`ownMembership` in `src/lib/membership.ts`). After this plan's migration, members read every membership of their clinic, so an unfiltered `clinic_members` read with `.maybeSingle()` fails for any clinic with two members.
- Join tokens come from `newToken` (12 letters and digits) and are stored only as their SHA-256 hex (`hashInviteToken` in `src/lib/team.ts`, the same digest `accept_invite` computes in SQL). A token is shown once, never logged, never stored in plain text, and travels only in the owner's copied link, the `/join/{token}` URL, a hidden form field, and the HttpOnly `bs_join` cookie.
- Push payloads never carry a patient's name. The Monday push carries counts only and `type: "weekly"`. The service worker maps `type: "weekly"` to `/app/reports` and everything else to `/app/requests`; it never follows a URL from a payload.
- The daily job's steps stay idempotent (core spec 11): the Monday step claims `weekly_report_for` with a compare-and-set before pushing, so a rerun never pushes twice. A failure for one clinic never stops the others or the other steps.
- Never log patient details, tokens, codes, secrets, keys, or environment values. Error logs carry where it failed and the error message only (`logError` in `src/lib/log.ts`).
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies). The secret-key client (`adminClient`) is used only where no staff session exists for the data read: `sendSms`, the public booking flow, `sendPush`, the daily job, the PayMongo webhook, `/admin` after `requireOperator`, and, new in this plan, the join link lookup by token hash (`inviteClinicName`, on `/join` and onboarding, for a visitor who is not a member of the inviting clinic; it reveals only the clinic's name, and only for an open link). Nothing else.
- Server Actions are public POST endpoints: each one checks who is calling (`requireStaff`, `requireOwner`, or, for joining, the Supabase session that `accept_invite` runs as) and re-validates every argument on the server, whatever the form already checked. The join page's other two actions only set its cookie or sign the visitor out of their own browser.
- Private pages send `X-Robots-Tag: noindex, nofollow`: `/app`, `/a/`, `/onboarding`, `/login`, `/signup`, `/forgot`, `/reset-password`, `/auth/`, `/api/`, `/admin`, and now `/join/`. `/join` is dynamic, so Next sends it `Cache-Control: private, no-cache, no-store`.
- UI: targets at least 44px, status never rests on colour alone (every chip and number carries a word), reuse the classes in `src/app/globals.css` (light only, cream canvas, white cards, teal primary). One primary button per screen.
- One new migration, `supabase/migrations/20260926000100_teams.sql`. Kai reviews it and pastes it into the production SQL Editor before this plan's branch merges (every merge to `main` deploys production). Nothing in this plan runs SQL against Supabase. The migration follows plan 5's rules: explicit grants and revokes (Supabase's default privileges grant new tables and functions to `anon` and `authenticated`, and the offline harness does the same), `security definer` only where RLS cannot express the rule, always with `set search_path = ''`, and only what Supabase's `postgres` role may do on Postgres 17 (PGlite 0.4.6 is Postgres 17.5; no Postgres 18 features). `create or replace function public.create_clinic` copies the latest body (in `20260925000200_billing.sql`) exactly and changes only the owner's membership insert, and a test compares the two definitions.
- Database tests are the offline PGlite suite in `tests/sql`, run by `npm test`. There is no development Supabase project and no Docker. `tests/db` and the Playwright test keep refusing the production project; this plan neither runs nor edits them, and they keep typechecking: `Staff` keeps its three fields, and the role lives in the new `Member` type.
- Never use the app locally in this plan (no sign-ups, joins, or dashboard walks): `.env.local` points at production. Pages are checked by typecheck, lint, build, and review, then walked on production after deploy (spec 8, and "What Kai must do" below). The one local server check, in Task 5, requests `/join/x` signed out, which reads no data.
- Dev server port: 3600 (`.claude/launch.json` entry `brightsmile`).
- Dependencies added: none.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. Clinic dashboard (done).
4. Launch readiness (done).
5. Billing (done; its PR is open, and this branch sits on it).
6. **Teams and reports (this plan):** the member lookup by user id and the role, the teams migration, owner-only setup and billing for staff, the Team page, join links, the Reports page, the Monday push, and the README. Deliverable: once Kai pastes the migration, owners can invite staff, staff can run the day without touching the setup, and every clinic sees its weekly numbers.

## File map for this plan

| File | Responsibility |
|---|---|
| `src/lib/membership.ts` | `Role`, `ownMembership` (the signed-in user's own membership row, by user id) |
| `src/lib/supabase/server.ts` | `signedInStaff` with the role, `Member`, `requireStaff` returning the role, `OWNER_ONLY`, `requireOwner` |
| `src/proxy.ts` | Membership lookup through `ownMembership`; matcher gains `/join/:path*` (session refresh only) |
| `supabase/migrations/20260926000100_teams.sql` | Roles, `clinic_members.email`, member policies, `is_clinic_owner`, owner-only setup policies, `clinic_invites`, `clinics.weekly_report_for`, the `join` reserved slug, `create_clinic` with the owner's email, `accept_invite`, `remove_member`, `clinic_week_stats` |
| `tests/sql/harness.ts` | `invite` (the owner makes a join link) and `addStaff` (a new user joins through `accept_invite`) |
| `tests/sql/teams.test.ts` | The migration: roles, emails, member visibility, owner-only setup, invites, `accept_invite`, `remove_member`, `clinic_week_stats` |
| `tests/sql/isolation.test.ts` | `clinic_invites` seeded and swept; the new staff functions listed |
| `src/lib/team.ts` | No data access (it uses `node:crypto`, so server code and tests only): `isInviteToken`, `hashInviteToken`, `joinLink`, `INVITE_DAYS`, `JOIN_COOKIE`, `joinView`, `joinRefusal` |
| `src/lib/team-data.ts` | Server: `loadTeam`, `createInvite`, `revokeInvite`, `removeMember`, `inviteClinicName` |
| `src/lib/validate.ts` | `join` joins `RESERVED_SLUGS` |
| `src/lib/onboarding.ts` | Doc comment: where `create_clinic` is now defined |
| `src/app/app/settings/actions.ts`, `page.tsx`, `DentistEditor.tsx` | Owner-only settings actions; staff see alerts, dentists' time off, billing status, and their account; the Team link |
| `src/app/app/billing/actions.ts`, `page.tsx` | `payOnline` for the owner only; staff see the status line only |
| `src/lib/billing.ts`, `src/lib/billing-data.ts`, `src/app/app/layout.tsx` | The banner asks staff to tell the owner, with no link |
| `src/app/app/settings/team/page.tsx`, `TeamPanel.tsx`, `actions.ts` | The Team page: members, open links, create, copy, revoke, remove |
| `src/app/join/[token]/page.tsx`, `src/app/join/[token]/JoinButton.tsx`, `src/app/join/actions.ts` | The join page, the join cookie, `accept_invite`, log out to join |
| `src/app/onboarding/page.tsx`, `src/app/onboarding/Onboarding.tsx` | Follow an open join link instead of the clinic setup; a hint for staff |
| `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/AuthForm.tsx`, `src/app/(auth)/actions.ts` | Sign-up words for someone joining a clinic |
| `src/lib/security-headers.ts`, `src/lib/supabase/admin.ts` | `/join` is noindex and kept out of robots.txt; doc comment for the new secret-key caller |
| `src/lib/reports.ts`, `src/app/app/reports/page.tsx` | Pure week math, rates, and sums; the Reports page |
| `src/app/app/AppNav.tsx`, `src/app/globals.css` | Reports in the nav, six tabs on phones |
| `src/lib/push.ts`, `public/sw.js` | `weeklyPushPayload` with `type: "weekly"`; the service worker opens Reports for it |
| `src/lib/daily.ts`, `src/lib/daily-job.ts` | `reportMonday`, `weeklyCandidates`, `sendWeeklyReports`, `weekly` in the summary |
| `README.md` | Migration 8, the Teams and reports section |
| `tests/unit/membership.test.ts`, `team.test.ts`, `team-data.test.ts`, `settings-actions.test.ts`, `reports.test.ts`, `service-worker.test.ts` | New unit tests |
| `tests/unit/validate.test.ts`, `billing.test.ts`, `pay-online.test.ts`, `routes.test.ts`, `security-headers.test.ts`, `push.test.ts`, `daily.test.ts`, `daily-job.test.ts` | Updated unit tests |

## Tasks

1. Find each member's own membership, and their role
2. The teams migration
3. Owner-only setup and billing
4. The Team page
5. Join links
6. The Reports page
7. The Monday push
8. README and final verification

---
### Task 1: Find each member's own membership, and their role

**Files:**
- Create: `src/lib/membership.ts`, `tests/unit/membership.test.ts`
- Modify: `src/lib/supabase/server.ts`, `src/proxy.ts`

**Interfaces:**
- Consumes: table `public.clinic_members (clinic_id, user_id, role)` (the `role` column exists since the first migration; it holds only `owner` until Task 2); `serverClient`, `type ServerDb` in `src/lib/supabase/server.ts`; `createServerClient` in `src/proxy.ts`.
- Produces:
  - From `@/lib/membership` (no `server-only`, so the proxy can import it): `type Role = "owner" | "staff"`, `ownMembership(db: SupabaseClient, userId: string): Promise<{ clinicId: string; role: Role } | null>`
  - From `@/lib/supabase/server`: `signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null; role: Role | null } | null>`; `type Staff = { db: SupabaseClient; userId: string; clinicId: string }` (unchanged, so `tests/db` still typechecks); `type Member = Staff & { role: Role }`; `requireStaff(): Promise<Member>`; `OWNER_ONLY: string` ("Only the clinic's owner can change this."); `requireOwner(): Promise<Member | null>` (null for staff)

Rules (spec 5, "Because members can now see each other's membership rows"):
- Today `signedInStaff` and the proxy read `clinic_members.select("clinic_id").maybeSingle()` and rely on RLS ("users see their memberships") to return one row. Task 2 lets members read every membership of their clinic, so both lookups filter by the signed-in user's id, through one function, before the migration lands. With the filter the code is also correct against today's database, so this task can ship first.
- `maybeSingle()` answers an error, not a row, when more than one row matches (PostgREST `PGRST116`). The test's fake table does the same, so leaving out `.eq("user_id", ...)` fails it.
- `requireStaff` sends an account without a clinic (or, impossibly, without a role) to onboarding, as before, and now returns the role. `requireOwner` is `requireStaff` plus the owner check: it returns null for staff, so an action can answer `OWNER_ONLY` and a page can redirect. Both keep `redirect` outside any `try`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/membership.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ownMembership } from "@/lib/membership";

type Row = { clinic_id: string; user_id: string; role: string };

/**
 * clinic_members as PostgREST serves it once members can read every membership of their clinic (teams spec 5):
 * each filter narrows the rows, and maybeSingle fails when more than one row is left, as PostgREST does.
 */
function membersTable(rows: Row[]): SupabaseClient {
  return {
    from(table: string) {
      expect(table).toBe("clinic_members");
      let left = rows;
      const query = {
        select: () => query,
        eq: (column: keyof Row, value: string) => {
          left = left.filter((r) => r[column] === value);
          return query;
        },
        maybeSingle: async () =>
          left.length > 1
            ? { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }
            : { data: left[0] ?? null, error: null },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

const clinic = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const owner = "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01";
const staff = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const team = membersTable([
  { clinic_id: clinic, user_id: owner, role: "owner" },
  { clinic_id: clinic, user_id: staff, role: "staff" },
]);

describe("ownMembership", () => {
  it("finds the signed-in member's own row when their clinic has two members", async () => {
    expect(await ownMembership(team, owner)).toEqual({ clinicId: clinic, role: "owner" });
    expect(await ownMembership(team, staff)).toEqual({ clinicId: clinic, role: "staff" });
  });

  it("is null for an account without a clinic", async () => {
    expect(await ownMembership(team, "9e8d7c6b-5a49-4382-a716-151413121110")).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/membership.test.ts`
Expected: FAIL with `Cannot find package '@/lib/membership'` (the file does not exist yet).

- [ ] **Step 2: Write the lookup**

Create `src/lib/membership.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** A member's role in their clinic (teams spec 4). */
export type Role = "owner" | "staff";

/**
 * The signed-in user's own membership, or null when the account has no clinic. It filters by the user's id because
 * members can read every membership of their clinic (teams spec 5): unfiltered, a clinic with two members returns two
 * rows and maybeSingle fails. The proxy and signedInStaff both use it.
 */
export async function ownMembership(db: SupabaseClient, userId: string): Promise<{ clinicId: string; role: Role } | null> {
  const { data } = await db.from("clinic_members").select("clinic_id, role").eq("user_id", userId).maybeSingle();
  const row = data as { clinic_id: string; role: Role } | null;
  return row ? { clinicId: row.clinic_id, role: row.role } : null;
}
```

Run: `npx vitest run tests/unit/membership.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Use it for the staff session, with the role and the owner check**

In `src/lib/supabase/server.ts`, replace:

```ts
import { isOperator } from "@/lib/admin";
```

with:

```ts
import { isOperator } from "@/lib/admin";
import { ownMembership, type Role } from "@/lib/membership";
```

and replace:

```ts
/** The signed-in staff member and their clinic, or null when nobody is signed in. */
export async function signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null } | null> {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: member } = await db.from("clinic_members").select("clinic_id").maybeSingle();
  return { db, userId, clinicId: (member?.clinic_id as string | undefined) ?? null };
}

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

with:

```ts
/** The signed-in user, their clinic, and their role there, or null when nobody is signed in. */
export async function signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null; role: Role | null } | null> {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const member = await ownMembership(db, userId);
  return { db, userId, clinicId: member?.clinicId ?? null, role: member?.role ?? null };
}

/** A signed-in staff member with a clinic. Services take this and query through `db`, so RLS applies. */
export type Staff = { db: SupabaseClient; userId: string; clinicId: string };

/** Staff plus their role in the clinic (teams spec 4). */
export type Member = Staff & { role: Role };

/**
 * For dashboard pages and Server Actions: visitors without a session go to log in, accounts without
 * a clinic go to onboarding. Call it outside try blocks, because redirect throws.
 */
export async function requireStaff(): Promise<Member> {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId || !staff.role) redirect("/onboarding");
  return { db: staff.db, userId: staff.userId, clinicId: staff.clinicId, role: staff.role };
}

/** What an owner-only Server Action answers staff (teams spec 4). RLS refuses their writes regardless. */
export const OWNER_ONLY = "Only the clinic's owner can change this.";

/**
 * For owner-only pages and Server Actions (teams spec 4): requireStaff, then null for staff, so an action can answer
 * OWNER_ONLY and a page can send them elsewhere. Call it outside try blocks, because requireStaff may redirect.
 */
export async function requireOwner(): Promise<Member | null> {
  const member = await requireStaff();
  return member.role === "owner" ? member : null;
}
```

- [ ] **Step 4: Use it in the proxy**

In `src/proxy.ts`, replace:

```ts
import { guardRedirect } from "@/lib/routes";
```

with:

```ts
import { ownMembership } from "@/lib/membership";
import { guardRedirect } from "@/lib/routes";
```

and replace:

```ts
  const signedIn = Boolean(data?.claims?.sub);
  let hasClinic = false;
  if (signedIn) {
    const { data: member } = await supabase.from("clinic_members").select("clinic_id").maybeSingle();
    hasClinic = Boolean(member);
  }
```

with:

```ts
  const userId = data?.claims?.sub;
  const signedIn = Boolean(userId);
  const hasClinic = userId ? (await ownMembership(supabase, userId)) !== null : false;
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every unit test and the `tests/sql` suite PASS.

```powershell
git add src/lib/membership.ts tests/unit/membership.test.ts src/lib/supabase/server.ts src/proxy.ts
git commit -m "feat: find each member's own membership and role" -m "The proxy and signedInStaff now read the signed-in user's own clinic_members row by user id, so they keep working once members can see each other's rows. requireStaff returns the role, and requireOwner guards owner-only pages and actions."
```

### Task 2: The teams migration

**Files:**
- Create: `src/lib/team.ts`, `tests/unit/team.test.ts`, `supabase/migrations/20260926000100_teams.sql`, `tests/sql/teams.test.ts`
- Modify: `tests/sql/harness.ts`, `tests/sql/isolation.test.ts`, `src/lib/validate.ts`, `tests/unit/validate.test.ts`, `src/lib/onboarding.ts` (doc comment only)

**Interfaces:**
- Consumes: the harness (`freshDb`, `asUser`, `asService`, `addUser`, `newClinic`, `migrate`, `MIGRATIONS`); `public.is_clinic_member(uuid)` (`20260922000200_access.sql`); `public.create_clinic(jsonb)` as last defined in `20260925000200_billing.sql`; the policies "users see their memberships", "members update their clinic" (`20260924000100_hardening.sql`), "members manage dentists", "members manage working hours", "members manage procedures"; the check constraints `clinic_members_role_check` (the inline `check (role = 'owner')` of `20260922000100_schema.sql`) and `clinics_slug_not_reserved` (hardening); `newToken` from `@/lib/codes`.
- Produces:
  - From `@/lib/team`: `isInviteToken(value: unknown): value is string`, `hashInviteToken(token: string): string`
  - From `tests/sql/harness.ts`: `invite(db: PGlite, clinic: { userId: string; clinicId: string }): Promise<string>` (the owner makes a join link through RLS; returns the token), `addStaff(db: PGlite, clinic: { userId: string; clinicId: string }): Promise<string>` (a new user joins through `accept_invite`; returns the user id)
  - SQL, in `supabase/migrations/20260926000100_teams.sql`:
    - `clinic_members.role` is `owner` or `staff` (default still `owner`); new `clinic_members.email text` (at most 254 characters), backfilled from `auth.users`
    - Table `public.clinic_invites (id uuid primary key, clinic_id uuid not null references clinics on delete cascade, token_hash text not null unique (64 hex characters), created_by uuid default auth.uid() references auth.users on delete set null, created_at timestamptz not null default now(), expires_at timestamptz not null default now() + 7 days, accepted_by uuid references auth.users on delete set null, accepted_at timestamptz, revoked_at timestamptz)`
    - `public.clinics.weekly_report_for date` (nullable)
    - `public.is_clinic_owner(cid uuid) returns boolean` (security definer, `authenticated`)
    - `public.create_clinic(p jsonb) returns uuid`: the billing version, plus the owner's email on their membership row
    - `public.accept_invite(p_token text) returns uuid` (the clinic id; security definer, `authenticated`); refusals raise SQLSTATE `BSUNK` (no such link), `BSREV` (revoked), `BSUSD` (used), `BSEXP` (expired), `23505` (the caller already belongs to a clinic), `42501` (not signed in)
    - `public.remove_member(p_user_id uuid) returns void` (security definer, `authenticated`); SQLSTATE `BSNOS` when there is no such staff member in a clinic the caller owns
    - `public.clinic_week_stats(p_clinic_id uuid, p_from date, p_weeks integer) returns table (week_start date, dentist_id uuid, completed integer, no_show integer, cancelled integer, declined integer, expired integer, unmarked integer, upcoming integer, online integer, manual integer)` (security invoker, `authenticated` and `service_role`)
  - `RESERVED_SLUGS` in `@/lib/validate` gains `"join"`

Rules (spec 4, 5, 7):
- Policies. `clinics`: members select (unchanged), the owner updates ("members update their clinic" is replaced; staff never had insert or delete). `dentists`, `working_hours`, `procedures`: members select, the owner inserts, updates, and deletes. `clinic_members`: members select every membership of their own clinic (through `is_clinic_member`, a security definer function, so the policy never recurses); `authenticated` keeps only `select` on the table, so nobody inserts, updates, or deletes a membership directly. `clinic_invites`: the owner selects, inserts, and revokes rows of their clinic; nobody else sees them. The other tables are unchanged: staff keep managing patients, appointments, events, and time off, and keep reading texts, push subscriptions (their own), billing, and payments.
- `clinic_invites` grants: `authenticated` may insert only `clinic_id` and `token_hash` (so `created_by`, `created_at`, and the 7 day `expires_at` always come from the defaults) and update only `revoked_at`, and the update policy's check refuses a null `revoked_at`, so a revoked link can never reopen. `anon` gets nothing; `service_role` everything (the join page's name lookup).
- `accept_invite` hashes the token itself (`encode(sha256(convert_to(token, 'UTF8')), 'hex')`, the digest `hashInviteToken` computes in the app), locks the invite row (`for update`), and checks in this order: exists, not revoked, not used, not expired, the caller has no clinic. Then it inserts the caller as `staff` with their email and marks the invite accepted, in one transaction. Two people opening one link at once: the second waits for the lock and gets `BSUSD`. One account joining two clinics at once: the unique index `clinic_members_one_user` raises `23505`, the same code.
- `remove_member` finds the member's row only where it is `staff` and the caller owns that clinic (`is_clinic_owner`), locks it, deletes that person's `push_subscriptions` for the clinic, then the membership. Every refusal is the same `BSNOS`, so it never reveals whether someone belongs to another clinic.
- `clinic_week_stats` groups by `date_trunc('week', starts_at at time zone 'Asia/Manila')` (a Monday) and dentist, over `p_weeks` weeks from the Monday of `p_from`'s week, and filters `clinic_id = p_clinic_id` first so the `appointments_clinic_time` index applies. Counts: `completed`, `no_show`, `cancelled`, `declined`, `expired` by status; `unmarked` = confirmed and started (`starts_at <= now()`, when the schedule offers Completed and No-show); `upcoming` = confirmed and still ahead; `online` and `manual` = every appointment by `source`, whatever its status. Weeks and dentists without appointments have no row.
- `create_clinic` is replaced with `create or replace`, copied from `20260925000200_billing.sql`, changing only its membership insert. A test compares the two definitions, so any other drift fails.
- Security definer only for `is_clinic_owner`, `create_clinic`, `accept_invite`, and `remove_member` (each must read or write rows the caller cannot see yet or any more), always with `set search_path = ''`. Every new function is revoked from `public` and `anon` and granted explicitly. The isolation test's list of functions `authenticated` may run grows by `accept_invite`, `clinic_week_stats`, `is_clinic_owner`, and `remove_member`, and nothing else.
- `join` becomes a reserved booking link in the database (`clinics_slug_not_reserved`) and in `RESERVED_SLUGS`. If a production clinic already uses `join`, the migration stops at that constraint; "What Kai must do" checks this first.

- [ ] **Step 1: Write the failing token test**

Create `tests/unit/team.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { hashInviteToken, isInviteToken } from "@/lib/team";

describe("join link tokens", () => {
  it("are newToken's 12 letters and digits, nothing else", () => {
    expect(isInviteToken(newToken())).toBe(true);
    for (const bad of ["", "AbCdEfGhIjK", "AbCdEfGhIjKlM", "AbCd-fGhIjKl", "AbCdEfGhIjK ", "ÄbCdEfGhIjKl", 123456789012, null, undefined]) {
      expect(isInviteToken(bad)).toBe(false);
    }
  });

  it("are stored as their SHA-256 in hex, the digest accept_invite computes", () => {
    // Postgres: select encode(sha256(convert_to('AbCdEfGhIjKl', 'UTF8')), 'hex') gives the same digest.
    expect(hashInviteToken("AbCdEfGhIjKl")).toBe("1b0a0a91ec2b4ba3cd4ba12cf7a3ffff12aac9425166be009fb55702f7cb2c10");
  });
});
```

Run: `npx vitest run tests/unit/team.test.ts`
Expected: FAIL with `Cannot find package '@/lib/team'`.

- [ ] **Step 2: Write the token helpers**

Create `src/lib/team.ts`:

```ts
import { createHash } from "node:crypto";

/** newToken's shape (12 letters and digits). Anything else is not a join link. */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{12}$/.test(value);
}

/**
 * How clinic_invites stores a join token (teams spec 5): its SHA-256 in hex, the same digest accept_invite computes in
 * SQL, so a leaked table holds no working links.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
```

Run: `npx vitest run tests/unit/team.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Write the failing database tests**

In `tests/sql/harness.ts`, replace:

```ts
import type { CreateClinicPayload } from "@/lib/onboarding";
```

with:

```ts
import type { CreateClinicPayload } from "@/lib/onboarding";
import { hashInviteToken } from "@/lib/team";
```

Append to the end of `tests/sql/harness.ts`:

```ts

/** A join link the clinic's owner makes through RLS, as the Team page does. Returns the token. */
export async function invite(db: PGlite, clinic: { userId: string; clinicId: string }): Promise<string> {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  await asUser(db, clinic.userId, "insert into public.clinic_invites (clinic_id, token_hash) values ($1, $2)", [
    clinic.clinicId,
    hashInviteToken(token),
  ]);
  return token;
}

/** A new user who joins the clinic as staff through a join link, as /join does. Returns the user id. */
export async function addStaff(db: PGlite, clinic: { userId: string; clinicId: string }): Promise<string> {
  const token = await invite(db, clinic);
  const userId = await addUser(db);
  await asUser(db, userId, "select public.accept_invite($1)", [token]);
  return userId;
}
```

In `tests/sql/isolation.test.ts`, replace:

```ts
import { asUser, freshDb, newClinic } from "./harness";
```

with:

```ts
import { asUser, freshDb, newClinic } from "./harness";
import { hashInviteToken } from "@/lib/team";
```

replace:

```ts
  "appointments",
  "clinic_members",
```

with:

```ts
  "appointments",
  "clinic_invites",
  "clinic_members",
```

replace:

```ts
  await db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [clinicId, userId, `https://fcm.googleapis.com/fcm/send/${clinicId}`]);
}
```

with:

```ts
  await db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [clinicId, userId, `https://fcm.googleapis.com/fcm/send/${clinicId}`]);
  await db.query("insert into public.clinic_invites (clinic_id, token_hash, created_by) values ($1, $2, $3)", [clinicId, hashInviteToken(clinicId), userId]);
}
```

and replace:

```ts
    expect(rows.map((r) => r.proname)).toEqual(["create_booking", "create_clinic", "is_clinic_member", "move_appointment", "set_appointment_status"]);
```

with:

```ts
    expect(rows.map((r) => r.proname)).toEqual([
      "accept_invite",
      "clinic_week_stats",
      "create_booking",
      "create_clinic",
      "is_clinic_member",
      "is_clinic_owner",
      "move_appointment",
      "remove_member",
      "set_appointment_status",
    ]);
```

In `tests/unit/validate.test.ts`, replace:

```ts
  it.each(["app", "login", "privacy", "reset-password"])("rejects reserved %s", (slug) => {
```

with:

```ts
  it.each(["app", "login", "privacy", "reset-password", "join"])("rejects reserved %s", (slug) => {
```

Create `tests/sql/teams.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addStaff, addUser, asService, asUser, freshDb, invite, migrate, MIGRATIONS, newClinic } from "./harness";
import { hashInviteToken } from "@/lib/team";

type Clinic = { userId: string; clinicId: string };

const TEAMS = "20260926000100_teams.sql";

let db: PGlite;
let a: Clinic;
let aStaff: string;
let b: Clinic;

/** The SQLSTATE a statement fails with, so each refusal is told apart by its code (teams spec 5). */
async function sqlstate(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
  return "no error";
}

const accept = (userId: string, token: string) => asUser<{ clinic: string }>(db, userId, "select public.accept_invite($1) as clinic", [token]);
const remove = (callerId: string | null, memberId: string) => asUser(db, callerId, "select public.remove_member($1)", [memberId]);

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  aStaff = await addStaff(db, a);
}, 60_000);

describe("create_clinic", () => {
  it("records the owner's role and login email", async () => {
    expect(await asUser(db, a.userId, "select role, email from public.clinic_members where user_id = $1", [a.userId])).toEqual([
      { role: "owner", email: `${a.userId}@example.com` },
    ]);
  });

  it("is the billing migration's version with only the membership insert changed", async () => {
    const before = await freshDb(MIGRATIONS.indexOf(TEAMS));
    // Line endings follow each file's checkout (CRLF on Windows), so compare the text line by line.
    const definition = async (d: PGlite) =>
      (await d.query<{ def: string }>("select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure) as def")).rows[0].def.replace(/\r\n/g, "\n");
    const billing = await definition(before);
    await before.close();
    const expected = billing.replace(
      "insert into public.clinic_members (clinic_id, user_id) values (v_clinic, v_user);",
      () => "insert into public.clinic_members (clinic_id, user_id, email)\n  values (v_clinic, v_user, (select u.email from auth.users u where u.id = v_user));",
    );
    expect(expected).not.toBe(billing);
    expect(await definition(db)).toBe(expected);
  });
});

describe("the migration on an existing database", () => {
  it("keeps every member an owner and copies their emails", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(TEAMS));
    const old = await newClinic(early);
    await migrate(early, TEAMS);
    const { rows } = await early.query("select role, email from public.clinic_members where user_id = $1", [old.userId]);
    expect(rows).toEqual([{ role: "owner", email: `${old.userId}@example.com` }]);
    await early.close();
  });

  it("allows only the owner and staff roles, and keeps the join link free", async () => {
    await expect(db.query("update public.clinic_members set role = 'admin' where user_id = $1", [aStaff])).rejects.toThrow(/clinic_members_role_check/);
    await expect(db.query("update public.clinics set slug = 'join' where id = $1", [a.clinicId])).rejects.toThrow(/clinics_slug_not_reserved/);
  });
});

describe("memberships", () => {
  it("show members every membership of their clinic and nobody else's", async () => {
    const clinicA = [
      { user_id: a.userId, role: "owner" },
      { user_id: aStaff, role: "staff" },
    ];
    for (const user of [a.userId, aStaff]) {
      expect(await asUser(db, user, "select user_id, role from public.clinic_members order by role"), user).toEqual(clinicA);
    }
    expect(await asUser(db, b.userId, "select user_id from public.clinic_members")).toEqual([{ user_id: b.userId }]);
    // Two rows for clinic A: why ownMembership filters by the signed-in user's id.
    expect(await asUser(db, aStaff, "select role from public.clinic_members where user_id = $1", [aStaff])).toEqual([{ role: "staff" }]);
  });

  it("cannot be added, changed, or deleted directly, not even by the owner", async () => {
    for (const user of [a.userId, aStaff]) {
      await expect(asUser(db, user, "insert into public.clinic_members (clinic_id, user_id) values ($1, $2)", [a.clinicId, b.userId])).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(db, user, "update public.clinic_members set role = 'owner' where user_id = $1", [aStaff])).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, "delete from public.clinic_members where user_id = $1", [aStaff])).rejects.toThrow(/permission denied/);
    }
  });
});

describe("the clinic's setup", () => {
  it("is readable by staff", async () => {
    for (const table of ["clinics", "dentists", "working_hours", "procedures"]) {
      expect((await asUser(db, aStaff, `select 1 from public.${table}`)).length, table).toBeGreaterThan(0);
    }
  });

  it("does not change when staff update or delete it", async () => {
    for (const sql of [
      "update public.clinics set name = 'Renamed by staff' returning id",
      "update public.dentists set name = 'Dr. Renamed' returning id",
      "delete from public.dentists returning id",
      "update public.working_hours set end_time = '23:00' returning id",
      "delete from public.working_hours returning id",
      "update public.procedures set duration_minutes = 5 returning id",
      "delete from public.procedures returning id",
    ]) {
      expect(await asUser(db, aStaff, sql), sql).toEqual([]);
    }
  });

  it("refuses dentists, hours, and procedures that staff add", async () => {
    const [dentist] = await asUser<{ id: string }>(db, aStaff, "select id from public.dentists limit 1");
    const inserts: [string, unknown[]][] = [
      ["insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Sneak', 'Dr. Sneak')", [a.clinicId]],
      ["insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 0, '09:00', '10:00')", [a.clinicId, dentist.id]],
      ["insert into public.procedures (clinic_id, name, duration_minutes) values ($1, 'Sneaky', 30)", [a.clinicId]],
    ];
    for (const [sql, params] of inserts) {
      await expect(asUser(db, aStaff, sql, params), sql).rejects.toThrow(/row-level security/);
    }
  });

  it("changes when the owner changes it", async () => {
    expect(await asUser(db, a.userId, "update public.clinics set address = 'Pasig' where id = $1 returning address", [a.clinicId])).toEqual([{ address: "Pasig" }]);
    const [dentist] = await asUser<{ id: string }>(db, a.userId, "insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Two', 'Dr. Two') returning id", [
      a.clinicId,
    ]);
    expect(
      await asUser(db, a.userId, "insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time) values ($1, $2, 2, '09:00', '12:00') returning weekday", [
        a.clinicId,
        dentist.id,
      ]),
    ).toEqual([{ weekday: 2 }]);
    expect(await asUser(db, a.userId, "update public.procedures set duration_minutes = 45 where clinic_id = $1 returning duration_minutes", [a.clinicId])).toEqual([
      { duration_minutes: 45 },
    ]);
  });
});

describe("the day's work", () => {
  it("is open to staff: patients, appointments, attendance, and time off", async () => {
    const [dentist] = await asUser<{ id: string }>(db, aStaff, "select id from public.dentists where clinic_id = $1 order by created_at limit 1", [a.clinicId]);
    const [patient] = await asUser<{ id: string }>(db, aStaff, "insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Lara', 'Santos') returning id", [
      a.clinicId,
    ]);
    const [visit] = await asUser<{ id: string }>(
      db,
      aStaff,
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       values ($1, $2, $3, '2030-03-04T09:00:00+08:00', '2030-03-04T09:30:00+08:00', 'confirmed', '{Consultation}', 'manual', 'StaffVisit01') returning id`,
      [a.clinicId, dentist.id, patient.id],
    );
    expect(await asUser(db, aStaff, "update public.appointments set status = 'completed' where id = $1 returning status", [visit.id])).toEqual([{ status: "completed" }]);
    const [off] = await asUser<{ id: string }>(
      db,
      aStaff,
      "insert into public.time_off (clinic_id, dentist_id, starts_at, ends_at) values ($1, $2, '2030-03-05T09:00:00+08:00', '2030-03-05T12:00:00+08:00') returning id",
      [a.clinicId, dentist.id],
    );
    expect(await asUser(db, aStaff, "delete from public.time_off where id = $1 returning id", [off.id])).toEqual([off]);
  });
});

describe("join links", () => {
  it("belong to the owner alone", async () => {
    const hash = hashInviteToken(await invite(db, a));
    expect(await asUser(db, a.userId, "select clinic_id from public.clinic_invites where token_hash = $1", [hash])).toEqual([{ clinic_id: a.clinicId }]);
    expect(await asUser(db, aStaff, "select id from public.clinic_invites")).toEqual([]);
    expect(await asUser(db, b.userId, "select id from public.clinic_invites where clinic_id = $1", [a.clinicId])).toEqual([]);
    expect(await asUser(db, aStaff, "update public.clinic_invites set revoked_at = now() returning id")).toEqual([]);
    for (const user of [aStaff, b.userId]) {
      await expect(
        asUser(db, user, "insert into public.clinic_invites (clinic_id, token_hash) values ($1, $2)", [a.clinicId, hashInviteToken(`Sneaky${user.slice(0, 6)}`)]),
      ).rejects.toThrow(/row-level security/);
    }
    await expect(asUser(db, null, "select id from public.clinic_invites")).rejects.toThrow(/permission denied/);
  });

  it("last 7 days from their making, and the owner can only revoke them, for good", async () => {
    const hash = hashInviteToken(await invite(db, a));
    expect(
      await asUser(db, a.userId, "select expires_at = created_at + interval '7 days' as week, created_by from public.clinic_invites where token_hash = $1", [hash]),
    ).toEqual([{ week: true, created_by: a.userId }]);
    await expect(
      asUser(db, a.userId, "insert into public.clinic_invites (clinic_id, token_hash, expires_at) values ($1, $2, '2099-01-01')", [
        a.clinicId,
        hashInviteToken("LongLived001"),
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, a.userId, "update public.clinic_invites set expires_at = '2099-01-01' where token_hash = $1", [hash])).rejects.toThrow(/permission denied/);
    expect(
      await asUser(db, a.userId, "update public.clinic_invites set revoked_at = now() where token_hash = $1 returning revoked_at is not null as revoked", [hash]),
    ).toEqual([{ revoked: true }]);
    await expect(asUser(db, a.userId, "update public.clinic_invites set revoked_at = null where token_hash = $1", [hash])).rejects.toThrow(/row-level security/);
  });
});

describe("accept_invite", () => {
  it("adds the caller as staff with their email, once", async () => {
    const c = await newClinic(db);
    const token = await invite(db, c);
    const user = await addUser(db);
    expect(await accept(user, token)).toEqual([{ clinic: c.clinicId }]);
    expect(await asUser(db, user, "select clinic_id, role, email from public.clinic_members where user_id = $1", [user])).toEqual([
      { clinic_id: c.clinicId, role: "staff", email: `${user}@example.com` },
    ]);
    expect(
      await asUser(db, c.userId, "select accepted_by, accepted_at is not null as accepted from public.clinic_invites where token_hash = $1", [hashInviteToken(token)]),
    ).toEqual([{ accepted_by: user, accepted: true }]);
    expect(await sqlstate(accept(await addUser(db), token))).toBe("BSUSD");
  });

  it("refuses revoked, expired, and unknown links, and adds nobody", async () => {
    const c = await newClinic(db);
    const revoked = await invite(db, c);
    await asUser(db, c.userId, "update public.clinic_invites set revoked_at = now() where token_hash = $1", [hashInviteToken(revoked)]);
    const expired = await invite(db, c);
    await db.query("update public.clinic_invites set expires_at = now() - interval '1 second' where token_hash = $1", [hashInviteToken(expired)]);
    const user = await addUser(db);
    expect(await sqlstate(accept(user, revoked))).toBe("BSREV");
    expect(await sqlstate(accept(user, expired))).toBe("BSEXP");
    expect(await sqlstate(accept(user, "NoSuchLink01"))).toBe("BSUNK");
    const { rows } = await db.query("select 1 from public.clinic_members where user_id = $1", [user]);
    expect(rows).toEqual([]);
  });

  it("refuses an account that already belongs to a clinic, and leaves the link open", async () => {
    const token = await invite(db, a);
    expect(await sqlstate(accept(b.userId, token))).toBe("23505");
    expect(await sqlstate(accept(aStaff, token))).toBe("23505");
    expect(await asUser(db, a.userId, "select accepted_at from public.clinic_invites where token_hash = $1", [hashInviteToken(token)])).toEqual([{ accepted_at: null }]);
  });

  it("is only for signed-in accounts", async () => {
    await expect(asUser(db, null, "select public.accept_invite('AbCdEfGhIjKl')")).rejects.toThrow(/permission denied/);
  });
});

describe("remove_member", () => {
  it("lets the owner remove staff, with their push subscriptions for the clinic", async () => {
    const c = await newClinic(db);
    const staff = await addStaff(db, c);
    const subscribe = (userId: string, n: number) =>
      db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [
        c.clinicId,
        userId,
        `https://fcm.googleapis.com/fcm/send/${c.clinicId}-${n}`,
      ]);
    await subscribe(staff, 1);
    await subscribe(staff, 2);
    await subscribe(c.userId, 3);
    await remove(c.userId, staff);
    expect(await asUser(db, c.userId, "select user_id from public.clinic_members")).toEqual([{ user_id: c.userId }]);
    const { rows } = await db.query("select user_id from public.push_subscriptions where clinic_id = $1", [c.clinicId]);
    expect(rows).toEqual([{ user_id: c.userId }]);
    // Their next request finds no clinic, and they are free to join another one.
    expect(await asUser(db, staff, "select id from public.clinics")).toEqual([]);
    const other = await newClinic(db);
    expect(await accept(staff, await invite(db, other))).toEqual([{ clinic: other.clinicId }]);
  });

  it("never removes an owner, and no one but the member's own clinic owner removes anyone", async () => {
    const c = await newClinic(db);
    const staff = await addStaff(db, c);
    const colleague = await addStaff(db, c);
    expect(await sqlstate(remove(c.userId, c.userId))).toBe("BSNOS");
    expect(await sqlstate(remove(staff, colleague))).toBe("BSNOS");
    expect(await sqlstate(remove(staff, c.userId))).toBe("BSNOS");
    expect(await sqlstate(remove(b.userId, staff))).toBe("BSNOS");
    await expect(remove(null, staff)).rejects.toThrow(/permission denied/);
    expect(await asUser(db, c.userId, "select user_id from public.clinic_members")).toHaveLength(3);
  });
});

describe("clinic_week_stats", () => {
  const zero = { completed: 0, no_show: 0, cancelled: 0, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 0, manual: 0 };
  const COLUMNS = "week_start::text as week, dentist_id, completed, no_show, cancelled, declined, expired, unmarked, upcoming, online, manual";
  let c: Clinic;
  let cStaff: string;
  let first: string;
  let second: string;

  /** One appointment at a Manila time, straight into the table (no slot checks). */
  async function visit(dentistId: string, startsAt: string, status: string, source = "online") {
    await db.query(
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, $2, p.id, $3::timestamptz, $3::timestamptz + interval '30 minutes', $4, '{Consultation}', $5, substr(md5(random()::text), 1, 12)
       from public.patients p where p.clinic_id = $1 limit 1`,
      [c.clinicId, dentistId, startsAt, status, source],
    );
  }

  beforeAll(async () => {
    c = await newClinic(db);
    cStaff = await addStaff(db, c);
    await db.query("insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Ana', 'Cruz')", [c.clinicId]);
    first = (await db.query<{ id: string }>("select id from public.dentists where clinic_id = $1", [c.clinicId])).rows[0].id;
    second = (await db.query<{ id: string }>("insert into public.dentists (clinic_id, name, sms_name) values ($1, 'Dr. Two', 'Dr. Two') returning id", [c.clinicId]))
      .rows[0].id;
    // The week of Mon Aug 31 to Sun Sep 6, 2026 (Manila), all before today.
    await visit(first, "2026-08-31T09:00:00+08:00", "completed");
    await visit(first, "2026-09-01T09:00:00+08:00", "completed", "manual");
    await visit(first, "2026-09-02T09:00:00+08:00", "no_show");
    await visit(first, "2026-09-03T09:00:00+08:00", "cancelled");
    await visit(first, "2026-09-04T09:00:00+08:00", "declined");
    await visit(first, "2026-09-05T09:00:00+08:00", "expired");
    await visit(first, "2026-09-05T10:00:00+08:00", "confirmed", "manual"); // started, and nobody marked it
    await visit(first, "2026-09-06T23:30:00+08:00", "completed"); // Sunday 11:30 PM Manila (15:30 UTC): still this week
    await visit(second, "2026-09-02T10:00:00+08:00", "no_show");
    await visit(first, "2026-09-07T00:30:00+08:00", "completed"); // Monday 12:30 AM Manila (Sunday in UTC): the next week
    await visit(first, "2030-01-08T09:00:00+08:00", "confirmed"); // still ahead
  }, 60_000);

  it("counts each status in its Manila week, per dentist", async () => {
    const rows = await asUser(db, c.userId, `select ${COLUMNS} from public.clinic_week_stats($1, '2026-08-31', 2)`, [c.clinicId]);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        { ...zero, week: "2026-08-31", dentist_id: first, completed: 3, no_show: 1, cancelled: 1, declined: 1, expired: 1, unmarked: 1, online: 6, manual: 2 },
        { ...zero, week: "2026-08-31", dentist_id: second, no_show: 1, online: 1 },
        { ...zero, week: "2026-09-07", dentist_id: first, completed: 1, online: 1 },
      ]),
    );
  });

  it("starts at the Monday of p_from's week and counts confirmed visits still ahead", async () => {
    expect(await asService(db, `select ${COLUMNS} from public.clinic_week_stats($1, '2030-01-10', 1)`, [c.clinicId])).toEqual([
      { ...zero, week: "2030-01-07", dentist_id: first, upcoming: 1, online: 1 },
    ]);
  });

  it("shows members only their own clinic's counts", async () => {
    expect(await asUser(db, cStaff, "select dentist_id from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).toHaveLength(3);
    expect(await asUser(db, b.userId, "select dentist_id from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).toEqual([]);
    await expect(asUser(db, null, "select * from public.clinic_week_stats($1, '2026-08-31', 2)", [c.clinicId])).rejects.toThrow(/permission denied/);
  });
});
```

The `create_clinic` comparison passes a replacer function to `replace`, so any `$` in the replacement text could never be read as a replacement pattern.

Run: `npx vitest run tests/sql tests/unit/validate.test.ts`
Expected: FAIL. `teams.test.ts` and `isolation.test.ts` stop in `beforeAll` on `relation "public.clinic_invites" does not exist` (the harness's `invite` and the isolation seed insert into it), and `validate.test.ts` fails "rejects reserved join". `billing.test.ts` still PASS.

- [ ] **Step 4: Write the migration and reserve the join link**

Create `supabase/migrations/20260926000100_teams.sql`:

```sql
-- Teams and reports (teams spec section 5): owner and staff roles, join links, the Monday summary's claim, and the
-- weekly counts behind the Reports page. Staff run the day; only the owner changes the clinic's setup and its team.

-- 1. Staff join the owner. The default stays 'owner', which create_clinic relies on.
alter table public.clinic_members drop constraint clinic_members_role_check;
alter table public.clinic_members add constraint clinic_members_role_check check (role in ('owner', 'staff'));

-- Each member's login email, copied when the membership is made, so the Team page never reads auth.users.
alter table public.clinic_members add column email text check (char_length(email) <= 254);
update public.clinic_members m set email = u.email from auth.users u where u.id = m.user_id;

-- Members see every membership of their clinic (the Team page). Nobody writes memberships directly: only
-- create_clinic and accept_invite add them, and only remove_member deletes them.
drop policy "users see their memberships" on public.clinic_members;
create policy "members see their clinic's members" on public.clinic_members
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
revoke all on public.clinic_members from authenticated;
grant select on public.clinic_members to authenticated;

-- 2. security definer, like is_clinic_member, so policies can read clinic_members without recursing.
create function public.is_clinic_owner(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = cid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;
revoke execute on function public.is_clinic_owner(uuid) from public, anon;
grant execute on function public.is_clinic_owner(uuid) to authenticated;

-- 3. Every member reads the clinic's setup; only the owner changes it (teams spec 4).
drop policy "members update their clinic" on public.clinics;
create policy "owner updates the clinic" on public.clinics
  for update to authenticated
  using (public.is_clinic_owner(id)) with check (public.is_clinic_owner(id));

drop policy "members manage dentists" on public.dentists;
create policy "members read dentists" on public.dentists
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner manages dentists" on public.dentists
  for all to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));

drop policy "members manage working hours" on public.working_hours;
create policy "members read working hours" on public.working_hours
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner manages working hours" on public.working_hours
  for all to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));

drop policy "members manage procedures" on public.procedures;
create policy "members read procedures" on public.procedures
  for select to authenticated
  using (public.is_clinic_member(clinic_id));
create policy "owner manages procedures" on public.procedures
  for all to authenticated
  using (public.is_clinic_owner(clinic_id)) with check (public.is_clinic_owner(clinic_id));

-- 4. Join links (teams spec 5, 6.1). Only the token's SHA-256 is stored, so a leaked table holds no working links.
create table public.clinic_invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
create index clinic_invites_clinic on public.clinic_invites (clinic_id, created_at);
alter table public.clinic_invites enable row level security;

create policy "owner reads invites" on public.clinic_invites
  for select to authenticated
  using (public.is_clinic_owner(clinic_id));
create policy "owner creates invites" on public.clinic_invites
  for insert to authenticated
  with check (public.is_clinic_owner(clinic_id) and created_by = (select auth.uid()));
-- Revoking is the only change the owner can make, and a revoked link never reopens.
create policy "owner revokes invites" on public.clinic_invites
  for update to authenticated
  using (public.is_clinic_owner(clinic_id))
  with check (public.is_clinic_owner(clinic_id) and revoked_at is not null);

-- Explicit grants: the owner sets only the clinic and the hash (the maker, the times, and the 7 day expiry are
-- defaults) and later only revoked_at. The secret key looks links up for the join page.
revoke all on public.clinic_invites from public, anon, authenticated;
grant select on public.clinic_invites to authenticated;
grant insert (clinic_id, token_hash) on public.clinic_invites to authenticated;
grant update (revoked_at) on public.clinic_invites to authenticated;
grant all on public.clinic_invites to service_role;

-- 5. The Monday a weekly summary was last claimed for, so the daily job pushes it once (teams spec 6.4).
alter table public.clinics add column weekly_report_for date;

-- 6. /join/{token} is the join page, so no clinic may take "join" as its booking link (must match RESERVED_SLUGS
-- in src/lib/validate.ts).
alter table public.clinics drop constraint clinics_slug_not_reserved;
alter table public.clinics add constraint clinics_slug_not_reserved check (
  slug not in ('a', 'app', 'api', 'auth', 'login', 'signup', 'onboarding', 'forgot',
               'reset-password', 'privacy', 'terms', 'admin', 'static', '_next', 'join')
);

-- 7. Onboarding also records the owner's email (teams spec 5). The rest is 20260925000200_billing.sql unchanged.
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

  insert into public.working_hours (clinic_id, dentist_id, weekday, start_time, end_time)
  select v_clinic, v_dentist, (h->>'weekday')::smallint, (h->>'start')::time, (h->>'end')::time
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

-- 8. Joining through a link (teams spec 6.2). security definer because the caller belongs to no clinic yet. It
-- hashes the token itself and locks the invite, so a link works once even when two people open it together.
-- Refusals raise their own SQLSTATE so the join page can tell them apart:
--   BSUNK no such link, BSREV revoked, BSUSD already used, BSEXP expired,
--   23505 the caller already belongs to a clinic (as in create_clinic; the unique index raises it in a race too).
create function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_invite public.clinic_invites%rowtype;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_invite from public.clinic_invites
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
  for update;
  if not found then
    raise exception 'no such join link' using errcode = 'BSUNK';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'this join link was revoked' using errcode = 'BSREV';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'this join link was already used' using errcode = 'BSUSD';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'this join link expired' using errcode = 'BSEXP';
  end if;
  if exists (select 1 from public.clinic_members where user_id = v_user) then
    raise exception 'this account already has a clinic' using errcode = '23505';
  end if;

  insert into public.clinic_members (clinic_id, user_id, role, email)
  values (v_invite.clinic_id, v_user, 'staff', (select u.email from auth.users u where u.id = v_user));

  update public.clinic_invites set accepted_by = v_user, accepted_at = now() where id = v_invite.id;

  return v_invite.clinic_id;
end;
$$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 9. Removing staff (teams spec 5): only the owner of the member's clinic, never an owner row. The person's push
-- subscriptions for the clinic go in the same transaction, because sendPush reads them with the secret key and would
-- otherwise keep alerting their phone. BSNOS: no such staff member in a clinic the caller owns.
create function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  select m.clinic_id into v_clinic from public.clinic_members m
  where m.user_id = p_user_id and m.role = 'staff' and public.is_clinic_owner(m.clinic_id)
  for update;
  if not found then
    raise exception 'no such staff member' using errcode = 'BSNOS';
  end if;

  delete from public.push_subscriptions where clinic_id = v_clinic and user_id = p_user_id;
  delete from public.clinic_members where clinic_id = v_clinic and user_id = p_user_id;
end;
$$;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.remove_member(uuid) to authenticated;

-- 10. The Reports page and the Monday summary (teams spec 5, 6.3, 6.4): one row per Manila week (Monday to Sunday,
-- by the appointment's start) and dentist, for p_weeks weeks from the Monday of p_from's week. security invoker, so
-- RLS limits a member to their own clinic; the daily job calls it with the secret key. Weeks and dentists without
-- appointments have no row. unmarked: confirmed visits that have started and nobody marked; upcoming: confirmed
-- visits still ahead; online and manual: every appointment by how it was booked, whatever its status.
create function public.clinic_week_stats(p_clinic_id uuid, p_from date, p_weeks integer)
returns table (
  week_start date,
  dentist_id uuid,
  completed integer,
  no_show integer,
  cancelled integer,
  declined integer,
  expired integer,
  unmarked integer,
  upcoming integer,
  online integer,
  manual integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (date_trunc('week', a.starts_at at time zone 'Asia/Manila'))::date,
    a.dentist_id,
    (count(*) filter (where a.status = 'completed'))::int,
    (count(*) filter (where a.status = 'no_show'))::int,
    (count(*) filter (where a.status = 'cancelled'))::int,
    (count(*) filter (where a.status = 'declined'))::int,
    (count(*) filter (where a.status = 'expired'))::int,
    (count(*) filter (where a.status = 'confirmed' and a.starts_at <= now()))::int,
    (count(*) filter (where a.status = 'confirmed' and a.starts_at > now()))::int,
    (count(*) filter (where a.source = 'online'))::int,
    (count(*) filter (where a.source = 'manual'))::int
  from public.appointments a
  where a.clinic_id = p_clinic_id
    and a.starts_at >= (date_trunc('week', p_from::timestamp) at time zone 'Asia/Manila')
    and a.starts_at < ((date_trunc('week', p_from::timestamp) + make_interval(weeks => p_weeks)) at time zone 'Asia/Manila')
  group by 1, 2
  order by 1, 2;
$$;
revoke execute on function public.clinic_week_stats(uuid, date, integer) from public, anon;
grant execute on function public.clinic_week_stats(uuid, date, integer) to authenticated, service_role;
```

In `src/lib/validate.ts`, replace:

```ts
  "reset-password", "privacy", "terms", "admin", "static", "_next",
]);
```

with:

```ts
  "reset-password", "privacy", "terms", "admin", "static", "_next", "join",
]);
```

Run: `npx vitest run tests/sql tests/unit/validate.test.ts`
Expected: PASS: `teams.test.ts` 22 tests, `isolation.test.ts` 9 (its sweep now covers `clinic_invites`, and the visitor checks cover the new table and functions), `billing.test.ts` 18, and `validate.test.ts`.

- [ ] **Step 5: Point the onboarding payload type at the new definition**

In `src/lib/onboarding.ts`, replace:

```ts
/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260925000200_billing.sql). */
```

with:

```ts
/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260926000100_teams.sql). */
```

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS.

```powershell
git add src/lib/team.ts tests/unit/team.test.ts supabase/migrations/20260926000100_teams.sql tests/sql/teams.test.ts tests/sql/harness.ts tests/sql/isolation.test.ts src/lib/validate.ts tests/unit/validate.test.ts src/lib/onboarding.ts
git commit -m "feat: add owner and staff roles, join links, and weekly counts to the database" -m "Staff read the clinic's setup and run the day; only the owner changes the setup, and members see each other's memberships with their emails. clinic_invites stores only token hashes; accept_invite joins once with distinct refusals, remove_member takes the person's push subscriptions with them, and clinic_week_stats counts appointments per Manila week and dentist under RLS. join is a reserved booking link. Proven offline in tests/sql."
```

### Task 3: Owner-only setup and billing

**Files:**
- Create: `tests/unit/settings-actions.test.ts`
- Modify: `src/app/app/settings/actions.ts`, `src/app/app/billing/actions.ts`, `src/lib/billing.ts`, `src/lib/billing-data.ts`, `src/app/app/layout.tsx`, `src/app/app/settings/page.tsx`, `src/app/app/settings/DentistEditor.tsx`, `src/app/app/billing/page.tsx`, `tests/unit/billing.test.ts`, `tests/unit/pay-online.test.ts`

**Interfaces:**
- Consumes: `requireStaff`, `requireOwner`, `OWNER_ONLY`, `type Member`, `type Staff` from `@/lib/supabase/server` (Task 1); the owner-only policies (Task 2); `billingStatus`, `statusLine`, `STATUS_LABEL`, `STATUS_CHIP`, `loadBilling` (plan 5).
- Produces:
  - `bannerText(state: BillingState, now: Date, owner?: boolean): string | null` from `@/lib/billing` (`owner` defaults to `true`, so every existing caller keeps its words)
  - `billingBanner(member: Member, now: Date): Promise<string | null>` from `@/lib/billing-data`
  - `DentistEditor({ dentist: Dentist | null; canEdit?: boolean })` (`canEdit` defaults to `true`)
  - The settings actions keep their signatures; `updateProfile`, `updateRules`, `saveDentistAction`, `setDentistActiveAction`, `saveProcedureAction`, and `setProcedureActiveAction` answer staff `{ ok: false, error: OWNER_ONLY }`. `payOnline` answers staff `{ error: OWNER_ONLY }`.

Rules (spec 4, 6.5):
- Owner-only Server Actions call `requireOwner` before reading anything; `addTimeOffAction`, `removeTimeOffAction`, `changePassword`, `enablePush`, and `disablePush` stay open to staff. RLS refuses staff writes regardless (Task 2); the check only turns a silent failure into a clear message.
- Settings for staff: "Alerts on this device", each dentist with a Time off button that opens only their time off (no editing of names or hours, no deactivating), the plan's status link, and the account. The clinic profile, booking rules (with the alert channel), procedures, and "Add a dentist" are the owner's.
- `/app/billing` for staff: the status chip and the status line only, without prices, payment options, or history.
- The dashboard banner stays on every page. For staff it adds "Ask your clinic's owner to renew." in place of the payment prompt ("Pay to reopen it." when lapsed, the "Go to Billing" link otherwise), and links nowhere.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/settings-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/app/app/settings/actions";
import * as settings from "@/lib/clinic-settings";
import { requireOwner, requireStaff } from "@/lib/supabase/server";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/push", () => ({ saveSubscription: vi.fn(), deleteSubscription: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ OWNER_ONLY: "Only the clinic's owner can change this.", requireStaff: vi.fn(), requireOwner: vi.fn() }));
vi.mock("@/lib/clinic-settings", () => {
  const saved = async () => ({ ok: true });
  return {
    saveProfile: vi.fn(saved),
    saveRules: vi.fn(saved),
    saveDentist: vi.fn(saved),
    setDentistActive: vi.fn(saved),
    addTimeOff: vi.fn(saved),
    removeTimeOff: vi.fn(saved),
    saveProcedure: vi.fn(saved),
    setProcedureActive: vi.fn(saved),
  };
});

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const member = (role: "owner" | "staff") => ({ db: {} as never, userId: "u1", clinicId: "c1", role });

// Every owner-only setting (teams spec 4), called the way the Settings forms call them.
const ownerOnly = () => [
  actions.updateProfile({}),
  actions.updateRules({}),
  actions.saveDentistAction(null, {}),
  actions.setDentistActiveAction(ID, false),
  actions.saveProcedureAction(null, {}),
  actions.setProcedureActiveAction(ID, false),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings actions", () => {
  it("answer staff that only the owner changes the clinic's setup, and save nothing", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("staff"));
    vi.mocked(requireOwner).mockResolvedValue(null);
    for (const result of await Promise.all(ownerOnly())) expect(result).toEqual({ ok: false, error: "Only the clinic's owner can change this." });
    for (const save of Object.values(settings)) expect(save).not.toHaveBeenCalled();
  });

  it("let staff add and remove dentists' time off", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("staff"));
    vi.mocked(requireOwner).mockResolvedValue(null);
    expect(await actions.addTimeOffAction(ID, {})).toEqual({ ok: true });
    expect(await actions.removeTimeOffAction(ID)).toEqual({ ok: true });
    expect(settings.addTimeOff).toHaveBeenCalledOnce();
    expect(settings.removeTimeOff).toHaveBeenCalledOnce();
  });

  it("let the owner change the setup", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("owner"));
    vi.mocked(requireOwner).mockResolvedValue(member("owner"));
    for (const result of await Promise.all(ownerOnly())) expect(result).toEqual({ ok: true });
    expect(settings.saveProfile).toHaveBeenCalledOnce();
    expect(settings.setProcedureActive).toHaveBeenCalledOnce();
  });
});
```

In `tests/unit/billing.test.ts`, replace:

```ts
    expect(bannerText(billingStatus(trial, lapsed), lapsed)).toBe("Online booking is paused. Pay to reopen it.");
  });
```

with:

```ts
    expect(bannerText(billingStatus(trial, lapsed), lapsed)).toBe("Online booking is paused. Pay to reopen it.");
  });

  it("asks staff to tell the owner in place of the payment prompt (teams spec 6.5)", () => {
    const early = at(trialEnd, -3 * DAY - 1);
    expect(bannerText(billingStatus(trial, early), early, false)).toBeNull();
    const threeDays = at(trialEnd, -3 * DAY);
    expect(bannerText(billingStatus(trial, threeDays), threeDays, false)).toBe("Your plan ends on Fri Oct 9. Ask your clinic's owner to renew.");
    const grace = at(trialEnd, DAY);
    expect(bannerText(billingStatus(trial, grace), grace, false)).toBe("Your plan ended. Online booking pauses on Mon Oct 12. Ask your clinic's owner to renew.");
    const lapsed = at(trialEnd, 3 * DAY);
    expect(bannerText(billingStatus(trial, lapsed), lapsed, false)).toBe("Online booking is paused. Ask your clinic's owner to renew.");
  });
```

In `tests/unit/pay-online.test.ts`, replace:

```ts
const fake = vi.hoisted(() => ({ slugRead: null as unknown as () => Promise<{ data: { slug: string } }> }));

vi.mock("@/lib/supabase/server", () => ({
  requireStaff: async () => ({
    clinicId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    db: { from: () => ({ select: () => ({ eq: () => ({ single: () => ({ throwOnError: () => fake.slugRead() }) }) }) }) },
  }),
}));
```

with:

```ts
const fake = vi.hoisted(() => ({ slugRead: null as unknown as () => Promise<{ data: { slug: string } }>, owner: true }));

vi.mock("@/lib/supabase/server", () => ({
  OWNER_ONLY: "Only the clinic's owner can change this.",
  requireOwner: async () =>
    fake.owner
      ? {
          clinicId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
          role: "owner",
          db: { from: () => ({ select: () => ({ eq: () => ({ single: () => ({ throwOnError: () => fake.slugRead() }) }) }) }) },
        }
      : null,
}));
```

replace:

```ts
  fake.slugRead = async () => ({ data: { slug: "bright-dental" } });
});
```

with:

```ts
  fake.slugRead = async () => ({ data: { slug: "bright-dental" } });
  fake.owner = true;
});
```

and replace:

```ts
    expect(vi.mocked(createCheckout).mock.calls[0][0]).toMatchObject({ slug: "bright-dental", tier: "Team", months: 3, amountCentavos: 389_700 });
  });
});
```

with:

```ts
    expect(vi.mocked(createCheckout).mock.calls[0][0]).toMatchObject({ slug: "bright-dental", tier: "Team", months: 3, amountCentavos: 389_700 });
  });

  it("answers staff that only the owner pays, before reading anything (teams spec 4)", async () => {
    fake.owner = false;
    expect(await payOnline({}, form("3"))).toEqual({ error: "Only the clinic's owner can change this." });
    expect(activeDentists).not.toHaveBeenCalled();
    expect(createCheckout).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/unit/settings-actions.test.ts tests/unit/billing.test.ts tests/unit/pay-online.test.ts`
Expected: FAIL. The staff case of `settings-actions.test.ts` gets `{ ok: true }` (the owner-only actions still call `requireStaff` and save); `billing.test.ts` gets the owner's words from `bannerText`, which ignores its third argument; every `pay-online.test.ts` test fails because `payOnline` still calls `requireStaff`, which the updated mock no longer defines (Vitest says `No "requireStaff" export is defined on the "@/lib/supabase/server" mock`).

- [ ] **Step 2: Make the setup actions owner-only**

In `src/app/app/settings/actions.ts`, replace:

```ts
import { requireStaff, type Staff } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validate";

/** Every settings action: signed-in staff only, untrusted arguments (spec 12), re-render on success. */
async function run(save: (staff: Staff) => Promise<Saved>): Promise<Saved> {
  const staff = await requireStaff();
  const result = await save(staff);
```

with:

```ts
import { OWNER_ONLY, requireOwner, requireStaff, type Staff } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validate";

/**
 * Every settings action: signed-in staff only, untrusted arguments (spec 12), re-render on success. Owner-only actions
 * pass requireOwner, which answers staff OWNER_ONLY before anything is read (teams spec 4).
 */
async function run(save: (staff: Staff) => Promise<Saved>, who: () => Promise<Staff | null> = requireStaff): Promise<Saved> {
  const staff = await who();
  if (!staff) return { ok: false, error: OWNER_ONLY };
  const result = await save(staff);
```

replace:

```ts
  return run((staff) => settings.saveProfile(staff, input));
```

with:

```ts
  return run((staff) => settings.saveProfile(staff, input), requireOwner);
```

replace:

```ts
  return run((staff) => settings.saveRules(staff, input));
```

with:

```ts
  return run((staff) => settings.saveRules(staff, input), requireOwner);
```

replace:

```ts
  return run((staff) => settings.saveDentist(staff, idOrNull(dentistId), input));
```

with:

```ts
  return run((staff) => settings.saveDentist(staff, idOrNull(dentistId), input), requireOwner);
```

replace:

```ts
  return run((staff) => settings.setDentistActive(staff, String(dentistId), active === true));
```

with:

```ts
  return run((staff) => settings.setDentistActive(staff, String(dentistId), active === true), requireOwner);
```

replace:

```ts
  return run((staff) => settings.saveProcedure(staff, idOrNull(procedureId), input));
```

with:

```ts
  return run((staff) => settings.saveProcedure(staff, idOrNull(procedureId), input), requireOwner);
```

and replace:

```ts
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true));
```

with:

```ts
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true), requireOwner);
```

- [ ] **Step 3: Make paying owner-only**

In `src/app/app/billing/actions.ts`, replace:

```ts
import { requireStaff } from "@/lib/supabase/server";
```

with:

```ts
import { OWNER_ONLY, requireOwner } from "@/lib/supabase/server";
```

and replace:

```ts
 * dentists, read here on the server, never from the form. redirect stays outside any try block.
 */
export async function payOnline(_state: PayState, form: FormData): Promise<PayState> {
  const staff = await requireStaff();
```

with:

```ts
 * dentists, read here on the server, never from the form. redirect stays outside any try block. Only the owner pays
 * (teams spec 4).
 */
export async function payOnline(_state: PayState, form: FormData): Promise<PayState> {
  const staff = await requireOwner();
  if (!staff) return { error: OWNER_ONLY };
```

- [ ] **Step 4: Give staff their own banner words**

In `src/lib/billing.ts`, replace:

```ts
/** The dashboard banner (spec 7.5), or null when the plan has more than 3 days left. */
export function bannerText(state: BillingState, now: Date): string | null {
  if (state.status === "lapsed") return "Online booking is paused. Pay to reopen it.";
  if (state.status === "grace") return `Your plan ended. Online booking pauses on ${billingDate(state.pausesAt, now)}.`;
  if (state.endsAt.getTime() - now.getTime() <= NOTICE_DAYS * DAY_MS) return `Your plan ends on ${billingDate(state.endsAt, now)}.`;
  return null;
}
```

with:

```ts
/**
 * The dashboard banner (spec 7.5), or null when the plan has more than 3 days left. Staff cannot pay, so they get
 * "Ask your clinic's owner to renew." in place of the payment prompt (teams spec 6.5).
 */
export function bannerText(state: BillingState, now: Date, owner = true): string | null {
  const ask = owner ? "" : " Ask your clinic's owner to renew.";
  if (state.status === "lapsed") return owner ? "Online booking is paused. Pay to reopen it." : `Online booking is paused.${ask}`;
  if (state.status === "grace") return `Your plan ended. Online booking pauses on ${billingDate(state.pausesAt, now)}.${ask}`;
  if (state.endsAt.getTime() - now.getTime() <= NOTICE_DAYS * DAY_MS) return `Your plan ends on ${billingDate(state.endsAt, now)}.${ask}`;
  return null;
}
```

In `src/lib/billing-data.ts`, replace:

```ts
import type { Staff } from "@/lib/supabase/server";
```

with:

```ts
import type { Member } from "@/lib/supabase/server";
```

and replace:

```ts
/** The dashboard banner, or null. Never throws: a failed billing read must not take the dashboard down. */
export async function billingBanner(staff: Staff, now: Date): Promise<string | null> {
  try {
    return bannerText(billingStatus(await loadBilling(staff.db, staff.clinicId), now), now);
```

with:

```ts
/**
 * The dashboard banner, or null, in the owner's or the staff's words (teams spec 6.5). Never throws: a failed billing
 * read must not take the dashboard down.
 */
export async function billingBanner(member: Member, now: Date): Promise<string | null> {
  try {
    return bannerText(billingStatus(await loadBilling(member.db, member.clinicId), now), now, member.role === "owner");
```

In `src/app/app/layout.tsx`, replace:

```tsx
          <p className="note-box warn mb-4">
            {banner}{" "}
            <Link href="/app/billing" className="link inline-flex min-h-11 items-center">
              Go to Billing
            </Link>
          </p>
```

with:

```tsx
          <p className="note-box warn mb-4">
            {banner}
            {staff.role === "owner" && (
              <>
                {" "}
                <Link href="/app/billing" className="link inline-flex min-h-11 items-center">
                  Go to Billing
                </Link>
              </>
            )}
          </p>
```

Run: `npx vitest run tests/unit/settings-actions.test.ts tests/unit/billing.test.ts tests/unit/pay-online.test.ts`
Expected: PASS (3, 17, and 3 tests).

- [ ] **Step 5: Show staff only what they may use in Settings and Billing**

In `src/app/app/settings/DentistEditor.tsx`, replace:

```tsx
/** One dentist (or "Add a dentist" when null): name, short name, weekly hours, active, and time off. */
export default function DentistEditor({ dentist }: { dentist: Dentist | null }) {
```

with:

```tsx
/**
 * One dentist (or "Add a dentist" when null): name, short name, weekly hours, active, and time off. Staff (canEdit
 * false) see only the time off, the one part of a dentist they may change (teams spec 4).
 */
export default function DentistEditor({ dentist, canEdit = true }: { dentist: Dentist | null; canEdit?: boolean }) {
```

replace:

```tsx
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
```

with:

```tsx
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          {canEdit ? "Edit" : "Time off"}
        </button>
```

and replace:

```tsx
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
```

with:

```tsx
    <div className="cf-box mt-3">
      {canEdit ? (
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
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-[16px] font-bold">{dentist?.name}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}

      {dentist && (
        <>
          {canEdit && (
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
            </>
          )}

          <h3 className="f-label mt-6">Time off</h3>
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
/** Spec 5.3 Settings: clinic profile, booking rules and alerts, dentists, procedures, account. */
export default async function SettingsPage() {
  const staff = await requireStaff();
  const settings = await loadSettings(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Settings</h1>
      </div>
      <ProfileForm clinic={settings.clinic} appUrl={appUrl()} />
      <RulesForm clinic={settings.clinic} />
      <PushSetup />
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
      <section className="card card-pad settings-section">
        <h2 className="font-display">Plan and billing</h2>
        <p className="f-hint">See when your plan ends, how to pay, and past payments.</p>
```

with:

```tsx
/**
 * Spec 5.3 Settings: clinic profile, booking rules and alerts, dentists, procedures, account. Staff see only what they
 * may use (teams spec 4): alerts on their device, dentists' time off, the plan's status, and their account.
 */
export default async function SettingsPage() {
  const staff = await requireStaff();
  const owner = staff.role === "owner";
  const settings = await loadSettings(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Settings</h1>
      </div>
      {owner && <ProfileForm clinic={settings.clinic} appUrl={appUrl()} />}
      {owner && <RulesForm clinic={settings.clinic} />}
      <PushSetup />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Dentists</h2>
        <p className="f-hint">
          {owner
            ? "Patients choose a dentist only when 2 or more are active."
            : "Add or remove a dentist's time off. Only the clinic's owner changes dentists and their hours."}
        </p>
        <div className="member-list mt-2">
          {settings.dentists.map((d) => (
            <DentistEditor key={d.id} dentist={d} canEdit={owner} />
          ))}
        </div>
        {owner && <DentistEditor dentist={null} />}
      </section>
      {owner && <ProcedureEditor procedures={settings.procedures} />}
      <section className="card card-pad settings-section">
        <h2 className="font-display">Plan and billing</h2>
        <p className="f-hint">{owner ? "See when your plan ends, how to pay, and past payments." : "See when your clinic's plan ends."}</p>
```

In `src/app/app/billing/page.tsx`, replace:

```tsx
  const staff = await requireStaff();
  const now = new Date();
  const [billing, dentists, payments, clinic, { paid }] = await Promise.all([
```

with:

```tsx
  const staff = await requireStaff();
  const now = new Date();
  // Teams spec 6.5: staff see the status line only, without prices, payment options, or history.
  if (staff.role !== "owner") {
    const state = billingStatus(await loadBilling(staff.db, staff.clinicId), now);
    return (
      <>
        <div className="page-head">
          <h1 className="font-display">Billing</h1>
        </div>
        <section className="card card-pad settings-section">
          <h2 className="font-display">Your plan</h2>
          <div className="chip-row">
            <span className={`chip ${STATUS_CHIP[state.status]}`}>{STATUS_LABEL[state.status]}</span>
          </div>
          <p className="mt-2">{statusLine(state, now)}</p>
          <p className="f-hint mt-2">Your clinic&apos;s owner handles the plan and payments.</p>
        </section>
      </>
    );
  }
  const [billing, dentists, payments, clinic, { paid }] = await Promise.all([
```

- [ ] **Step 6: Check and commit**

The pages have no rule of their own beyond the role checks tested above, so the checks are the typecheck, lint, tests, and build (spec 8: no dashboard against a real database locally).

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the build finishes.

```powershell
git add tests/unit/settings-actions.test.ts src/app/app/settings/actions.ts src/app/app/billing/actions.ts src/lib/billing.ts src/lib/billing-data.ts src/app/app/layout.tsx src/app/app/settings/page.tsx src/app/app/settings/DentistEditor.tsx src/app/app/billing/page.tsx tests/unit/billing.test.ts tests/unit/pay-online.test.ts
git commit -m "feat: keep the clinic's setup and payments with the owner" -m "Owner-only settings actions and Pay online answer staff that only the owner can change them. Staff see alerts, dentists' time off, the plan's status, and their account in Settings, the status line alone on Billing, and a banner that asks them to tell the owner instead of pointing at payment."
```

### Task 4: The Team page

**Files:**
- Create: `src/lib/team-data.ts`, `tests/unit/team-data.test.ts`, `src/app/app/settings/team/actions.ts`, `src/app/app/settings/team/TeamPanel.tsx`, `src/app/app/settings/team/page.tsx`
- Modify: `src/lib/team.ts`, `src/app/app/settings/page.tsx`

**Interfaces:**
- Consumes: `hashInviteToken` (Task 2); `requireOwner`, `OWNER_ONLY`, `type Staff` (Task 1); `type Role` from `@/lib/membership`; `newToken` from `@/lib/codes`; `appUrl` from `@/lib/app-url`; `logError`; `isUuid`; `billingDate` from `@/lib/billing`; `formatTime` from `@/lib/time`; table `clinic_invites`, the member policy, and `remove_member` (Task 2).
- Produces:
  - From `@/lib/team`: `joinLink(appUrl: string, token: string): string`
  - From `@/lib/team-data` (server only): `type TeamMember = { userId: string; email: string | null; role: Role; joinedAt: string }`, `type OpenInvite = { id: string; createdAt: string; expiresAt: string }`, `type NewInvite = { ok: true; link: string } | { ok: false; error: string }`, `loadTeam(owner: Staff, now: Date): Promise<{ members: TeamMember[]; invites: OpenInvite[] }>`, `createInvite(owner: Staff): Promise<NewInvite>`, `revokeInvite(owner: Staff, id: string): Promise<Saved>`, `removeMember(owner: Staff, userId: string): Promise<Saved>`
  - Server Actions in `src/app/app/settings/team/actions.ts`: `createInviteAction(): Promise<NewInvite>`, `revokeInviteAction(id: unknown): Promise<Saved>`, `removeMemberAction(userId: unknown): Promise<Saved>`
  - Default export `TeamPanel({ members: MemberRow[]; invites: InviteRow[] })`, with `type MemberRow = { userId: string; email: string | null; owner: boolean; joined: string }` and `type InviteRow = { id: string; created: string; expires: string }` (dates already in words, so the Client Component never formats time)
  - Page `/app/settings/team` (owner only; staff are sent to `/app/settings`), linked from Settings for the owner

Rules (spec 6.1, 7):
- The page lists every member (email, role as a word chip, joined date from `clinic_members.created_at`) and every open link (made, works until), all through the owner's RLS client.
- "Create join link" (the page's one primary button) stores `hashInviteToken(newToken())` and returns `{APP_URL}/join/{token}` once, with "Send it by Messenger or text. It works once, for 7 days." and a Copy button. The token is never stored or shown again, and never logged.
- Revoke sets `revoked_at` on an open link of this clinic only. Remove asks first ("Remove {email}? They lose access at once...") and calls `remove_member`; the owner's row has no Remove button, and the database refuses it anyway. Removed and revoked answers "no longer on your team" or "already used or revoked" when nothing matched.
- Every action calls `requireOwner` first and treats its argument as untrusted.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/team-data.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "@/lib/team";
import { createInvite, removeMember, revokeInvite } from "@/lib/team-data";

vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://bsmile.vercel.app" }));

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const STAFF_ID = "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92";
const owner = (db: object) => ({ db: db as never, userId: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", clinicId: CLINIC });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createInvite", () => {
  it("stores only the token's hash and gives the link back once", async () => {
    const inserted: unknown[] = [];
    const db = {
      from: (table: string) => ({
        insert: async (row: unknown) => {
          inserted.push({ table, row });
          return { error: null };
        },
      }),
    };
    const result = await createInvite(owner(db));
    if (!result.ok) throw new Error(result.error);
    const token = result.link.replace("https://bsmile.vercel.app/join/", "");
    expect(token).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(inserted).toEqual([{ table: "clinic_invites", row: { clinic_id: CLINIC, token_hash: hashInviteToken(token) } }]);
  });

  it("says something went wrong, and logs where, when the link cannot be saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { from: () => ({ insert: async () => ({ error: { message: "JWT expired" } }) }) };
    expect(await createInvite(owner(db))).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    expect(logged.mock.calls).toEqual([["createInvite failed:", "JWT expired"]]);
  });
});

describe("revokeInvite and removeMember", () => {
  it("say the link or the person is gone when nothing matched", async () => {
    type Chain = { update: () => Chain; eq: () => Chain; is: () => Chain; select: () => Promise<{ data: unknown[]; error: null }> };
    const chain: Chain = { update: () => chain, eq: () => chain, is: () => chain, select: async () => ({ data: [], error: null }) };
    expect(await revokeInvite(owner({ from: () => chain }), STAFF_ID)).toEqual({ ok: false, error: "That link was already used or revoked. Reload the page." });
    const db = { rpc: async () => ({ error: { code: "BSNOS", message: "no such staff member" } }) };
    expect(await removeMember(owner(db), STAFF_ID)).toEqual({ ok: false, error: "That person is no longer on your team. Reload the page." });
  });

  it("refuse ids that are not ids before asking the database", async () => {
    const never = () => {
      throw new Error("no query expected");
    };
    const db = { from: never, rpc: never };
    expect((await revokeInvite(owner(db), "not-an-id")).ok).toBe(false);
    expect((await removeMember(owner(db), "not-an-id")).ok).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/team-data.test.ts`
Expected: FAIL with `Cannot find package '@/lib/team-data'`.

- [ ] **Step 2: Write the join link helper and the team data**

Append to the end of `src/lib/team.ts`:

```ts

/** The link the owner sends by Messenger or text (teams spec 6.1): {APP_URL}/join/{token}. */
export function joinLink(appUrl: string, token: string): string {
  return `${appUrl}/join/${token}`;
}
```

Create `src/lib/team-data.ts`:

```ts
import "server-only";
import { appUrl } from "@/lib/app-url";
import { newToken } from "@/lib/codes";
import { logError } from "@/lib/log";
import type { Role } from "@/lib/membership";
import type { Saved } from "@/lib/staff-input";
import type { Staff } from "@/lib/supabase/server";
import { hashInviteToken, joinLink } from "@/lib/team";
import { isUuid } from "@/lib/validate";

export type TeamMember = { userId: string; email: string | null; role: Role; joinedAt: string };
export type OpenInvite = { id: string; createdAt: string; expiresAt: string };
export type NewInvite = { ok: true; link: string } | { ok: false; error: string };

const GENERIC = "Something went wrong. Please try again.";
const USED = "That link was already used or revoked. Reload the page.";
const GONE = "That person is no longer on your team. Reload the page.";

/**
 * The Team page (teams spec 6.1), through the owner's RLS client: every member, oldest first, and the join links nobody
 * has used, revoked, or outlived, newest first.
 */
export async function loadTeam(owner: Staff, now: Date): Promise<{ members: TeamMember[]; invites: OpenInvite[] }> {
  const [members, invites] = await Promise.all([
    owner.db.from("clinic_members").select("user_id, role, email, created_at").eq("clinic_id", owner.clinicId).order("created_at").throwOnError(),
    owner.db
      .from("clinic_invites")
      .select("id, created_at, expires_at")
      .eq("clinic_id", owner.clinicId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: false })
      .throwOnError(),
  ]);
  return {
    members: (members.data as { user_id: string; role: Role; email: string | null; created_at: string }[]).map((m) => ({
      userId: m.user_id,
      email: m.email,
      role: m.role,
      joinedAt: m.created_at,
    })),
    invites: (invites.data as { id: string; created_at: string; expires_at: string }[]).map((i) => ({
      id: i.id,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
  };
}

/**
 * A new join link (teams spec 6.1): a random token whose SHA-256 alone is stored, so the link can be shown once and
 * never again. The database sets who made it and the 7 day expiry.
 */
export async function createInvite(owner: Staff): Promise<NewInvite> {
  const token = newToken();
  const { error } = await owner.db.from("clinic_invites").insert({ clinic_id: owner.clinicId, token_hash: hashInviteToken(token) });
  if (error) {
    logError("createInvite", error);
    return { ok: false, error: GENERIC };
  }
  return { ok: true, link: joinLink(appUrl(), token) };
}

/** Revokes an open join link of this clinic; it stops working at once (teams spec 2.4). */
export async function revokeInvite(owner: Staff, id: string): Promise<Saved> {
  if (!isUuid(id)) return { ok: false, error: USED };
  const { data, error } = await owner.db
    .from("clinic_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("clinic_id", owner.clinicId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    logError("revokeInvite", error);
    return { ok: false, error: GENERIC };
  }
  return (data ?? []).length > 0 ? { ok: true } : { ok: false, error: USED };
}

/** Removes a staff member and their alerts to this clinic (remove_member). The owner's own row cannot be removed. */
export async function removeMember(owner: Staff, userId: string): Promise<Saved> {
  if (!isUuid(userId)) return { ok: false, error: GONE };
  const { error } = await owner.db.rpc("remove_member", { p_user_id: userId });
  if (!error) return { ok: true };
  if (error.code === "BSNOS") return { ok: false, error: GONE };
  logError("removeMember", error);
  return { ok: false, error: GENERIC };
}
```

Run: `npx vitest run tests/unit/team-data.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Write the Team page**

Create `src/app/app/settings/team/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import type { Saved } from "@/lib/staff-input";
import { OWNER_ONLY, requireOwner } from "@/lib/supabase/server";
import { createInvite, removeMember, revokeInvite, type NewInvite } from "@/lib/team-data";

/** Teams spec 6.1: a new join link, for the owner only. The token comes back once and is never stored. */
export async function createInviteAction(): Promise<NewInvite> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await createInvite(owner);
  if (result.ok) refresh();
  return result;
}

/** Revokes an open join link. The id is untrusted: RLS and the clinic filter keep it to the owner's clinic. */
export async function revokeInviteAction(id: unknown): Promise<Saved> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await revokeInvite(owner, String(id));
  if (result.ok) refresh();
  return result;
}

/** Removes a staff member; remove_member itself checks the owner and refuses owner rows. */
export async function removeMemberAction(userId: unknown): Promise<Saved> {
  const owner = await requireOwner();
  if (!owner) return { ok: false, error: OWNER_ONLY };
  const result = await removeMember(owner, String(userId));
  if (result.ok) refresh();
  return result;
}
```

Create `src/app/app/settings/team/TeamPanel.tsx`:

```tsx
"use client";

import { Fragment, useState, useTransition } from "react";
import type { Saved } from "@/lib/staff-input";
import { createInviteAction, removeMemberAction, revokeInviteAction } from "./actions";

export type MemberRow = { userId: string; email: string | null; owner: boolean; joined: string };
export type InviteRow = { id: string; created: string; expires: string };

/**
 * Teams spec 6.1: the members (email, role, joined) with Remove behind a confirm step, the open join links with Revoke,
 * and a new link shown once with Copy. The owner's row has no Remove.
 */
export default function TeamPanel({ members, invites }: { members: MemberRow[]; invites: InviteRow[] }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [memberResult, setMemberResult] = useState<Saved | null>(null);
  const [linkResult, setLinkResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const r = await createInviteAction();
      setLinkResult(r.ok ? null : r);
      if (r.ok) {
        setLink(r.link);
        setCopied(false);
      }
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section className="card card-pad settings-section">
        <h2 className="font-display">Members</h2>
        <p className="f-hint">
          Staff handle requests, the schedule, patients, and dentists&apos; time off. Only you change the clinic&apos;s setup, pay, and manage the team.
        </p>
        <div className="member-list mt-2">
          {members.map((m) => (
            <Fragment key={m.userId}>
              <div className="member-row cursor-default">
                <span className="nm">
                  {m.email ?? "No email on file"}
                  <span className="meta block">Joined {m.joined}</span>
                </span>
                <span className={`chip ${m.owner ? "chip-brand" : "chip-blue"}`}>{m.owner ? "Owner" : "Staff"}</span>
                {!m.owner && (
                  <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(m.userId)}>
                    Remove
                  </button>
                )}
              </div>
              {confirming === m.userId && (
                <div className="note-box warn">
                  <p>
                    Remove {m.email ?? "this staff member"}? They lose access at once, and their devices stop getting this clinic&apos;s alerts.
                  </p>
                  <div className="action-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await removeMemberAction(m.userId);
                          setMemberResult(r.ok ? null : r);
                          if (r.ok) setConfirming(null);
                        })
                      }
                    >
                      Yes, remove
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        {memberResult && !memberResult.ok && (
          <p className="field-err" role="alert">
            {memberResult.error}
          </p>
        )}
      </section>

      <section className="card card-pad settings-section">
        <h2 className="font-display">Join links</h2>
        <p className="f-hint">Each link lets one person make an account and join your clinic as staff.</p>
        {link && (
          <div className="cf-box mt-3">
            <label className="f-label" htmlFor="join-link">
              New join link
            </label>
            <input id="join-link" className="f-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <p className="f-hint">Send it by Messenger or text. It works once, for 7 days. It is shown only now.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-soft" onClick={copy}>
                Copy link
              </button>
              <span className="f-hint" role="status">
                {copied ? "Copied." : ""}
              </span>
            </div>
          </div>
        )}
        {invites.length === 0 ? (
          <p className="f-hint mt-3">No open join links.</p>
        ) : (
          <div className="member-list mt-2">
            {invites.map((i) => (
              <div key={i.id} className="member-row cursor-default">
                <span className="nm">
                  Made {i.created}
                  <span className="meta block">Works until {i.expires}</span>
                </span>
                <span className="chip chip-amber">Open</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => startTransition(async () => setLinkResult(await revokeInviteAction(i.id)))}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
        {linkResult && !linkResult.ok && (
          <p className="field-err" role="alert">
            {linkResult.error}
          </p>
        )}
        <button type="button" className="btn btn-primary mt-4" disabled={pending} onClick={create}>
          {pending ? "One moment..." : "Create join link"}
        </button>
      </section>
    </>
  );
}
```

Create `src/app/app/settings/team/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import TeamPanel from "./TeamPanel";
import { billingDate } from "@/lib/billing";
import { requireOwner } from "@/lib/supabase/server";
import { loadTeam } from "@/lib/team-data";
import { formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Team" };

/** Teams spec 6.1: the owner's Team page. Staff go back to Settings. */
export default async function TeamPage() {
  const owner = await requireOwner();
  if (!owner) redirect("/app/settings");
  const now = new Date();
  const { members, invites } = await loadTeam(owner, now);
  const at = (iso: string) => `${billingDate(new Date(iso), now)}, ${formatTime(new Date(iso))}`;

  return (
    <>
      <Link href="/app/settings" className="back-arrow min-h-11">
        Back to Settings
      </Link>
      <div className="page-head">
        <h1 className="font-display">Team</h1>
      </div>
      <TeamPanel
        members={members.map((m) => ({ userId: m.userId, email: m.email, owner: m.role === "owner", joined: billingDate(new Date(m.joinedAt), now) }))}
        invites={invites.map((i) => ({ id: i.id, created: at(i.createdAt), expires: at(i.expiresAt) }))}
      />
    </>
  );
}
```

In `src/app/app/settings/page.tsx`, replace:

```tsx
      {owner && <ProcedureEditor procedures={settings.procedures} />}
```

with:

```tsx
      {owner && <ProcedureEditor procedures={settings.procedures} />}
      {owner && (
        <section className="card card-pad settings-section">
          <h2 className="font-display">Team</h2>
          <p className="f-hint">Invite staff with a join link, and remove staff who leave.</p>
          <Link href="/app/settings/team" className="btn btn-soft mt-3">
            Open Team
          </Link>
        </section>
      )}
```

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the build's route list shows `ƒ /app/settings/team`.

```powershell
git add src/lib/team.ts src/lib/team-data.ts tests/unit/team-data.test.ts src/app/app/settings/team/actions.ts src/app/app/settings/team/TeamPanel.tsx src/app/app/settings/team/page.tsx src/app/app/settings/page.tsx
git commit -m "feat: add the Team page with join links" -m "The owner sees every member with their email, role, and joined date, and every open join link. Create join link stores only the token's hash and shows the link once with Copy; links can be revoked, and staff removed after a confirm step. Staff are sent back to Settings."
```

### Task 5: Join links

**Files:**
- Create: `src/app/join/actions.ts`, `src/app/join/[token]/JoinButton.tsx`, `src/app/join/[token]/page.tsx`
- Modify: `src/lib/team.ts`, `src/lib/team-data.ts`, `src/lib/security-headers.ts`, `src/proxy.ts`, `src/lib/supabase/admin.ts` (doc comment), `src/app/onboarding/page.tsx`, `src/app/onboarding/Onboarding.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/AuthForm.tsx`, `src/app/(auth)/actions.ts`, `tests/unit/team.test.ts`, `tests/unit/team-data.test.ts`, `tests/unit/security-headers.test.ts`, `tests/unit/routes.test.ts`

**Interfaces:**
- Consumes: `isInviteToken`, `hashInviteToken` (Task 2); `accept_invite` and its SQLSTATEs (Task 2); `signedInStaff`, `serverClient` from `@/lib/supabase/server` (Task 1); `adminClient`; `logError`; `cookies` from `next/headers`; `guardRedirect` (unchanged: it never redirects `/join`).
- Produces:
  - From `@/lib/team`: `INVITE_DAYS = 7`, `JOIN_COOKIE = "bs_join"`, `type JoinView = "gone" | "signed_out" | "join" | "member"`, `joinView(clinicName: string | null, visitor: { hasClinic: boolean } | null): JoinView`, `joinRefusal(code: string | undefined): "gone" | "member" | null`
  - From `@/lib/team-data`: `inviteClinicName(token: unknown, now: Date): Promise<string | null>` (secret key; throws on a database error)
  - Server Actions in `src/app/join/actions.ts`: `type JoinState = { error?: string }`, `continueToJoin(form: FormData): Promise<void>` (sets the cookie, redirects to `/signup` or `/login`), `joinClinic(state: JoinState, form: FormData): Promise<JoinState>` (redirects to `/app/requests` on success), `logOutToJoin(form: FormData): Promise<void>`
  - Default export `JoinButton({ token: string; clinic: string })`
  - Page `/join/[token]`; `NOINDEX_SOURCES` gains `/join/:path*` and `ROBOTS_DISALLOW` gains `/join/`; the proxy matcher gains `/join/:path*`; `AuthForm` gains the mode `"join"`

Rules (spec 6.2, 7, 9):
- `/join/{token}` looks the link up by the token's hash through the secret key (`inviteClinicName`) and shows only the clinic's name, only for an open link (not used, not revoked, not expired). Views: gone ("This join link no longer works. Ask the clinic for a new one."), signed out ("{clinic} invited you to BrightSmile", with "Create an account" and "I already have an account"), signed in without a clinic ("Join {clinic}"), and signed in with a clinic ("This account already belongs to a clinic. Log out and use another email to join {clinic}."). A failed lookup logs where and why and shows "Something went wrong. Try the link again."
- Opening the page never joins or changes anything, so a link preview in Messenger is harmless. Joining is a button press that runs `accept_invite` as the signed-in user.
- A Server Component cannot set or delete cookies (`cookies.md`), so the cookie is set by the Server Action behind "Create an account" and "I already have an account": `bs_join`, HttpOnly, SameSite=Lax, Secure in production, path `/`, 7 days. `joinClinic` deletes it once the link has worked or been refused; an unexpected error keeps it for another try. Onboarding follows the cookie to `/join/{token}` only while the link still works, so a stale cookie never keeps anyone from setting up a clinic.
- Sign-up after a join link says "Create your account. Then you join your clinic's team on BrightSmile." and, when email confirmation is on, "Open it on this device to join your clinic's team." (the cookie lives in this browser). Onboarding's first screen tells anyone who came to join a team to open the clinic's link.
- `/join` is noindex (header and robots meta), kept out of robots.txt, `force-dynamic` (Next sends it `private, no-cache, no-store`), and in the proxy matcher only so a signed-in visitor's session is refreshed where cookies can be written; `guardRedirect` never redirects it.
- The token never reaches a log. It appears only in the URL, one hidden form field, and the HttpOnly cookie.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/team.test.ts`, replace:

```ts
import { hashInviteToken, isInviteToken } from "@/lib/team";
```

with:

```ts
import { hashInviteToken, isInviteToken, joinRefusal, joinView } from "@/lib/team";
```

Append to the end of `tests/unit/team.test.ts`:

```ts

describe("joinView", () => {
  it("says the link no longer works, whoever opens it", () => {
    for (const visitor of [null, { hasClinic: false }, { hasClinic: true }]) expect(joinView(null, visitor)).toBe("gone");
  });

  it("asks visitors to sign up or log in, lets an account without a clinic join, and stops one that has a clinic", () => {
    expect(joinView("Bright Dental", null)).toBe("signed_out");
    expect(joinView("Bright Dental", { hasClinic: false })).toBe("join");
    expect(joinView("Bright Dental", { hasClinic: true })).toBe("member");
  });
});

describe("joinRefusal", () => {
  it("maps accept_invite's refusals to the join page's words, and nothing else", () => {
    for (const code of ["BSUNK", "BSREV", "BSUSD", "BSEXP"]) expect(joinRefusal(code)).toBe("gone");
    expect(joinRefusal("23505")).toBe("member");
    for (const code of [undefined, "42501", "PGRST301", "08006"]) expect(joinRefusal(code)).toBeNull();
  });
});
```

In `tests/unit/team-data.test.ts`, replace:

```ts
import { createInvite, removeMember, revokeInvite } from "@/lib/team-data";

vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://bsmile.vercel.app" }));
```

with:

```ts
import { createInvite, inviteClinicName, removeMember, revokeInvite } from "@/lib/team-data";

const admin = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://bsmile.vercel.app" }));
vi.mock("@/lib/supabase/admin", () => ({ adminClient: () => admin.client }));
```

Append to the end of `tests/unit/team-data.test.ts`:

```ts

/** The secret-key client, recording each call of the query it builds; maybeSingle answers `row`. */
function recording(row: unknown): unknown[][] {
  const calls: unknown[][] = [];
  const query: Record<string, unknown> = { maybeSingle: async () => ({ data: row, error: null }) };
  for (const name of ["from", "select", "eq", "is", "gt"]) {
    query[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return query;
    };
  }
  admin.client = query;
  return calls;
}

describe("inviteClinicName", () => {
  it("names the clinic only for an open link, found by the token's hash", async () => {
    const calls = recording({ clinic: { name: "Bright Dental" } });
    expect(await inviteClinicName("AbCdEfGhIjKl", new Date("2026-09-26T02:00:00Z"))).toBe("Bright Dental");
    expect(calls).toEqual([
      ["from", "clinic_invites"],
      ["select", "clinic:clinics(name)"],
      ["eq", "token_hash", hashInviteToken("AbCdEfGhIjKl")],
      ["is", "accepted_at", null],
      ["is", "revoked_at", null],
      ["gt", "expires_at", "2026-09-26T02:00:00.000Z"],
    ]);
  });

  it("is null for a link that no longer works, and asks nothing for a malformed token", async () => {
    recording(null);
    expect(await inviteClinicName("AbCdEfGhIjKl", new Date())).toBeNull();
    const calls = recording(null);
    expect(await inviteClinicName("../../admin", new Date())).toBeNull();
    expect(calls).toEqual([]);
  });
});
```

In `tests/unit/security-headers.test.ts`, replace:

```ts
      "/api/:path*",
      "/admin/:path*",
    ]);
```

with:

```ts
      "/api/:path*",
      "/admin/:path*",
      "/join/:path*",
    ]);
```

replace:

```ts
    for (const path of ["/app/requests", "/a/AbCdEfGhIjKl", "/onboarding/", "/auth/confirm", "/api/cron/daily"]) {
```

with:

```ts
    for (const path of ["/app/requests", "/a/AbCdEfGhIjKl", "/onboarding/", "/auth/confirm", "/api/cron/daily", "/join/AbCdEfGhIjKl"]) {
```

and replace:

```ts
    for (const path of ["/", "/demo", "/apple-dental", "/apple-icon.png", "/aura-smile", "/privacy", "/terms", "/manifest.webmanifest", "/login-dental", "/forgot-me-not-dental", "/signupsmile", "/onboarding-clinic", "/reset-password-care"]) {
```

with:

```ts
    for (const path of ["/", "/demo", "/apple-dental", "/apple-icon.png", "/aura-smile", "/privacy", "/terms", "/manifest.webmanifest", "/login-dental", "/forgot-me-not-dental", "/signupsmile", "/onboarding-clinic", "/reset-password-care", "/join-dental", "/joinsmile"]) {
```

In `tests/unit/routes.test.ts`, replace:

```ts
  it("never redirects the admin page, which checks the operator itself", () => {
    for (const visitor of [out, noClinic, staff]) expect(guardRedirect("/admin", visitor)).toBeNull();
  });
```

with:

```ts
  it("never redirects the admin page, which checks the operator itself", () => {
    for (const visitor of [out, noClinic, staff]) expect(guardRedirect("/admin", visitor)).toBeNull();
  });

  it("never redirects a join link, which works signed in or out (teams spec 6.2)", () => {
    for (const visitor of [out, noClinic, staff]) expect(guardRedirect("/join/AbCdEfGhIjKl", visitor)).toBeNull();
  });
```

Run: `npx vitest run tests/unit/team.test.ts tests/unit/team-data.test.ts tests/unit/security-headers.test.ts tests/unit/routes.test.ts`
Expected: FAIL: `joinView`, `joinRefusal`, and `inviteClinicName` are not functions yet, `NOINDEX_SOURCES` lacks `/join/:path*`, and robots.txt does not keep crawlers out of `/join/`. `routes.test.ts` PASS (the join test pins what `guardRedirect` already does).

- [ ] **Step 2: Write the join states and the name lookup**

Append to the end of `src/lib/team.ts`:

```ts

/** A join link works for 7 days (teams spec 1): the database sets expires_at, and the join cookie lasts as long. */
export const INVITE_DAYS = 7;

/** The HttpOnly cookie that carries a join link through sign-up or log-in (teams spec 6.2). */
export const JOIN_COOKIE = "bs_join";

export type JoinView = "gone" | "signed_out" | "join" | "member";

/**
 * What /join/{token} shows (teams spec 6.2): a link that no longer works (whoever opens it); a visitor who must sign up
 * or log in first; a signed-in account without a clinic, which may join; or an account that already has a clinic.
 */
export function joinView(clinicName: string | null, visitor: { hasClinic: boolean } | null): JoinView {
  if (clinicName === null) return "gone";
  if (!visitor) return "signed_out";
  return visitor.hasClinic ? "member" : "join";
}

/** accept_invite's refusals (supabase/migrations/20260926000100_teams.sql) as join page states; null for anything else. */
export function joinRefusal(code: string | undefined): "gone" | "member" | null {
  if (code === "BSUNK" || code === "BSREV" || code === "BSUSD" || code === "BSEXP") return "gone";
  if (code === "23505") return "member";
  return null;
}
```

In `src/lib/team-data.ts`, replace:

```ts
import type { Staff } from "@/lib/supabase/server";
import { hashInviteToken, joinLink } from "@/lib/team";
```

with:

```ts
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";
import { hashInviteToken, isInviteToken, joinLink } from "@/lib/team";
```

Append to the end of `src/lib/team-data.ts`:

```ts

/**
 * The clinic behind an open join link (not used, revoked, or expired), or null (teams spec 6.2, 7). Through the secret
 * key, because the visitor is not a member of that clinic; it finds the link by the token's hash and reveals only the name.
 * Throws on a database error.
 */
export async function inviteClinicName(token: unknown, now: Date): Promise<string | null> {
  if (!isInviteToken(token)) return null;
  const { data, error } = await adminClient()
    .from("clinic_invites")
    .select("clinic:clinics(name)")
    .eq("token_hash", hashInviteToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as { clinic: { name: string } | null } | null)?.clinic?.name ?? null;
}
```

- [ ] **Step 3: Keep /join out of search and keep its session fresh**

In `src/lib/security-headers.ts`, replace:

```ts
  "/api/:path*",
  "/admin/:path*",
];
```

with:

```ts
  "/api/:path*",
  "/admin/:path*",
  "/join/:path*",
];
```

and replace:

```ts
export const ROBOTS_DISALLOW = ["/app/", "/a/", "/onboarding/", "/auth/", "/api/"];
```

with:

```ts
export const ROBOTS_DISALLOW = ["/app/", "/a/", "/onboarding/", "/auth/", "/api/", "/join/"];
```

In `src/proxy.ts`, replace:

```ts
// /admin passes through only to keep its session fresh: guardRedirect never redirects it, requireOperator guards it.
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup", "/admin"],
};
```

with:

```ts
// /admin and /join pass through only to keep their sessions fresh: guardRedirect never redirects them; requireOperator
// guards /admin, and a join link works signed in or out (teams spec 6.2).
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup", "/admin", "/join/:path*"],
};
```

In `src/lib/supabase/admin.ts`, replace:

```ts
 * patient links, sendPush, the daily job, the PayMongo webhook, and /admin after requireOperator.
```

with:

```ts
 * patient links, sendPush, the daily job, the PayMongo webhook, /admin after requireOperator, and the join
 * link lookup by token hash (inviteClinicName), for visitors who are not members of the inviting clinic.
```

Run: `npx vitest run tests/unit/team.test.ts tests/unit/team-data.test.ts tests/unit/security-headers.test.ts tests/unit/routes.test.ts`
Expected: PASS (5, 6, 8, and 9 tests).

- [ ] **Step 4: Write the join page and its actions**

Create `src/app/join/actions.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logError } from "@/lib/log";
import { serverClient } from "@/lib/supabase/server";
import { INVITE_DAYS, isInviteToken, JOIN_COOKIE, joinRefusal } from "@/lib/team";

export type JoinState = { error?: string };

const GONE = "This join link no longer works. Ask the clinic for a new one.";
const MEMBER = "This account already belongs to a clinic. Log out and use another email to join.";
const TRY_AGAIN = "Something went wrong. Try the link again.";

/** Carries the join link through sign-up or log-in: HttpOnly, SameSite=Lax, for 7 days (teams spec 6.2). */
async function rememberInvite(token: string): Promise<void> {
  (await cookies()).set(JOIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: INVITE_DAYS * 24 * 60 * 60,
    path: "/",
  });
}

/** "Create an account" and "I already have an account": remember the link, then sign up or log in. */
export async function continueToJoin(form: FormData): Promise<void> {
  const token = form.get("token");
  if (!isInviteToken(token)) redirect("/login");
  await rememberInvite(token);
  redirect(form.get("to") === "login" ? "/login" : "/signup");
}

/**
 * "Join {clinic}": accept_invite as the signed-in user, then the dashboard. The cookie goes once the link has worked or
 * been refused, so onboarding never sends the account back here; an unexpected error keeps it for another try.
 */
export async function joinClinic(_state: JoinState, form: FormData): Promise<JoinState> {
  const token = form.get("token");
  if (!isInviteToken(token)) return { error: GONE };
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) {
    await rememberInvite(token);
    redirect("/login");
  }
  const { error } = await db.rpc("accept_invite", { p_token: token });
  const refusal = error ? joinRefusal(error.code) : null;
  if (error && !refusal) {
    logError("joinClinic", error);
    return { error: TRY_AGAIN };
  }
  (await cookies()).delete(JOIN_COOKIE);
  if (refusal) return { error: refusal === "member" ? MEMBER : GONE };
  redirect("/app/requests");
}

/** "Log out" for an account that already belongs to a clinic: sign out, then back to the link to sign up or log in. */
export async function logOutToJoin(form: FormData): Promise<void> {
  const token = form.get("token");
  const db = await serverClient();
  await db.auth.signOut();
  redirect(isInviteToken(token) ? `/join/${token}` : "/login");
}
```

Create `src/app/join/[token]/JoinButton.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { joinClinic, type JoinState } from "../actions";

/** "Join {clinic}", with a refusal or an error in words (teams spec 6.2, 9). */
export default function JoinButton({ token, clinic }: { token: string; clinic: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(joinClinic, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p className="note-box warn mb-4" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary wide-btn" disabled={pending}>
        {pending ? "Joining..." : `Join ${clinic}`}
      </button>
    </form>
  );
}
```

Create `src/app/join/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import JoinButton from "./JoinButton";
import { continueToJoin, logOutToJoin } from "../actions";
import { logError } from "@/lib/log";
import { signedInStaff } from "@/lib/supabase/server";
import { joinView } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";

// Never prerendered or cached: what it shows depends on the link and on who is signed in (teams spec 6.2).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a clinic", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

function Card({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{title}</h1>
        <p className="sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Teams spec 6.2: where a join link lands. It names the clinic only for an open link and joins only on a button press,
 * so a link preview that opens the page changes nothing.
 */
export default async function JoinPage({ params }: Props) {
  const { token } = await params;
  let clinic: string | null;
  try {
    clinic = await inviteClinicName(token, new Date());
  } catch (e) {
    logError("join page", e);
    return <Card title="Something went wrong" sub="Try the link again." />;
  }
  const visitor = await signedInStaff();
  const view = joinView(clinic, visitor && { hasClinic: visitor.clinicId !== null });
  if (view === "gone" || clinic === null) return <Card title="This join link no longer works" sub="Ask the clinic for a new one." />;

  if (view === "signed_out") {
    return (
      <Card title={`${clinic} invited you to BrightSmile`} sub="Create an account to join the clinic's team, or log in if you already have one.">
        <form action={continueToJoin}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" name="to" value="signup" className="btn btn-primary wide-btn">
            Create an account
          </button>
          <button type="submit" name="to" value="login" className="btn btn-ghost wide-btn mt-3">
            I already have an account
          </button>
        </form>
      </Card>
    );
  }

  if (view === "member") {
    return (
      <Card title={`Join ${clinic}`} sub="This account already belongs to a clinic.">
        <p className="note-box warn mb-4">Log out and use another email to join {clinic}.</p>
        <form action={logOutToJoin}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary wide-btn">
            Log out
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card title={`Join ${clinic}`} sub="You will see and handle its requests, schedule, and patients.">
      <JoinButton token={token} clinic={clinic} />
    </Card>
  );
}
```

- [ ] **Step 5: Follow the link from onboarding and sign-up**

In `src/app/onboarding/page.tsx`, replace:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { appUrl } from "@/lib/app-url";
import { signedInStaff } from "@/lib/supabase/server";
```

with:

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { appUrl } from "@/lib/app-url";
import { signedInStaff } from "@/lib/supabase/server";
import { JOIN_COOKIE } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";
```

and replace:

```tsx
  if (staff.clinicId) redirect("/app");
  return <Onboarding appUrl={appUrl()} />;
```

with:

```tsx
  if (staff.clinicId) redirect("/app");
  // Teams spec 6.2: an account that came through a join link joins that clinic instead of setting one up. Only a link
  // that still works counts, so a stale cookie never keeps anyone from setting up a clinic.
  const token = (await cookies()).get(JOIN_COOKIE)?.value;
  if (token && (await inviteClinicName(token, new Date()))) redirect(`/join/${token}`);
  return <Onboarding appUrl={appUrl()} />;
```

In `src/app/onboarding/Onboarding.tsx`, replace:

```tsx
            <p className="sub">Patients see this on your booking page.</p>
```

with:

```tsx
            <p className="sub">Patients see this on your booking page.</p>
            <p className="note-box mb-6">Joining a clinic&apos;s team instead? Open the join link the clinic sent you.</p>
```

In `src/app/(auth)/signup/page.tsx`, replace:

```tsx
import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
```

with:

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { JOIN_COOKIE } from "@/lib/team";

export const metadata: Metadata = { title: "Sign up" };

/** After a join link (teams spec 6.2), sign-up says the account joins a clinic's team instead of setting one up. */
export default async function SignupPage() {
  const joining = (await cookies()).has(JOIN_COOKIE);
  return <AuthForm mode={joining ? "join" : "signup"} action={signUp} />;
}
```

In `src/app/(auth)/AuthForm.tsx`, replace:

```tsx
type Mode = "signup" | "login" | "forgot" | "reset";
```

with:

```tsx
type Mode = "signup" | "join" | "login" | "forgot" | "reset";
```

replace:

```tsx
  login: { title: "Log in", sub: "Welcome back to BrightSmile.", button: "Log in" },
```

with:

```tsx
  join: { title: "Create your account", sub: "Then you join your clinic's team on BrightSmile.", button: "Create account" },
  login: { title: "Log in", sub: "Welcome back to BrightSmile.", button: "Log in" },
```

and replace:

```tsx
          {mode === "signup" && (
```

with:

```tsx
          {(mode === "signup" || mode === "join") && (
```

In `src/app/(auth)/actions.ts`, replace:

```ts
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { hasRecentRecoverySession } from "@/lib/reset-session";
import { serverClient } from "@/lib/supabase/server";
import { cleanEmail, passwordProblem } from "@/lib/validate";
```

with:

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { hasRecentRecoverySession } from "@/lib/reset-session";
import { serverClient } from "@/lib/supabase/server";
import { JOIN_COOKIE } from "@/lib/team";
import { cleanEmail, passwordProblem } from "@/lib/validate";
```

and replace:

```ts
  if (!data.session) return { sent: `We sent a confirmation link to ${email}. Open it to set up your clinic.` };
```

with:

```ts
  if (!data.session) {
    // Teams spec 6.2: after a join link, the confirmation leads to the clinic's team when opened in this browser.
    const next = (await cookies()).has(JOIN_COOKIE) ? "Open it on this device to join your clinic's team." : "Open it to set up your clinic.";
    return { sent: `We sent a confirmation link to ${email}. ${next}` };
  }
```

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the build's route list shows `ƒ /join/[token]`, and `/signup` is now `ƒ` (it reads the join cookie).

Run `npm start` in a second terminal, then:

Run: `curl.exe -s -i http://localhost:3600/join/x`
Expected: `HTTP/1.1 200 OK` with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, and the page says "This join link no longer works". Stop `npm start`. A malformed token never reaches the database and nobody is signed in, so this request reads no data.

```powershell
git add src/lib/team.ts src/lib/team-data.ts src/lib/security-headers.ts src/proxy.ts src/lib/supabase/admin.ts src/app/join/actions.ts "src/app/join/[token]/JoinButton.tsx" "src/app/join/[token]/page.tsx" src/app/onboarding/page.tsx src/app/onboarding/Onboarding.tsx "src/app/(auth)/signup/page.tsx" "src/app/(auth)/AuthForm.tsx" "src/app/(auth)/actions.ts" tests/unit/team.test.ts tests/unit/team-data.test.ts tests/unit/security-headers.test.ts tests/unit/routes.test.ts
git commit -m "feat: let staff join a clinic through its link" -m "/join/{token} names the clinic only for an open link, found by the token's hash. Signed out, it keeps the token in an HttpOnly cookie through sign-up or log-in, and onboarding follows it while the link still works; signed in without a clinic, Join runs accept_invite and opens Requests. Refusals and errors say what happened in words. /join is noindex, uncached, and out of robots.txt."
```

### Task 6: The Reports page

**Files:**
- Create: `src/lib/reports.ts`, `tests/unit/reports.test.ts`, `src/app/app/reports/page.tsx`
- Modify: `src/app/app/AppNav.tsx`, `src/app/globals.css`

**Interfaces:**
- Consumes: `clinic_week_stats` (Task 2); `requireStaff`, `type Staff` (Task 1); `addDays`, `formatDate`, `manilaDate`, `manilaInstant`, `weekday` from `@/lib/time`; `logError`.
- Produces, from `@/lib/reports` (pure, no server imports):
  - `REPORT_WEEKS = 8`
  - `type WeekStatsRow = { week_start: string; dentist_id: string; completed: number; no_show: number; cancelled: number; declined: number; expired: number; unmarked: number; upcoming: number; online: number; manual: number }` (one `clinic_week_stats` row)
  - `type WeekCounts = Omit<WeekStatsRow, "week_start" | "dentist_id">`
  - `weekStart(date: string): string` (the Monday of a Manila date's week)
  - `reportWeeks(now: Date): string[]` (this week's Monday and the 7 before it, newest first)
  - `pickWeek(value: unknown, weeks: string[]): string` (the offered week from `?week=`, else last week)
  - `weekLabel(monday: string): string` ("Mon Sep 21 to Sun Sep 27")
  - `sumCounts(rows: WeekCounts[]): WeekCounts`
  - `noShowRate(completed: number, noShow: number): number | null`
  - `formatRate(rate: number | null): string` ("25%", or "No rate")
- Page `/app/reports` (owner and staff), and "Reports" in the dashboard nav

Rules (spec 2.5, 6.3, 9):
- A report week is Monday to Sunday on the Manila calendar, by the appointment's start. The picker offers this week and the previous 7, defaulting to last week; any other `?week=` value falls back to last week.
- The no-show rate is `no_show / (completed + no_show)`; with neither it is "No rate", never a division by zero. It rounds to a whole percent.
- For the chosen week: visits (completed), no-shows, the no-show rate, cancellations, declined and expired requests, not marked yet (confirmed visits that started and nobody marked, with a link to the schedule on that week's Monday), booked online versus added by staff, and, when there are any, confirmed visits still ahead. The same numbers per dentist when 2 or more dentists had appointments that week. An 8 week table of visits (with a CSS bar), no-shows, and the no-show rate. Every number sits next to its label; the bar is decoration (`aria-hidden`). An empty week says "No appointments this week."
- The page reads `clinic_week_stats` through the staff RLS client in one call for all 8 weeks. If that call fails, the page says "Reports are not available right now." and logs where and why; the rest of the dashboard is unaffected.
- The bottom tab bar gets a sixth item. At 360px each tab is 60px wide; the longest label, "Requests", is about 52px in Inter semibold at 12px, so the phone labels drop from 12.5px to 12px, and `minmax(0, 1fr)` keeps a long label from ever widening the bar past the screen. Wider screens keep the top bar as it is.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatRate, noShowRate, pickWeek, reportWeeks, sumCounts, weekLabel, weekStart, type WeekStatsRow } from "@/lib/reports";
import { manilaInstant } from "@/lib/time";

const row = (dentist_id: string, counts: Partial<WeekStatsRow>): WeekStatsRow => ({
  week_start: "2026-09-21",
  dentist_id,
  completed: 0,
  no_show: 0,
  cancelled: 0,
  declined: 0,
  expired: 0,
  unmarked: 0,
  upcoming: 0,
  online: 0,
  manual: 0,
  ...counts,
});

describe("weekStart", () => {
  it("is the Monday of the week, across month and year ends", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28"); // a Monday
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // its Sunday
    expect(weekStart("2026-10-01")).toBe("2026-09-28"); // across the month end
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // across the year end
    expect(weekStart("2024-03-01")).toBe("2024-02-26"); // across a leap day
  });
});

describe("reportWeeks and pickWeek", () => {
  it("offers this week and the 7 before it, by the Manila calendar", () => {
    // Sunday Oct 4, 11:30 PM in Manila is 15:30 UTC: still the week of Sep 28.
    expect(reportWeeks(manilaInstant("2026-10-04", 23 * 60 + 30))).toEqual([
      "2026-09-28",
      "2026-09-21",
      "2026-09-14",
      "2026-09-07",
      "2026-08-31",
      "2026-08-24",
      "2026-08-17",
      "2026-08-10",
    ]);
    // Monday 12:30 AM in Manila is still Sunday in UTC: already the new week.
    expect(reportWeeks(manilaInstant("2026-10-05", 30))[0]).toBe("2026-10-05");
  });

  it("defaults to last week and ignores weeks it does not offer", () => {
    const weeks = reportWeeks(manilaInstant("2026-10-01", 600));
    expect(pickWeek(undefined, weeks)).toBe("2026-09-21");
    expect(pickWeek("2026-09-14", weeks)).toBe("2026-09-14");
    for (const other of ["2026-09-15", "2025-09-28", "last", ["2026-09-14"]]) expect(pickWeek(other, weeks)).toBe("2026-09-21");
  });
});

describe("weekLabel", () => {
  it("names the Monday and the Sunday", () => {
    expect(weekLabel("2026-09-28")).toBe("Mon Sep 28 to Sun Oct 4");
  });
});

describe("noShowRate and formatRate", () => {
  it("is no-shows over visits and no-shows, rounded to a whole percent", () => {
    expect(noShowRate(3, 1)).toBe(0.25);
    expect(formatRate(noShowRate(3, 1))).toBe("25%");
    expect(formatRate(noShowRate(2, 1))).toBe("33%");
    expect(formatRate(noShowRate(0, 2))).toBe("100%");
    expect(formatRate(noShowRate(5, 0))).toBe("0%");
  });

  it("gives no rate, not a division by zero, when nobody came or was marked a no-show", () => {
    expect(noShowRate(0, 0)).toBeNull();
    expect(formatRate(noShowRate(0, 0))).toBe("No rate");
  });
});

describe("sumCounts", () => {
  it("adds up a week's dentists, and is all zeros for a week without rows", () => {
    const total = sumCounts([row("d1", { completed: 3, no_show: 1, online: 4 }), row("d2", { completed: 2, cancelled: 1, manual: 3 })]);
    expect(total).toEqual({ completed: 5, no_show: 1, cancelled: 1, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 4, manual: 3 });
    expect(Object.values(sumCounts([]))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
```

Run: `npx vitest run tests/unit/reports.test.ts`
Expected: FAIL with `Cannot find package '@/lib/reports'`.

- [ ] **Step 2: Write the week math, rates, and sums**

Create `src/lib/reports.ts`:

```ts
import { addDays, formatDate, manilaDate, manilaInstant, weekday } from "@/lib/time";

/** The Reports page offers this week and the 7 before it (teams spec 6.3). */
export const REPORT_WEEKS = 8;

/** One clinic_week_stats row: a Manila week (by its Monday) and one dentist. */
export type WeekStatsRow = {
  week_start: string;
  dentist_id: string;
  completed: number;
  no_show: number;
  cancelled: number;
  declined: number;
  expired: number;
  unmarked: number;
  upcoming: number;
  online: number;
  manual: number;
};

export type WeekCounts = Omit<WeekStatsRow, "week_start" | "dentist_id">;

/** The Monday of the Manila week a "YYYY-MM-DD" date falls in (weeks run Monday to Sunday). */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** This week's Monday and the 7 before it, newest first, by the Manila calendar. */
export function reportWeeks(now: Date): string[] {
  const monday = weekStart(manilaDate(now));
  return Array.from({ length: REPORT_WEEKS }, (_, i) => addDays(monday, -7 * i));
}

/** The week from ?week= when it is one of the offered Mondays, otherwise last week (the default, teams spec 6.3). */
export function pickWeek(value: unknown, weeks: string[]): string {
  return typeof value === "string" && weeks.includes(value) ? value : weeks[1];
}

/** "Mon Sep 21 to Sun Sep 27". */
export function weekLabel(monday: string): string {
  return `${formatDate(manilaInstant(monday, 0))} to ${formatDate(manilaInstant(addDays(monday, 6), 0))}`;
}

/** Adds rows up: a week's dentists, or one dentist's rows. No rows is all zeros. */
export function sumCounts(rows: WeekCounts[]): WeekCounts {
  const sum: WeekCounts = { completed: 0, no_show: 0, cancelled: 0, declined: 0, expired: 0, unmarked: 0, upcoming: 0, online: 0, manual: 0 };
  for (const r of rows) for (const key of Object.keys(sum) as (keyof WeekCounts)[]) sum[key] += r[key];
  return sum;
}

/** no_show / (completed + no_show), or null when there was neither: no rate, not a division by zero (teams spec 2.5). */
export function noShowRate(completed: number, noShow: number): number | null {
  return completed + noShow === 0 ? null : noShow / (completed + noShow);
}

/** "25%", to the nearest whole percent, or "No rate". */
export function formatRate(rate: number | null): string {
  return rate === null ? "No rate" : `${Math.round(rate * 100)}%`;
}
```

Run: `npx vitest run tests/unit/reports.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Write the Reports page**

Create `src/app/app/reports/page.tsx`:

```tsx
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { logError } from "@/lib/log";
import { formatRate, noShowRate, pickWeek, REPORT_WEEKS, reportWeeks, sumCounts, weekLabel, type WeekCounts, type WeekStatsRow } from "@/lib/reports";
import { requireStaff, type Staff } from "@/lib/supabase/server";
import { formatDate, manilaInstant } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

type Props = { searchParams: Promise<{ week?: string | string[] }> };
type Dentist = { id: string; name: string };

/** The offered weeks' counts through the staff member's RLS client, or null after logging when they cannot be read (teams spec 9). */
async function loadStats(staff: Staff, from: string): Promise<WeekStatsRow[] | null> {
  const { data, error } = await staff.db.rpc("clinic_week_stats", { p_clinic_id: staff.clinicId, p_from: from, p_weeks: REPORT_WEEKS });
  if (error) {
    logError("reports", error);
    return null;
  }
  return (data ?? []) as WeekStatsRow[];
}

/** One week's numbers, each next to its label (teams spec 6.3). */
function Counts({ counts, monday }: { counts: WeekCounts; monday: string }) {
  const rows: [string, ReactNode][] = [
    ["Visits", counts.completed],
    ["No-shows", counts.no_show],
    ["No-show rate", formatRate(noShowRate(counts.completed, counts.no_show))],
    ["Cancellations", counts.cancelled],
    ["Declined requests", counts.declined],
    ["Expired requests", counts.expired],
    [
      "Not marked yet",
      counts.unmarked > 0 ? (
        <>
          {counts.unmarked}{" "}
          <Link href={`/app/schedule?date=${monday}`} className="link inline-flex min-h-11 items-center">
            Mark them on the schedule
          </Link>
        </>
      ) : (
        0
      ),
    ],
    ["Booked online", counts.online],
    ["Added by staff", counts.manual],
  ];
  if (counts.upcoming > 0) rows.push(["Confirmed, still ahead", counts.upcoming]);
  return (
    <div className="mt-2">
      {rows.map(([label, value]) => (
        <div key={label} className="cf-row">
          <span className="k">{label}</span>
          <span className="v">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** The chosen week, per dentist when 2 or more had appointments, and the 8 weeks side by side. */
function Report({ stats, dentists, weeks, week }: { stats: WeekStatsRow[]; dentists: Dentist[]; weeks: string[]; week: string }) {
  const chosen = stats.filter((r) => r.week_start === week);
  const total = sumCounts(chosen);
  const byDentist = dentists
    .map((d) => ({ ...d, counts: sumCounts(chosen.filter((r) => r.dentist_id === d.id)) }))
    .filter((d) => d.counts.online + d.counts.manual > 0);
  const table = weeks.map((w) => ({ week: w, counts: sumCounts(stats.filter((r) => r.week_start === w)) }));
  const most = Math.max(1, ...table.map((t) => t.counts.completed));

  return (
    <>
      <section className="card card-pad settings-section">
        <h2 className="font-display">{weekLabel(week)}</h2>
        {total.online + total.manual === 0 ? <p className="f-hint">No appointments this week.</p> : <Counts counts={total} monday={week} />}
      </section>
      {byDentist.length >= 2 &&
        byDentist.map((d) => (
          <section key={d.id} className="card card-pad settings-section">
            <h2 className="font-display">{d.name}</h2>
            <Counts counts={d.counts} monday={week} />
          </section>
        ))}
      <section className="card card-pad settings-section">
        <h2 className="font-display">The last 8 weeks</h2>
        <table className="mt-2 w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="text-text-2">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Week of
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Visits
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                No-shows
              </th>
              <th scope="col" className="py-2 font-semibold">
                No-show rate
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((t) => (
              <tr key={t.week} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {formatDate(manilaInstant(t.week, 0))}
                </th>
                <td className="py-2 pr-3 tabular-nums">
                  {t.counts.completed}
                  <span aria-hidden="true" className="mt-1 block h-1.5 rounded-full bg-primary" style={{ width: `${(t.counts.completed / most) * 100}%` }} />
                </td>
                <td className="py-2 pr-3 tabular-nums">{t.counts.no_show}</td>
                <td className="py-2 tabular-nums">{formatRate(noShowRate(t.counts.completed, t.counts.no_show))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Teams spec 6.3: a Manila week's visits, no-shows, and more, for owners and staff alike. Counts only, no patient names. */
export default async function ReportsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const weeks = reportWeeks(new Date());
  const week = pickWeek((await searchParams).week, weeks);
  const [stats, dentists] = await Promise.all([
    loadStats(staff, weeks[weeks.length - 1]),
    staff.db.from("dentists").select("id, name").eq("clinic_id", staff.clinicId).order("created_at").throwOnError(),
  ]);

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Reports</h1>
      </div>
      <Form action="/app/reports" className="card card-pad mb-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="f-label">Week</span>
          <select key={week} name="week" defaultValue={week} className="f-input">
            {weeks.map((w, i) => (
              <option key={w} value={w}>
                {`${i === 0 ? "This week, " : i === 1 ? "Last week, " : ""}${weekLabel(w)}`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-soft">
          Show
        </button>
      </Form>
      {stats === null ? (
        <div className="card empty-note" role="alert">
          Reports are not available right now.
        </div>
      ) : (
        <Report stats={stats} dentists={dentists.data as Dentist[]} weeks={weeks} week={week} />
      )}
    </>
  );
}
```

- [ ] **Step 4: Put Reports in the nav**

In `src/app/app/AppNav.tsx`, replace:

```tsx
  { href: "/app/patients", label: "Patients" },
  { href: "/app/settings", label: "Settings" },
```

with:

```tsx
  { href: "/app/patients", label: "Patients" },
  { href: "/app/reports", label: "Reports" },
  { href: "/app/settings", label: "Settings" },
```

In `src/app/globals.css`, replace:

```css
  display: grid;
  grid-template-columns: repeat(5, 1fr);
```

with:

```css
  display: grid;
  /* Six tabs, 60px each on a 360px phone; minmax(0, 1fr) keeps a long label from widening the bar past the screen. */
  grid-template-columns: repeat(6, minmax(0, 1fr));
```

and replace:

```css
  min-height: 56px;
  font-size: 12.5px;
```

with:

```css
  min-height: 56px;
  font-size: 12px;
```

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the build's route list shows `ƒ /app/reports`.

```powershell
git add src/lib/reports.ts tests/unit/reports.test.ts src/app/app/reports/page.tsx src/app/app/AppNav.tsx src/app/globals.css
git commit -m "feat: add the Reports page" -m "Owners and staff pick one of the last 8 Manila weeks (last week by default) and see visits, no-shows, the no-show rate, cancellations, declined and expired requests, visits not marked yet with a link to the schedule, and online versus staff bookings, per dentist when 2 or more worked, plus an 8 week table with a bar for visits. Reports is the sixth tab."
```

### Task 7: The Monday push

**Files:**
- Create: `tests/unit/service-worker.test.ts`
- Modify: `src/lib/push.ts`, `public/sw.js`, `src/lib/daily.ts`, `src/lib/daily-job.ts`, `tests/unit/push.test.ts`, `tests/unit/daily.test.ts`, `tests/unit/daily-job.test.ts`

**Interfaces:**
- Consumes: `clinic_week_stats` and `clinics.weekly_report_for` (Task 2); `noShowRate`, `formatRate`, `sumCounts`, `type WeekStatsRow` from `@/lib/reports` (Task 6); `billingFromRow`, `billingStatus`, `type BillingRow` from `@/lib/billing`; `sendPush` from `@/lib/push`; `addDays`, `manilaDate`, `weekday` from `@/lib/time`; `adminClient`; `logError`.
- Produces:
  - From `@/lib/push`: `type PushPayload = { title: string; body: string; url: string; type?: "weekly" }`, `weeklyPushPayload(clinicName: string, visits: number, noShows: number): PushPayload`
  - From `@/lib/daily`: `type WeeklyRow = { id: string; name: string; created_at: string; weekly_report_for: string | null }`, `reportMonday(now: Date): string | null`, `weeklyCandidates(clinics: WeeklyRow[], billing: (BillingRow & { clinic_id: string })[], now: Date): WeeklyRow[]`
  - From `@/lib/daily-job`: `sendWeeklyReports(now: Date): Promise<number>`; `DailySummary` gains `weekly: number | "failed"`
  - `public/sw.js`: `type: "weekly"` opens `/app/reports`; everything else opens `/app/requests`

Rules (spec 6.4, 7, 9; core spec 11):
- The daily job runs at 9:00 AM Manila (01:00 UTC). On a Manila Monday (`reportMonday`), for each clinic that is not lapsed (`billingStatus`, with the missing-row rule), has `weekly_report_for` empty or before this Monday, and had at least one appointment last week (Monday to Sunday, any status: `online + manual > 0` from `clinic_week_stats`): claim `weekly_report_for = this Monday` with a compare-and-set, then push to the clinic's devices. Only a clinic whose claim matched is pushed, so a rerun or an overlapping run never pushes twice. On other days the step returns 0 without reading anything.
- The push: title "Last week at {clinic name}", body "{n} visits, {m} no-shows ({r}%). Tap to see Reports." ("1 visit", "1 no-show"; no percentage when there were neither visits nor no-shows). Counts only, `type: "weekly"`, and no text fallback. A clinic without a device that has push on is not a failure and is not counted.
- A failed count or claim for one clinic never stops the others. After trying every clinic, the step throws with the failed clinics' ids (ids only), which marks the run failed and puts them in the log, like the heads-up step. The step runs after the heads-ups and before the credit check.
- The service worker passes only `{ weekly: true | false }` from the payload to the notification, and the tap maps it to one of two fixed paths. It never follows a URL from a payload.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/service-worker.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://bsmile.vercel.app";

type Listener = (event: unknown) => void;

/** Runs public/sw.js in a stand-in worker, delivers one push, taps its notification, and returns the pages opened. */
async function tapPush(payload: unknown): Promise<string[]> {
  const listeners: Record<string, Listener> = {};
  const shown: { data?: unknown }[] = [];
  const opened: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const waitUntil = (work: Promise<unknown>) => {
    pending = work;
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting: () => {},
    registration: {
      showNotification: async (_title: string, options: { data?: unknown }) => {
        shown.push(options);
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL });
  listeners.push({ data: { json: () => payload }, waitUntil });
  await pending;
  listeners.notificationclick({ notification: { close: () => {}, data: shown[0].data }, waitUntil });
  await pending;
  return opened;
}

describe("the service worker", () => {
  it("opens Reports for the Monday summary (teams spec 6.4)", async () => {
    expect(await tapPush({ title: "Last week at Bright Dental", body: "12 visits, 3 no-shows (20%).", url: "/app/reports", type: "weekly" })).toEqual([
      `${ORIGIN}/app/reports`,
    ]);
  });

  it("opens the requests page for everything else, and never a URL from the payload", async () => {
    expect(await tapPush({ title: "New booking request", body: "Thu Sep 24, 10:00 AM", url: "https://evil.example/" })).toEqual([`${ORIGIN}/app/requests`]);
    expect(await tapPush({ title: "Hi", body: "There", url: "https://evil.example/", type: "https://evil.example/" })).toEqual([`${ORIGIN}/app/requests`]);
  });
});
```

In `tests/unit/push.test.ts`, replace:

```ts
import { parseSubscription, planPushPayload, pushPayload, sendPush, vapidSender } from "@/lib/push";
```

with:

```ts
import { parseSubscription, planPushPayload, pushPayload, sendPush, vapidSender, weeklyPushPayload } from "@/lib/push";
```

and replace:

```ts
      body: "Pay in BrightSmile to keep online booking open.",
      url: "/app/requests",
    });
  });
});
```

with:

```ts
      body: "Pay in BrightSmile to keep online booking open.",
      url: "/app/requests",
    });
  });
});

describe("weeklyPushPayload", () => {
  it("sums up last week in counts only, and asks for Reports", () => {
    expect(weeklyPushPayload("Bright Dental", 12, 3)).toEqual({
      title: "Last week at Bright Dental",
      body: "12 visits, 3 no-shows (20%). Tap to see Reports.",
      url: "/app/reports",
      type: "weekly",
    });
    expect(weeklyPushPayload("Bright Dental", 1, 1).body).toBe("1 visit, 1 no-show (50%). Tap to see Reports.");
  });

  it("gives no rate when nobody came or was marked a no-show", () => {
    expect(weeklyPushPayload("Bright Dental", 0, 0).body).toBe("0 visits, 0 no-shows. Tap to see Reports.");
  });
});
```

In `tests/unit/daily.test.ts`, replace:

```ts
import { isCronAuthorized, lowCreditThreshold, reminders, reminderWindow, renewalNotices, type ReminderRow, type RenewalRow } from "@/lib/daily";
```

with:

```ts
import {
  isCronAuthorized,
  lowCreditThreshold,
  reminders,
  reminderWindow,
  renewalNotices,
  reportMonday,
  weeklyCandidates,
  type ReminderRow,
  type RenewalRow,
  type WeeklyRow,
} from "@/lib/daily";
```

Append to the end of `tests/unit/daily.test.ts`:

```ts

describe("reportMonday and weeklyCandidates", () => {
  const monday = manilaInstant("2026-10-05", 9 * 60); // the cron time, 01:00 UTC
  const open = { trial_ends_at: manilaInstant("2026-10-20", 0).toISOString(), paid_through: null };
  const clinic = (id: string, weekly_report_for: string | null = null): WeeklyRow => ({
    id,
    name: `Clinic ${id}`,
    created_at: "2026-09-01T00:00:00Z",
    weekly_report_for,
  });

  it("is Monday on the Manila calendar, whatever the UTC date", () => {
    expect(reportMonday(monday)).toBe("2026-10-05");
    expect(reportMonday(manilaInstant("2026-10-05", 30))).toBe("2026-10-05"); // 12:30 AM in Manila is still Sunday in UTC
    expect(reportMonday(manilaInstant("2026-10-04", 23 * 60 + 30))).toBeNull(); // Sunday 11:30 PM in Manila
    expect(reportMonday(manilaInstant("2026-10-06", 9 * 60))).toBeNull();
  });

  it("picks clinics still taking bookings that have no summary for this Monday yet", () => {
    const clinics = [clinic("c1"), clinic("c2", "2026-09-28"), clinic("c3", "2026-10-05"), clinic("c4"), clinic("c5"), clinic("c6")];
    const billing = [
      { clinic_id: "c1", ...open },
      { clinic_id: "c2", ...open },
      { clinic_id: "c3", ...open },
      { clinic_id: "c4", trial_ends_at: manilaInstant("2026-09-20", 0).toISOString(), paid_through: null }, // paused since Sep 23
      { clinic_id: "c6", trial_ends_at: manilaInstant("2026-10-03", 0).toISOString(), paid_through: null }, // in grace until Oct 6
    ];
    // c5 has no billing row: a trial that ended at signup (Sep 1), so it is paused too.
    expect(weeklyCandidates(clinics, billing, monday).map((c) => c.id)).toEqual(["c1", "c2", "c6"]);
  });
});
```

In `tests/unit/daily-job.test.ts`, replace:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenewalRow } from "@/lib/daily";
import { sendRenewalNotices } from "@/lib/daily-job";
import { alertPlanEnding } from "@/lib/notify";
import { manilaInstant } from "@/lib/time";

// The claim's compare-and-set itself runs in SQL; here the client answers each clinic's claim as the test says.
const db = vi.hoisted(() => ({
  rows: [] as RenewalRow[],
  claims: new Map<string, { data: { clinic_id: string }[] | null; error: { message: string } | null }>(),
}));

vi.mock("@/lib/notify", () => ({ alertPlanEnding: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: () => ({
      select: async () => ({ data: db.rows, error: null }),
      update: () => ({ eq: (_column: string, clinicId: string) => ({ or: () => ({ select: async () => db.claims.get(clinicId) }) }) }),
    }),
  }),
}));

const alert = vi.mocked(alertPlanEnding);
```

with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenewalRow, WeeklyRow } from "@/lib/daily";
import { sendRenewalNotices, sendWeeklyReports } from "@/lib/daily-job";
import { alertPlanEnding } from "@/lib/notify";
import { sendPush } from "@/lib/push";
import type { WeekStatsRow } from "@/lib/reports";
import { manilaInstant } from "@/lib/time";

type Answer<T> = { data: T | null; error: { message: string } | null };

// The claims' compare-and-set runs in SQL; here the client answers each clinic's claim, and its weekly counts, as the
// test says. clinic_billing reads answer db.rows, clinics reads answer db.clinics.
const db = vi.hoisted(() => ({
  rows: [] as RenewalRow[],
  clinics: [] as WeeklyRow[],
  claims: new Map<string, Answer<unknown[]>>(),
  stats: new Map<string, Answer<WeekStatsRow[]>>(),
  counted: [] as unknown[],
}));

vi.mock("@/lib/notify", () => ({ alertPlanEnding: vi.fn() }));
vi.mock("@/lib/push", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/push")>()), sendPush: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  adminClient: () => ({
    from: (table: string) => ({
      select: async () => ({ data: table === "clinics" ? db.clinics : db.rows, error: null }),
      update: () => ({ eq: (_column: string, clinicId: string) => ({ or: () => ({ select: async () => db.claims.get(clinicId) }) }) }),
    }),
    rpc: async (_name: string, args: { p_clinic_id: string }) => {
      db.counted.push(args);
      return db.stats.get(args.p_clinic_id) ?? { data: [], error: null };
    },
  }),
}));

const alert = vi.mocked(alertPlanEnding);
const push = vi.mocked(sendPush);
```

Append to the end of `tests/unit/daily-job.test.ts`:

```ts

describe("sendWeeklyReports", () => {
  const monday = manilaInstant("2026-10-05", 9 * 60); // every clinic's trial runs to Oct 9 (db.rows)
  const week = (dentist_id: string, completed: number, no_show: number): WeekStatsRow => ({
    week_start: "2026-09-28",
    dentist_id,
    completed,
    no_show,
    cancelled: 0,
    declined: 0,
    expired: 0,
    unmarked: 0,
    upcoming: 0,
    online: completed + no_show,
    manual: 0,
  });

  beforeEach(() => {
    db.clinics = ["c1", "c2", "c3"].map((id) => ({ id, name: `Clinic ${id}`, created_at: "2026-09-01T00:00:00Z", weekly_report_for: null }));
    db.stats.clear();
    db.counted = [];
    push.mockReset();
  });

  it("pushes last week's counts to each clinic it claims, and skips a week without appointments", async () => {
    db.stats.set("c1", { data: [week("d1", 9, 3), week("d2", 2, 0)], error: null }).set("c2", { data: [week("d1", 4, 0)], error: null });
    db.claims.set("c1", claimed("c1")).set("c2", { data: [], error: null });
    push.mockResolvedValue(1);
    expect(await sendWeeklyReports(monday)).toBe(1);
    // c2 was claimed by another run; c3 had no appointments last week, so it was never claimed.
    expect(push.mock.calls).toEqual([
      ["c1", { title: "Last week at Clinic c1", body: "11 visits, 3 no-shows (21%). Tap to see Reports.", url: "/app/reports", type: "weekly" }],
    ]);
    expect(db.counted).toContainEqual({ p_clinic_id: "c1", p_from: "2026-09-28", p_weeks: 1 });
  });

  it("does nothing on other days", async () => {
    expect(await sendWeeklyReports(manilaInstant("2026-10-06", 9 * 60))).toBe(0);
    expect(db.counted).toEqual([]);
    expect(push).not.toHaveBeenCalled();
  });

  it("tries every clinic, then fails the run when a count or a claim fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.stats
      .set("c1", { data: null, error: { message: "connection reset" } })
      .set("c2", { data: [week("d1", 1, 0)], error: null })
      .set("c3", { data: [week("d1", 2, 1)], error: null });
    db.claims.set("c2", { data: null, error: { message: "timeout" } }).set("c3", claimed("c3"));
    push.mockResolvedValue(0); // c3 has no device with push on: not a failure, and not counted
    await expect(sendWeeklyReports(monday)).rejects.toThrow("2 weekly summaries failed, 0 sent (clinics c1, c2)");
    expect(push.mock.calls.map(([clinicId]) => clinicId)).toEqual(["c3"]);
  });
});
```

Run: `npx vitest run tests/unit/service-worker.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts tests/unit/daily-job.test.ts`
Expected: FAIL: the service worker opens `/app/requests` for the weekly summary too; `weeklyPushPayload`, `reportMonday`, `weeklyCandidates`, and `sendWeeklyReports` are not functions yet. The heads-up tests in `daily-job.test.ts` still PASS.

- [ ] **Step 2: Write the push and its selector**

In `src/lib/push.ts`, replace:

```ts
import { adminClient } from "@/lib/supabase/admin";
```

with:

```ts
import { formatRate, noShowRate } from "@/lib/reports";
import { adminClient } from "@/lib/supabase/admin";
```

replace:

```ts
export type PushPayload = { title: string; body: string; url: string };
```

with:

```ts
/** type "weekly" is the one thing the service worker reads besides the words: it opens Reports instead of Requests. */
export type PushPayload = { title: string; body: string; url: string; type?: "weekly" };
```

replace:

```ts
  return { title: `Your BrightSmile plan ends ${formatDate(endsAt)}`, body: "Pay in BrightSmile to keep online booking open.", url: "/app/requests" };
}
```

with:

```ts
  return { title: `Your BrightSmile plan ends ${formatDate(endsAt)}`, body: "Pay in BrightSmile to keep online booking open.", url: "/app/requests" };
}

/** Teams spec 6.4: the Monday summary of last week, in counts only. A tap opens Reports (type "weekly"). */
export function weeklyPushPayload(clinicName: string, visits: number, noShows: number): PushPayload {
  const rate = noShowRate(visits, noShows);
  const counts = `${visits} ${visits === 1 ? "visit" : "visits"}, ${noShows} ${noShows === 1 ? "no-show" : "no-shows"}`;
  return {
    title: `Last week at ${clinicName}`,
    body: `${counts}${rate === null ? "" : ` (${formatRate(rate)})`}. Tap to see Reports.`,
    url: "/app/reports",
    type: "weekly",
  };
}
```

and replace:

```ts
 * ponytail: an endpoint already saved by another login on this browser fails RLS and shows FAILED; v1 has one login per clinic.
```

with:

```ts
 * ponytail: an endpoint another member already saved on this browser (a shared front desk device) fails RLS and shows
 * FAILED, though the device keeps getting the clinic's alerts through that member's row; let a member take it over if asked.
```

In `public/sw.js`, replace:

```js
// BrightSmile service worker (spec 10.4): shows clinic alerts and opens the requests page on tap.
// It caches nothing: the dashboard always needs live data.
```

with:

```js
// BrightSmile service worker (spec 10.4): shows clinic alerts. A tap opens Reports for the Monday summary and the
// requests page for everything else. It caches nothing: the dashboard always needs live data.
```

replace:

```js
      icon: "/brand/icon-192.png",
      lang: "en",
    }),
```

with:

```js
      icon: "/brand/icon-192.png",
      lang: "en",
      // Only whether this is the weekly summary reaches the tap, never a URL (teams spec 6.4).
      data: { weekly: data.type === "weekly" },
    }),
```

and replace:

```js
// Always the requests page, whatever the payload says, so a push can never open another site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/app/requests", self.location.origin).href;
```

with:

```js
// A fixed page, whatever the payload says, so a push can never open another site: Reports for the weekly summary,
// the requests page for everything else.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const weekly = Boolean(event.notification.data && event.notification.data.weekly === true);
  const target = new URL(weekly ? "/app/reports" : "/app/requests", self.location.origin).href;
```

In `src/lib/daily.ts`, replace:

```ts
import { billingStatus, NOTICE_DAYS } from "@/lib/billing";
import { addDays, formatTime, manilaDate, manilaInstant } from "@/lib/time";
```

with:

```ts
import { billingFromRow, billingStatus, NOTICE_DAYS, type BillingRow } from "@/lib/billing";
import { addDays, formatTime, manilaDate, manilaInstant, weekday } from "@/lib/time";
```

Append to the end of `src/lib/daily.ts`:

```ts

/** A clinic as the Monday summary reads it. */
export type WeeklyRow = { id: string; name: string; created_at: string; weekly_report_for: string | null };

/** Today's Manila date when it is a Monday, the day the weekly summary goes out (teams spec 6.4), otherwise null. */
export function reportMonday(now: Date): string | null {
  const today = manilaDate(now);
  return weekday(today) === 1 ? today : null;
}

/**
 * Teams spec 6.4: the clinics due this Monday's summary: still taking bookings (not lapsed, billing spec 5; a clinic
 * without a billing row counts as a trial that ended at signup) and not yet claimed for this Monday. The daily job
 * checks the day with reportMonday and skips clinics without an appointment last week.
 */
export function weeklyCandidates(clinics: WeeklyRow[], billing: (BillingRow & { clinic_id: string })[], now: Date): WeeklyRow[] {
  const today = manilaDate(now);
  const rows = new Map(billing.map((b) => [b.clinic_id, b]));
  return clinics.filter(
    (c) => (c.weekly_report_for === null || c.weekly_report_for < today) && billingStatus(billingFromRow(rows.get(c.id) ?? null, c.created_at), now).open,
  );
}
```

- [ ] **Step 3: Add the daily job step**

In `src/lib/daily-job.ts`, replace:

```ts
import { billingStatus } from "@/lib/billing";
import { loadBillings } from "@/lib/billing-data";
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, renewalNotices, type ReminderRow, type RenewalRow } from "@/lib/daily";
import { logError } from "@/lib/log";
import { alertPlanEnding } from "@/lib/notify";
import { normalizeMobile } from "@/lib/phone";
import { smsMode, type SmsMode } from "@/lib/sms/prepare";
import { semaphoreBalance, sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
```

with:

```ts
import { billingStatus, type BillingRow } from "@/lib/billing";
import { loadBillings } from "@/lib/billing-data";
import {
  LOW_CREDIT_GAP_MS,
  lowCreditThreshold,
  reminders,
  reminderWindow,
  renewalNotices,
  reportMonday,
  weeklyCandidates,
  type ReminderRow,
  type RenewalRow,
  type WeeklyRow,
} from "@/lib/daily";
import { logError } from "@/lib/log";
import { alertPlanEnding } from "@/lib/notify";
import { normalizeMobile } from "@/lib/phone";
import { sendPush, weeklyPushPayload } from "@/lib/push";
import { sumCounts, type WeekStatsRow } from "@/lib/reports";
import { smsMode, type SmsMode } from "@/lib/sms/prepare";
import { semaphoreBalance, sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/time";
```

replace:

```ts
/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
```

with:

```ts
/**
 * Teams spec 6.4: on Mondays (Manila), last week's visits and no-shows to each clinic's devices, by push only. Due: not
 * lapsed and not yet told this Monday (weeklyCandidates), with at least one appointment last week. Each clinic first
 * claims weekly_report_for with a compare-and-set, so a rerun never pushes twice. Returns how many clinics a push reached.
 * A failed count or claim is not retried by this run, so after trying every clinic it throws with their ids.
 * ponytail: reads every clinic and billing row (the API returns at most 1000) and counts one clinic at a time; page and batch when clinics near that.
 */
export async function sendWeeklyReports(now: Date): Promise<number> {
  const monday = reportMonday(now);
  if (!monday) return 0;
  const lastMonday = addDays(monday, -7);
  const db = adminClient();
  const [clinics, billing] = await Promise.all([
    db.from("clinics").select("id, name, created_at, weekly_report_for"),
    db.from("clinic_billing").select("clinic_id, trial_ends_at, paid_through"),
  ]);
  if (clinics.error) throw clinics.error;
  if (billing.error) throw billing.error;
  let sent = 0;
  const failed: string[] = [];
  const due = weeklyCandidates((clinics.data ?? []) as WeeklyRow[], (billing.data ?? []) as (BillingRow & { clinic_id: string })[], now);
  for (const clinic of due) {
    const { data: rows, error: countError } = await db.rpc("clinic_week_stats", { p_clinic_id: clinic.id, p_from: lastMonday, p_weeks: 1 });
    if (countError) {
      logError("sendWeeklyReports counts", countError);
      failed.push(clinic.id);
      continue;
    }
    const week = sumCounts((rows ?? []) as WeekStatsRow[]);
    if (week.online + week.manual === 0) continue;
    const { data: claimed, error: claimError } = await db
      .from("clinics")
      .update({ weekly_report_for: monday })
      .eq("id", clinic.id)
      .or(`weekly_report_for.is.null,weekly_report_for.lt.${monday}`)
      .select("id");
    if (claimError) {
      logError("sendWeeklyReports claim", claimError);
      failed.push(clinic.id);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    if ((await sendPush(clinic.id, weeklyPushPayload(clinic.name, week.completed, week.no_show))) > 0) sent++;
  }
  // A failed count or claim is not retried, so name the clinics (ids only) in the log.
  if (failed.length > 0) throw new Error(`${failed.length} weekly summaries failed, ${sent} sent (clinics ${failed.join(", ")})`);
  return sent;
}

/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
```

replace:

```ts
  renewals: number | Failed;
```

with:

```ts
  renewals: number | Failed;
  weekly: number | Failed;
```

and replace:

```ts
  const renewals = await step("renewal notices", () => sendRenewalNotices(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, renewals, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, renewals, expired, cleaned, credit };
```

with:

```ts
  const renewals = await step("renewal notices", () => sendRenewalNotices(now));
  const weekly = await step("weekly reports", () => sendWeeklyReports(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, renewals, weekly, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, renewals, weekly, expired, cleaned, credit };
```

The date inside the `or` filter needs no quotes: `2026-10-05` has none of PostgREST's reserved characters.

Run: `npx vitest run tests/unit/service-worker.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts tests/unit/daily-job.test.ts`
Expected: PASS (2, 11, 12, and 5 tests).

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing; lint clean; every test PASS (the cron route test still answers 401 before running the job).

```powershell
git add src/lib/push.ts public/sw.js src/lib/daily.ts src/lib/daily-job.ts tests/unit/service-worker.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts tests/unit/daily-job.test.ts
git commit -m "feat: push last week's numbers every Monday" -m "On Manila Mondays the daily job finds clinics that are not lapsed, had an appointment last week, and have no summary for this Monday, claims weekly_report_for with a compare-and-set, and pushes visits, no-shows, and the no-show rate, counts only. The service worker opens Reports for that push and the requests page for everything else, never a URL from the payload."
```

### Task 8: README and final verification

**Files:**
- Modify: `README.md`

The controller runs this task after Tasks 1 to 7 are committed. It changes only the README unless a check fails; a fix gets its own `fix:` commit.

- [ ] **Step 1: Document teams and reports**

In `README.md`, replace:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migration 7 is pasted as described under "Billing" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

with:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migrations 7 and 8 are pasted as described under "Billing" and "Teams and reports" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

replace:

```markdown
   | 7 | `20260925000200_billing.sql` |
```

with:

```markdown
   | 7 | `20260925000200_billing.sql` |
   | 8 | `20260926000100_teams.sql` |
```

replace:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260925000200
```

with:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260925000200 20260926000100
```

and append to the end of the file:

````markdown

## Teams and reports

A clinic's owner invites staff with a join link (spec: `docs/superpowers/specs/2026-09-26-brightsmile-teams-reports-design.md`). Staff handle requests, the schedule, new appointments, patients, and dentists' time off; only the owner changes the clinic profile and booking rules, dentists, working hours, procedures, billing, and the team. The database enforces this, not only the pages. Staff seats are free. Every clinic also gets a Reports page and a Monday 9:00 AM push that sums up the week before.

### Apply the teams migration (once, before merging the teams branch)

Every merge to `main` deploys, and the new code reads the new columns and functions, so the migration goes first. The billing migration must already be in production.

1. Make sure production's `create_clinic` is still the one in the billing migration, because this migration replaces it and a fix made there by hand would be lost. Run `select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure);` in the production **SQL Editor** and compare the body (between the `$function$` markers) with `create_clinic` in `supabase/migrations/20260925000200_billing.sql`. If they differ, stop and fold the difference into the teams migration first.
2. Make sure no clinic uses the booking link `join`, which becomes reserved: `select id, name from public.clinics where slug = 'join';` must return no rows. If it returns one, change that clinic's booking link first, or the migration stops at `clinics_slug_not_reserved`.
3. Open `supabase/migrations/20260926000100_teams.sql`, paste it into the production **SQL Editor**, and run it. Every existing member stays the owner of their clinic and gets their login email copied onto their membership. `npm test` has already applied it to an offline copy of the schema (`tests/sql`).
4. Check it: `select count(*) from public.clinic_members where email is null or role <> 'owner';` must return `0`.
5. If you ever link the project for `npm run db:push`, mark it applied first: `npx supabase migration repair --status applied 20260926000100`.

### Invite staff

1. As the owner, open **Settings**, then **Open Team**, and press **Create join link**. Copy the link and send it by Messenger or text. It works once, for 7 days, and is shown only once; make another if it is lost.
2. The staff member opens it, creates an account (or logs in), confirms their email in the same browser, and presses **Join**. They land on Requests. If they confirmed in another browser and see the clinic setup instead, they open the join link again there.
3. On the Team page, **Revoke** stops an unused link at once, and **Remove** ends a staff member's access on their next page load and stops their devices getting the clinic's alerts.

One login belongs to one clinic: someone whose login already has a clinic joins with another email.

### Reports and the Monday push

**Reports**, in the dashboard nav, shows a Manila week's (Monday to Sunday) visits, no-shows, no-show rate, cancellations, declined and expired requests, visits nobody marked yet, and online versus staff bookings, per dentist when 2 or more worked, and an 8 week table. Every Monday the daily job pushes "Last week at {clinic}" with the week's visits, no-shows, and no-show rate to each clinic that is not paused and had appointments; tapping it opens Reports. There is no text fallback (it would cost a credit per clinic per week). The daily job's JSON reports how many clinics the push reached as `"weekly"`.
````

- [ ] **Step 2: Run every automated check**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run build`
Expected: lint clean; `tsc` silent; every unit test and the `tests/sql` suite PASS (`teams.test.ts` 22, `isolation.test.ts` 9, `billing.test.ts` 18); the build finishes and its route list shows `ƒ /app/reports`, `ƒ /app/settings/team`, and `ƒ /join/[token]`. `;` keeps going after a failure, so read every result.

- [ ] **Step 3: No dashes slipped in, and the other suites are untouched**

Run: `git grep -n -P "[\x{2013}\x{2014}]" -- src tests supabase public README.md CONTRIBUTING.md docs/superpowers/plans/2026-09-26-plan-6-teams-reports.md`
Expected: no output.

Run: `git diff --stat plan-5-billing...HEAD -- tests/db tests/e2e playwright.config.ts`
Expected: no output (this plan neither edits nor runs them).

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: explain teams, join links, reports, and the teams migration" -m "The README gains the Teams and reports section: the checks before pasting the migration, pasting it before the merge, inviting and removing staff, and what Reports and the Monday push show. Migration 8 joins the table and the repair command."
```

- [ ] **Step 5: Report to Kai**

Write the summary for Kai: what shipped, the test counts, that no dependency was added, the one migration and that it must be pasted before the merge (after the billing one), the two checks before pasting, and the list in "What Kai must do" below. Say plainly that the pages were checked by typecheck, lint, build, review, and one signed-out request to `/join/x`, because there is no development database, and list the walk to do on production after the deploy.

## What Kai must do (outside the code)

Before merging the teams branch (after the billing branch, which this one sits on; every merge to `main` deploys production):
- Review `supabase/migrations/20260926000100_teams.sql`. Run the two checks in the README's "Teams and reports" section (production's `create_clinic` matches the billing migration's; no clinic uses the booking link `join`), then paste the migration into the production **SQL Editor**, run it, and run the check query (it must return `0`).
- Nothing else: no new environment variables, no Supabase setting or email template changes.

After the deploy, walk it on production (you need a second email address for the staff side):
- As the demo clinic's owner, open Settings: the Team section is there. Open Team and press **Create join link**; copy the link.
- In a private window, open the link: it says the demo clinic invited you. Press **Create an account**, use the second email, confirm it in the same private window, and press **Join**: you land on Requests, and the nav shows Reports.
- As that staff member: Settings shows alerts on this device, dentists with **Time off** only, the plan's status, and the account. Billing shows the status line only. Opening `/app/settings/team` sends you back to Settings.
- Open the same join link again in another private window: "This join link no longer works."
- Back as the owner, the Team page lists the staff member with the Staff chip and today's date. Remove them: in the staff window, the next page load lands on the clinic setup (onboarding).
- Open Reports: last week is chosen, and the 8 week table is there.
- After 9:00 AM on the next Monday: the push "Last week at {clinic}" arrives on any device with push on (if the clinic had appointments last week), and tapping it opens Reports. Under **Settings > Cron Jobs**, the run's JSON includes `"weekly"`.
- Phones that added the dashboard to the home screen pick up the new service worker the next time they open it (`/sw.js` is served uncached).

## Self-review

**Spec coverage.**

| Spec | Where |
|---|---|
| 1: owner and staff roles, free seats, 7 day join links by Messenger or text, Reports plus a Monday push without a text, one owner, one clinic per login | Task 2 (roles, `accept_invite` refuses accounts with a clinic), Task 4 (links), Task 6 (Reports), Task 7 (push, no text); prices unchanged |
| 2.1: invite in under a minute, working within 5 minutes | Task 4 (one button, Copy), Task 5 (join flow, sign-up words, onboarding follows the link) |
| 2.2: staff never change setup, billing, or team, by RLS, proven, even through a Server Action | Task 2 (policies, grants, `remove_member`; `teams.test.ts`), Task 3 (`requireOwner` in every owner-only action; `settings-actions.test.ts`, `pay-online.test.ts`) |
| 2.3: nobody outside a clinic reads its team, invites, or reports | Task 2 (member and invite policies, `clinic_week_stats` under RLS; tests, isolation sweep) |
| 2.4: a link works once, for 7 days, and stops when revoked | Task 2 (`accept_invite` with the row lock, column grants, no reopening; tests), Task 4 (Revoke) |
| 2.5: the no-show rate is `no_show / (completed + no_show)` per Manila week | Task 2 (`clinic_week_stats`, Sunday 11:30 PM test), Task 6 (`noShowRate`), Task 7 (the push uses the same function) |
| 2.6: a removed member loses access on the next request | Task 2 (`remove_member`; test), Task 1 (`requireStaff` finds no membership and sends them to onboarding) |
| 3: scope in and out | In: all tasks. Out (several owners, transfer, dentist logins, email invites, custom roles, CSV, charts beyond CSS bars, audit screens, multi-clinic logins): not built |
| 4: the roles table | Task 2 (RLS), Task 3 (actions and pages), Task 4 (Team page owner only), Task 6 (Reports for both); password and push stay open |
| 5: data model, helper, policies, the lookup by user id, `accept_invite`, `remove_member`, `clinic_week_stats` | Task 2; Task 1 (`ownMembership` in the proxy and `signedInStaff`) |
| 6.1: Team page, create once with Copy, revoke, remove with a confirm, no remove for the owner | Task 4 |
| 6.2: the join page's states, the cookie, onboarding redirect, reserved `join`, noindex, never cached | Task 5, Task 2 (`join` reserved in SQL and `RESERVED_SLUGS`) |
| 6.3: Reports: week picker, the numbers, per dentist, 8 week table with CSS bars, labels, empty weeks | Task 6 |
| 6.4: Monday push: not lapsed, had appointments, compare-and-set claim, wording, counts only, `type: "weekly"`, the service worker | Task 7 |
| 6.5: staff banner words without a link; staff Billing status only | Task 3 |
| 7: security and privacy | Tasks 2, 4, 5, 7; tokens hashed and never logged; `/join` reveals the name only for an open link |
| 8: tests | Database: `tests/sql/teams.test.ts` and `isolation.test.ts` (Task 2). Unit: week math, rate (Task 6), push text (Task 7), join page states (Task 5), Monday selector (Task 7), plus membership, team data, actions, service worker |
| 9: errors | Task 5 (join refusals and "Try the link again."), Task 7 (one clinic's failure never stops others; the run is marked failed with ids), Task 6 ("Reports are not available right now.") |

**Decisions worth a second look.**
- The join page cannot set or clear cookies (Next forbids it in Server Components), so the cookie is set by the Server Action behind "Create an account" and "I already have an account", and cleared by the join action once the link works or is refused. A page view of a dead link cannot clear it, so onboarding follows the cookie only while the link is still open; a stale cookie never keeps anyone from setting up a clinic.
- `accept_invite` refuses with custom SQLSTATEs (`BSUNK`, `BSREV`, `BSUSD`, `BSEXP`) plus the existing `23505` for "already has a clinic" (the unique index raises the same code in a race). `remove_member` answers every refusal with `BSNOS`, so it never reveals whether someone belongs to another clinic.
- `clinic_invites` uses column grants: the owner inserts only `clinic_id` and `token_hash` (so the maker and the 7 day expiry always come from defaults) and updates only `revoked_at`, and the update policy refuses a null `revoked_at`, so a revoked link can never reopen, even through the API.
- `authenticated` keeps only `select` on `clinic_members` (the spec's "no insert, update, or delete for anyone"), so a direct write is a permission error rather than a silent RLS miss.
- Counts: `online` and `manual` count every appointment of the week by source, whatever its status (requests included); `upcoming` is confirmed visits still ahead, not pending requests; "not marked yet" is confirmed visits that have started, when the schedule starts offering Completed and No-show. The spec named these counts without defining them.
- "Had at least one appointment last week" counts any status, so a clinic whose week held only cancellations gets "0 visits, 0 no-shows. Tap to see Reports." The rate is left out when there were neither visits nor no-shows.
- The Monday step reads `clinic_billing` in one query and applies `billingFromRow` and `billingStatus` itself (the same rules `loadBillings` applies) instead of calling `loadBillings` with every clinic id, which would put hundreds of ids in one URL. It counts one clinic at a time through `clinic_week_stats`, which keeps the function's signature per clinic and index-friendly; both are marked `ponytail:` for past 1000 clinics.
- Sign-up says "Create your account. Then you join your clinic's team on BrightSmile." when the join cookie is present, and onboarding's first screen tells staff to open the clinic's link. The spec left sign-up unchanged, which would have told a joining staff member to "Create your clinic account" and set up a clinic.
- "Log out" on the join page (for an account that already has a clinic) comes back to the same link instead of `/login`, so the next step is "Create an account" with the cookie set.
- `/join/` is also kept out of robots.txt, next to the noindex header and robots meta, like the other private folders.
- `requireOwner` returns null for staff instead of redirecting, so actions answer "Only the clinic's owner can change this." and the one owner-only page (Team) redirects to Settings.
- The per-dentist sections appear when 2 or more dentists had any appointment that week. The "Mark them on the schedule" link opens the schedule on that week's Monday.
- The bottom tab bar has six tabs on phones at 12px instead of 12.5px (60px per tab at 360px).
- Staff see the Billing status line unchanged, which for a paused clinic ends "Online booking reopens when you pay."; a hint below says the owner handles payments.
- On a device shared by two members, the second one's "Enable push" fails RLS (the endpoint belongs to the first), though the device keeps getting the clinic's alerts; the `ponytail:` comment in `saveSubscription` says so.

**Deferred.** Everything in spec 3's "Out" list; a staff member leaving a clinic on their own (the owner removes them); a way out for someone holding an open join link who wants their own clinic instead (they wait until it is used, revoked, or expired, or sign up with another email); paging the Monday step past 1000 clinics (marked `ponytail:`); a browser walk of the dashboard before deploy (no development database exists).

**Placeholder scan.** Every step has complete code or exact text. Kai supplies nothing but the migration paste and the production walk.

**How this plan was checked.** Every Create, replace, and append instruction was applied by script, in order, to a clean export of commit `94e3756` (the plan's base, `plan-6-teams`): each replaced text occurs exactly once in its file at that point, as the Edit tool needs. After each task the copy typechecked, linted clean, and passed `npm test` (unit and `tests/sql`); each "Expected: FAIL" step failed for the reason given; after Tasks 3 to 7 the copy built with `next build`, and under `next start` a signed-out `/join/x` answered 200 with `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, and "This join link no longer works". The migration was also checked the other way: without the `clinic_invites` revoke, or without the `clinic_members` revoke, a test fails.

**Type consistency.** `Role` is declared once in `src/lib/membership.ts` (Task 1) and used by `signedInStaff`, `Member`, and `TeamMember` (Task 4). `Staff` keeps its three fields; `Member = Staff & { role: Role }` is what `requireStaff` and `requireOwner` return and what `billingBanner` takes (Task 3), and every service that took `Staff` still does. `WeekStatsRow` and `WeekCounts` (Task 6) match `clinic_week_stats`' columns (Task 2) and serve the Reports page and `sendWeeklyReports` (Task 7). `hashInviteToken` (Task 2) is the digest `accept_invite` computes and what the harness, `createInvite`, and `inviteClinicName` use. `joinRefusal` maps exactly the SQLSTATEs `accept_invite` raises. `PushPayload.type` is `"weekly"` or absent, and `public/sw.js` checks exactly `"weekly"`. `Saved` (`@/lib/staff-input`) is what the settings and team actions return; `NewInvite`, `PayState`, and `JoinState` are the other action results. `DailySummary.weekly` sits next to `renewals`.
