# BrightSmile Plan 5: Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every clinic gets a 14 day free trial at signup and then prepays 1 to 12 months, by GCash (Kai records it on `/admin`) or through PayMongo checkout once its two keys are set. Three days before a plan ends the clinic gets a heads-up; 3 days after, its public booking page and reminder texts pause while the dashboard keeps working. Every database change is proven offline before Kai pastes it into production.

**Architecture:** One migration adds `clinic_billing` (one row per clinic: `trial_ends_at`, `paid_through`, `renewal_notice_for`) and `payments`. Members of a clinic may read both; only the secret key (`service_role`) writes them, through three functions: `record_payment` (locks the row, records a PayMongo session once, extends from the latest of `paid_through`, the trial end, and now), `extend_trial`, and `admin_overview` (the admin list, aggregated in SQL because the API returns at most 1000 rows per request). `create_clinic` also starts the trial. Every time rule lives in one pure module, `src/lib/billing.ts`: the tiers and amounts, `billingStatus(billing, now)` (active, trial, grace, lapsed), and the words for the status line, the dashboard banner, and the paused notice. `src/lib/billing-data.ts` loads billing through the client each caller has: the staff RLS client in `/app`, the secret-key client on the public booking page, in the daily job, in the PayMongo webhook, and on `/admin` behind `requireOperator`. `src/lib/paymongo.ts` builds the checkout request, verifies the `Paymongo-Signature` header, and reads webhook events defensively; the Route Handler reads the raw body and answers 401, 200, or 500. The daily job gains a heads-up step that claims `renewal_notice_for` with a compare-and-set before alerting (push first, text as fallback), and skips reminders for lapsed clinics. Database changes are tested offline with PGlite: `tests/sql/harness.ts` rebuilds Supabase's roles, `auth.uid()`, and default privileges, applies every migration in order, and runs SQL as signed-in users, so a forgotten revoke fails a test instead of leaking in production.

**Tech Stack:** Next.js 16.3 (App Router, Route Handlers, Server Actions with `useActionState`, `refresh`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5, `@electric-sql/pglite` 0.5 (new, dev only). PayMongo's REST API through `fetch`, no SDK.

**Spec:** `docs/superpowers/specs/2026-09-25-brightsmile-billing-design.md` (every section). It builds on `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (10.1 text limits, 10.4 alert channel rule, 11 daily job).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| Route Handlers: `POST`, reading the raw body with `request.text()` for webhooks, `Response.json` | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (sections "Request Body" and "Webhooks") |
| Forms with Server Actions: `FormData`, `useActionState` (the action gets the previous state first), pending state | `node_modules/next/dist/docs/01-app/02-guides/forms.md` |
| Server Action security: every action authenticates, authorizes, and validates its input itself | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (section "Security"), `node_modules/next/dist/docs/01-app/02-guides/data-security.md` |
| `refresh()` after a mutation, `redirect` after a mutation | `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` |
| `redirect` (accepts absolute external URLs; call it outside `try`; a client navigation when JavaScript runs, a 303 for a plain form post) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` |
| `notFound` (throws, so call it in the render path or an awaited function; adds a noindex meta tag) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md` |
| `page.tsx` props: `searchParams` is a Promise | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` |
| Proxy matcher (gains `/admin` in Task 7, so the operator's session stays fresh) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` |
| `headers` in `next.config` (the `X-Robots-Tag` rules in `src/lib/security-headers.ts`) | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, SQL comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/(auth)"` and `"src/app/[slug]/BookingSheet.tsx"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer the session adds (CONTRIBUTING.md). The commit commands in this plan leave it out; add your own as a final `-m` paragraph. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-5-billing`, one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone (Vercel runs in UTC). Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and clock times as minutes after midnight. "This month" on `/admin` is the Manila calendar month (`manilaMonthStart`).
- Money is whole centavos (`integer`), never floats. Prices live only in `TIERS` in `src/lib/billing.ts` (Solo 1 to 2 active dentists ₱399 a month, Team 3 to 6 ₱1,299, Group 7 or more ₱1,799; 0 active dentists pays Solo). The server computes every amount it charges; a Server Action never takes an amount from the client, and `?paid=1` never changes what the page says about the plan.
- Every billing decision goes through `billingStatus(billing, now)` in `src/lib/billing.ts` (spec 5). Nothing else compares `trial_ends_at` or `paid_through` with now, except the SQL functions that write them.
- Mobile numbers are stored as `+639XXXXXXXXX` and shown as `09XXXXXXXXX` (`localMobile`).
- Texts are printable ASCII, at most 160 characters with worst-case inputs (clinic `sms_name` 20 characters, `APP_URL` host 17 characters, date "Wed Sep 30"). The new `renewal` text is 146 characters in that worst case; `tests/unit/sms-templates.test.ts` proves it for every kind.
- `APP_URL` is the only source of the site's address. Code builds links as `${APP_URL}/app/billing`.
- `SMS_MODE=log` writes texts to `sms_log` with status `logged`. Tests and local development always use `log`.
- Never log patient details, codes, secrets, keys, or environment values. Error logs carry where it failed and the error message only (`logError` in `src/lib/log.ts`). PayMongo keys and the webhook secret never reach a log, an error message, or the client.
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies). The secret-key client (`adminClient`) is used only where no staff session exists: `sendSms`, the public booking flow (now including `bookingOpen`), `sendPush`, and the daily job; and, new in this plan, the PayMongo webhook and `/admin` after `requireOperator` (they cross clinics). Nothing else.
- Server Actions are public POST endpoints: each one checks who is calling (`requireStaff` or `requireOperator`) and re-validates every argument on the server, whatever the form already checked.
- A text or a push that fails never fails the action or job step that caused it (core spec 13). `sendPush` never throws; `alertPlanEnding`, like `alertClinic`, falls back to a text when no device got the push.
- Push payloads never carry a patient's name. The plan push carries only the end date. Tapping any notification opens `/app/requests`, whatever the payload says (the service worker ignores payload URLs).
- The daily job's steps stay idempotent (core spec 11): reminders claim `reminder_sent_at` before texting; the heads-up claims `renewal_notice_for` before alerting; a rerun never alerts twice.
- Private pages send `X-Robots-Tag: noindex, nofollow`: `/app`, `/a/`, `/onboarding`, `/login`, `/signup`, `/forgot`, `/reset-password`, `/auth/`, `/api/` (which covers `/api/paymongo/webhook`), and now `/admin`.
- UI: targets at least 44px, status never rests on colour alone (every chip carries a word), reuse the classes in `src/app/globals.css` (light only, cream canvas, white cards, teal primary). One primary button per screen.
- One new migration, `supabase/migrations/20260925000200_billing.sql`. Kai reviews it and pastes it into the production SQL Editor before the plan's branch merges (every merge to `main` deploys production). Nothing in this plan runs SQL against Supabase.
- Database tests are the offline PGlite suite in `tests/sql`, run by `npm test`. There is no development Supabase project (the original one is production) and no Docker. `tests/db` and the Playwright test keep refusing the production project; this plan neither runs nor edits them, and they stay valid: a clinic without a `clinic_billing` row counts as a trial that ended at signup, so their freshly seeded clinics are in grace and open.
- Never use the app locally in this plan (no sign-ups, bookings, or dashboard walks): `.env.local` points at production. The pages are checked by typecheck, lint, build, and review, then walked on production after deploy (spec 9, and "What Kai must do" below). The one local server check, in Task 7, requests `/admin` signed out, which reads no data.
- Dev server port: 3600 (`.claude/launch.json` entry `brightsmile`).
- Dependencies added (each named in the PR with its reason): `@electric-sql/pglite` (dev only; an in-process Postgres 17 compiled to WebAssembly, the only way to apply the migrations and prove RLS without a development project or Docker; a spike on 2026-09-25 applied all six existing migrations with it). PayMongo is called with `fetch`, no SDK.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. Clinic dashboard (done).
4. Launch readiness (done).
5. **Billing (this plan):** the offline database harness, the billing migration, the status rules, pausing lapsed clinics, PayMongo checkout and webhook, the Billing page and banner, the operator's `/admin` page, the heads-up before a plan ends, the environment check, and the README. Deliverable: once Kai pastes the migration and sets three environment variables, clinics can see and pay for their plan, and Kai can record GCash payments.

## File map for this plan

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | `@electric-sql/pglite` (dev); `npm test` runs `tests/unit` and `tests/sql` |
| `tests/sql/harness.ts` | Offline Postgres: Supabase stand-in (roles, `auth.users`, `auth.uid()`, default privileges), every migration in order, `asUser`, `asService`, `addUser`, `newClinic` |
| `tests/sql/isolation.test.ts` | Re-proves clinic isolation in every table with a `clinic_id`, nothing for visitors, the double booking guard |
| `tests/sql/billing.test.ts` | The billing migration: trial rows, backfill, member read only, `record_payment`, `extend_trial`, `admin_overview` |
| `supabase/migrations/20260925000200_billing.sql` | `clinic_billing`, `payments`, RLS and grants, `create_clinic` with the trial, backfill, `record_payment`, `extend_trial`, `admin_overview` |
| `src/lib/billing.ts` | Pure: tiers, amounts, `billingStatus`, dates and words, paused notice, `manilaMonthStart` |
| `src/lib/billing-data.ts` | Server: `loadBillings`, `loadBilling`, `bookingOpen`, `billingBanner`, `activeDentists`, `loadPayments`, `recordPayment`, `extendTrial`, `adminOverview` |
| `src/lib/paymongo.ts` | Server: `paymongoKeys`, `checkoutRequest`, `createCheckout`, `verifySignature`, `readWebhookEvent` |
| `src/lib/admin.ts` | Pure: `operatorEmails`, `isOperator`, `parsePesos`, `parseGcashPayment`, `parseTrialDays` |
| `src/lib/supabase/server.ts` | `requireOperator` |
| `src/lib/supabase/admin.ts` | Doc comment: the two new secret-key callers |
| `src/proxy.ts` | Matcher gains `/admin` (session refresh only) |
| `src/lib/security-headers.ts` | `/admin` is noindex |
| `src/lib/booking.ts`, `src/app/[slug]/page.tsx`, `src/app/[slug]/BookingSheet.tsx` | A lapsed clinic's page shows the paused notice; the booking actions answer `paused` |
| `src/lib/daily.ts`, `src/lib/daily-job.ts` | Reminders skip lapsed clinics; `renewalNotices`, `sendRenewalNotices`, `renewals` in the summary |
| `src/lib/sms/templates.ts`, `src/lib/push.ts`, `src/lib/notify.ts` | `renewal` text, `planPushPayload`, `alertPlanEnding` |
| `src/app/api/paymongo/webhook/route.ts` | `POST`: signature, event, `record_payment`, 401 or 200 or 500 |
| `src/app/app/billing/page.tsx`, `PayPanel.tsx`, `actions.ts` | Billing page, months picker, GCash details, Pay online (`payOnline`), history |
| `src/app/app/layout.tsx`, `src/app/app/settings/page.tsx` | Dashboard banner; Settings link to Billing |
| `src/app/admin/page.tsx`, `ClinicActions.tsx`, `actions.ts` | Operator page: clinic list, record a GCash payment, extend a trial |
| `src/lib/env.ts`, `.env.example` | Billing variables in the startup check |
| `src/lib/onboarding.ts` | Doc comment: where `create_clinic` is now defined |
| `README.md`, `CONTRIBUTING.md` | `npm test` row, database changes without a development project, the Billing section, migration 7 |
| `tests/unit/billing.test.ts`, `paymongo.test.ts`, `paymongo-webhook.test.ts`, `admin.test.ts` | New unit tests |
| `tests/unit/daily.test.ts`, `env.test.ts`, `push.test.ts`, `routes.test.ts`, `security-headers.test.ts`, `sms-templates.test.ts` | Updated unit tests |

## Tasks

1. Offline database tests with PGlite
2. The billing migration
3. Billing rules and loaders
4. Pause lapsed clinics
5. PayMongo checkout and webhook
6. Billing page, banner, and Settings link
7. The operator's admin page
8. Heads-up before a plan ends
9. Environment check and `.env.example`
10. README and final verification

---

### Task 1: Offline database tests with PGlite

**Files:**
- Modify: `package.json`, `package-lock.json`, `README.md`, `CONTRIBUTING.md`
- Create: `tests/sql/harness.ts`, `tests/sql/isolation.test.ts`

**Interfaces:**
- Consumes: every file in `supabase/migrations` (applied in filename order); `type CreateClinicPayload` from `@/lib/onboarding` (the jsonb `public.create_clinic` reads); `PGlite` from `@electric-sql/pglite` and `btree_gist` from `@electric-sql/pglite/contrib/btree_gist` (the schema's `no_overlap` exclusion constraint needs it).
- Produces, from `tests/sql/harness.ts`:
  - `MIGRATIONS: string[]` (file names, sorted)
  - `migrate(db: PGlite, file: string): Promise<void>`
  - `freshDb(count?: number): Promise<PGlite>` (stand-in plus the first `count` migrations, all by default)
  - `asUser<T>(db: PGlite, userId: string | null, sql: string, params?: unknown[]): Promise<T[]>` (role `authenticated` with the user's claims, or `anon` for `null`, for one transaction)
  - `asService<T>(db: PGlite, sql: string, params?: unknown[]): Promise<T[]>` (role `service_role`)
  - `addUser(db: PGlite): Promise<string>` (a row in `auth.users`; returns its id)
  - `newClinic(db: PGlite): Promise<{ userId: string; clinicId: string }>` (a new user who calls `public.create_clinic`)
  - `npm test` runs `vitest run tests/unit tests/sql`.

Rules (spec 9): the stand-in reproduces what a Supabase project has before our first migration, including its default privileges (every new table, sequence, and function in `public` granted to `anon`, `authenticated`, and `service_role`), so a migration that forgets a revoke fails a test here instead of passing offline and leaking in production. `auth.uid()` reads `request.jwt.claim.sub` or `request.jwt.claims ->> 'sub'`, like Supabase's own. `asUser` switches role with `set_config('role', ...)` inside a transaction, exactly as PostgREST does, so the role always ends with the statement. Queries run as the default PGlite user (a superuser that owns the tables) bypass RLS; the tests use that only to seed rows. The isolation test discovers every table with a `clinic_id` column at run time, so tables added by later migrations are checked for leaks automatically.

- [ ] **Step 1: Install PGlite**

Run: `npm install -D @electric-sql/pglite@^0.5.8`
Expected: `added 1 package` and no `ERR!` lines. `package.json` lists `"@electric-sql/pglite"` under `devDependencies`.

- [ ] **Step 2: Write the failing isolation test**

Create `tests/sql/isolation.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, freshDb, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };

// Every table with a clinic_id that seed() fills. Tables added later are still checked for leaks below.
const SEEDED = [
  "appointment_events",
  "appointments",
  "clinic_members",
  "dentists",
  "patients",
  "procedures",
  "push_subscriptions",
  "sms_log",
  "time_off",
  "working_hours",
];

let db: PGlite;
let a: Clinic;
let b: Clinic;

/** One row in every clinic-owned table create_clinic does not fill, written as the table owner (no RLS). */
async function seed({ userId, clinicId }: Clinic) {
  const one = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]?.id;
  const dentist = await one("select id from public.dentists where clinic_id = $1", [clinicId]);
  const patient = await one("insert into public.patients (clinic_id, first_name, last_name, mobile) values ($1, 'Ana', 'Cruz', '+639171112222') returning id", [clinicId]);
  const appointment = await one(
    `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
     values ($1, $2, $3, '2030-01-07T09:00:00+08:00', '2030-01-07T09:30:00+08:00', 'confirmed', '{Consultation}', 'online', $4) returning id`,
    [clinicId, dentist, patient, `T${clinicId.replace(/-/g, "").slice(0, 11)}`],
  );
  await db.query("insert into public.appointment_events (clinic_id, appointment_id, to_status, actor) values ($1, $2, 'confirmed', 'staff')", [clinicId, appointment]);
  await db.query("insert into public.time_off (clinic_id, dentist_id, starts_at, ends_at) values ($1, $2, '2030-01-08T09:00:00+08:00', '2030-01-08T12:00:00+08:00')", [clinicId, dentist]);
  await db.query("insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status) values ($1, '+639171112222', 'confirmed', 'x', 1, 'logged')", [clinicId]);
  await db.query("insert into public.push_subscriptions (clinic_id, user_id, endpoint, p256dh, auth) values ($1, $2, $3, 'k', 'a')", [clinicId, userId, `https://fcm.googleapis.com/fcm/send/${clinicId}`]);
}

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  await seed(a);
  await seed(b);
  // A text to the operator belongs to no clinic: no member may see it.
  await db.query("insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status) values (null, '+639170000009', 'low_credit', 'x', 1, 'logged')");
}, 60_000);

describe("clinic isolation", () => {
  it("shows members only their own clinic, and only its rows in every table with a clinic_id", async () => {
    expect(await asUser(db, a.userId, "select id from public.clinics")).toEqual([{ id: a.clinicId }]);
    const tables = (
      await db.query<{ table_name: string }>(
        "select table_name from information_schema.columns where table_schema = 'public' and column_name = 'clinic_id' order by table_name",
      )
    ).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(SEEDED));
    for (const table of tables) {
      const rows = await asUser<{ clinic_id: string | null }>(db, a.userId, `select clinic_id from public.${table}`);
      expect(rows.every((r) => r.clinic_id === a.clinicId), table).toBe(true);
      if (SEEDED.includes(table)) expect(rows.length, table).toBeGreaterThan(0);
    }
  });

  it("changes nothing in another clinic", async () => {
    expect(await asUser(db, a.userId, "update public.clinics set name = 'Hacked' where id = $1 returning id", [b.clinicId])).toEqual([]);
    expect(await asUser(db, a.userId, "delete from public.patients where clinic_id = $1 returning id", [b.clinicId])).toEqual([]);
    await expect(
      asUser(db, a.userId, "insert into public.patients (clinic_id, first_name, last_name) values ($1, 'Sneaky', 'Insert')", [b.clinicId]),
    ).rejects.toThrow(/row-level security/);
  });

  it("keeps verification codes away from signed-in users", async () => {
    await expect(asUser(db, a.userId, "select id from public.otp_requests")).rejects.toThrow(/permission denied/);
  });
});

describe("visitors without a session", () => {
  it("can read no table", async () => {
    const tables = (
      await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
    ).rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(10);
    for (const table of tables) {
      await expect(asUser(db, null, `select 1 from public.${table} limit 1`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("can run no function", async () => {
    const runnable = await db.query<{ proname: string }>(
      "select proname from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')",
    );
    expect(runnable.rows).toEqual([]);
  });
});

describe("double booking guard", () => {
  const insert = (clinic: Clinic, start: string, end: string, status: string) =>
    db.query(
      `insert into public.appointments (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token)
       select $1, d.id, p.id, $2, $3, $4, '{Consultation}', 'manual', substr(md5(random()::text), 1, 12)
       from public.dentists d join public.patients p on p.clinic_id = d.clinic_id where d.clinic_id = $1 limit 1`,
      [clinic.clinicId, start, end, status],
    );

  it("rejects overlapping pending or confirmed visits for one dentist", async () => {
    await insert(a, "2030-02-04T09:00:00+08:00", "2030-02-04T10:00:00+08:00", "confirmed");
    await expect(insert(a, "2030-02-04T09:30:00+08:00", "2030-02-04T10:30:00+08:00", "pending")).rejects.toThrow(/no_overlap/);
  });

  it("allows back-to-back visits and ignores cancelled ones", async () => {
    await insert(a, "2030-02-04T10:00:00+08:00", "2030-02-04T10:30:00+08:00", "confirmed");
    await insert(a, "2030-02-04T11:00:00+08:00", "2030-02-04T12:00:00+08:00", "cancelled");
    await insert(a, "2030-02-04T11:00:00+08:00", "2030-02-04T12:00:00+08:00", "pending");
  });
});
```

Run: `npx vitest run tests/sql/isolation.test.ts`
Expected: FAIL, `./harness` does not exist.

- [ ] **Step 3: Write the harness**

Create `tests/sql/harness.ts`:

```ts
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import type { CreateClinicPayload } from "@/lib/onboarding";

const DIR = new URL("../../supabase/migrations/", import.meta.url);

/** Every migration file, in the order Supabase (and Kai, pasting) applies them. */
export const MIGRATIONS = readdirSync(DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort();

/**
 * What a Supabase project has before our first migration: the three API roles, auth.users, auth.uid()
 * reading the JWT claims the way PostgREST sets them, and Supabase's default privileges, which grant
 * every new table, sequence, and function in public to anon, authenticated, and service_role. Keeping
 * those defaults means a migration that forgets a revoke fails a test here instead of leaking in production.
 */
const SUPABASE = `
  set timezone to 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/** Applies one migration file, naming it when it fails. */
export async function migrate(db: PGlite, file: string): Promise<void> {
  try {
    await db.exec(readFileSync(new URL(file, DIR), "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

/** An in-process Postgres with the Supabase stand-in and the first `count` migrations (all by default). */
export async function freshDb(count = MIGRATIONS.length): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(SUPABASE);
  for (const file of MIGRATIONS.slice(0, count)) await migrate(db, file);
  return db;
}

/**
 * Runs one statement the way PostgREST runs a request: inside a transaction, as role authenticated with
 * the user's claims, or as anon when userId is null. The role ends with the transaction.
 */
export async function asUser<T>(db: PGlite, userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [
      userId ? "authenticated" : "anon",
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Runs one statement as the server's secret key does (service_role, which bypasses RLS). */
export async function asService<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('role', 'service_role', true)");
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** A signed-up user (a row in auth.users). Returns the user id. */
export async function addUser(db: PGlite): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.com`]);
  return id;
}

/** A new user and the clinic they create through public.create_clinic, as onboarding does. */
export async function newClinic(db: PGlite): Promise<{ userId: string; clinicId: string }> {
  const userId = await addUser(db);
  const payload: CreateClinicPayload = {
    name: "Sample Clinic",
    sms_name: "Sample Clinic",
    slug: `c-${randomUUID().slice(0, 8)}`,
    mobile: "+639170000001",
    address: "Makati",
    dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    hours: [{ weekday: 1, start: "09:00", end: "17:00" }],
    procedures: [{ name: "Consultation", minutes: 30 }],
  };
  const [row] = await asUser<{ id: string }>(db, userId, "select public.create_clinic($1::jsonb) as id", [JSON.stringify(payload)]);
  return { userId, clinicId: row.id };
}
```

The clinic's short name is "Sample Clinic" because the schema refuses short names that start with "test".

Run: `npx vitest run tests/sql/isolation.test.ts`
Expected: PASS (7 tests), in a few seconds. If a migration fails to apply, the error starts with its file name.

- [ ] **Step 4: Run the SQL tests with the unit tests**

In `package.json`, replace:

```json
    "test": "vitest run tests/unit",
```

with:

```json
    "test": "vitest run tests/unit tests/sql",
```

In `README.md`, replace:

```markdown
| `npm test` | Unit tests, no network needed |
```

with:

```markdown
| `npm test` | Unit tests and the offline database tests (`tests/sql`, PGlite), no network needed |
```

Run: `npm test`
Expected: every unit test file and `tests/sql/isolation.test.ts` PASS.

- [ ] **Step 5: Say how database changes are tested now**

In `CONTRIBUTING.md`, replace:

```markdown
- `npm run test:db` when you touched `supabase/migrations` or `tests/db`.
```

with:

```markdown
- Nothing extra for a migration: `npm test` runs the offline database tests in `tests/sql`.
- `npm run test:db` and `npm run test:e2e` only once a development Supabase project exists; both refuse production.
```

and replace:

```markdown
- [ ] `npm run test:db` passes (migrations or `tests/db` changed)
```

with:

```markdown
- [ ] The migration has a test in `tests/sql` (migrations changed)
```

and replace:

```markdown
There is no local Supabase, so development and the database tests share one Supabase project. `npm run db:push` changes it the moment you run it, before anyone reviews.

- Never edit a migration that has been pushed. Add a new one.
- Name migrations `YYYYMMDDHHMMSS_what.sql` in `supabase/migrations`.
- A new table gets RLS and its per-clinic access rules in the same PR, with a test in `tests/db`.
- Say in the PR that the migration is already on the development project. When two open PRs both change the database, merge them one at a time and rerun `npm run test:db` after each.
- Production migrations run only from `main`, after the merge.
```

with:

```markdown
There is no development Supabase project (the first one became production) and no Docker, so migrations are proven offline: `tests/sql/harness.ts` applies every file in `supabase/migrations`, in order, to an in-process Postgres (PGlite) with a stand-in for Supabase's roles, `auth.uid()`, and default privileges, and the tests in `tests/sql` run SQL as signed-in users and as visitors. `npm test` runs them.

- Never edit a migration that production already has. Add a new one.
- Name migrations `YYYYMMDDHHMMSS_what.sql` in `supabase/migrations`.
- A new table gets RLS, explicit grants, and its per-clinic access rules in the same PR, with a test in `tests/sql`. Supabase grants new tables to `anon` and `authenticated` by default, and so does the harness, so a forgotten revoke fails a test.
- Kai pastes a reviewed migration into the production SQL Editor just before merging the PR that needs it, because every merge to `main` deploys. Never run `npm run db:push`: the only project is production.
- When two open PRs both change the database, merge them one at a time.
```

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json tests/sql/harness.ts tests/sql/isolation.test.ts README.md CONTRIBUTING.md
git commit -m "test: prove migrations offline with PGlite" -m "There is no development Supabase project any more, so tests/sql applies every migration to an in-process Postgres with Supabase's roles, auth.uid(), and default privileges, and re-proves clinic isolation, the anon lockout, and the double booking guard. npm test runs them with the unit tests."
```

### Task 2: The billing migration

**Files:**
- Create: `supabase/migrations/20260925000200_billing.sql`, `tests/sql/billing.test.ts`
- Modify: `src/lib/onboarding.ts` (doc comment only)

**Interfaces:**
- Consumes: the harness from Task 1; `public.clinics` (with `created_at`), `public.is_clinic_member(uuid)` and `public.create_clinic(jsonb)` as last defined in `supabase/migrations/20260922000200_access.sql` (the later migrations never redefine them); `public.sms_log`, `public.dentists`, `auth.users`.
- Produces (SQL):
  - Table `public.clinic_billing (clinic_id uuid primary key references clinics on delete cascade, trial_ends_at timestamptz not null, paid_through timestamptz, renewal_notice_for timestamptz, created_at timestamptz not null default now())`
  - Table `public.payments (id uuid primary key, clinic_id uuid not null references clinics on delete cascade, method text ('gcash' or 'paymongo'), amount_centavos integer (above 0), months integer (1 to 12), reference text (1 to 100 characters), provider_session_id text unique, recorded_by uuid references auth.users on delete set null, paid_through_after timestamptz not null, paid_at timestamptz not null default now())`
  - `public.create_clinic(p jsonb) returns uuid`: unchanged, plus the clinic's `clinic_billing` row with `trial_ends_at = now() + 14 days`
  - `public.record_payment(p_clinic_id uuid, p_method text, p_amount_centavos integer, p_months integer, p_reference text, p_session_id text, p_recorded_by uuid) returns jsonb`: `{"status": "ok" | "duplicate", "paid_through": timestamptz}`, `service_role` only
  - `public.extend_trial(p_clinic_id uuid, p_days integer) returns timestamptz`: the new trial end, `service_role` only
  - `public.admin_overview(p_month_start timestamptz) returns table (id uuid, name text, slug text, created_at timestamptz, trial_ends_at timestamptz, paid_through timestamptz, active_dentists integer, credits integer, last_paid_at timestamptz, last_months integer, last_amount_centavos integer, last_method text)`, `service_role` only

Rules (spec 6):
- Both tables have RLS on. Members of the clinic may select their rows (`public.is_clinic_member`). The grants are explicit: `authenticated` gets `select` only, `anon` nothing, `service_role` everything. Supabase's default privileges would otherwise grant new tables to `anon` and `authenticated` in full; the harness has the same defaults, so the write tests below fail if a revoke goes missing.
- `create_clinic` is replaced with `create or replace`, copied from `20260922000200_access.sql` plus one insert, and keeps its grants (`authenticated` only).
- The backfill gives every clinic without a row `trial_ends_at = clinics.created_at + 14 days` (production had no clinics when this was written, so it is a safety net).
- `record_payment`, in one transaction: locks the clinic's row (`select ... for update`); if `p_session_id` is already recorded, answers `duplicate` and changes nothing; otherwise sets `paid_through` to the latest of `paid_through`, `trial_ends_at`, and now, plus `p_months` months, clears `renewal_notice_for`, and inserts the payment. The unique `provider_session_id` backs up the duplicate check if two deliveries race. A clinic without a billing row (none should exist after the backfill) first gets one whose trial ended at signup (spec 11), so a payment never fails for that reason; an unknown clinic raises `P0002`.
- `extend_trial` adds days from the later of the trial end and now (spec 7.6).
- `admin_overview` returns one row per clinic for `/admin`: dates, active dentists, credits of texts with status `sent` since `p_month_start`, and the last payment. It aggregates in SQL because the API returns at most 1000 rows per request, which a month of `sms_log` rows soon passes.
- All three functions are `security invoker` with `search_path = ''`, revoked from `public`, `anon`, and `authenticated`, and granted to `service_role`, like `issue_otp` in `20260925000100_otp_issue_lock.sql`.
- `sms_log.kind` has no check constraint, so the new `renewal` kind (Task 8) needs no migration.

- [ ] **Step 1: Write the failing tests**

Create `tests/sql/billing.test.ts`:

```ts
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { addUser, asService, asUser, freshDb, migrate, MIGRATIONS, newClinic } from "./harness";

type Clinic = { userId: string; clinicId: string };
type Payment = { status: "ok" | "duplicate"; paid_through: string | null };

const BILLING = "20260925000200_billing.sql";

let db: PGlite;
let a: Clinic;
let b: Clinic;
let operator: string;

/** record_payment through the secret key, as the admin page and the webhook call it. */
async function pay(clinicId: string, months: number, sessionId: string | null = null): Promise<Payment> {
  const [row] = await asService<{ r: Payment }>(db, "select public.record_payment($1, $2, $3, $4, $5, $6, $7) as r", [
    clinicId,
    sessionId ? "paymongo" : "gcash",
    39900 * months,
    months,
    sessionId ?? "GCASH-REF-1",
    sessionId,
    sessionId ? null : operator,
  ]);
  return row.r;
}

/** Sets a clinic's dates directly, as the table owner. */
async function setDates(clinicId: string, trialEndsAt: string, paidThrough: string | null) {
  await db.query("update public.clinic_billing set trial_ends_at = $2, paid_through = $3 where clinic_id = $1", [clinicId, trialEndsAt, paidThrough]);
}

beforeAll(async () => {
  db = await freshDb();
  a = await newClinic(db);
  b = await newClinic(db);
  operator = await addUser(db);
}, 60_000);

describe("create_clinic", () => {
  it("starts a 14 day trial with nothing paid", async () => {
    const [row] = await asUser<{ trial: boolean; paid_through: string | null; renewal_notice_for: string | null }>(
      db,
      a.userId,
      `select b.trial_ends_at = c.created_at + interval '14 days' as trial, b.paid_through, b.renewal_notice_for
       from public.clinic_billing b join public.clinics c on c.id = b.clinic_id`,
    );
    expect(row).toEqual({ trial: true, paid_through: null, renewal_notice_for: null });
  });
});

describe("the backfill", () => {
  it("gives clinics from before billing 14 days from their signup", async () => {
    const early = await freshDb(MIGRATIONS.indexOf(BILLING));
    const [clinic] = (
      await early.query<{ id: string }>(
        "insert into public.clinics (name, sms_name, slug, mobile, created_at) values ('Old', 'Old', 'old-clinic', '+639170000003', '2026-09-01T00:00:00Z') returning id",
      )
    ).rows;
    await migrate(early, BILLING);
    const { rows } = await early.query<{ trial_ends_at: Date }>("select trial_ends_at from public.clinic_billing where clinic_id = $1", [clinic.id]);
    expect(rows).toEqual([{ trial_ends_at: new Date("2026-09-15T00:00:00Z") }]);
    await early.close();
  });
});

describe("billing access", () => {
  beforeAll(async () => {
    await pay(a.clinicId, 1);
    await pay(b.clinicId, 3);
  });

  it("lets members read their own billing and payments, and nobody else's", async () => {
    expect(await asUser(db, a.userId, "select clinic_id from public.clinic_billing")).toEqual([{ clinic_id: a.clinicId }]);
    expect(await asUser(db, a.userId, "select clinic_id, months from public.payments")).toEqual([{ clinic_id: a.clinicId, months: 1 }]);
    expect(await asUser(db, b.userId, "select clinic_id, months from public.payments")).toEqual([{ clinic_id: b.clinicId, months: 3 }]);
  });

  it("never lets members write either table, not even their own rows", async () => {
    const writes = [
      "insert into public.clinic_billing (clinic_id, trial_ends_at) values ($1, now())",
      "update public.clinic_billing set paid_through = '2099-01-01' where clinic_id = $1",
      "delete from public.clinic_billing where clinic_id = $1",
      "insert into public.payments (clinic_id, method, amount_centavos, months, reference, paid_through_after) values ($1, 'gcash', 100, 1, 'x', now())",
      "update public.payments set months = 12 where clinic_id = $1",
      "delete from public.payments where clinic_id = $1",
    ];
    for (const sql of writes) {
      await expect(asUser(db, a.userId, sql, [a.clinicId]), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("lets only the secret key record payments, extend trials, or list every clinic", async () => {
    for (const user of [a.userId, null]) {
      await expect(
        asUser(db, user, "select public.record_payment($1, 'gcash', 100, 12, 'x', null, null)", [a.clinicId]),
      ).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, "select public.extend_trial($1, 365)", [a.clinicId])).rejects.toThrow(/permission denied/);
      await expect(asUser(db, user, "select * from public.admin_overview(now())")).rejects.toThrow(/permission denied/);
    }
  });
});

describe("record_payment", () => {
  it("extends from paid_through when the plan is paid ahead", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2030-01-01T00:00:00Z", "2030-01-15T00:00:00Z");
    expect(await pay(c.clinicId, 3)).toEqual({ status: "ok", paid_through: "2030-04-15T00:00:00+00:00" });
    const [row] = await db.query<{ renewal_notice_for: Date | null; paid_through_after: Date; reference: string; recorded_by: string }>(
      `select b.renewal_notice_for, p.paid_through_after, p.reference, p.recorded_by
       from public.clinic_billing b join public.payments p on p.clinic_id = b.clinic_id where b.clinic_id = $1`,
      [c.clinicId],
    ).then((r) => r.rows);
    expect(row).toEqual({
      renewal_notice_for: null,
      paid_through_after: new Date("2030-04-15T00:00:00Z"),
      reference: "GCASH-REF-1",
      recorded_by: operator,
    });
  });

  it("keeps the trial days when paid during the trial", async () => {
    const c = await newClinic(db);
    await pay(c.clinicId, 1);
    const [row] = await db.query<{ exact: boolean }>(
      "select paid_through = trial_ends_at + interval '1 month' as exact from public.clinic_billing where clinic_id = $1",
      [c.clinicId],
    ).then((r) => r.rows);
    expect(row.exact).toBe(true);
  });

  it("starts from now after a lapse", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    // One statement, so the function's now() and this now() are the same instant.
    const [row] = await asService<{ exact: boolean }>(
      db,
      "select (public.record_payment($1, 'gcash', 39900, 1, 'GCASH-REF-2', null, null) ->> 'paid_through')::timestamptz = now() + interval '1 month' as exact",
      [c.clinicId],
    );
    expect(row.exact).toBe(true);
  });

  it("records a PayMongo session once, however often the webhook comes", async () => {
    const c = await newClinic(db);
    const first = await pay(c.clinicId, 6, "cs_test_once");
    expect(first.status).toBe("ok");
    expect(await pay(c.clinicId, 6, "cs_test_once")).toEqual({ status: "duplicate", paid_through: first.paid_through });
    const { rows } = await db.query("select id from public.payments where provider_session_id = 'cs_test_once'");
    expect(rows).toHaveLength(1);
  });

  it("changes nothing when the payment itself is invalid", async () => {
    const c = await newClinic(db);
    await expect(pay(c.clinicId, 13)).rejects.toThrow(/payments_months_check/);
    const { rows } = await db.query<{ paid_through: Date | null }>("select paid_through from public.clinic_billing where clinic_id = $1", [c.clinicId]);
    expect(rows).toEqual([{ paid_through: null }]);
  });
});

describe("extend_trial", () => {
  it("adds days to a running trial, and counts from now once it ended", async () => {
    const c = await newClinic(db);
    await setDates(c.clinicId, "2030-01-01T00:00:00Z", null);
    const [running] = await asService<{ t: Date }>(db, "select public.extend_trial($1, 10) as t", [c.clinicId]);
    expect(running.t).toEqual(new Date("2030-01-11T00:00:00Z"));
    await setDates(c.clinicId, "2026-01-01T00:00:00Z", null);
    const [ended] = await asService<{ exact: boolean }>(db, "select public.extend_trial($1, 7) = now() + interval '7 days' as exact", [c.clinicId]);
    expect(ended.exact).toBe(true);
  });
});

describe("admin_overview", () => {
  it("lists each clinic with its dates, active dentists, credits sent this month, and last payment", async () => {
    const c = await newClinic(db);
    const quiet = await newClinic(db);
    await db.query(
      "insert into public.dentists (clinic_id, name, sms_name, active) values ($1, 'Dr. Two', 'Dr. Two', true), ($1, 'Dr. Gone', 'Dr. Gone', false)",
      [c.clinicId],
    );
    const text = (createdAt: string, status: string, credits: number) =>
      db.query(
        "insert into public.sms_log (clinic_id, to_mobile, kind, body, credits, status, created_at) values ($1, '+639171112222', 'confirmed', 'x', $2, $3, $4)",
        [c.clinicId, credits, status, createdAt],
      );
    await text("2026-09-10T02:00:00Z", "sent", 1);
    await text("2026-09-11T02:00:00Z", "sent", 2);
    await text("2026-08-31T15:59:59Z", "sent", 1); // Aug 31, 11:59 PM Manila: last month
    await text("2026-09-12T02:00:00Z", "logged", 1);
    await text("2026-09-13T02:00:00Z", "failed", 0);
    await pay(c.clinicId, 1);
    await pay(c.clinicId, 3);

    const rows = await asService<{ id: string; [key: string]: unknown }>(db, "select * from public.admin_overview($1)", [
      "2026-08-31T16:00:00Z", // Sep 1, 00:00 Manila
    ]);
    expect(rows.find((r) => r.id === c.clinicId)).toMatchObject({
      name: "Sample Clinic",
      active_dentists: 2,
      credits: 3,
      last_months: 3,
      last_amount_centavos: 119_700,
      last_method: "gcash",
    });
    expect(rows.find((r) => r.id === quiet.clinicId)).toMatchObject({ active_dentists: 1, credits: 0, last_paid_at: null, last_months: null });
  });
});
```

The "starts from now" and "extend_trial" cases compare inside one statement because a function's `now()` is the transaction's start: one statement means one instant, so the comparison is exact and never flaky.

Run: `npx vitest run tests/sql/billing.test.ts`
Expected: FAIL. The backfill test cannot read `20260925000200_billing.sql` (`ENOENT`), and the rest fail on `relation "public.clinic_billing" does not exist` or `function public.record_payment(...) does not exist`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260925000200_billing.sql`:

```sql
-- Billing (billing spec section 6): each clinic's trial and paid-through dates, the payments that extend
-- them, and the functions that change them. Staff read their own clinic's rows and never write them: only
-- the server's secret key (service_role) writes billing, through record_payment and extend_trial.

create table public.clinic_billing (
  clinic_id uuid primary key references public.clinics (id) on delete cascade,
  trial_ends_at timestamptz not null,
  paid_through timestamptz,
  -- The ends_at a heads-up was already sent for (billing spec 7.4).
  renewal_notice_for timestamptz,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  method text not null check (method in ('gcash', 'paymongo')),
  -- What was actually paid, so a price change never rewrites history.
  amount_centavos integer not null check (amount_centavos > 0),
  months integer not null check (months between 1 and 12),
  -- The GCash reference number, or the PayMongo checkout session id.
  reference text not null check (char_length(reference) between 1 and 100),
  -- Unique, so a webhook delivered twice can never record twice (null for GCash).
  provider_session_id text unique,
  -- The operator who recorded a GCash payment; null for PayMongo.
  recorded_by uuid references auth.users (id) on delete set null,
  paid_through_after timestamptz not null,
  paid_at timestamptz not null default now()
);
create index payments_clinic_time on public.payments (clinic_id, paid_at);

alter table public.clinic_billing enable row level security;
alter table public.payments enable row level security;

create policy "members read their billing" on public.clinic_billing
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "members read their payments" on public.payments
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

-- Explicit grants: Supabase's default privileges would otherwise give anon and authenticated everything
-- on new tables. Staff may only read; the secret key writes.
revoke all on public.clinic_billing, public.payments from public, anon, authenticated;
grant select on public.clinic_billing, public.payments to authenticated;
grant all on public.clinic_billing, public.payments to service_role;

-- Onboarding also starts the 14 day trial (billing spec 6). The rest is 20260922000200_access.sql unchanged.
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

  insert into public.clinic_members (clinic_id, user_id) values (v_clinic, v_user);

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

-- Clinics that signed up before billing get their 14 days from signup.
insert into public.clinic_billing (clinic_id, trial_ends_at)
select id, created_at + interval '14 days' from public.clinics
on conflict (clinic_id) do nothing;

-- Records one payment in one transaction (billing spec 6). A payment extends from the latest of
-- paid_through, trial_ends_at, and now, so paying during the trial keeps the trial days and paying after
-- a lapse starts today. A PayMongo session id already recorded changes nothing and answers 'duplicate';
-- the unique provider_session_id backs that up if two deliveries race.
create function public.record_payment(
  p_clinic_id uuid,
  p_method text,
  p_amount_centavos integer,
  p_months integer,
  p_reference text,
  p_session_id text,
  p_recorded_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_trial timestamptz;
  v_paid timestamptz;
  v_after timestamptz;
begin
  -- A clinic without a billing row (none should exist after the backfill) counts as a trial that ended at signup.
  insert into public.clinic_billing (clinic_id, trial_ends_at)
  select id, created_at from public.clinics where id = p_clinic_id
  on conflict (clinic_id) do nothing;

  select trial_ends_at, paid_through into v_trial, v_paid
  from public.clinic_billing
  where clinic_id = p_clinic_id
  for update;
  if not found then
    raise exception 'clinic not found' using errcode = 'P0002';
  end if;

  if p_session_id is not null and exists (select 1 from public.payments where provider_session_id = p_session_id) then
    return jsonb_build_object('status', 'duplicate', 'paid_through', v_paid);
  end if;

  v_after := greatest(coalesce(v_paid, '-infinity'::timestamptz), v_trial, now()) + make_interval(months => p_months);

  update public.clinic_billing
  set paid_through = v_after, renewal_notice_for = null
  where clinic_id = p_clinic_id;

  insert into public.payments
    (clinic_id, method, amount_centavos, months, reference, provider_session_id, recorded_by, paid_through_after)
  values
    (p_clinic_id, p_method, p_amount_centavos, p_months, p_reference, p_session_id, p_recorded_by, v_after);

  return jsonb_build_object('status', 'ok', 'paid_through', v_after);
end;
$$;
revoke execute on function public.record_payment(uuid, text, integer, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.record_payment(uuid, text, integer, integer, text, text, uuid) to service_role;

-- The operator extends a trial by some days, from the later of its end and now (billing spec 7.6).
create function public.extend_trial(p_clinic_id uuid, p_days integer)
returns timestamptz
language sql
security invoker
set search_path = ''
as $$
  insert into public.clinic_billing (clinic_id, trial_ends_at)
  select id, now() + make_interval(days => p_days) from public.clinics where id = p_clinic_id
  on conflict (clinic_id) do update
    set trial_ends_at = greatest(public.clinic_billing.trial_ends_at, now()) + make_interval(days => p_days)
  returning trial_ends_at;
$$;
revoke execute on function public.extend_trial(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_trial(uuid, integer) to service_role;

-- The admin page's list (billing spec 7.6): one row per clinic with its dates, active dentists, credits of
-- texts sent since p_month_start, and its last payment. Aggregated here because the API returns at most
-- 1000 rows per request, which a month of texts soon passes.
create function public.admin_overview(p_month_start timestamptz)
returns table (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  trial_ends_at timestamptz,
  paid_through timestamptz,
  active_dentists integer,
  credits integer,
  last_paid_at timestamptz,
  last_months integer,
  last_amount_centavos integer,
  last_method text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id, c.name, c.slug, c.created_at, b.trial_ends_at, b.paid_through,
    (select count(*)::int from public.dentists d where d.clinic_id = c.id and d.active),
    (select coalesce(sum(s.credits), 0)::int from public.sms_log s
      where s.clinic_id = c.id and s.status = 'sent' and s.created_at >= p_month_start),
    p.paid_at, p.months, p.amount_centavos, p.method
  from public.clinics c
  left join public.clinic_billing b on b.clinic_id = c.id
  left join lateral (
    select x.paid_at, x.months, x.amount_centavos, x.method from public.payments x
    where x.clinic_id = c.id order by x.paid_at desc limit 1
  ) p on true
  order by c.created_at desc;
$$;
revoke execute on function public.admin_overview(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
```

Run: `npx vitest run tests/sql`
Expected: PASS, 12 tests in `billing.test.ts` and 7 in `isolation.test.ts` (the isolation sweep now also checks `clinic_billing` and `payments`, and the visitor checks cover the new tables and functions).

- [ ] **Step 3: Point the onboarding payload type at the new definition**

In `src/lib/onboarding.ts`, replace:

```ts
/** The jsonb argument of public.create_clinic (supabase/migrations/20260922000200_access.sql). */
```

with:

```ts
/** The jsonb argument of public.create_clinic (latest definition: supabase/migrations/20260925000200_billing.sql). */
```

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm test`
Expected: `tsc` prints nothing; every test PASS.

```powershell
git add supabase/migrations/20260925000200_billing.sql tests/sql/billing.test.ts src/lib/onboarding.ts
git commit -m "feat: add billing tables, trial rows, and payment functions" -m "clinic_billing and payments are readable by the clinic's members and writable only by the secret key. create_clinic starts a 14 day trial, record_payment extends from the latest of paid_through, the trial end, and now and records a PayMongo session once, and extend_trial and admin_overview serve the operator page. Proven offline in tests/sql."
```

### Task 3: Billing rules and loaders

**Files:**
- Create: `src/lib/billing.ts`, `src/lib/billing-data.ts`, `tests/unit/billing.test.ts`

**Interfaces:**
- Consumes: `formatDate`, `manilaDate`, `manilaInstant` from `@/lib/time`; `adminClient` from `@/lib/supabase/admin`; `type Staff` from `@/lib/supabase/server`; `logError` from `@/lib/log`; the tables from Task 2.
- Produces:
  - From `@/lib/billing` (pure, safe in Client Components): `TIERS` (a readonly tuple of `{ name, maxDentists, pesos }`: Solo 2 ₱399, Team 6 ₱1,299, Group `Infinity` ₱1,799), `type Tier = (typeof TIERS)[number]`, `MONTH_CHOICES = [1, 3, 6, 12] as const`, `GRACE_DAYS = 3`, `NOTICE_DAYS = 3`, `tierFor(activeDentists: number): Tier`, `amountCentavos(activeDentists: number, months: number): number`, `parseMonths(value: unknown): number | null`, `formatPesos(centavos: number): string`, `type Billing = { trialEndsAt: Date; paidThrough: Date | null }`, `type BillingRow = { trial_ends_at: string; paid_through: string | null }`, `billingFromRow(row: BillingRow | null, clinicCreatedAt: string): Billing`, `type BillingStatus = "active" | "trial" | "grace" | "lapsed"`, `type BillingState = { status: BillingStatus; endsAt: Date; pausesAt: Date; open: boolean }`, `billingStatus(billing: Billing, now: Date): BillingState`, `STATUS_LABEL`, `STATUS_CHIP` (both `Record<BillingStatus, string>`), `billingDate(instant: Date, now: Date): string`, `statusLine(state: BillingState, now: Date): string`, `bannerText(state: BillingState, now: Date): string | null`, `pausedMessage(clinicName: string, phone: string): string`, `manilaMonthStart(now: Date): Date`
  - From `@/lib/billing-data` (server only): `loadBillings(db: SupabaseClient, clinicIds: string[]): Promise<Map<string, Billing>>`, `loadBilling(db: SupabaseClient, clinicId: string): Promise<Billing>`, `bookingOpen(clinicId: string, now: Date): Promise<boolean>`, `billingBanner(staff: Staff, now: Date): Promise<string | null>`, `activeDentists(db: SupabaseClient, clinicId: string): Promise<number>`

Rules (spec 4, 5, 7.1, 7.5, 11):
- Tier by active dentists: 0 to 2 Solo ₱399, 3 to 6 Team ₱1,299, 7 or more Group ₱1,799. Amount = tier price x months, in centavos; months are whole numbers 1 to 12.
- `ends_at` is the later of `trial_ends_at` and `paid_through`. `active` while `paid_through` is after now; else `trial` while `trial_ends_at` is after now; else `grace` while now is less than 3 days after `ends_at`; else `lapsed`. Only `lapsed` closes the booking page. `pausesAt` is `ends_at` plus 3 days.
- A missing `clinic_billing` row counts as a trial that ended at the clinic's `created_at` (spec 11), so the clinic lands in grace or lapsed and the banner points to Billing instead of a crash.
- Words: the Billing page says "Free trial until {date}.", "Paid until {date}.", "Your plan ended {date}. Online booking pauses in {n} days." (grace), or "Your plan ended {date}. Online booking reopens when you pay." (lapsed). The banner says "Online booking is paused. Pay to reopen it." (lapsed), "Your plan ended. Online booking pauses on {date}." (grace), "Your plan ends on {date}." (3 days or less before the end), and nothing otherwise. Dates are `formatDate` ("Fri Oct 9"), with the year added when it is not the current Manila year, so a plan paid 12 months ahead never reads like this year's date.
- `bookingOpen` uses the secret key (the patient has no session); `billingBanner` uses the staff RLS client and never throws, so a failed billing read never takes the dashboard down.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/billing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  amountCentavos,
  bannerText,
  billingDate,
  billingFromRow,
  billingStatus,
  formatPesos,
  manilaMonthStart,
  parseMonths,
  pausedMessage,
  statusLine,
  tierFor,
  type Billing,
} from "@/lib/billing";
import { manilaInstant } from "@/lib/time";

const DAY = 24 * 60 * 60 * 1000;
const trialEnd = manilaInstant("2026-10-09", 600); // Fri Oct 9, 10:00 AM
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const trial: Billing = { trialEndsAt: trialEnd, paidThrough: null };

describe("tierFor and amountCentavos", () => {
  it("prices by active dentists, with no dentists paying Solo", () => {
    expect([0, 1, 2, 3, 6, 7, 40].map((n) => tierFor(n).name)).toEqual(["Solo", "Solo", "Solo", "Team", "Team", "Group", "Group"]);
    expect(amountCentavos(0, 1)).toBe(39_900);
    expect(amountCentavos(2, 12)).toBe(478_800);
    expect(amountCentavos(3, 1)).toBe(129_900);
    expect(amountCentavos(6, 3)).toBe(389_700);
    expect(amountCentavos(7, 1)).toBe(179_900);
    expect(amountCentavos(7, 12)).toBe(2_158_800);
  });

  it("multiplies the monthly price for every month from 1 to 12", () => {
    for (let months = 1; months <= 12; months++) expect(amountCentavos(4, months)).toBe(129_900 * months);
  });
});

describe("parseMonths", () => {
  it("accepts whole months from 1 to 12, as numbers or form text", () => {
    expect([1, "3", " 6 ", 12, "01"].map(parseMonths)).toEqual([1, 3, 6, 12, 1]);
  });

  it("refuses everything else", () => {
    for (const bad of [0, 13, 3.5, "1.5", "", "abc", "100", null, undefined, {}]) expect(parseMonths(bad)).toBeNull();
  });
});

describe("formatPesos", () => {
  it("writes pesos with thousands separators and centavos only when there are some", () => {
    expect(formatPesos(39_900)).toBe("₱399");
    expect(formatPesos(129_900)).toBe("₱1,299");
    expect(formatPesos(2_158_800)).toBe("₱21,588");
    expect(formatPesos(119_750)).toBe("₱1,197.50");
    expect(formatPesos(5)).toBe("₱0.05");
    expect(formatPesos(100_000_000)).toBe("₱1,000,000");
  });
});

describe("billingFromRow", () => {
  it("reads the row, and treats a missing row as a trial that ended at signup", () => {
    expect(billingFromRow({ trial_ends_at: trialEnd.toISOString(), paid_through: null }, "2026-09-25T02:00:00Z")).toEqual(trial);
    expect(billingFromRow(null, "2026-09-25T02:00:00Z")).toEqual({ trialEndsAt: new Date("2026-09-25T02:00:00Z"), paidThrough: null });
  });
});

describe("billingStatus", () => {
  it("is trial until the trial ends, then 3 days of grace, then lapsed", () => {
    expect(billingStatus(trial, at(trialEnd, -1))).toEqual({ status: "trial", endsAt: trialEnd, pausesAt: at(trialEnd, 3 * DAY), open: true });
    expect(billingStatus(trial, trialEnd).status).toBe("grace");
    expect(billingStatus(trial, at(trialEnd, 3 * DAY - 1))).toMatchObject({ status: "grace", open: true });
    expect(billingStatus(trial, at(trialEnd, 3 * DAY))).toMatchObject({ status: "lapsed", open: false });
  });

  it("is active while paid through is ahead, then grace from paid through", () => {
    const paid = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2027-01-09", 600) };
    expect(billingStatus(paid, at(paid.paidThrough, -1))).toMatchObject({ status: "active", endsAt: paid.paidThrough, open: true });
    expect(billingStatus(paid, paid.paidThrough)).toMatchObject({ status: "grace", open: true });
    expect(billingStatus(paid, at(paid.paidThrough, 3 * DAY))).toMatchObject({ status: "lapsed", open: false });
  });

  it("counts a payment made during the trial as active, ending after the trial", () => {
    const paidDuringTrial = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2026-11-09", 600) };
    expect(billingStatus(paidDuringTrial, manilaInstant("2026-09-30", 600))).toMatchObject({ status: "active", endsAt: paidDuringTrial.paidThrough });
  });

  it("ends at the later date when a trial was extended past an old payment", () => {
    const extended = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2026-09-01", 600) };
    expect(billingStatus(extended, manilaInstant("2026-10-01", 600))).toMatchObject({ status: "trial", endsAt: trialEnd });
  });
});

describe("the words", () => {
  const now = manilaInstant("2026-10-07", 600);

  it("dates this year without the year, and other years with it", () => {
    expect(billingDate(trialEnd, now)).toBe("Fri Oct 9");
    expect(billingDate(manilaInstant("2027-09-30", 600), now)).toBe("Thu Sep 30, 2027");
  });

  it("says where the plan stands on the Billing page", () => {
    expect(statusLine(billingStatus(trial, now), now)).toBe("Free trial until Fri Oct 9.");
    const paid = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2027-03-03", 600) };
    expect(statusLine(billingStatus(paid, now), now)).toBe("Paid until Wed Mar 3, 2027.");
    const graceNow = at(trialEnd, 2 * DAY);
    expect(statusLine(billingStatus(trial, graceNow), graceNow)).toBe("Your plan ended Fri Oct 9. Online booking pauses in 1 day.");
    expect(statusLine(billingStatus(trial, at(trialEnd, 1)), at(trialEnd, 1))).toBe("Your plan ended Fri Oct 9. Online booking pauses in 3 days.");
    const lapsedNow = at(trialEnd, 4 * DAY);
    expect(statusLine(billingStatus(trial, lapsedNow), lapsedNow)).toBe("Your plan ended Fri Oct 9. Online booking reopens when you pay.");
  });

  it("shows the banner only from 3 days before the end", () => {
    const early = at(trialEnd, -3 * DAY - 1);
    expect(bannerText(billingStatus(trial, early), early)).toBeNull();
    const threeDays = at(trialEnd, -3 * DAY);
    expect(bannerText(billingStatus(trial, threeDays), threeDays)).toBe("Your plan ends on Fri Oct 9.");
    const grace = at(trialEnd, DAY);
    expect(bannerText(billingStatus(trial, grace), grace)).toBe("Your plan ended. Online booking pauses on Mon Oct 12.");
    const lapsed = at(trialEnd, 3 * DAY);
    expect(bannerText(billingStatus(trial, lapsed), lapsed)).toBe("Online booking is paused. Pay to reopen it.");
  });

  it("tells patients of a paused clinic to call", () => {
    expect(pausedMessage("Bright Dental", "09171234567")).toBe("Bright Dental is not taking online requests right now. Call 09171234567 to book.");
  });
});

describe("manilaMonthStart", () => {
  it("is 00:00 Manila on the 1st, whatever the UTC date", () => {
    expect(manilaMonthStart(manilaInstant("2026-10-01", 30))).toEqual(manilaInstant("2026-10-01", 0)); // still Sep 30 in UTC
    expect(manilaMonthStart(manilaInstant("2026-09-30", 23 * 60))).toEqual(manilaInstant("2026-09-01", 0));
  });
});
```

Run: `npx vitest run tests/unit/billing.test.ts`
Expected: FAIL, `@/lib/billing` does not exist.

- [ ] **Step 2: Write the rules**

Create `src/lib/billing.ts`:

```ts
import { formatDate, manilaDate, manilaInstant } from "@/lib/time";

/** Billing spec 4: the price by active dentists at the time of payment. Change prices here; no migration needed. */
export const TIERS = [
  { name: "Solo", maxDentists: 2, pesos: 399 },
  { name: "Team", maxDentists: 6, pesos: 1299 },
  { name: "Group", maxDentists: Infinity, pesos: 1799 },
] as const;
export type Tier = (typeof TIERS)[number];

/** What the Billing page offers. The database accepts any 1 to 12. */
export const MONTH_CHOICES = [1, 3, 6, 12] as const;
/** Days after the plan ends before the booking page pauses (spec 5). */
export const GRACE_DAYS = 3;
/** The banner and the heads-up start this many days before the end (spec 7.4, 7.5). */
export const NOTICE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A clinic with no active dentists pays the Solo price. */
export function tierFor(activeDentists: number): Tier {
  return TIERS.find((t) => activeDentists <= t.maxDentists) ?? TIERS[TIERS.length - 1];
}

/** Tier price times months, in centavos (spec 4). */
export function amountCentavos(activeDentists: number, months: number): number {
  return tierFor(activeDentists).pesos * 100 * months;
}

/** Whole months from 1 to 12, from a form value or PayMongo metadata, or null. */
export function parseMonths(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

/** "₱1,299" or "₱1,299.50". Built by hand, like formatDate, so every runtime prints the same. */
export function formatPesos(centavos: number): string {
  const pesos = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = centavos % 100;
  return `₱${pesos}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

export type Billing = { trialEndsAt: Date; paidThrough: Date | null };
export type BillingRow = { trial_ends_at: string; paid_through: string | null };

/** A clinic_billing row as dates. A missing row counts as a trial that ended at signup (spec 11). */
export function billingFromRow(row: BillingRow | null, clinicCreatedAt: string): Billing {
  if (!row) return { trialEndsAt: new Date(clinicCreatedAt), paidThrough: null };
  return { trialEndsAt: new Date(row.trial_ends_at), paidThrough: row.paid_through ? new Date(row.paid_through) : null };
}

export type BillingStatus = "active" | "trial" | "grace" | "lapsed";
export type BillingState = { status: BillingStatus; endsAt: Date; pausesAt: Date; open: boolean };

/**
 * Spec 5, the one place the rule lives: active while paid_through is ahead, then trial while the trial is,
 * then 3 days of grace after the later of the two, then lapsed. Only lapsed closes the booking page.
 */
export function billingStatus({ trialEndsAt, paidThrough }: Billing, now: Date): BillingState {
  const endsAt = paidThrough && paidThrough > trialEndsAt ? paidThrough : trialEndsAt;
  const pausesAt = new Date(endsAt.getTime() + GRACE_DAYS * DAY_MS);
  const t = now.getTime();
  const status: BillingStatus =
    paidThrough && paidThrough.getTime() > t
      ? "active"
      : trialEndsAt.getTime() > t
        ? "trial"
        : t < pausesAt.getTime()
          ? "grace"
          : "lapsed";
  return { status, endsAt, pausesAt, open: status !== "lapsed" };
}

/** Status words, so a chip never rests on colour alone. */
export const STATUS_LABEL: Record<BillingStatus, string> = { active: "Paid", trial: "Free trial", grace: "Plan ended", lapsed: "Booking paused" };
export const STATUS_CHIP: Record<BillingStatus, string> = { active: "chip-green", trial: "chip-blue", grace: "chip-amber", lapsed: "chip-red" };

/** "Fri Oct 9", with the year when it is not this year ("Thu Sep 30, 2027"). */
export function billingDate(instant: Date, now: Date): string {
  const year = manilaDate(instant).slice(0, 4);
  return year === manilaDate(now).slice(0, 4) ? formatDate(instant) : `${formatDate(instant)}, ${year}`;
}

/** The Billing page's status line (spec 7.1). */
export function statusLine(state: BillingState, now: Date): string {
  const ends = billingDate(state.endsAt, now);
  if (state.status === "active") return `Paid until ${ends}.`;
  if (state.status === "trial") return `Free trial until ${ends}.`;
  if (state.status === "lapsed") return `Your plan ended ${ends}. Online booking reopens when you pay.`;
  const days = Math.max(1, Math.ceil((state.pausesAt.getTime() - now.getTime()) / DAY_MS));
  return `Your plan ended ${ends}. Online booking pauses in ${days} ${days === 1 ? "day" : "days"}.`;
}

/** The dashboard banner (spec 7.5), or null when the plan has more than 3 days left. */
export function bannerText(state: BillingState, now: Date): string | null {
  if (state.status === "lapsed") return "Online booking is paused. Pay to reopen it.";
  if (state.status === "grace") return `Your plan ended. Online booking pauses on ${billingDate(state.pausesAt, now)}.`;
  if (state.endsAt.getTime() - now.getTime() <= NOTICE_DAYS * DAY_MS) return `Your plan ends on ${billingDate(state.endsAt, now)}.`;
  return null;
}

/** What a lapsed clinic's booking page and booking actions say (spec 7.5). */
export function pausedMessage(clinicName: string, phone: string): string {
  return `${clinicName} is not taking online requests right now. Call ${phone} to book.`;
}

/** The first instant of the Manila calendar month (the admin page counts texts from it). */
export function manilaMonthStart(now: Date): Date {
  return manilaInstant(`${manilaDate(now).slice(0, 7)}-01`, 0);
}
```

Run: `npx vitest run tests/unit/billing.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 3: Write the loaders**

Create `src/lib/billing-data.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bannerText, billingFromRow, billingStatus, type Billing, type BillingRow } from "@/lib/billing";
import { logError } from "@/lib/log";
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";

/**
 * Each clinic's billing, with the missing-row rule (billing spec 11). Staff pages pass their RLS client (members
 * read their own clinic and its billing row); the public booking flow and the daily job pass the secret-key client.
 */
export async function loadBillings(db: SupabaseClient, clinicIds: string[]): Promise<Map<string, Billing>> {
  if (clinicIds.length === 0) return new Map();
  const [clinics, rows] = await Promise.all([
    db.from("clinics").select("id, created_at").in("id", clinicIds).throwOnError(),
    db.from("clinic_billing").select("clinic_id, trial_ends_at, paid_through").in("clinic_id", clinicIds).throwOnError(),
  ]);
  const byClinic = new Map((rows.data as (BillingRow & { clinic_id: string })[]).map((r) => [r.clinic_id, r]));
  return new Map(
    (clinics.data as { id: string; created_at: string }[]).map((c) => [c.id, billingFromRow(byClinic.get(c.id) ?? null, c.created_at)]),
  );
}

/** One clinic's billing. Throws when the clinic does not exist (or is not the staff member's). */
export async function loadBilling(db: SupabaseClient, clinicId: string): Promise<Billing> {
  const billing = (await loadBillings(db, [clinicId])).get(clinicId);
  if (!billing) throw new Error("clinic not found");
  return billing;
}

/** Whether a clinic's booking page takes requests now (spec 7.5). The secret key: patients have no session. */
export async function bookingOpen(clinicId: string, now: Date): Promise<boolean> {
  return billingStatus(await loadBilling(adminClient(), clinicId), now).open;
}

/** The dashboard banner, or null. Never throws: a failed billing read must not take the dashboard down. */
export async function billingBanner(staff: Staff, now: Date): Promise<string | null> {
  try {
    return bannerText(billingStatus(await loadBilling(staff.db, staff.clinicId), now), now);
  } catch (e) {
    logError("billingBanner", e);
    return null;
  }
}

/** Active dentists, which set the tier (spec 4). */
export async function activeDentists(db: SupabaseClient, clinicId: string): Promise<number> {
  const { count } = await db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("active", true)
    .throwOnError();
  return count ?? 0;
}
```

These talk to Supabase, so no unit test covers them: they are thin reads, and the rules they feed are tested above. Tasks 4 to 7 use them; `billingStatus` stays the only place that decides.

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm test; npm run lint`
Expected: `tsc` prints nothing; every test PASS; lint clean.

```powershell
git add src/lib/billing.ts src/lib/billing-data.ts tests/unit/billing.test.ts
git commit -m "feat: add the billing rules and loaders" -m "One pure billingStatus decides active, trial, grace, or lapsed for every caller, next to the tiers, amounts in centavos, and the words for the Billing page, the banner, and the paused booking page. A missing billing row counts as a trial that ended at signup."
```

### Task 4: Pause lapsed clinics

**Files:**
- Modify: `src/lib/booking.ts`, `src/app/[slug]/page.tsx`, `src/app/[slug]/BookingSheet.tsx`, `src/lib/daily.ts`, `src/lib/daily-job.ts`, `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `bookingOpen`, `loadBillings` from `@/lib/billing-data`; `billingStatus`, `pausedMessage` from `@/lib/billing` (Task 3); `loadClinic` from `@/lib/availability`.
- Produces:
  - `BookingOutcome`, `VerifyOutcome`, and `ResendOutcome` in `@/lib/booking` each gain `| { status: "paused" }`
  - `BookingSheet` takes a new prop `paused: boolean`
  - `reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date, paused?: Set<string>): Reminder[]` in `@/lib/daily` (defaults to an empty set, so existing callers are unchanged)

Rules (spec 7.5):
- A lapsed clinic's booking page keeps its header (name, address, hours, the phone as a `tel:` link) and shows "{clinic} is not taking online requests right now. Call {mobile} to book." instead of the booking form.
- The booking Server Actions check the status too, so a tab opened before the lapse cannot slip a request in: `requestBooking` refuses before sending any code, `verifyBookingCode` refuses before booking, and `resendBookingCode` refuses before sending another (paid) text. Each answers `{ status: "paused" }` and the page shows the same message. `getOpenDates` and `getOpenStarts` stay as they are: they only read open times, and the form that calls them is not shown.
- The daily job sends no reminders for a lapsed clinic's appointments. The manage link (`/a/...`) and everything under `/app` are untouched, so patients can still see and cancel and the clinic keeps its data.

- [ ] **Step 1: Write the failing reminder test**

In `tests/unit/daily.test.ts`, replace:

```ts
    expect(reminders(skipped, one, now)).toEqual([]);
  });
});
```

with:

```ts
    expect(reminders(skipped, one, now)).toEqual([]);
  });

  it("sends nothing for a clinic whose booking is paused", () => {
    const other = { ...row, id: "a2", clinic_id: "c2" };
    const both = new Map([["c1", 1], ["c2", 1]]);
    expect(reminders([row, other], both, now, new Set(["c1"])).map((r) => r.appointmentId)).toEqual(["a2"]);
  });
});
```

Run: `npx vitest run tests/unit/daily.test.ts`
Expected: FAIL, the new test gets `["a1", "a2"]`.

- [ ] **Step 2: Skip paused clinics in the reminder rules**

In `src/lib/daily.ts`, replace:

```ts
/**
 * Spec 11 step 1: needsReminder decides which visits are due; a patient without a mobile (or deleted)
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1).
 */
export function reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date): Reminder[] {
  return rows.flatMap((r) => {
```

with:

```ts
/**
 * Spec 11 step 1: needsReminder decides which visits are due; a patient without a mobile (or deleted)
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1).
 * A clinic whose booking is paused gets no reminders (billing spec 7.5).
 */
export function reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date, paused: Set<string> = new Set()): Reminder[] {
  return rows.flatMap((r) => {
    if (paused.has(r.clinic_id)) return [];
```

Run: `npx vitest run tests/unit/daily.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Pass the paused clinics from the daily job**

In `src/lib/daily-job.ts`, replace:

```ts
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
```

with:

```ts
import { billingStatus } from "@/lib/billing";
import { loadBillings } from "@/lib/billing-data";
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
```

and replace:

```ts
  const { data: dentists, error: dentistError } = await db
    .from("dentists")
    .select("clinic_id")
    .eq("active", true)
    .in("clinic_id", [...new Set(rows.map((r) => r.clinic_id))]);
  if (dentistError) throw dentistError;
  const active = new Map<string, number>();
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);

  const app = appUrl();
  let sent = 0;
  for (const r of reminders(rows, active, now)) {
```

with:

```ts
  const clinicIds = [...new Set(rows.map((r) => r.clinic_id))];
  const { data: dentists, error: dentistError } = await db.from("dentists").select("clinic_id").eq("active", true).in("clinic_id", clinicIds);
  if (dentistError) throw dentistError;
  const active = new Map<string, number>();
  for (const { clinic_id } of (dentists ?? []) as { clinic_id: string }[]) active.set(clinic_id, (active.get(clinic_id) ?? 0) + 1);
  // Billing spec 7.5: a lapsed clinic's patients get no reminders.
  const paused = new Set([...(await loadBillings(db, clinicIds))].filter(([, billing]) => !billingStatus(billing, now).open).map(([id]) => id));

  const app = appUrl();
  let sent = 0;
  for (const r of reminders(rows, active, now, paused)) {
```

- [ ] **Step 4: Refuse bookings for a paused clinic**

In `src/lib/booking.ts`, replace:

```ts
import { dayOpenStarts, loadClinic } from "@/lib/availability";
```

with:

```ts
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
```

replace:

```ts
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unavailable" };
```

with:

```ts
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "paused" }
  | { status: "unavailable" };
```

replace:

```ts
  | { status: "used" }
  | { status: "unavailable" };
```

with:

```ts
  | { status: "used" }
  | { status: "paused" }
  | { status: "unavailable" };
```

replace:

```ts
  | { status: "gone" }
  | { status: "unavailable" };
```

with:

```ts
  | { status: "gone" }
  | { status: "paused" }
  | { status: "unavailable" };
```

replace (in `requestBooking`):

```ts
    if (!clinic) return { status: "invalid", errors: { slot: "This booking link doesn't exist." } };
```

with:

```ts
    if (!clinic) return { status: "invalid", errors: { slot: "This booking link doesn't exist." } };
    // Billing spec 7.5: a lapsed clinic takes no requests, even from a tab opened before it lapsed.
    if (!(await bookingOpen(clinic.id, ctx.now))) return { status: "paused" };
```

replace (in `verifyCode`):

```ts
    if (!clinic) return done({ status: "unavailable" });
    return done(await finalize(clinic, row.booking, now));
```

with:

```ts
    if (!clinic) return done({ status: "unavailable" });
    if (!(await bookingOpen(clinic.id, now))) return done({ status: "paused" });
    return done(await finalize(clinic, row.booking, now));
```

and replace (in `resendCode`):

```ts
    if (!row || row.verified_at) return { status: "gone" };
```

with:

```ts
    if (!row || row.verified_at) return { status: "gone" };
    if (!(await bookingOpen(row.booking.clinicId, ctx.now))) return { status: "paused" };
```

Each check sits inside the function's existing `try`, so a failed billing read answers `unavailable`, like any other database failure there.

- [ ] **Step 5: Show the paused notice on the booking page**

In `src/app/[slug]/page.tsx`, replace:

```ts
import { loadClinic } from "@/lib/availability";
```

with:

```ts
import { loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
```

and replace:

```tsx
/** A clinic's public booking page and website (spec 5.1). It receives no patient data and no busy times. */
export default async function ClinicBookingPage({ params }: Params) {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) notFound();
  return <BookingSheet clinic={clinic} nowIso={new Date().toISOString()} />;
}
```

with:

```tsx
/**
 * A clinic's public booking page and website (spec 5.1). It receives no patient data and no busy times.
 * A lapsed clinic's page shows how to call instead of the booking form (billing spec 7.5).
 */
export default async function ClinicBookingPage({ params }: Params) {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) notFound();
  const now = new Date();
  const open = await bookingOpen(clinic.id, now);
  return <BookingSheet clinic={clinic} nowIso={now.toISOString()} paused={!open} />;
}
```

In `src/app/[slug]/BookingSheet.tsx`, replace:

```ts
import type { BookingOutcome } from "@/lib/booking";
```

with:

```ts
import { pausedMessage } from "@/lib/billing";
import type { BookingOutcome } from "@/lib/booking";
```

replace:

```ts
type Props = { clinic: PublicClinic; nowIso: string };
```

with:

```ts
type Props = { clinic: PublicClinic; nowIso: string; paused: boolean };
```

replace:

```tsx
export default function BookingSheet({ clinic, nowIso }: Props) {
```

with:

```tsx
export default function BookingSheet({ clinic, nowIso, paused }: Props) {
```

replace (in `handleBooking`):

```ts
      case "too_many":
        setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
        return;
      case "unavailable":
        setNotice(UNAVAILABLE);
        return;
```

with:

```ts
      case "too_many":
        setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
        return;
      case "paused":
        setNotice(pausedMessage(clinic.name, phone));
        return;
      case "unavailable":
        setNotice(UNAVAILABLE);
        return;
```

replace (in `verify`):

```ts
        case "too_many":
          setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
```

with:

```ts
        case "too_many":
          setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
          break;
        case "paused":
          setNotice(pausedMessage(clinic.name, phone));
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
```

replace (in `resend`):

```ts
        case "gone":
          setNotice("Please send your request again.");
          setStep("who");
          break;
```

with:

```ts
        case "gone":
          setNotice("Please send your request again.");
          setStep("who");
          break;
        case "paused":
          setNotice(pausedMessage(clinic.name, phone));
          break;
```

and replace:

```tsx
        {closed ? (
          <p className="note-box">
```

with:

```tsx
        {paused ? (
          <p className="note-box" role="status">
            {pausedMessage(clinic.name, phone)}
          </p>
        ) : closed ? (
          <p className="note-box">
```

`phone` is the clinic mobile as `09XXXXXXXXX`, the same value the header already links with `tel:`.

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm test; npm run lint`
Expected: `tsc` prints nothing; every test PASS; lint clean.

```powershell
git add src/lib/booking.ts "src/app/[slug]/page.tsx" "src/app/[slug]/BookingSheet.tsx" src/lib/daily.ts src/lib/daily-job.ts tests/unit/daily.test.ts
git commit -m "feat: pause booking and reminders for lapsed clinics" -m "After the 3 day grace period the public booking page shows how to call instead of the form, the booking actions answer paused before sending any code, and the daily job skips that clinic's reminders. Patient links and the dashboard keep working."
```

### Task 5: PayMongo checkout and webhook

**Files:**
- Create: `src/lib/paymongo.ts`, `src/app/api/paymongo/webhook/route.ts`, `tests/unit/paymongo.test.ts`, `tests/unit/paymongo-webhook.test.ts`
- Modify: `src/lib/billing-data.ts`

**Interfaces:**
- Consumes: `parseMonths` from `@/lib/billing` (Task 3); `isUuid` from `@/lib/validate`; `logError` from `@/lib/log`; `createHmac`, `timingSafeEqual` from `node:crypto`; SQL `record_payment` (Task 2).
- Produces:
  - From `@/lib/paymongo` (server only): `PAID_EVENT = "checkout_session.payment.paid"`, `SIGNATURE_TOLERANCE_S = 300`, `type PayMongoKeys = { secretKey: string; webhookSecret: string }`, `paymongoKeys(env?: Record<string, string | undefined>): PayMongoKeys | null`, `type CheckoutInput = { clinicId: string; slug: string; tier: string; months: number; amountCentavos: number; appUrl: string }`, `checkoutRequest(input: CheckoutInput, secretKey: string): { url: string; init: RequestInit }`, `createCheckout(input: CheckoutInput, secretKey: string): Promise<string | null>`, `verifySignature(header: string | null, rawBody: string, secret: string | undefined, livemode: boolean, now: Date): boolean`, `type PaidCheckout = { sessionId: string; clinicId: string; months: number; amountCentavos: number }`, `type WebhookEvent = { livemode: boolean; type: string | null; paid: PaidCheckout | null }`, `readWebhookEvent(rawBody: string): WebhookEvent`
  - From `@/lib/billing-data`: `type NewPayment = { clinicId: string; method: "gcash" | "paymongo"; amountCentavos: number; months: number; reference: string; sessionId: string | null; recordedBy: string | null }`, `recordPayment(p: NewPayment): Promise<{ status: "ok" | "duplicate"; paidThrough: string | null }>`
  - `POST /api/paymongo/webhook`: 401 `{"error":"Invalid signature"}`; 200 `{"status":"ok"}`, `{"status":"duplicate"}`, or `{"status":"ignored"}`; 500 `{"error":"Not recorded"}`

Rules (spec 7.3, 8; PayMongo facts verified for this plan):
- Checkout: `POST https://api.paymongo.com/v1/checkout_sessions`, HTTP Basic auth with the secret key as the username and an empty password, body `{data: {attributes: {line_items: [{name, amount (centavos), currency: "PHP", quantity: 1}], payment_method_types: ["gcash", "paymaya", "card"], success_url, cancel_url, description, reference_number, metadata: {clinic_id, months}, send_email_receipt: true}}}`. The line item is "BrightSmile {tier} plan, {n} months". `success_url` is `{APP_URL}/app/billing?paid=1`, `cancel_url` `{APP_URL}/app/billing`, `reference_number` the clinic's slug. Metadata values are strings (PayMongo's rule), so months go as `"3"`. The response carries `data.id` and `data.attributes.checkout_url`. `createCheckout` never throws: any failure is logged by status only (never the key) and returns null.
- Signature: the header is `Paymongo-Signature: t=<unix seconds>,te=<hex>,li=<hex>`. The signature is the hex HMAC-SHA256 of `{t}.{raw body}` with the webhook secret, compared in constant time with `li` when the event's `livemode` is true and with `te` otherwise. A timestamp more than 300 seconds from now, either way, is refused. No secret, a malformed header, or a mismatch is a 401.
- Event: `{data: {id, attributes: {type, livemode, data: {id: <checkout session id>, attributes: {metadata, payments: [{attributes: {amount}}], ...}}}}}`. `readWebhookEvent` checks every field it reads; unknown shapes leave `paid` null. For `checkout_session.payment.paid` it needs a session id (letters, digits, underscores, at most 100), a clinic id that is a UUID, months 1 to 12, and at least one payment whose amounts are positive whole centavos (summed).
- Route: reads the raw body with `request.text()` before anything else (the signature covers the exact bytes). Bad signature 401. Another event type 200 `ignored`. A paid event it cannot read: 200 `ignored` plus a `logError` telling Kai to check PayMongo and record the payment on `/admin`. Otherwise `record_payment` with method `paymongo`, the session id as both `reference` and `sessionId`, and `recordedBy` null: `ok` and `duplicate` answer 200; a database error answers 500 so PayMongo retries, which `record_payment` makes safe. Months come from our own metadata on a session only our server can create, so they are trusted once the signature checks out.
- The webhook uses the secret key: PayMongo has no staff session, and it crosses clinics. `/api/` is already noindex and outside the proxy matcher.

- [ ] **Step 1: Write the failing PayMongo tests**

Create `tests/unit/paymongo.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutRequest, createCheckout, paymongoKeys, readWebhookEvent, verifySignature } from "@/lib/paymongo";

const SECRET = "whsk_test_4b2f1c9e8d7a";
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const NOW = new Date("2026-09-25T02:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
const input = { clinicId: CLINIC, slug: "bright-dental", tier: "Team", months: 3, amountCentavos: 389_700, appUrl: "https://brightsmile.ph" };

/** What PayMongo sends: te for test events, li for live events. */
function signature(body: string, { live = false, t = T, secret = SECRET } = {}) {
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return live ? `t=${t},te=,li=${hex}` : `t=${t},te=${hex},li=`;
}

function paidEvent({ live = false, metadata = { clinic_id: CLINIC, months: "3" } as Record<string, unknown>, payments = [{ attributes: { amount: 389_700 } }] as unknown[] } = {}) {
  return JSON.stringify({
    data: {
      id: "evt_9aZ",
      type: "event",
      attributes: {
        type: "checkout_session.payment.paid",
        livemode: live,
        data: { id: "cs_test_4Nd9k2", type: "checkout_session", attributes: { metadata, reference_number: "bright-dental", payments } },
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("paymongoKeys", () => {
  it("needs both keys", () => {
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: "sk_test_a", PAYMONGO_WEBHOOK_SECRET: " whsk_b " })).toEqual({ secretKey: "sk_test_a", webhookSecret: "whsk_b" });
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: "sk_test_a" })).toBeNull();
    expect(paymongoKeys({ PAYMONGO_SECRET_KEY: " ", PAYMONGO_WEBHOOK_SECRET: "whsk_b" })).toBeNull();
    expect(paymongoKeys({})).toBeNull();
  });
});

describe("checkoutRequest", () => {
  it("posts one line item with the amount computed on our server, with basic auth", () => {
    const { url, init } = checkoutRequest(input, "sk_test_abc");
    expect(url).toBe("https://api.paymongo.com/v1/checkout_sessions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("sk_test_abc:").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual({
      data: {
        attributes: {
          line_items: [{ name: "BrightSmile Team plan, 3 months", amount: 389_700, currency: "PHP", quantity: 1 }],
          payment_method_types: ["gcash", "paymaya", "card"],
          success_url: "https://brightsmile.ph/app/billing?paid=1",
          cancel_url: "https://brightsmile.ph/app/billing",
          description: "BrightSmile Team plan for bright-dental, 3 months",
          reference_number: "bright-dental",
          metadata: { clinic_id: CLINIC, months: "3" },
          send_email_receipt: true,
        },
      },
    });
    expect(JSON.parse(checkoutRequest({ ...input, months: 1 }, "k").init.body as string).data.attributes.line_items[0].name).toBe("BrightSmile Team plan, 1 month");
  });
});

describe("createCheckout", () => {
  it("returns PayMongo's checkout_url", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: { id: "cs_1", attributes: { checkout_url: "https://checkout.paymongo.com/cs_1" } } }));
    expect(await createCheckout(input, "sk_test_abc")).toBe("https://checkout.paymongo.com/cs_1");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.paymongo.com/v1/checkout_sessions");
  });

  it("gives null for a refusal or a network error, and never logs the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ errors: [{ detail: "Unauthorized" }] }, { status: 401 }));
    expect(await createCheckout(input, "sk_test_abc")).toBeNull();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("socket hang up"));
    expect(await createCheckout(input, "sk_test_abc")).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("sk_test_abc");
    expect(logged).toHaveBeenCalledWith("createCheckout failed:", "PayMongo answered 401");
  });
});

describe("verifySignature", () => {
  const body = paidEvent();

  it("accepts a valid test signature (te) and a valid live signature (li)", () => {
    expect(verifySignature(signature(body), body, SECRET, false, NOW)).toBe(true);
    const live = paidEvent({ live: true });
    expect(verifySignature(signature(live, { live: true }), live, SECRET, true, NOW)).toBe(true);
  });

  it("checks the field that matches the event's mode", () => {
    expect(verifySignature(signature(body), body, SECRET, true, NOW)).toBe(false);
    expect(verifySignature(signature(body, { live: true }), body, SECRET, false, NOW)).toBe(false);
  });

  it("refuses a wrong secret, an altered body, or a missing secret", () => {
    expect(verifySignature(signature(body, { secret: "whsk_other" }), body, SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body.replace("389700", "1"), SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body, undefined, false, NOW)).toBe(false);
    expect(verifySignature(signature(body), body, "", false, NOW)).toBe(false);
  });

  it("refuses a timestamp more than 5 minutes away, either way", () => {
    expect(verifySignature(signature(body, { t: T - 300 }), body, SECRET, false, NOW)).toBe(true);
    expect(verifySignature(signature(body, { t: T - 301 }), body, SECRET, false, NOW)).toBe(false);
    expect(verifySignature(signature(body, { t: T + 301 }), body, SECRET, false, NOW)).toBe(false);
  });

  it("refuses a malformed header", () => {
    const hex = createHmac("sha256", SECRET).update(`${T}.${body}`).digest("hex");
    for (const header of [null, "", "garbage", `te=${hex}`, `t=${T}`, `t=abc,te=${hex}`, `t=${T},te=${hex.slice(0, 63)}`, `t=${T},te=${hex}zz`, `t=${T},te=${"g".repeat(64)}`]) {
      expect(verifySignature(header, body, SECRET, false, NOW)).toBe(false);
    }
  });
});

describe("readWebhookEvent", () => {
  it("reads a paid checkout: our session id, clinic, months, and the amount paid", () => {
    expect(readWebhookEvent(paidEvent())).toEqual({
      livemode: false,
      type: "checkout_session.payment.paid",
      paid: { sessionId: "cs_test_4Nd9k2", clinicId: CLINIC, months: 3, amountCentavos: 389_700 },
    });
    expect(readWebhookEvent(paidEvent({ live: true })).livemode).toBe(true);
    const split = paidEvent({ payments: [{ attributes: { amount: 200_000 } }, { attributes: { amount: 189_700 } }] });
    expect(readWebhookEvent(split).paid?.amountCentavos).toBe(389_700);
  });

  it("reads other events without a payment", () => {
    const other = JSON.stringify({ data: { attributes: { type: "payment.failed", livemode: true, data: {} } } });
    expect(readWebhookEvent(other)).toEqual({ livemode: true, type: "payment.failed", paid: null });
    expect(readWebhookEvent("not json")).toEqual({ livemode: false, type: null, paid: null });
    expect(readWebhookEvent("[]")).toEqual({ livemode: false, type: null, paid: null });
  });

  it("leaves paid empty when any field it needs is missing or wrong", () => {
    for (const body of [
      paidEvent({ metadata: {} }),
      paidEvent({ metadata: { clinic_id: "not-a-uuid", months: "3" } }),
      paidEvent({ metadata: { clinic_id: CLINIC, months: "13" } }),
      paidEvent({ metadata: { clinic_id: CLINIC, months: "0" } }),
      paidEvent({ payments: [] }),
      paidEvent({ payments: [{ attributes: { amount: "389700" } }] }),
      paidEvent({ payments: [{ attributes: { amount: 0 } }] }),
      paidEvent({ payments: [{ attributes: {} }] }),
      paidEvent({ payments: [null] }),
      paidEvent().replace('"cs_test_4Nd9k2"', '"cs test; drop"'),
    ]) {
      expect(readWebhookEvent(body).paid).toBeNull();
    }
  });
});
```

The signatures are real HMAC-SHA256 values computed in the test with Node's `crypto`, the same way PayMongo computes them.

Run: `npx vitest run tests/unit/paymongo.test.ts`
Expected: FAIL, `@/lib/paymongo` does not exist.

- [ ] **Step 2: Write the PayMongo module**

Create `src/lib/paymongo.ts`:

```ts
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseMonths } from "@/lib/billing";
import { logError } from "@/lib/log";
import { isUuid } from "@/lib/validate";

const CHECKOUT_SESSIONS = "https://api.paymongo.com/v1/checkout_sessions";
/** The one event that records a payment (billing spec 7.3). */
export const PAID_EVENT = "checkout_session.payment.paid";
/** A signature whose timestamp is further than this from now is refused (spec 7.3: 5 minutes). */
export const SIGNATURE_TOLERANCE_S = 300;

export type PayMongoKeys = { secretKey: string; webhookSecret: string };

/** Both keys, or null while PayMongo is not set up (the Billing page then offers GCash only). */
export function paymongoKeys(env: Record<string, string | undefined> = process.env): PayMongoKeys | null {
  const secretKey = env.PAYMONGO_SECRET_KEY?.trim();
  const webhookSecret = env.PAYMONGO_WEBHOOK_SECRET?.trim();
  return secretKey && webhookSecret ? { secretKey, webhookSecret } : null;
}

export type CheckoutInput = { clinicId: string; slug: string; tier: string; months: number; amountCentavos: number; appUrl: string };

/** POST /v1/checkout_sessions for one prepayment (spec 7.3). Basic auth: the secret key as username, no password. */
export function checkoutRequest(input: CheckoutInput, secretKey: string): { url: string; init: RequestInit } {
  const months = `${input.months} ${input.months === 1 ? "month" : "months"}`;
  const body = {
    data: {
      attributes: {
        line_items: [{ name: `BrightSmile ${input.tier} plan, ${months}`, amount: input.amountCentavos, currency: "PHP", quantity: 1 }],
        payment_method_types: ["gcash", "paymaya", "card"],
        success_url: `${input.appUrl}/app/billing?paid=1`,
        cancel_url: `${input.appUrl}/app/billing`,
        description: `BrightSmile ${input.tier} plan for ${input.slug}, ${months}`,
        reference_number: input.slug,
        // PayMongo metadata values are strings. The webhook trusts these because only our server creates sessions.
        metadata: { clinic_id: input.clinicId, months: String(input.months) },
        send_email_receipt: true,
      },
    },
  };
  return {
    url: CHECKOUT_SESSIONS,
    init: {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  };
}

/** Creates the checkout session and returns its checkout_url, or null after logging the status (never the key). Never throws. */
export async function createCheckout(input: CheckoutInput, secretKey: string): Promise<string | null> {
  try {
    const { url, init } = checkoutRequest(input, secretKey);
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => null)) as { data?: { attributes?: { checkout_url?: unknown } } } | null;
    const checkoutUrl = body?.data?.attributes?.checkout_url;
    if (res.ok && typeof checkoutUrl === "string" && checkoutUrl.startsWith("https://")) return checkoutUrl;
    logError("createCheckout", `PayMongo answered ${res.status}`);
    return null;
  } catch (e) {
    logError("createCheckout", e);
    return null;
  }
}

/**
 * The Paymongo-Signature header is "t=<unix seconds>,te=<hex>,li=<hex>": an HMAC-SHA256 of "{t}.{raw body}"
 * with the webhook secret, in li for live events and te for test events. Compared in constant time, and
 * refused when t is more than 5 minutes from now.
 */
export function verifySignature(header: string | null, rawBody: string, secret: string | undefined, livemode: boolean, now: Date): boolean {
  if (!header || !secret) return false;
  const fields = new Map<string, string>();
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at > 0) fields.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  const t = fields.get("t") ?? "";
  const sent = fields.get(livemode ? "li" : "te") ?? "";
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(sent)) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(sent, "hex"));
}

export type PaidCheckout = { sessionId: string; clinicId: string; months: number; amountCentavos: number };
export type WebhookEvent = { livemode: boolean; type: string | null; paid: PaidCheckout | null };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Reads a webhook body defensively, checking every field it uses: {data: {attributes: {type, livemode,
 * data: <checkout session>}}}. paid is set only for a paid checkout whose session carries our metadata and
 * paid amounts; any other shape leaves it null.
 */
export function readWebhookEvent(rawBody: string): WebhookEvent {
  let root: unknown = null;
  try {
    root = JSON.parse(rawBody);
  } catch {
    // Not JSON: nothing to read.
  }
  const attributes = record(record(record(root)?.data)?.attributes);
  const livemode = attributes?.livemode === true;
  const type = typeof attributes?.type === "string" ? attributes.type : null;
  const none = { livemode, type, paid: null };
  if (type !== PAID_EVENT) return none;

  const session = record(attributes?.data);
  const details = record(session?.attributes);
  const metadata = record(details?.metadata);
  const sessionId = session?.id;
  const clinicId = metadata?.clinic_id;
  const months = parseMonths(metadata?.months);
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_]{1,100}$/.test(sessionId) || !isUuid(clinicId) || months === null) return none;
  const payments = Array.isArray(details?.payments) ? details.payments : [];
  const amounts = payments.map((p) => record(record(p)?.attributes)?.amount);
  if (amounts.length === 0 || !amounts.every((a): a is number => Number.isInteger(a) && (a as number) > 0)) return none;
  return { livemode, type, paid: { sessionId, clinicId, months, amountCentavos: amounts.reduce((sum, a) => sum + a, 0) } };
}
```

The livemode flag that picks `li` or `te` is read from the body before the signature is checked. That is safe: both fields are HMACs of the same exact body with the same secret, so a forged body fails either way.

Run: `npx vitest run tests/unit/paymongo.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 3: Write the failing webhook route test**

Create `tests/unit/paymongo-webhook.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/paymongo/webhook/route";
import { recordPayment } from "@/lib/billing-data";

// The database side (record_payment, and that a repeated session records once) is proven in tests/sql/billing.test.ts.
vi.mock("@/lib/billing-data", () => ({ recordPayment: vi.fn() }));

const SECRET = "whsk_test_4b2f1c9e8d7a";
const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const saved = { key: process.env.PAYMONGO_SECRET_KEY, secret: process.env.PAYMONGO_WEBHOOK_SECRET };
const record = vi.mocked(recordPayment);

function event(type = "checkout_session.payment.paid", session: unknown = {
  id: "cs_test_4Nd9k2",
  attributes: { metadata: { clinic_id: CLINIC, months: "3" }, payments: [{ attributes: { amount: 389_700 } }] },
}) {
  return JSON.stringify({ data: { id: "evt_1", attributes: { type, livemode: false, data: session } } });
}

function post(body: string, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body, headers: { "Paymongo-Signature": `t=${t},te=${hex},li=` } }));
}

beforeEach(() => {
  process.env.PAYMONGO_SECRET_KEY = "sk_test_abc";
  process.env.PAYMONGO_WEBHOOK_SECRET = SECRET;
  record.mockReset();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [name, value] of [["PAYMONGO_SECRET_KEY", saved.key], ["PAYMONGO_WEBHOOK_SECRET", saved.secret]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("POST /api/paymongo/webhook", () => {
  it("refuses a missing or wrong signature before touching the database", async () => {
    const unsigned = await POST(new Request("http://localhost/api/paymongo/webhook", { method: "POST", body: event() }));
    expect(unsigned.status).toBe(401);
    expect((await post(event(), "whsk_wrong")).status).toBe(401);
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    expect((await post(event())).status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it("records a paid checkout as a PayMongo payment", async () => {
    record.mockResolvedValue({ status: "ok", paidThrough: "2027-01-09T02:00:00+00:00" });
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(record).toHaveBeenCalledWith({
      clinicId: CLINIC,
      method: "paymongo",
      amountCentavos: 389_700,
      months: 3,
      reference: "cs_test_4Nd9k2",
      sessionId: "cs_test_4Nd9k2",
      recordedBy: null,
    });
  });

  it("answers 200 to a repeated delivery", async () => {
    record.mockResolvedValue({ status: "duplicate", paidThrough: "2027-01-09T02:00:00+00:00" });
    const res = await post(event());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "duplicate" });
  });

  it("answers 500 when the database fails, so PayMongo retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    record.mockRejectedValue(new Error("connection reset"));
    expect((await post(event())).status).toBe(500);
  });

  it("ignores other events and paid events it cannot read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [event("payment.failed"), event("checkout_session.payment.paid", { id: "cs_x", attributes: {} })]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ignored" });
    }
    expect(record).not.toHaveBeenCalled();
  });
});
```

`vi.mock` is hoisted above the imports, so the route gets the mocked `recordPayment` and the test never needs a database.

Run: `npx vitest run tests/unit/paymongo-webhook.test.ts`
Expected: FAIL, `@/app/api/paymongo/webhook/route` does not exist.

- [ ] **Step 4: Record payments through the secret key**

Append to the end of `src/lib/billing-data.ts`:

```ts
type Method = "gcash" | "paymongo";

export type NewPayment = {
  clinicId: string;
  method: Method;
  amountCentavos: number;
  months: number;
  reference: string;
  sessionId: string | null;
  recordedBy: string | null;
};

/** record_payment through the secret key (spec 6), for the admin page and the PayMongo webhook. Throws on a database error. */
export async function recordPayment(p: NewPayment): Promise<{ status: "ok" | "duplicate"; paidThrough: string | null }> {
  const { data, error } = await adminClient().rpc("record_payment", {
    p_clinic_id: p.clinicId,
    p_method: p.method,
    p_amount_centavos: p.amountCentavos,
    p_months: p.months,
    p_reference: p.reference,
    p_session_id: p.sessionId,
    p_recorded_by: p.recordedBy,
  });
  if (error) throw error;
  const result = data as { status: "ok" | "duplicate"; paid_through: string | null };
  return { status: result.status, paidThrough: result.paid_through };
}
```

- [ ] **Step 5: Write the webhook route**

Create `src/app/api/paymongo/webhook/route.ts`:

```ts
import { recordPayment } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { PAID_EVENT, paymongoKeys, readWebhookEvent, verifySignature } from "@/lib/paymongo";

/**
 * Billing spec 7.3: PayMongo posts checkout_session.payment.paid here. 401 for a bad signature. 200 for a payment
 * recorded now or already, and for any other event. 500 when the database fails, so PayMongo retries, which
 * record_payment makes safe.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const event = readWebhookEvent(raw);
  const secret = paymongoKeys()?.webhookSecret;
  if (!verifySignature(request.headers.get("paymongo-signature"), raw, secret, event.livemode, new Date())) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (event.type !== PAID_EVENT) return Response.json({ status: "ignored" });
  if (!event.paid) {
    logError("paymongo webhook", "a paid checkout could not be read; check PayMongo and record it at /admin");
    return Response.json({ status: "ignored" });
  }
  try {
    const { status } = await recordPayment({ ...event.paid, method: "paymongo", reference: event.paid.sessionId, recordedBy: null });
    return Response.json({ status });
  } catch (e) {
    logError("paymongo webhook", e);
    return Response.json({ error: "Not recorded" }, { status: 500 });
  }
}
```

`paymongoKeys()` needs both keys, so the route refuses everything (401) until PayMongo is fully set up. A `POST` Route Handler is never cached.

Run: `npx vitest run tests/unit/paymongo-webhook.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm test; npm run lint`
Expected: `tsc` prints nothing; every test PASS; lint clean.

```powershell
git add src/lib/paymongo.ts src/lib/billing-data.ts src/app/api/paymongo/webhook/route.ts tests/unit/paymongo.test.ts tests/unit/paymongo-webhook.test.ts
git commit -m "feat: create PayMongo checkouts and record paid webhooks" -m "Checkout sessions are built with fetch and basic auth, one line item priced on our server. The webhook verifies Paymongo-Signature (HMAC-SHA256 of t.body, li for live and te for test, 5 minute tolerance), reads the event defensively, and records it through record_payment, so a repeated delivery changes nothing."
```

### Task 6: Billing page, banner, and Settings link

**Files:**
- Create: `src/app/app/billing/page.tsx`, `src/app/app/billing/PayPanel.tsx`, `src/app/app/billing/actions.ts`
- Modify: `src/lib/billing-data.ts`, `src/app/app/layout.tsx`, `src/app/app/settings/page.tsx`

**Interfaces:**
- Consumes: `billingStatus`, `statusLine`, `tierFor`, `amountCentavos`, `parseMonths`, `formatPesos`, `billingDate`, `MONTH_CHOICES`, `STATUS_LABEL`, `STATUS_CHIP` from `@/lib/billing` and `loadBilling`, `activeDentists`, `billingBanner` from `@/lib/billing-data` (Task 3); `paymongoKeys`, `createCheckout` from `@/lib/paymongo` (Task 5); `requireStaff` from `@/lib/supabase/server`; `appUrl` from `@/lib/app-url`; `localMobile`, `normalizeMobile` from `@/lib/phone`; `BILLING_GCASH_NAME` and `BILLING_GCASH_NUMBER` from the environment (checked in Task 9).
- Produces:
  - From `@/lib/billing-data`: `type PaymentItem = { id: string; paidAt: string; months: number; amountCentavos: number; method: "gcash" | "paymongo" }`, `loadPayments(db: SupabaseClient, clinicId: string): Promise<PaymentItem[]>`
  - From `src/app/app/billing/actions.ts` (Server Action): `type PayState = { error?: string }`, `payOnline(state: PayState, form: FormData): Promise<PayState>` (redirects to PayMongo's checkout on success)
  - Default export `PayPanel({ activeDentists: number; slug: string; gcash: { name: string; number: string } | null; online: boolean })` from `src/app/app/billing/PayPanel.tsx`
  - Page `/app/billing`; the dashboard banner on every `/app` page; a "Plan and billing" section in Settings

Rules (spec 7.1, 7.3, 7.5, 11):
- The page shows, on one screen: a status chip with its word and the status line; the tier, its monthly price, and the active dentist count it is based on (texts are included, spec 1); a months picker (1, 3, 6, 12) with the amount for each; the amount due; GCash details (name, number, the amount, and the slug to type in the GCash note, then "Your plan is extended once we see the payment, usually the same day."); "Pay online" only when both PayMongo keys are set; and the payment history (date, months, amount, method).
- `?paid=1` adds "Payment received. Your plan updates within a minute." and nothing else: the plan shown always comes from the database.
- `payOnline` re-reads everything on the server: `requireStaff`, months through `parseMonths`, the active dentist count and slug through the staff RLS client, the amount from `amountCentavos`. When checkout creation fails it answers "Online payment is not available right now. You can pay by GCash." (spec 11; `createCheckout` already logged why). `redirect` stays outside any `try`. With JavaScript it is a client navigation to PayMongo.
- "Pay online" is the page's one primary button. GCash details are plain text.
- The banner (spec 7.5) sits at the top of every dashboard page, amber, with a "Go to Billing" link at least 44px tall. `billingBanner` never throws, so the dashboard renders even when the billing read fails.
- Settings gets a "Plan and billing" section linking to `/app/billing` (spec 7.1: linked from Settings and the banner). The bottom tab bar keeps its five items.

- [ ] **Step 1: Load the payment history**

Append to the end of `src/lib/billing-data.ts`:

```ts
export type PaymentItem = { id: string; paidAt: string; months: number; amountCentavos: number; method: Method };

/** The Billing page's payment history, newest first (spec 7.1). Staff pass their RLS client. */
export async function loadPayments(db: SupabaseClient, clinicId: string): Promise<PaymentItem[]> {
  const { data } = await db
    .from("payments")
    .select("id, paid_at, months, amount_centavos, method")
    .eq("clinic_id", clinicId)
    .order("paid_at", { ascending: false })
    .limit(24)
    .throwOnError();
  return (data as { id: string; paid_at: string; months: number; amount_centavos: number; method: Method }[]).map((p) => ({
    id: p.id,
    paidAt: p.paid_at,
    months: p.months,
    amountCentavos: p.amount_centavos,
    method: p.method,
  }));
}
```

- [ ] **Step 2: Write the Pay online action**

Create `src/app/app/billing/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { amountCentavos, parseMonths, tierFor } from "@/lib/billing";
import { activeDentists } from "@/lib/billing-data";
import { createCheckout, paymongoKeys } from "@/lib/paymongo";
import { requireStaff } from "@/lib/supabase/server";

export type PayState = { error?: string };

const UNAVAILABLE = "Online payment is not available right now. You can pay by GCash.";

/**
 * Billing spec 7.3: opens PayMongo checkout for the chosen months. The amount comes from the clinic's active
 * dentists, read here on the server, never from the form. redirect stays outside any try block.
 */
export async function payOnline(_state: PayState, form: FormData): Promise<PayState> {
  const staff = await requireStaff();
  const months = parseMonths(form.get("months"));
  if (!months) return { error: "Choose how many months to pay for." };
  const keys = paymongoKeys();
  if (!keys) return { error: UNAVAILABLE };
  const [dentists, clinic] = await Promise.all([
    activeDentists(staff.db, staff.clinicId),
    staff.db.from("clinics").select("slug").eq("id", staff.clinicId).single().throwOnError(),
  ]);
  const checkoutUrl = await createCheckout(
    {
      clinicId: staff.clinicId,
      slug: (clinic.data as { slug: string }).slug,
      tier: tierFor(dentists).name,
      months,
      amountCentavos: amountCentavos(dentists, months),
      appUrl: appUrl(),
    },
    keys.secretKey,
  );
  if (!checkoutUrl) return { error: UNAVAILABLE };
  redirect(checkoutUrl);
}
```

- [ ] **Step 3: Write the months picker and payment panel**

Create `src/app/app/billing/PayPanel.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { payOnline, type PayState } from "./actions";
import { amountCentavos, formatPesos, MONTH_CHOICES } from "@/lib/billing";

type Props = {
  activeDentists: number;
  slug: string;
  gcash: { name: string; number: string } | null;
  online: boolean;
};

const monthsText = (months: number) => (months === 1 ? "1 month" : `${months} months`);

/** Billing spec 7.1: the months picker, the amount due, GCash details, and Pay online when PayMongo is set up. */
export default function PayPanel({ activeDentists, slug, gcash, online }: Props) {
  const [months, setMonths] = useState<number>(1);
  const [state, formAction, pending] = useActionState<PayState, FormData>(payOnline, {});
  const amount = formatPesos(amountCentavos(activeDentists, months));

  return (
    <>
      <form action={formAction} className="card card-pad settings-section">
        <h2 className="font-display">Pay ahead</h2>
        <fieldset className="mt-2">
          <legend className="f-label">How many months</legend>
          <div className="member-list">
            {MONTH_CHOICES.map((m) => (
              <label key={m} className="member-row">
                <input type="radio" name="months" value={m} checked={months === m} onChange={() => setMonths(m)} />
                <span className="nm">{monthsText(m)}</span>
                <span className="meta">{formatPesos(amountCentavos(activeDentists, m))}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="cf-row">
          <span className="k">Amount due for {monthsText(months)}</span>
          <span className="v">{amount}</span>
        </div>
        {online && (
          <>
            {state.error && (
              <p className="field-err mt-3" role="alert">
                {state.error}
              </p>
            )}
            <button type="submit" className="btn btn-primary wide-btn mt-4" disabled={pending}>
              {pending ? "Opening checkout..." : `Pay ${amount} online`}
            </button>
            <p className="f-hint mt-2">GCash, Maya, or card, on PayMongo&apos;s secure page.</p>
          </>
        )}
      </form>

      <section className="card card-pad settings-section">
        <h2 className="font-display">Pay by GCash</h2>
        {gcash ? (
          <div className="cf-box mt-2">
            <div className="cf-row">
              <span className="k">Send to</span>
              <span className="v">{gcash.name}</span>
            </div>
            <div className="cf-row">
              <span className="k">GCash number</span>
              <span className="v">{gcash.number}</span>
            </div>
            <div className="cf-row">
              <span className="k">Amount</span>
              <span className="v">{amount}</span>
            </div>
            <div className="cf-row">
              <span className="k">Type this in the GCash note</span>
              <span className="v">{slug}</span>
            </div>
          </div>
        ) : (
          <p className="note-box mt-2">GCash payment details are not set up yet.</p>
        )}
        <p className="f-hint mt-3">Your plan is extended once we see the payment, usually the same day.</p>
      </section>
    </>
  );
}
```

The months radios sit inside the form, so "Pay online" posts the chosen value; the amount shown here is only a preview, and `payOnline` computes it again.

- [ ] **Step 4: Write the Billing page**

Create `src/app/app/billing/page.tsx`:

```tsx
import type { Metadata } from "next";
import PayPanel from "./PayPanel";
import { billingDate, billingStatus, formatPesos, STATUS_CHIP, STATUS_LABEL, statusLine, tierFor } from "@/lib/billing";
import { activeDentists, loadBilling, loadPayments } from "@/lib/billing-data";
import { paymongoKeys } from "@/lib/paymongo";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing" };

type Props = { searchParams: Promise<{ paid?: string | string[] }> };

/**
 * Billing spec 7.1: when the plan ends, what it costs and why, how to pay, and past payments. The plan shown
 * always comes from the database; ?paid=1 only adds a note after PayMongo checkout.
 */
export default async function BillingPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const now = new Date();
  const [billing, dentists, payments, clinic, { paid }] = await Promise.all([
    loadBilling(staff.db, staff.clinicId),
    activeDentists(staff.db, staff.clinicId),
    loadPayments(staff.db, staff.clinicId),
    staff.db.from("clinics").select("slug").eq("id", staff.clinicId).single().throwOnError(),
    searchParams,
  ]);
  const state = billingStatus(billing, now);
  const tier = tierFor(dentists);
  const gcashName = process.env.BILLING_GCASH_NAME?.trim();
  const gcashNumber = normalizeMobile(process.env.BILLING_GCASH_NUMBER ?? "");

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Billing</h1>
      </div>
      {paid === "1" && (
        <p className="note-box mb-4" role="status">
          Payment received. Your plan updates within a minute.
        </p>
      )}
      <section className="card card-pad settings-section">
        <h2 className="font-display">Your plan</h2>
        <div className="chip-row">
          <span className={`chip ${STATUS_CHIP[state.status]}`}>{STATUS_LABEL[state.status]}</span>
        </div>
        <p className="mt-2">{statusLine(state, now)}</p>
        <p className="f-hint mt-2">
          {tier.name} plan: {formatPesos(tier.pesos * 100)} a month for {dentists} active {dentists === 1 ? "dentist" : "dentists"}. Texts
          to patients are included.
        </p>
      </section>
      <PayPanel
        activeDentists={dentists}
        slug={(clinic.data as { slug: string }).slug}
        gcash={gcashName && gcashNumber ? { name: gcashName, number: localMobile(gcashNumber) } : null}
        online={paymongoKeys() !== null}
      />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Payment history</h2>
        {payments.length === 0 ? (
          <p className="f-hint">No payments yet.</p>
        ) : (
          <div className="mt-2">
            {payments.map((p) => (
              <div key={p.id} className="cf-row">
                <span className="k">
                  {billingDate(new Date(p.paidAt), now)}, {p.months === 1 ? "1 month" : `${p.months} months`}
                </span>
                <span className="v">
                  {formatPesos(p.amountCentavos)} by {p.method === "gcash" ? "GCash" : "PayMongo"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
```

Only the booleans and display strings reach the Client Component: the PayMongo keys stay on the server.

- [ ] **Step 5: Add the banner to every dashboard page**

In `src/app/app/layout.tsx`, replace:

```tsx
import AppNav from "./AppNav";
```

with:

```tsx
import AppNav from "./AppNav";
import { billingBanner } from "@/lib/billing-data";
```

replace:

```tsx
  const [clinic, pending] = await Promise.all([
```

with:

```tsx
  const [clinic, pending, banner] = await Promise.all([
```

replace:

```tsx
      .gt("starts_at", new Date().toISOString())
      .throwOnError(),
  ]);
```

with:

```tsx
      .gt("starts_at", new Date().toISOString())
      .throwOnError(),
    billingBanner(staff, new Date()),
  ]);
```

and replace:

```tsx
      <main id="main" className="app-main">
        {children}
      </main>
```

with:

```tsx
      <main id="main" className="app-main">
        {banner && (
          <p className="note-box warn mb-4">
            {banner}{" "}
            <Link href="/app/billing" className="link inline-flex min-h-11 items-center">
              Go to Billing
            </Link>
          </p>
        )}
        {children}
      </main>
```

- [ ] **Step 6: Link Billing from Settings**

In `src/app/app/settings/page.tsx`, replace:

```tsx
import type { Metadata } from "next";
```

with:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
```

and replace:

```tsx
      <ProcedureEditor procedures={settings.procedures} />
      <AccountForms />
```

with:

```tsx
      <ProcedureEditor procedures={settings.procedures} />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Plan and billing</h2>
        <p className="f-hint">See when your plan ends, pay by GCash or online, and see past payments.</p>
        <Link href="/app/billing" className="btn btn-soft mt-3">
          Open Billing
        </Link>
      </section>
      <AccountForms />
```

- [ ] **Step 7: Check and commit**

These are pages and a form, with no rule of their own (every rule they show is tested in Task 3), so the checks are the typecheck, lint, and build (spec 9: the dashboard cannot run against a real database locally).

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the build finishes and its route list shows `ƒ /app/billing` and `ƒ /api/paymongo/webhook`.

```powershell
git add src/lib/billing-data.ts src/app/app/billing/page.tsx src/app/app/billing/PayPanel.tsx src/app/app/billing/actions.ts src/app/app/layout.tsx src/app/app/settings/page.tsx
git commit -m "feat: add the Billing page, the plan banner, and Pay online" -m "The Billing page shows the plan's status, the tier and why, a months picker with the amount, GCash details with the slug to type as the note, Pay online when PayMongo is set up, and past payments. Every dashboard page warns before and after the plan ends, and Settings links to Billing."
```

### Task 7: The operator's admin page

**Files:**
- Create: `src/lib/admin.ts`, `tests/unit/admin.test.ts`, `src/app/admin/page.tsx`, `src/app/admin/ClinicActions.tsx`, `src/app/admin/actions.ts`
- Modify: `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/proxy.ts`, `src/lib/security-headers.ts`, `src/lib/billing-data.ts`, `tests/unit/routes.test.ts`, `tests/unit/security-headers.test.ts`

**Interfaces:**
- Consumes: `parseMonths`, `amountCentavos`, `manilaMonthStart`, `billingFromRow`, `billingStatus`, `billingDate`, `formatPesos`, `STATUS_LABEL`, `STATUS_CHIP`, `type BillingState` from `@/lib/billing` (Task 3); `recordPayment` from `@/lib/billing-data` (Task 5); `cleanText`, `isUuid` from `@/lib/validate`; `serverClient` in `@/lib/supabase/server`; `Field` from `@/components/Field`; `refresh` from `next/cache`; `notFound` from `next/navigation`; SQL `extend_trial`, `admin_overview` (Task 2); `OPERATOR_EMAILS`.
- Produces:
  - From `@/lib/admin` (pure): `operatorEmails(value: string | undefined): string[]`, `isOperator(user: { email?: string | null; email_confirmed_at?: string | null }, list: string | undefined): boolean`, `parsePesos(value: unknown): number | null`, `type GcashPayment = { clinicId: string; months: number; amountCentavos: number; reference: string }`, `parseGcashPayment(input: { clinicId: unknown; months: unknown; amount: unknown; reference: unknown }): { ok: true; value: GcashPayment } | { ok: false; error: string }`, `parseTrialDays(value: unknown): number | null`
  - `requireOperator(): Promise<{ userId: string }>` from `@/lib/supabase/server`
  - From `@/lib/billing-data`: `extendTrial(clinicId: string, days: number): Promise<string>`, `type AdminClinic = { id: string; name: string; slug: string; state: BillingState; activeDentists: number; credits: number; lastPayment: { paidAt: string; months: number; amountCentavos: number; method: "gcash" | "paymongo" } | null }`, `adminOverview(now: Date): Promise<AdminClinic[]>`
  - From `src/app/admin/actions.ts` (Server Actions): `type AdminState = { error?: string; done?: string }`, `recordGcashPayment(state: AdminState, form: FormData): Promise<AdminState>`, `extendTrialAction(state: AdminState, form: FormData): Promise<AdminState>`
  - Default export `ClinicActions({ clinicId: string; activeDentists: number })`; page `/admin`
  - `NOINDEX_SOURCES` gains `"/admin/:path*"`; the proxy matcher gains `"/admin"`

Rules (spec 7.2, 7.6, 8):
- Operator: a signed-in user whose email is confirmed (`email_confirmed_at` set) and listed in `OPERATOR_EMAILS` (comma separated, trimmed, case-insensitive). Anyone else, signed in or not, gets `notFound()`, a 404 that does not reveal the page. `requireOperator` uses `auth.getUser()`, which asks Supabase Auth, so the confirmation date is current. The page and each action call it first, outside any `try`.
- After that check, reads and writes use the secret key (they cross clinics). The page shows billing and counts only, never patient data: name, slug, status (word and colour), plan end, active dentists, credits of texts sent this Manila month, and the last payment.
- Record a GCash payment: months (1 to 12, default 1), the amount received in pesos (prefilled with the tier price for the chosen months, editable), and the GCash reference number (required, up to 100 characters). It calls `record_payment` with method `gcash` and `recorded_by` = the operator's user id. Extend a trial: 1 to 365 days (default 14), from the later of the trial end and now. Both actions re-validate on the server and `refresh()` the page on success. The submit buttons disable while pending, so a double tap cannot record twice.
- `/admin` sends `X-Robots-Tag: noindex, nofollow` (a new `NOINDEX_SOURCES` entry; `notFound` also adds a noindex meta tag). It is not added to robots.txt, which matches by prefix and would also hide a clinic whose booking link starts with `admin` (only the exact slug `admin` is reserved).
- The proxy matcher gains `/admin` so the operator's session is refreshed there like on `/app` (Server Components cannot write cookies, and a refresh token rotated without being saved would sign Kai out). `guardRedirect` never redirects `/admin`, which a test pins.
- The operator buttons are secondary (`btn-soft`, `btn-ghost`): the page has no single primary action.

- [ ] **Step 1: Write the failing tests for the operator rules and the form input**

Create `tests/unit/admin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isOperator, operatorEmails, parseGcashPayment, parsePesos, parseTrialDays } from "@/lib/admin";

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const LIST = " Kai@Example.com, ,ops@brightsmile.ph ";
const confirmed = "2026-09-25T02:00:00Z";

describe("operatorEmails", () => {
  it("reads a comma separated list, trimmed and lowercased", () => {
    expect(operatorEmails(LIST)).toEqual(["kai@example.com", "ops@brightsmile.ph"]);
    expect(operatorEmails(undefined)).toEqual([]);
    expect(operatorEmails("")).toEqual([]);
  });
});

describe("isOperator", () => {
  it("lets in a confirmed, listed email, whatever its case", () => {
    expect(isOperator({ email: "KAI@example.com", email_confirmed_at: confirmed }, LIST)).toBe(true);
    expect(isOperator({ email: "ops@brightsmile.ph", email_confirmed_at: confirmed }, LIST)).toBe(true);
  });

  it("keeps out unconfirmed, unlisted, and look-alike emails, and everyone when the list is empty", () => {
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: null }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com" }, LIST)).toBe(false);
    expect(isOperator({ email: "ai@example.com", email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com.evil.ph", email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: null, email_confirmed_at: confirmed }, LIST)).toBe(false);
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: confirmed }, undefined)).toBe(false);
    expect(isOperator({ email: "kai@example.com", email_confirmed_at: confirmed }, "")).toBe(false);
  });
});

describe("parsePesos", () => {
  it("reads pesos as typed, in centavos", () => {
    expect(["1197", "1,197.50", "₱1,197", " 399 ", "0.5", "100000"].map(parsePesos)).toEqual([119_700, 119_750, 119_700, 39_900, 50, 10_000_000]);
  });

  it("refuses zero, negatives, too many decimals, and more than ₱100,000", () => {
    for (const bad of ["0", "0.00", "-5", "1.234", "abc", "", "100001", "1e3", 1197, null]) expect(parsePesos(bad)).toBeNull();
  });
});

describe("parseGcashPayment", () => {
  const good = { clinicId: CLINIC, months: "3", amount: "3,897", reference: " 1234 567 890 " };

  it("builds the payment from the form", () => {
    expect(parseGcashPayment(good)).toEqual({ ok: true, value: { clinicId: CLINIC, months: 3, amountCentavos: 389_700, reference: "1234 567 890" } });
  });

  it("says what is wrong", () => {
    expect(parseGcashPayment({ ...good, clinicId: "nope" })).toEqual({ ok: false, error: "That clinic no longer exists. Reload the page." });
    expect(parseGcashPayment({ ...good, months: "13" })).toEqual({ ok: false, error: "Choose 1 to 12 months." });
    expect(parseGcashPayment({ ...good, amount: "" })).toEqual({ ok: false, error: "Enter the amount received, like 1197 or 1,197.50." });
    expect(parseGcashPayment({ ...good, reference: "  " })).toEqual({ ok: false, error: "Enter the GCash reference number, up to 100 characters." });
    expect(parseGcashPayment({ ...good, reference: "x".repeat(101) }).ok).toBe(false);
  });
});

describe("parseTrialDays", () => {
  it("accepts 1 to 365 whole days", () => {
    expect(["1", " 14 ", "365"].map(parseTrialDays)).toEqual([1, 14, 365]);
    for (const bad of ["0", "366", "1.5", "-3", "", "abc", 7, null]) expect(parseTrialDays(bad)).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/admin.test.ts`
Expected: FAIL, `@/lib/admin` does not exist.

- [ ] **Step 2: Write the operator rules**

Create `src/lib/admin.ts`:

```ts
import { parseMonths } from "@/lib/billing";
import { cleanText, isUuid } from "@/lib/validate";

/** OPERATOR_EMAILS as lowercased addresses: comma separated, spaces and empty entries ignored. */
export function operatorEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Billing spec 7.6: a signed-in user whose email is confirmed and listed in OPERATOR_EMAILS. */
export function isOperator(user: { email?: string | null; email_confirmed_at?: string | null }, list: string | undefined): boolean {
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && user.email_confirmed_at && operatorEmails(list).includes(email));
}

/** A peso amount as the operator types it ("1197", "1,197.50", "₱1,197") in centavos: above 0, at most ₱100,000. */
export function parsePesos(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim().replace(/^₱\s*/, "").replace(/,/g, "") : "";
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const centavos = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return centavos > 0 && centavos <= 10_000_000 ? centavos : null;
}

export type GcashPayment = { clinicId: string; months: number; amountCentavos: number; reference: string };

/** The admin page's GCash form, checked on the server (spec 7.2). */
export function parseGcashPayment(input: {
  clinicId: unknown;
  months: unknown;
  amount: unknown;
  reference: unknown;
}): { ok: true; value: GcashPayment } | { ok: false; error: string } {
  if (!isUuid(input.clinicId)) return { ok: false, error: "That clinic no longer exists. Reload the page." };
  const months = parseMonths(input.months);
  if (!months) return { ok: false, error: "Choose 1 to 12 months." };
  const amountCentavos = parsePesos(input.amount);
  if (!amountCentavos) return { ok: false, error: "Enter the amount received, like 1197 or 1,197.50." };
  const reference = cleanText(input.reference, 100);
  if (!reference) return { ok: false, error: "Enter the GCash reference number, up to 100 characters." };
  return { ok: true, value: { clinicId: input.clinicId, months, amountCentavos, reference } };
}

/** Days to add to a trial: a whole number from 1 to 365, or null. */
export function parseTrialDays(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim() : "";
  const days = /^\d{1,3}$/.test(text) ? Number(text) : 0;
  return days >= 1 && days <= 365 ? days : null;
}
```

Run: `npx vitest run tests/unit/admin.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Keep /admin out of search, and pin that the proxy never redirects it**

In `tests/unit/security-headers.test.ts`, replace:

```ts
      "/api/:path*",
    ]);
```

with:

```ts
      "/api/:path*",
      "/admin/:path*",
    ]);
```

In `tests/unit/routes.test.ts`, replace:

```ts
  it("sends signed-in users without a clinic to onboarding", () => {
```

with:

```ts
  it("never redirects the admin page, which checks the operator itself", () => {
    for (const visitor of [out, noClinic, staff]) expect(guardRedirect("/admin", visitor)).toBeNull();
  });

  it("sends signed-in users without a clinic to onboarding", () => {
```

Run: `npx vitest run tests/unit/security-headers.test.ts tests/unit/routes.test.ts`
Expected: FAIL in `security-headers.test.ts` ("marks every private area noindex": the list has no `/admin/:path*`); `routes.test.ts` PASS (8 tests), pinning behaviour that `guardRedirect` already has.

In `src/lib/security-headers.ts`, replace:

```ts
  "/api/:path*",
];
```

with:

```ts
  "/api/:path*",
  "/admin/:path*",
];
```

In `src/proxy.ts`, replace:

```ts
// Public pages (the booking page and patient links) never touch the staff session, so they skip the proxy.
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup"],
};
```

with:

```ts
// Public pages (the booking page and patient links) never touch the staff session, so they skip the proxy.
// /admin passes through only to keep its session fresh: guardRedirect never redirects it, requireOperator guards it.
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup", "/admin"],
};
```

Run: `npx vitest run tests/unit/security-headers.test.ts tests/unit/routes.test.ts`
Expected: PASS (7 and 8 tests). `/:path*` also matches zero segments, so `/admin/:path*` covers `/admin` itself, the same way `/app/:path*` covers `/app`.

- [ ] **Step 4: Add the operator guard**

In `src/lib/supabase/server.ts`, replace:

```ts
import { redirect } from "next/navigation";
```

with:

```ts
import { notFound, redirect } from "next/navigation";
import { isOperator } from "@/lib/admin";
```

and append to the end of the file:

```ts
/**
 * For /admin and its actions (billing spec 7.6): the signed-in user whose confirmed email is in OPERATOR_EMAILS.
 * Everyone else, signed in or not, gets a 404, so the page never reveals itself. getUser asks Supabase Auth, so
 * email_confirmed_at is current. Call it outside try blocks, because notFound throws.
 */
export async function requireOperator(): Promise<{ userId: string }> {
  const db = await serverClient();
  const { data } = await db.auth.getUser();
  if (!data.user || !isOperator(data.user, process.env.OPERATOR_EMAILS)) notFound();
  return { userId: data.user.id };
}
```

In `src/lib/supabase/admin.ts`, replace:

```ts
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes,
 * sms_log, patient links, sendPush, and the daily job. Staff pages use serverClient() so RLS applies.
```

with:

```ts
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes, sms_log,
 * patient links, sendPush, the daily job, the PayMongo webhook, and /admin after requireOperator.
 * Staff pages use serverClient() so RLS applies.
```

- [ ] **Step 5: Load every clinic and extend trials through the secret key**

In `src/lib/billing-data.ts`, replace:

```ts
import { bannerText, billingFromRow, billingStatus, type Billing, type BillingRow } from "@/lib/billing";
```

with:

```ts
import { bannerText, billingFromRow, billingStatus, manilaMonthStart, type Billing, type BillingRow, type BillingState } from "@/lib/billing";
```

and append to the end of the file:

```ts
/** extend_trial through the secret key (spec 7.6). Returns the new trial end. */
export async function extendTrial(clinicId: string, days: number): Promise<string> {
  const { data, error } = await adminClient().rpc("extend_trial", { p_clinic_id: clinicId, p_days: days });
  if (error) throw error;
  return data as string;
}

export type AdminClinic = {
  id: string;
  name: string;
  slug: string;
  state: BillingState;
  activeDentists: number;
  credits: number;
  lastPayment: { paidAt: string; months: number; amountCentavos: number; method: Method } | null;
};

type OverviewRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  trial_ends_at: string | null;
  paid_through: string | null;
  active_dentists: number;
  credits: number;
  last_paid_at: string | null;
  last_months: number | null;
  last_amount_centavos: number | null;
  last_method: Method | null;
};

/**
 * Every clinic for the admin page (spec 7.6) in one call to admin_overview: billing and counts only, no patient
 * data. Credits are texts sent since the start of this Manila month.
 * ponytail: the API returns at most 1000 rows; page admin_overview when clinics near that.
 */
export async function adminOverview(now: Date): Promise<AdminClinic[]> {
  const { data, error } = await adminClient().rpc("admin_overview", { p_month_start: manilaMonthStart(now).toISOString() });
  if (error) throw error;
  return (data as OverviewRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    state: billingStatus(billingFromRow(r.trial_ends_at ? { trial_ends_at: r.trial_ends_at, paid_through: r.paid_through } : null, r.created_at), now),
    activeDentists: r.active_dentists,
    credits: r.credits,
    lastPayment:
      r.last_paid_at && r.last_months && r.last_amount_centavos && r.last_method
        ? { paidAt: r.last_paid_at, months: r.last_months, amountCentavos: r.last_amount_centavos, method: r.last_method }
        : null,
  }));
}
```

- [ ] **Step 6: Write the admin actions**

Create `src/app/admin/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import { parseGcashPayment, parseTrialDays } from "@/lib/admin";
import { extendTrial, recordPayment } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { requireOperator } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validate";

export type AdminState = { error?: string; done?: string };

/** Billing spec 7.2: the operator records a GCash payment they saw arrive. Operator only, every field checked here. */
export async function recordGcashPayment(_state: AdminState, form: FormData): Promise<AdminState> {
  const { userId } = await requireOperator();
  const parsed = parseGcashPayment({
    clinicId: form.get("clinicId"),
    months: form.get("months"),
    amount: form.get("amount"),
    reference: form.get("reference"),
  });
  if (!parsed.ok) return { error: parsed.error };
  try {
    await recordPayment({ ...parsed.value, method: "gcash", sessionId: null, recordedBy: userId });
  } catch (e) {
    logError("recordGcashPayment", e);
    return { error: "The payment was not recorded. Try again." };
  }
  refresh();
  return { done: "Payment recorded." };
}

/** Billing spec 7.6: adds days to a clinic's trial, from the later of its end and now. Operator only. */
export async function extendTrialAction(_state: AdminState, form: FormData): Promise<AdminState> {
  await requireOperator();
  const clinicId = form.get("clinicId");
  const days = parseTrialDays(form.get("days"));
  if (!isUuid(clinicId)) return { error: "That clinic no longer exists. Reload the page." };
  if (!days) return { error: "Enter 1 to 365 days." };
  try {
    await extendTrial(clinicId, days);
  } catch (e) {
    logError("extendTrialAction", e);
    return { error: "The trial was not extended. Try again." };
  }
  refresh();
  return { done: "Trial extended." };
}
```

- [ ] **Step 7: Write the admin page and its forms**

Create `src/app/admin/ClinicActions.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { extendTrialAction, recordGcashPayment, type AdminState } from "./actions";
import Field from "@/components/Field";
import { amountCentavos } from "@/lib/billing";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The prefilled amount: the tier price for these months, in pesos as typed. */
const pesosFor = (activeDentists: number, months: number) => String(amountCentavos(activeDentists, months) / 100);

function Result({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p className="field-err mt-2" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.done) {
    return (
      <p className="f-hint mt-2" role="status">
        {state.done}
      </p>
    );
  }
  return null;
}

/** Billing spec 7.6: the operator's two actions for one clinic. */
export default function ClinicActions({ clinicId, activeDentists }: { clinicId: string; activeDentists: number }) {
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(() => pesosFor(activeDentists, 1));
  const [paid, payAction, paying] = useActionState(recordGcashPayment, {});
  const [extended, extendAction, extending] = useActionState(extendTrialAction, {});

  return (
    <div className="mt-3">
      <form action={payAction} className="cf-box">
        <input type="hidden" name="clinicId" value={clinicId} />
        <p className="card-title">Record a GCash payment</p>
        <Field label="Months">
          <select
            name="months"
            className="f-input"
            value={months}
            onChange={(e) => {
              const next = Number(e.target.value);
              setMonths(next);
              setAmount(pesosFor(activeDentists, next));
            }}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "1 month" : `${m} months`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount received, in pesos" hint="Prefilled with the price for these months. Change it if they sent a different amount.">
          <input name="amount" className="f-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="GCash reference number">
          <input name="reference" className="f-input" maxLength={100} autoComplete="off" required />
        </Field>
        <Result state={paid} />
        <button type="submit" className="btn btn-soft mt-4" disabled={paying}>
          {paying ? "Recording..." : "Record payment"}
        </button>
      </form>

      <form action={extendAction} className="mt-3">
        <input type="hidden" name="clinicId" value={clinicId} />
        <Field label="Days to add to the trial">
          <input name="days" type="number" className="f-input" min={1} max={365} defaultValue={14} required />
        </Field>
        <Result state={extended} />
        <button type="submit" className="btn btn-ghost mt-3" disabled={extending}>
          {extending ? "Extending..." : "Extend trial"}
        </button>
      </form>
    </div>
  );
}
```

Create `src/app/admin/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import ClinicActions from "./ClinicActions";
import { billingDate, formatPesos, STATUS_CHIP, STATUS_LABEL } from "@/lib/billing";
import { adminOverview } from "@/lib/billing-data";
import { requireOperator } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };

const monthsText = (months: number) => (months === 1 ? "1 month" : `${months} months`);

/**
 * Billing spec 7.6: every clinic's plan, for the operator only (anyone else gets a 404). Billing and counts,
 * never patient data. The secret-key reads sit behind requireOperator.
 */
export default async function AdminPage() {
  await requireOperator();
  const now = new Date();
  const clinics = await adminOverview(now);

  return (
    <main className="app-main">
      <div className="page-head">
        <h1 className="font-display">Clinics</h1>
        <span className="f-hint">{clinics.length === 1 ? "1 clinic" : `${clinics.length} clinics`}</span>
      </div>
      {clinics.length === 0 && <div className="card empty-note">No clinics yet.</div>}
      {clinics.map((c) => (
        <article key={c.id} className="card appt">
          <p className="who">{c.name}</p>
          <Link href={`/${c.slug}`} target="_blank" rel="noreferrer" className="link inline-flex min-h-11 items-center">
            /{c.slug}
          </Link>
          <div className="chip-row">
            <span className={`chip ${STATUS_CHIP[c.state.status]}`}>{STATUS_LABEL[c.state.status]}</span>
          </div>
          <p className="what">
            Plan ends {billingDate(c.state.endsAt, now)}. {c.activeDentists} active {c.activeDentists === 1 ? "dentist" : "dentists"}.{" "}
            {c.credits} {c.credits === 1 ? "credit" : "credits"} of texts sent this month.
          </p>
          <p className="what">
            {c.lastPayment
              ? `Last payment ${billingDate(new Date(c.lastPayment.paidAt), now)}: ${formatPesos(c.lastPayment.amountCentavos)} for ${monthsText(c.lastPayment.months)} by ${c.lastPayment.method === "gcash" ? "GCash" : "PayMongo"}.`
              : "No payments yet."}
          </p>
          <ClinicActions clinicId={c.id} activeDentists={c.activeDentists} />
        </article>
      ))}
    </main>
  );
}
```

`/admin` is a static route, so it wins over `[slug]` (and `admin` is a reserved slug). It has no dashboard shell: the operator may have no clinic of their own.

- [ ] **Step 8: Check the build and the 404**

Run: `npx tsc --noEmit; npm run lint; npm test; npm run build`
Expected: `tsc` prints nothing; lint clean; every test PASS; the route list shows `ƒ /admin`.

Run `npm start` in a second terminal, then:

Run: `curl.exe -s -i http://localhost:3600/admin`
Expected: `HTTP/1.1 404 Not Found` with `X-Robots-Tag: noindex, nofollow` (nobody is signed in, so it is a plain 404). Stop `npm start`. This request only asks Supabase Auth about an empty session; it reads no data.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/admin.ts tests/unit/admin.test.ts src/app/admin/page.tsx src/app/admin/ClinicActions.tsx src/app/admin/actions.ts src/lib/supabase/server.ts src/lib/supabase/admin.ts src/proxy.ts src/lib/security-headers.ts src/lib/billing-data.ts tests/unit/routes.test.ts tests/unit/security-headers.test.ts
git commit -m "feat: add the operator page for GCash payments and trials" -m "/admin lists every clinic's plan, active dentists, credits of texts sent this Manila month, and last payment, and records GCash payments and trial extensions through the secret key. Only a signed-in user with a confirmed email in OPERATOR_EMAILS gets past requireOperator; everyone else sees a 404, and the page is noindex."
```

### Task 8: Heads-up before a plan ends

**Files:**
- Modify: `src/lib/sms/templates.ts`, `src/lib/push.ts`, `src/lib/notify.ts`, `src/lib/daily.ts`, `src/lib/daily-job.ts`, `tests/unit/sms-templates.test.ts`, `tests/unit/push.test.ts`, `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `billingStatus`, `NOTICE_DAYS` from `@/lib/billing` (Task 3); `sendPush`, `type PushPayload` from `@/lib/push`; `sendSms` from `@/lib/sms/send`; `appUrl` from `@/lib/app-url`; `formatDate` from `@/lib/time`; `adminClient`; table `clinic_billing` (Task 2).
- Produces:
  - `SmsKind` gains `"renewal"`, rendered as "BrightSmile: your plan for {clinic} ends {date}. Pay in the app to keep online booking open: {APP_URL}/app/billing" (vars `clinic`, `date`, `appUrl`)
  - `planPushPayload(endsAt: Date): PushPayload` from `@/lib/push`
  - `alertPlanEnding(clinicId: string, endsAt: Date): Promise<"push" | "sms" | "failed">` from `@/lib/notify`
  - From `@/lib/daily`: `type RenewalRow = { clinic_id: string; trial_ends_at: string; paid_through: string | null; renewal_notice_for: string | null }`, `type Renewal = { clinicId: string; endsAt: Date }`, `renewalNotices(rows: RenewalRow[], now: Date): Renewal[]`
  - From `@/lib/daily-job`: `sendRenewalNotices(now: Date): Promise<number>`; `DailySummary` gains `renewals: number | "failed"`

Rules (spec 7.4, core spec 10.4 and 11):
- Due: a clinic whose plan end (`ends_at`, trial or paid) is after now and at most 3 days away, and whose `renewal_notice_for` differs from that end. Dates compare at millisecond precision, the precision the job writes with, so a notice is never sent twice for one end.
- Claim first: `update clinic_billing set renewal_notice_for = ends_at where clinic_id = ... and (renewal_notice_for is null or renewal_notice_for <> ends_at)`, and alert only when that update matched a row, so a rerun or an overlapping run never alerts twice. A payment clears `renewal_notice_for` (`record_payment`), so the next end gets its own heads-up; an extended trial has a new end, so it does too.
- Alert by the clinic's channel rule, like `alertClinic`: a push to its devices when `alert_channel` is `push`; a text to the clinic mobile when no push was delivered or it chose texts. The push says "Your BrightSmile plan ends {date}" and, like every push, opens `/app/requests`, where the banner links to Billing. `alertClinic` itself stays unchanged.
- The text is 146 characters in the worst case (20 character clinic, "Wed Sep 30", 17 character host), inside 160.
- The step runs after reminders and before the credit check; a failure is logged and marks the run failed without stopping the steps after it. The summary reports how many heads-ups went out.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/sms-templates.test.ts`, replace:

```ts
  "cancelled", "reminder", "patient_cancel_alert", "low_credit",
];
```

with:

```ts
  "cancelled", "reminder", "patient_cancel_alert", "low_credit", "renewal",
];
```

and replace:

```ts
  it("never starts a clinic alert with the patient's name", () => {
```

with:

```ts
  it("renders the plan heads-up with the link to Billing", () => {
    const text = renderSms("renewal", { clinic: "Elite Dental", date: "Fri Oct 9", appUrl: "https://brightsmile.ph" });
    expect(text).toBe("BrightSmile: your plan for Elite Dental ends Fri Oct 9. Pay in the app to keep online booking open: https://brightsmile.ph/app/billing");
  });

  it("never starts a clinic alert with the patient's name", () => {
```

In `tests/unit/push.test.ts`, replace:

```ts
import { parseSubscription, pushPayload, sendPush, vapidSender } from "@/lib/push";
```

with:

```ts
import { parseSubscription, planPushPayload, pushPayload, sendPush, vapidSender } from "@/lib/push";
```

and replace:

```ts
describe("parseSubscription", () => {
```

with:

```ts
describe("planPushPayload", () => {
  it("says when the plan ends and opens the requests page", () => {
    expect(planPushPayload(manilaInstant("2026-10-09", 600))).toEqual({
      title: "Your BrightSmile plan ends Fri Oct 9",
      body: "Pay in BrightSmile to keep online booking open.",
      url: "/app/requests",
    });
  });
});

describe("parseSubscription", () => {
```

In `tests/unit/daily.test.ts`, replace:

```ts
import { isCronAuthorized, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
```

with:

```ts
import { isCronAuthorized, lowCreditThreshold, reminders, reminderWindow, renewalNotices, type ReminderRow, type RenewalRow } from "@/lib/daily";
```

and replace:

```ts
    expect(reminders([row, other], both, now, new Set(["c1"])).map((r) => r.appointmentId)).toEqual(["a2"]);
  });
});
```

with:

```ts
    expect(reminders([row, other], both, now, new Set(["c1"])).map((r) => r.appointmentId)).toEqual(["a2"]);
  });
});

describe("renewalNotices", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = manilaInstant("2026-10-06", 9 * 60);
  const trialEnd = manilaInstant("2026-10-09", 9 * 60); // exactly 3 days away
  const row: RenewalRow = { clinic_id: "c1", trial_ends_at: trialEnd.toISOString(), paid_through: null, renewal_notice_for: null };

  it("picks plans that end within 3 days and have had no heads-up for that end", () => {
    expect(renewalNotices([row], now)).toEqual([{ clinicId: "c1", endsAt: trialEnd }]);
    const paidThrough = new Date(now.getTime() + DAY);
    const paid = { ...row, trial_ends_at: manilaInstant("2026-09-01", 0).toISOString(), paid_through: paidThrough.toISOString() };
    expect(renewalNotices([paid], now)).toEqual([{ clinicId: "c1", endsAt: paidThrough }]);
  });

  it("skips plans further out, already ended, or already told about this end", () => {
    expect(renewalNotices([row], new Date(trialEnd.getTime() - 3 * DAY - 1))).toEqual([]);
    expect(renewalNotices([row], trialEnd)).toEqual([]);
    expect(renewalNotices([{ ...row, renewal_notice_for: trialEnd.toISOString() }], now)).toEqual([]);
    const oldNotice = { ...row, renewal_notice_for: manilaInstant("2026-09-06", 9 * 60).toISOString() };
    expect(renewalNotices([oldNotice], now)).toEqual([{ clinicId: "c1", endsAt: trialEnd }]);
  });
});
```

Run: `npx vitest run tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts`
Expected: FAIL: `renderSms("renewal")` has no template, `planPushPayload` and `renewalNotices` are not exported.

- [ ] **Step 2: Add the text, the push, and the selector**

In `src/lib/sms/templates.ts`, replace:

```ts
  | "low_credit";
```

with:

```ts
  | "low_credit"
  | "renewal";
```

and replace:

```ts
    low_credit: () => `BrightSmile: Semaphore balance is ${v.credits} credits. Top up before reminders fail.`,
```

with:

```ts
    low_credit: () => `BrightSmile: Semaphore balance is ${v.credits} credits. Top up before reminders fail.`,
    renewal: () => `BrightSmile: your plan for ${clinic} ends ${v.date}. Pay in the app to keep online booking open: ${v.appUrl}/app/billing`,
```

In `src/lib/push.ts`, replace:

```ts
// The push services of Chrome and Android (FCM), Firefox, Safari and iOS, and Edge on Windows.
```

with:

```ts
/** Billing spec 7.4: the plan heads-up. Like every push, a tap opens the requests page, where the banner links to Billing. */
export function planPushPayload(endsAt: Date): PushPayload {
  return { title: `Your BrightSmile plan ends ${formatDate(endsAt)}`, body: "Pay in BrightSmile to keep online booking open.", url: "/app/requests" };
}

// The push services of Chrome and Android (FCM), Firefox, Safari and iOS, and Edge on Windows.
```

In `src/lib/daily.ts`, replace:

```ts
import { needsReminder, type Status } from "@/lib/appointments";
```

with:

```ts
import { needsReminder, type Status } from "@/lib/appointments";
import { billingStatus, NOTICE_DAYS } from "@/lib/billing";
```

and append to the end of the file:

```ts
/** A clinic_billing row as the heads-up step reads it. */
export type RenewalRow = { clinic_id: string; trial_ends_at: string; paid_through: string | null; renewal_notice_for: string | null };
export type Renewal = { clinicId: string; endsAt: Date };

/**
 * Billing spec 7.4: clinics whose plan (trial or paid) ends after now and at most 3 days from now, and that
 * have not had a heads-up for this end yet. Dates compare at millisecond precision, the precision the job
 * writes renewal_notice_for with.
 */
export function renewalNotices(rows: RenewalRow[], now: Date): Renewal[] {
  return rows.flatMap((r) => {
    const paidThrough = r.paid_through ? new Date(r.paid_through) : null;
    const { endsAt } = billingStatus({ trialEndsAt: new Date(r.trial_ends_at), paidThrough }, now);
    const left = endsAt.getTime() - now.getTime();
    const noticed = r.renewal_notice_for !== null && new Date(r.renewal_notice_for).getTime() === endsAt.getTime();
    return left > 0 && left <= NOTICE_DAYS * 24 * 60 * 60 * 1000 && !noticed ? [{ clinicId: r.clinic_id, endsAt }] : [];
  });
}
```

Run: `npx vitest run tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts`
Expected: PASS: every kind, `renewal` included, fits one text for each `APP_URL` in the worst case; `push.test.ts` 9 tests; `daily.test.ts` 10 tests.

- [ ] **Step 3: Alert the clinic by its channel**

In `src/lib/notify.ts`, replace:

```ts
import { pushPayload, sendPush, type AlertKind } from "@/lib/push";
```

with:

```ts
import { planPushPayload, pushPayload, sendPush, type AlertKind } from "@/lib/push";
```

and append to the end of the file:

```ts
/**
 * Billing spec 7.4: the plan heads-up, by the same channel rule as alertClinic. A push to the clinic's devices
 * when it chose push; a text to the clinic mobile when no push was delivered or it chose texts. Never throws.
 */
export async function alertPlanEnding(clinicId: string, endsAt: Date): Promise<"push" | "sms" | "failed"> {
  try {
    const { data, error } = await adminClient().from("clinics").select("sms_name, mobile, alert_channel").eq("id", clinicId).single();
    if (error) throw error;
    const clinic = data as { sms_name: string; mobile: string; alert_channel: "push" | "sms" };

    if (clinic.alert_channel === "push" && (await sendPush(clinicId, planPushPayload(endsAt))) > 0) return "push";

    const status = await sendSms({
      kind: "renewal",
      to: clinic.mobile,
      clinicId,
      vars: { clinic: clinic.sms_name, date: formatDate(endsAt), appUrl: appUrl() },
    });
    return status === "failed" ? "failed" : "sms";
  } catch (e) {
    logError("alertPlanEnding", e);
    return "failed";
  }
}
```

- [ ] **Step 4: Add the daily job step**

In `src/lib/daily-job.ts`, replace:

```ts
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
import { logError } from "@/lib/log";
```

with:

```ts
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, renewalNotices, type ReminderRow, type RenewalRow } from "@/lib/daily";
import { logError } from "@/lib/log";
import { alertPlanEnding } from "@/lib/notify";
```

replace:

```ts
/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
```

with:

```ts
/**
 * Billing spec 7.4: one heads-up per plan end, 3 days or less before it. Each clinic's notice first claims
 * renewal_notice_for with a compare-and-set, so a rerun never alerts twice. Returns how many alerts went out.
 * ponytail: reads every clinic_billing row (the API returns at most 1000); page through when clinics near that.
 */
export async function sendRenewalNotices(now: Date): Promise<number> {
  const db = adminClient();
  const { data, error } = await db.from("clinic_billing").select("clinic_id, trial_ends_at, paid_through, renewal_notice_for");
  if (error) throw error;
  let sent = 0;
  for (const { clinicId, endsAt } of renewalNotices((data ?? []) as RenewalRow[], now)) {
    const endsIso = endsAt.toISOString();
    const { data: claimed, error: claimError } = await db
      .from("clinic_billing")
      .update({ renewal_notice_for: endsIso })
      .eq("clinic_id", clinicId)
      .or(`renewal_notice_for.is.null,renewal_notice_for.neq."${endsIso}"`)
      .select("clinic_id");
    if (claimError) {
      logError("sendRenewalNotices claim", claimError);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    if ((await alertPlanEnding(clinicId, endsAt)) !== "failed") sent++;
  }
  return sent;
}

/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
```

replace:

```ts
  reminders: number | Failed;
  expired: number | Failed;
```

with:

```ts
  reminders: number | Failed;
  renewals: number | Failed;
  expired: number | Failed;
```

and replace:

```ts
  const sent = await step("reminders", () => sendReminders(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, expired, cleaned, credit };
```

with:

```ts
  const sent = await step("reminders", () => sendReminders(now));
  const renewals = await step("renewal notices", () => sendRenewalNotices(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, renewals, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, renewals, expired, cleaned, credit };
```

The timestamp inside the `or` filter is quoted, as PostgREST asks for values with reserved characters such as `.` and `:`. `sms_log.kind` has no check constraint, so `renewal` texts are logged like any other kind.

- [ ] **Step 5: Check and commit**

Run: `npx tsc --noEmit; npm test; npm run lint`
Expected: `tsc` prints nothing; every test PASS (the cron route test still answers 401 before running the job); lint clean.

```powershell
git add src/lib/sms/templates.ts src/lib/push.ts src/lib/notify.ts src/lib/daily.ts src/lib/daily-job.ts tests/unit/sms-templates.test.ts tests/unit/push.test.ts tests/unit/daily.test.ts
git commit -m "feat: warn clinics 3 days before their plan ends" -m "The daily job finds plans ending within 3 days, claims renewal_notice_for with a compare-and-set, then pushes to the clinic's devices or texts the clinic mobile by its alert channel. The renewal text fits one SMS in the worst case, and the summary counts the heads-ups."
```

### Task 9: Environment check and `.env.example`

**Files:**
- Modify: `src/lib/env.ts`, `tests/unit/env.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `operatorEmails` from `@/lib/admin` (Task 7); `cleanEmail` from `@/lib/validate`; `normalizeMobile` from `@/lib/phone`.
- Produces: `envProblems` (same signature) with the billing rules below; `.env.example` lists the five new variables.

Rules (spec 10):
- `VERCEL_ENV=production` also requires `OPERATOR_EMAILS`, `BILLING_GCASH_NAME`, and `BILLING_GCASH_NUMBER`.
- `PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` are both set or both unset, in every environment.
- Formats, when set: `OPERATOR_EMAILS` must be email addresses separated by commas (a typo would lock the operator out behind a 404); `BILLING_GCASH_NUMBER` must be a Philippine mobile number (clinics send money to it).
- Messages name the variable and the rule, never the value.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/env.test.ts`, replace:

```ts
  NEXT_PUBLIC_CONTACT_EMAIL: "hello@brightsmile.ph",
};
```

with:

```ts
  NEXT_PUBLIC_CONTACT_EMAIL: "hello@brightsmile.ph",
  OPERATOR_EMAILS: "kai@example.com",
  BILLING_GCASH_NAME: "Kai B.",
  BILLING_GCASH_NUMBER: "0917 555 0101",
};
```

and replace:

```ts
describe("assertEnv", () => {
```

with:

```ts
describe("billing variables", () => {
  it("requires the operator emails and the GCash details in production only", () => {
    const { OPERATOR_EMAILS, BILLING_GCASH_NAME, BILLING_GCASH_NUMBER, ...missing } = production;
    void OPERATOR_EMAILS;
    void BILLING_GCASH_NAME;
    void BILLING_GCASH_NUMBER;
    expect(envProblems(missing)).toEqual(["OPERATOR_EMAILS is not set", "BILLING_GCASH_NAME is not set", "BILLING_GCASH_NUMBER is not set"]);
    expect(envProblems(dev)).toEqual([]);
  });

  it("wants both PayMongo keys or neither, everywhere", () => {
    const both = "PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET must be set together, or neither";
    expect(envProblems({ ...dev, PAYMONGO_SECRET_KEY: "sk_test_abc" })).toEqual([both]);
    expect(envProblems({ ...production, PAYMONGO_WEBHOOK_SECRET: "whsk_abc" })).toEqual([both]);
    expect(envProblems({ ...production, PAYMONGO_SECRET_KEY: "sk_live_abc", PAYMONGO_WEBHOOK_SECRET: "whsk_abc" })).toEqual([]);
  });

  it("checks the formats without repeating the values", () => {
    const problems = envProblems({ ...production, OPERATOR_EMAILS: "kai@example.com, not-an-email", BILLING_GCASH_NUMBER: "12345" });
    expect(problems).toEqual([
      "OPERATOR_EMAILS must be email addresses separated by commas",
      "BILLING_GCASH_NUMBER must be a Philippine mobile number",
    ]);
    expect(problems.join(" ")).not.toContain("not-an-email");
    expect(problems.join(" ")).not.toContain("12345");
  });
});

describe("assertEnv", () => {
```

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL: the three new tests get `[]` or miss the new messages (the existing tests still pass, because the fixture now carries the new variables).

- [ ] **Step 2: Check the billing variables**

In `src/lib/env.ts`, replace:

```ts
import { normalizeMobile } from "@/lib/phone";
import { productionModeError, smsMode } from "@/lib/sms/prepare";
```

with:

```ts
import { operatorEmails } from "@/lib/admin";
import { normalizeMobile } from "@/lib/phone";
import { productionModeError, smsMode } from "@/lib/sms/prepare";
import { cleanEmail } from "@/lib/validate";
```

replace:

```ts
  "NEXT_PUBLIC_CONTACT_EMAIL",
];
```

with:

```ts
  "NEXT_PUBLIC_CONTACT_EMAIL",
  "OPERATOR_EMAILS",
  "BILLING_GCASH_NAME",
  "BILLING_GCASH_NUMBER",
];
```

and replace:

```ts
  if (env.SEMAPHORE_SENDER_NAME && env.SEMAPHORE_SENDER_NAME.length > 11) problems.push("SEMAPHORE_SENDER_NAME must be at most 11 characters");
  return problems;
```

with:

```ts
  if (env.SEMAPHORE_SENDER_NAME && env.SEMAPHORE_SENDER_NAME.length > 11) problems.push("SEMAPHORE_SENDER_NAME must be at most 11 characters");
  if (env.OPERATOR_EMAILS?.trim() && !operatorEmails(env.OPERATOR_EMAILS).every((email) => cleanEmail(email))) {
    problems.push("OPERATOR_EMAILS must be email addresses separated by commas");
  }
  if (env.BILLING_GCASH_NUMBER?.trim() && !normalizeMobile(env.BILLING_GCASH_NUMBER)) {
    problems.push("BILLING_GCASH_NUMBER must be a Philippine mobile number");
  }
  if (Boolean(env.PAYMONGO_SECRET_KEY?.trim()) !== Boolean(env.PAYMONGO_WEBHOOK_SECRET?.trim())) {
    problems.push("PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET must be set together, or neither");
  }
  return problems;
```

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 3: List the variables in `.env.example`**

In `.env.example`, replace:

```
# Contact address shown on the privacy and terms pages.
NEXT_PUBLIC_CONTACT_EMAIL=
```

with:

```
# Contact address shown on the privacy and terms pages.
NEXT_PUBLIC_CONTACT_EMAIL=

# Billing. /admin opens only for these login emails (confirmed, comma separated). Required in production.
OPERATOR_EMAILS=
# The GCash account clinics pay, shown on the Billing page. Both required in production.
BILLING_GCASH_NAME=
BILLING_GCASH_NUMBER=
# PayMongo online payments (optional): set both or neither, or the server refuses to start.
# Secret key: PayMongo dashboard, Developers. Webhook secret: the webhook for checkout_session.payment.paid
# that points at {APP_URL}/api/paymongo/webhook. Live keys need a registered business.
PAYMONGO_SECRET_KEY=
PAYMONGO_WEBHOOK_SECRET=
```

- [ ] **Step 4: Check and commit**

Run: `npx tsc --noEmit; npm test`
Expected: `tsc` prints nothing; every test PASS.

```powershell
git add src/lib/env.ts tests/unit/env.test.ts .env.example
git commit -m "feat: check the billing variables at server start" -m "Production refuses to start without OPERATOR_EMAILS and the GCash name and number, every environment refuses one PayMongo key without the other, and malformed operator emails or GCash numbers are named without their values."
```

### Task 10: README and final verification

**Files:**
- Modify: `README.md`

The controller runs this task after Tasks 1 to 9 are committed. It changes only the README unless a check fails; a fix gets its own `fix:` commit.

- [ ] **Step 1: Document billing**

In `README.md`, replace:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Its migrations are already applied, so for it start at step 3. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

with:

```markdown
Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migration 7 is pasted as described under "Billing" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.
```

replace:

```markdown
   | 6 | `20260925000100_otp_issue_lock.sql` |
```

with:

```markdown
   | 6 | `20260925000100_otp_issue_lock.sql` |
   | 7 | `20260925000200_billing.sql` |
```

replace:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100
```

with:

```powershell
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260925000200
```

and append to the end of the file:

````markdown

## Billing

Clinics get a 14 day free trial at signup, then prepay 1 to 12 months (spec: `docs/superpowers/specs/2026-09-25-brightsmile-billing-design.md`). Prices are in `TIERS` in `src/lib/billing.ts`: Solo (1 to 2 active dentists) ₱399 a month, Team (3 to 6) ₱1,299, Group (7 or more) ₱1,799. Three days before a plan ends the clinic gets a push or a text; 3 days after it ends, its booking page and reminder texts pause until it pays. The dashboard always keeps working.

### Apply the billing migration (once, before merging the billing branch)

Every merge to `main` deploys, and the new code reads the new tables, so the migration goes first.

1. Open `supabase/migrations/20260925000200_billing.sql`, paste it into the production **SQL Editor**, and run it. It creates `clinic_billing` and `payments`, gives every existing clinic its trial (14 days from its signup), and adds `record_payment`, `extend_trial`, and `admin_overview`. `npm test` has already applied it to an offline copy of the schema (`tests/sql`).
2. Check it: `select count(*) from public.clinics c left join public.clinic_billing b on b.clinic_id = c.id where b.clinic_id is null;` must return `0`.
3. If you ever link the project for `npm run db:push`, mark it applied first: `npx supabase migration repair --status applied 20260925000200`.

### Environment

| Variable | Needed |
|---|---|
| `OPERATOR_EMAILS` | Production. The login emails that may open `/admin`, comma separated. The email must be confirmed. |
| `BILLING_GCASH_NAME`, `BILLING_GCASH_NUMBER` | Production. The GCash account clinics pay, shown on the Billing page. |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | Optional, both or neither. Set them once live PayMongo keys exist (they need a registered business). |

Set the first three in Vercel (**Settings > Environment Variables**, Production) before merging the billing branch: the server refuses to start without them.

### Record a GCash payment

1. A clinic sends the amount shown on its Billing page, with its booking link name (for example `bright-dental`) as the GCash note.
2. When it arrives in your GCash app, log in with an `OPERATOR_EMAILS` address, open `/admin`, find the clinic, choose the months, check the amount (prefilled with the price), type the GCash reference number, and press **Record payment**. The plan extends from its current end, or from today after a lapse.
3. **Extend trial** on the same card adds days to a trial, for example for the `demo` clinic.

### Turn on PayMongo

1. In the PayMongo dashboard (Developers), create a webhook for the event `checkout_session.payment.paid` pointing at `{APP_URL}/api/paymongo/webhook`, and copy its secret.
2. In Vercel, set `PAYMONGO_SECRET_KEY` (the secret key from the same page) and `PAYMONGO_WEBHOOK_SECRET`, then redeploy. The Billing page then shows **Pay online** (GCash, Maya, or card on PayMongo's page).
3. Pay 1 month for the demo clinic: within a minute the payment shows in its Billing page history and on `/admin`. A payment that never shows means the webhook failed: check the Vercel logs for "paymongo webhook", and record it by hand on `/admin` meanwhile.
````

- [ ] **Step 2: Run every automated check**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run build`
Expected: lint clean; `tsc` silent; every unit test and the `tests/sql` suite PASS (`billing.test.ts` 12, `isolation.test.ts` 7); the build finishes and its route list shows `ƒ /admin`, `ƒ /app/billing`, and `ƒ /api/paymongo/webhook`. `;` keeps going after a failure, so read every result.

- [ ] **Step 3: No dashes slipped in, and the other suites are untouched**

Run: `git grep -n -P "[\x{2013}\x{2014}]" -- src tests supabase README.md CONTRIBUTING.md .env.example docs/superpowers/plans/2026-09-25-plan-5-billing.md`
Expected: no output.

Run: `git diff --stat main...HEAD -- tests/db tests/e2e playwright.config.ts`
Expected: no output (this plan neither edits nor runs them).

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: explain billing, the migration, GCash recording, and PayMongo" -m "The README gains the Billing section: pasting the migration before the merge, the three production variables, recording GCash payments on /admin, and turning on PayMongo's webhook. Migration 7 joins the table and the repair command."
```

- [ ] **Step 5: Report to Kai**

Write the summary for Kai: what shipped, the test counts, the dependency added (`@electric-sql/pglite`, dev only) with its reason, the one migration and that it must be pasted before the merge, the three variables to set first, and the list in "What Kai must do" below. Say plainly that the dashboard pages were checked by typecheck, lint, build, and review only, because there is no development database, and list the walk to do on production after the deploy.

## What Kai must do (outside the code)

Before merging the billing branch (every merge to `main` deploys production):
- Review `supabase/migrations/20260925000200_billing.sql`, paste it into the production **SQL Editor**, run it, and run the check query in the README's "Billing" section (it must return `0`).
- In Vercel, Production: set `OPERATOR_EMAILS` (your login email), `BILLING_GCASH_NAME`, and `BILLING_GCASH_NUMBER`. Without them the new deployment refuses to start.
- Make sure your operator login exists and its email is confirmed (log in once at `/login` with it).

After the deploy, walk it on production:
- Open `/admin` while logged in with that email: every clinic is listed with its status word. From a private window (logged out), `/admin` is a 404.
- The backfill counts each existing clinic's trial from its signup, so a clinic that signed up more than 17 days before the migration shows "Booking paused" at once. Extend the trial of any clinic on `/admin` that should keep taking bookings.
- Extend the `demo` clinic's trial on `/admin` (for example 365 days), so the landing page's demo link never pauses.
- As the demo clinic, open Settings, then "Open Billing": the status line, the tier, the months picker with amounts, and the GCash details with the booking link name. No "Pay online" yet.
- Check the next daily job run under **Settings > Cron Jobs**: the JSON now includes `"renewals"`.

Later:
- When clinics pay by GCash, record each payment on `/admin` (README "Record a GCash payment").
- Once the business is registered: open a PayMongo account, get live keys, create the webhook, and set both keys (README "Turn on PayMongo"). Pay 1 month for the demo clinic to see it recorded.
- Official receipts and invoices (BIR) stay outside the app for now (spec 3); PayMongo emails its own payment receipts.

## Self-review

**Spec coverage.**

| Spec | Where |
|---|---|
| 1: prices, 14 day trial, unlimited texts (no allowance code), GCash then PayMongo, heads-up then 3 days of grace then pause, PayMongo as gateway | Task 3 (`TIERS`, `GRACE_DAYS`), Task 2 (trial in `create_clinic`), Task 7 (GCash on `/admin`), Task 5 (PayMongo), Task 8 (heads-up), Task 4 (pause); texts: no code, and `/admin` shows credits this month |
| 2.1: trial at signup with nothing to set up | Task 2 (`create_clinic`, backfill) |
| 2.2: one screen with the end date, the amount for the months, and how to pay | Task 6 |
| 2.3: a PayMongo payment extends once even when delivered twice, proven by a test | Task 2 (`record_payment` duplicate test), Task 5 (webhook answers 200 `duplicate`) |
| 2.4: Kai records a GCash payment in under a minute | Task 7 (prefilled months and amount, one reference field) |
| 2.5: a lapsed clinic's booking page takes no requests; nothing else breaks | Task 4; `billingBanner` never throws (Task 3) |
| 2.6: staff read their billing, never change it or see another clinic's, proven by a test | Task 2 (`billing access` tests), Task 1 (isolation sweep covers the new tables) |
| 3: scope in and out | In: all tasks. Out (automatic renewal, receipts, discounts, refunds and proration, a text allowance, Xendit, staff seats): not built |
| 4: tier table, tier from active dentists, 0 dentists pays Solo, amount = price x months, centavos, payment rows store what was paid | Task 3 (`tierFor`, `amountCentavos`), Task 2 (`payments.amount_centavos`) |
| 5: status rules in one pure function; payments extend from the latest of the three dates | Task 3 (`billingStatus`, used by Tasks 4, 6, 7, 8), Task 2 (`record_payment`) |
| 6: data model, RLS, `create_clinic`, backfill, `record_payment` | Task 2 |
| 7.1: Billing page, linked from Settings and the banner | Task 6 |
| 7.2: GCash payment recorded on `/admin` with `recorded_by` | Task 7 |
| 7.3: checkout from a Server Action, webhook with signature and tolerance, 200 or 401 or 500, `?paid=1` not trusted | Task 5, Task 6 (`payOnline`, the `?paid=1` note) |
| 7.4: heads-up by compare-and-set, channel rule, `renewal` text, push wording | Task 8 |
| 7.5: paused page, actions refuse, no reminders, manage links and `/app` keep working, banner texts | Task 4, Task 6 (banner), Task 3 (texts) |
| 7.6: operator check on page and actions, clinic list, record payment, extend trial, secret key behind the check, noindex | Task 7 (and Task 2 for `admin_overview`, `extend_trial`) |
| 8: server-only writes, verified webhooks, no keys in logs, no patient data on `/admin`, no card data | Tasks 2, 5, 7; `logError` throughout |
| 9: unit tests at every boundary; the PGlite harness and its tests | Tasks 1, 2, 3, 5, 7, 8, 9 |
| 10: environment variables | Task 9, README (Task 10) |
| 11: checkout failure message, webhook 500, missing row rule | Task 6, Task 5, Task 3 (`billingFromRow`) and Task 2 (`record_payment` creates the missing row) |

**Decisions worth a second look.**
- The migration adds two functions the spec does not name: `extend_trial` (one atomic statement that also covers a missing row) and `admin_overview` (the API returns at most 1000 rows per request, so a month of `sms_log` could not be summed in the app).
- `record_payment` creates a missing billing row as "trial ended at signup" (spec 11's rule, in SQL) instead of failing; an unknown clinic still raises, and the webhook then answers 500.
- The backfill counts the trial from each clinic's `created_at`, as decided, so a clinic older than 17 days is paused the moment the migration runs. Production was empty at launch; "What Kai must do" says to check `/admin` right after the deploy.
- `payments.reference` must be 1 to 100 characters (the spec says up to 100); both callers always have one.
- PayMongo metadata carries months as a string, because PayMongo metadata values are strings; the parser accepts a string or a number.
- A paid webhook event the parser cannot read answers 200 (unknown shapes are ignored) and logs an error that tells Kai to record it by hand. A 500 would only make PayMongo retry a body that can never parse.
- Until both PayMongo keys are set, the webhook answers 401 to everything.
- The banner and the heads-up count the trial as the plan, so a trial ending in 3 days gets both.
- Dates read like the rest of the app ("Fri Oct 9"), with the year added when it is not this year, instead of the spec's "Oct 9".
- The grace status line is "Your plan ended {date}. Online booking pauses in {n} days."; the spec left that wording open.
- Only the write actions of the booking page refuse a paused clinic. `getOpenDates` and `getOpenStarts` only read, and their form is not shown.
- `/admin` joins the proxy matcher only so the operator's session is refreshed; `guardRedirect` never redirects it.
- CSP `form-action 'self'` is unchanged. With JavaScript, Pay online's redirect to PayMongo is a client navigation. A tap before the page hydrates posts the form natively, and some browsers then block the 303 to another origin under `form-action`; add `https://checkout.paymongo.com` to `form-action` if that is ever reported.
- A GCash payment recorded twice by mistake is not caught; the button disables while pending, and the card shows the last payment right after.

**Deferred.** Automatic renewal, receipts and invoices, discounts, refunds and proration, a text allowance, Xendit, staff seats (all out of scope, spec 3); paging `admin_overview` and the heads-up's `clinic_billing` read past 1000 clinics (marked `ponytail:`); a Billing tab in the bottom bar (it has five tabs; Billing is reached from Settings and the banner); a browser walk of the dashboard before deploy (no development database exists).

**Placeholder scan.** Every step has complete code or exact text. The only values Kai supplies are the environment variables and the GCash details, listed above.

**How this plan was checked.** Every Create, replace, and append instruction was applied by script, in order, to a clean export of commit `3df0fc5` (the plan's base): each replaced text occurs exactly once in its file at that point, as the Edit tool needs. After each task the copy typechecked, linted clean, and passed `npm test` (unit and `tests/sql`); each "Expected: FAIL" step failed for the reason given; the final state built with `next build`, and under `next start` a signed-out `/admin` answered 404 with `X-Robots-Tag: noindex, nofollow` and an unsigned webhook post answered 401. The migration was also checked the other way: without its `revoke` lines, the billing tests fail.

**Type consistency.** `Billing`, `BillingRow`, `BillingState`, and `billingStatus` (Task 3) are what `loadBillings`, `bookingOpen`, `billingBanner` (Task 3), `sendReminders` (Task 4), the Billing page (Task 6), `adminOverview` (Task 7), and `renewalNotices` (Task 8) use. `Method` (`"gcash" | "paymongo"`) is declared once in `src/lib/billing-data.ts` (Task 5) and reused by `PaymentItem` (Task 6) and `AdminClinic` (Task 7). `recordPayment(p: NewPayment)` (Task 5) is called by the webhook with `method: "paymongo"`, `reference` and `sessionId` both the session id, and `recordedBy: null`, and by `recordGcashPayment` (Task 7) with `method: "gcash"`, `sessionId: null`, and the operator's id; `record_payment`'s seven parameters (Task 2) match its `p_` names. `PayState` and `AdminState` are `{ error?: string }`-shaped states for `useActionState`, like `AuthState`. `parseMonths` (Task 3) serves the Billing form, the admin form, and the webhook metadata. `BookingOutcome`, `VerifyOutcome`, and `ResendOutcome` gain the same `{ status: "paused" }`, and `BookingSheet` handles it in all three switches. `DailySummary.renewals` is reported next to `reminders`.

