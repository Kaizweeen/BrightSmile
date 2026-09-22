# BrightSmile Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold BrightSmile and build its tested core: Manila time scheduling, input rules, SMS templates, appointment rules, verification codes, and the Supabase database with its double-booking guard and per-clinic isolation.

**Architecture:** A Next.js 16 App Router app in `src/`. Business rules live in small pure TypeScript modules under `src/lib`, unit-tested with Vitest and free of I/O. Integrity rules live in Postgres (check constraints, an exclusion constraint, composite foreign keys, RLS, SQL functions), tested against the development Supabase project. Plans 2 to 4 add pages and I/O on top of these modules.

**Tech Stack:** Next.js 16.3 (App Router, Turbopack), TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth, RLS) with `@supabase/ssr` and `@supabase/supabase-js`, Vitest, Supabase CLI (the `supabase` npm package), Node 24.

**Spec:** `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md`

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags.
- Every commit message ends with this paragraph: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone. Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and clock times as minutes after midnight.
- Mobile numbers are stored as `+639XXXXXXXXX`.
- Field limits: clinic name 80; clinic short name for texts 20 (must not start with "test" in any case); dentist name 60; dentist short name 16; first and last name 50 each; status reason 36; procedure name 60 with a duration of 5 to 480 minutes; HMO 60; address 200; booking link (slug) 3 to 24 characters of `[a-z0-9-]`, starting and ending with a letter or digit.
- Reserved booking links: `a`, `app`, `api`, `auth`, `login`, `signup`, `onboarding`, `forgot`, `reset-password`, `privacy`, `terms`, `admin`, `static`, `_next`.
- Booking rule defaults: 30 minute slots (15, 30, or 60 allowed), 120 minutes minimum notice, 60 day booking window, clinic alerts by push.
- Texts are printable ASCII without the GSM-7 extension characters (square brackets, backslash, caret, backtick, curly braces, pipe, tilde), and at most 160 characters with worst-case inputs.
- Environment variable names follow Supabase's current key names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- Dev server port: 3600.
- Dependencies allowed in this plan: `@supabase/ssr`, `@supabase/supabase-js`, `vitest`, `supabase`. Adding anything else needs a stated reason.

## Plan map

The spec is built in four plans. Each ends with working, tested software. Plans 2 to 4 are written after this one lands, against the real code.

1. **Foundation (this plan):** scaffold, design foundation, pure domain logic, database. Deliverable: `npm test`, `npm run test:db`, `npm run lint`, and `npm run build` all pass.
2. **Accounts and public booking:** Supabase clients and proxy, sign up and log in (with forgot password and the `/auth/confirm` callback), onboarding, availability loader, SMS sender, clinic alerts, booking service, the public booking page, and the patient view/cancel link. Deliverable: a clinic signs up and receives a verified online request in development.
3. **Clinic dashboard:** shell and navigation, Requests, Schedule, New appointment and Move, Patients, Settings. Deliverable: a clinic runs its whole day from the dashboard.
4. **Launch readiness:** PWA and push, the daily job with Vercel Cron, landing and legal pages, the Playwright happy path, and an impeccable polish and audit pass. Deliverable: v1 ready to deploy.

## File map for this plan

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Test runner config; loads `.env.local` for database tests |
| `.env.example` | Every environment variable, documented |
| `.claude/launch.json` | Dev server entry for the Claude app, port 3600 |
| `PRODUCT.md`, `DESIGN.md` | Product truth and design system (impeccable) |
| `src/app/globals.css`, `src/app/layout.tsx` | Design tokens and fonts |
| `src/lib/time.ts` | Manila calendar and clock helpers, ASCII date and time formatting |
| `src/lib/slots.ts` | Open start times, open dates, working-hours checks |
| `src/lib/phone.ts` | PH mobile normalization |
| `src/lib/validate.ts` | Booking link, short name, text, and birthday rules |
| `src/lib/sms/templates.ts` | Text templates, ASCII sanitizer, credit counting |
| `src/lib/appointments.ts` | Status change rules, reminder selection, cancel and attendance checks |
| `src/lib/codes.ts` | Verification codes, rate limit, manage tokens, verified-device cookie |
| `supabase/migrations/*.sql` | Schema, access rules, SQL functions |
| `tests/unit/*.test.ts` | Unit tests (no network) |
| `tests/db/*.test.ts`, `tests/db/helpers.ts` | Database tests against the development Supabase project |

---

### Task 1: Scaffold the app

**Files:**
- Create (generated by create-next-app): `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `public/*`, `AGENTS.md`, `CLAUDE.md`
- Create: `vitest.config.ts`, `.env.example`, `.claude/launch.json`
- Modify: `package.json` (scripts), `.gitignore`, `README.md` (replace the generated one)

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `dev` (port 3600), `test` (unit), `test:db` (database), `db:push`; the `@/` import alias pointing at `src/`; `.env.local` loading for Vitest.

- [ ] **Step 1: Generate the Next.js app in the repo root**

The folder already holds `.git` and `docs`, which create-next-app allows.

Run:
```powershell
npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```
Expected: ends with `Success! Created brightsmile`. If it lists conflicting files and stops, report them and stop.

- [ ] **Step 2: Install the dependencies**

Run:
```powershell
npm install @supabase/ssr @supabase/supabase-js; npm install -D vitest supabase
```
Expected: both installs finish without errors.

- [ ] **Step 3: Set the scripts**

In `package.json`, set these entries inside `"scripts"` and leave the generated `build` and `lint` entries as they are:

```json
"dev": "next dev -p 3600",
"start": "next start -p 3600",
"test": "vitest run tests/unit",
"test:db": "vitest run tests/db",
"db:push": "supabase db push --yes"
```

- [ ] **Step 4: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests need the Supabase keys. Earlier files win, as in Next.js.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Optional file.
  }
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Document the environment**

The generated `.gitignore` ignores every `.env*` file in any folder (that also covers `supabase/.env` from Task 2). Append these lines to `.gitignore` so the example is committed and the Supabase CLI's local state is not:

```gitignore
!.env.example
supabase/.temp/
supabase/.branches/
```

Create `.env.example`:

```dotenv
# Supabase development project: Project Settings > API Keys
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# Where the app runs. Used in links inside text messages.
APP_URL=http://localhost:3600

# Random secrets. Generate each one with:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
APP_SECRET=
CRON_SECRET=

# log: write texts to the sms_log table and the console. live: send through Semaphore.
SMS_MODE=log
SEMAPHORE_API_KEY=
SEMAPHORE_SENDER_NAME=BrightSmile
SMS_LOW_CREDIT_THRESHOLD=500
OPERATOR_MOBILE=

# Web push keys. Generate with: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:hello@example.com

# Contact address shown on the privacy and terms pages.
NEXT_PUBLIC_CONTACT_EMAIL=
```

- [ ] **Step 6: Add the launch entry and the README**

Create `.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "brightsmile",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 3600
    }
  ]
}
```

Replace `README.md` with:

```markdown
# BrightSmile

Online booking for dental clinics in the Philippines. Patients request a time from the clinic's booking link, the clinic approves it, and patients get text confirmations and reminders.

- Spec: `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md`
- Plans: `docs/superpowers/plans/`

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in (the comments say where each value comes from).
3. `npm run dev`, then open http://localhost:3600

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3600 |
| `npm test` | Unit tests, no network needed |
| `npm run test:db` | Database tests against the development Supabase project |
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
```

- [ ] **Step 7: Verify the scaffold**

Run:
```powershell
npm run lint; npm run build
```
Expected: lint reports no errors and the build ends with the route table (`/` listed).

- [ ] **Step 8: Commit**

```powershell
git add -A; git commit -m "chore: scaffold Next.js app with Vitest and Supabase packages" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Kai sets up the Supabase development project

This is a human checkpoint. Claude can't create accounts or handle database passwords. Kai does steps 1 to 6; the agent does step 7.

**Files:**
- Create (by Kai): `.env.local`, `supabase/config.toml` (from `supabase init`), `supabase/.env`

**Interfaces:**
- Consumes: `.env.example` from Task 1.
- Produces: a linked Supabase project; `npm run db:push` works without prompting; `.env.local` holds the Supabase URL and keys plus `APP_SECRET` and `CRON_SECRET`.

- [ ] **Step 1 (Kai): Create the project**

At supabase.com, create an account and a project named `brightsmile-dev` in the Southeast Asia (Singapore) region. Save the database password in your password manager.

- [ ] **Step 2 (Kai): Fill in `.env.local`**

```powershell
Copy-Item .env.example .env.local
```

From Project Settings > API Keys, paste the Project URL, the publishable key, and the secret key into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`. Generate `APP_SECRET` and `CRON_SECRET` by running this twice and pasting one output into each:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Leave `SMS_MODE=log`.

- [ ] **Step 3 (Kai): Turn off email confirmation in this development project only**

Authentication > Sign In / Providers > Email: switch off "Confirm email". Production keeps it on (spec section 5.4). This keeps local sign-ups from hitting Supabase's built-in email limit.

- [ ] **Step 4 (Kai): Link the CLI**

In a terminal at `C:\Users\User\brightsmile`:

```powershell
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

Answer N to the editor settings questions. The project ref is the subdomain of the Project URL. `link` asks for the database password once.

- [ ] **Step 5 (Kai): Let migrations run without a password prompt**

Create `supabase/.env` containing one line (your database password after the `=`):

```dotenv
SUPABASE_DB_PASSWORD=your-database-password
```

- [ ] **Step 6 (Kai): Check the password file is ignored by git**

```powershell
git check-ignore supabase/.env
```
Expected: prints `supabase/.env`. If it prints nothing, stop and tell Claude.

- [ ] **Step 7 (agent): Verify the setup**

Run:
```powershell
node --env-file=.env.local -e "for (const k of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','APP_SECRET','CRON_SECRET']) console.log(k, process.env[k] ? 'set' : 'MISSING')"
npx supabase db push --dry-run
```
Expected: all five print `set`, and the dry run finishes without asking for a password (it may say the remote database is up to date).

- [ ] **Step 8 (agent): Commit the CLI config**

```powershell
git add supabase; git status --short
```
Expected: `supabase/config.toml` is staged (plus `supabase/.gitignore` if the CLI created one). `supabase/.env` and `supabase/.temp/` must not appear. If either does, stop and fix `.gitignore` first.

```powershell
git commit -m "chore: link Supabase CLI to the development project" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Design foundation (main session, with Kai)

Run this in the main session, not a subagent: the impeccable skill asks Kai questions. Kai's standing rule is that all UI work goes through impeccable, starting with `init` on a new project.

**Files:**
- Create: `PRODUCT.md`, `DESIGN.md`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`

**Interfaces:**
- Consumes: the scaffold from Task 1.
- Produces: the token contract every later UI task uses: Tailwind classes `bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-accent`, `text-accent`, `text-on-accent`, `text-danger`, `text-ok`, `text-warn`, `rounded-card`, `font-sans`, `font-display`. Values may change with DESIGN.md; names may not.

- [ ] **Step 1: Capture product truth**

Invoke the `impeccable` skill with `init`. Ground it in the spec: clinic staff on phones between patients, patients booking on mobile data, Philippine context, the honesty rules. Expected: `PRODUCT.md` exists.

- [ ] **Step 2: Establish the design system**

Use impeccable to shape the two surfaces (the public booking page and the clinic dashboard) and write `DESIGN.md` with a named design point of view, palette (light and dark), type pairing, radius, and motion rules. Expected: `DESIGN.md` exists and names its point of view.

- [ ] **Step 3: Apply the token contract**

Replace `src/app/globals.css`. The values below are starting values; use the ones DESIGN.md chose, but keep every variable and token name.

```css
@import "tailwindcss";

:root {
  --canvas: #f6f4ef;
  --surface: #ffffff;
  --ink: #1d2320;
  --muted: #5d6762;
  --line: #e2ded5;
  --accent: #1f6f5c;
  --on-accent: #ffffff;
  --danger: #b3261e;
  --ok: #1f7a3a;
  --warn: #9a5b00;
}

@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #121614;
    --surface: #1a201d;
    --ink: #eef1ef;
    --muted: #a3ada8;
    --line: #2c3430;
    --accent: #5fc2a6;
    --on-accent: #0c1411;
    --danger: #f2b8b5;
    --ok: #8fd6a2;
    --warn: #f0c37a;
  }
}

@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-on-accent: var(--on-accent);
  --color-danger: var(--danger);
  --color-ok: var(--ok);
  --color-warn: var(--warn);
  --font-sans: var(--font-body);
  --font-display: var(--font-heading);
  --radius-card: 14px;
}

body {
  background: var(--canvas);
  color: var(--ink);
}
```

- [ ] **Step 4: Wire the fonts**

Replace `src/app/layout.tsx`. Swap the two Google fonts for DESIGN.md's pairing; keep the variable names `--font-body` and `--font-heading`.

```tsx
import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import "./globals.css";

const body = Figtree({ subsets: ["latin"], variable: "--font-body" });
const heading = Fraunces({ subsets: ["latin"], variable: "--font-heading" });

export const metadata: Metadata = {
  title: { default: "BrightSmile", template: "%s | BrightSmile" },
  description: "Online booking for dental clinics in the Philippines.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${heading.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 5: Verify**

Run `npm run build` (expected: passes). Start the dev server with the Browser pane's `preview_start` using the `brightsmile` launch entry, open http://localhost:3600, and check the canvas color and fonts in both light and dark (`resize_window` with `colorScheme`). Show Kai a screenshot.

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "feat: add product truth, design system, and design tokens" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Manila time helpers

**Files:**
- Create: `src/lib/time.ts`
- Test: `tests/unit/time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `@/lib/time`):
  - `manilaInstant(date: string, minutes: number): Date`
  - `manilaDate(instant: Date): string`
  - `manilaMinutes(instant: Date): number`
  - `weekday(date: string): number` (0 Sunday to 6 Saturday)
  - `addDays(date: string, days: number): string`
  - `parseClock(clock: string): number` (accepts `"09:00"` and Postgres `"09:00:00"`)
  - `formatClock(minutes: number): string` (`"13:30"`)
  - `formatDate(instant: Date): string` (`"Thu Sep 24"`)
  - `formatMinutes(minutes: number): string` (`"1:05 PM"`)
  - `formatTime(instant: Date): string` (`"10:00 AM"`)
  - `monthDates(month: string): string[]` (`"2026-02"` gives 28 dates)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  formatClock,
  formatDate,
  formatMinutes,
  formatTime,
  manilaDate,
  manilaInstant,
  manilaMinutes,
  monthDates,
  parseClock,
  weekday,
} from "@/lib/time";

describe("Manila time", () => {
  it("builds the UTC instant for a Manila wall-clock time", () => {
    expect(manilaInstant("2026-09-24", 9 * 60).toISOString()).toBe("2026-09-24T01:00:00.000Z");
  });

  it("puts times before 8 AM on the previous UTC day", () => {
    expect(manilaInstant("2026-09-24", 7 * 60 + 30).toISOString()).toBe("2026-09-23T23:30:00.000Z");
  });

  it("reads the Manila date and minutes of a late-evening UTC instant", () => {
    const instant = new Date("2026-09-30T16:30:00Z"); // 12:30 AM on Oct 1 in Manila
    expect(manilaDate(instant)).toBe("2026-10-01");
    expect(manilaMinutes(instant)).toBe(30);
  });

  it("round-trips a date and time", () => {
    const instant = manilaInstant("2026-12-31", 23 * 60 + 45);
    expect(manilaDate(instant)).toBe("2026-12-31");
    expect(manilaMinutes(instant)).toBe(23 * 60 + 45);
  });

  it("gives the weekday of a date", () => {
    expect(weekday("2026-09-20")).toBe(0);
    expect(weekday("2026-09-26")).toBe(6);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("parses and formats clock strings", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("13:30:00")).toBe(810);
    expect(formatClock(810)).toBe("13:30");
    expect(formatClock(0)).toBe("00:00");
  });

  it("formats dates and times in plain ASCII", () => {
    const instant = manilaInstant("2026-09-24", 10 * 60);
    expect(formatDate(instant)).toBe("Thu Sep 24");
    expect(formatTime(instant)).toBe("10:00 AM");
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(12 * 60)).toBe("12:00 PM");
    expect(formatMinutes(13 * 60 + 5)).toBe("1:05 PM");
  });

  it("lists every date in a month", () => {
    const dates = monthDates("2026-02");
    expect(dates).toHaveLength(28);
    expect(dates[0]).toBe("2026-02-01");
    expect(dates.at(-1)).toBe("2026-02-28");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: FAIL, cannot resolve `@/lib/time`.

- [ ] **Step 3: Implement**

Create `src/lib/time.ts`:

```ts
// Manila is UTC+8 all year with no daylight saving, so a fixed offset is exact.
const OFFSET_MS = 8 * 60 * 60_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** The instant of a Manila wall-clock time: a "YYYY-MM-DD" date plus minutes after midnight. */
export function manilaInstant(date: string, minutes: number): Date {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - OFFSET_MS);
}

/** The Manila calendar date ("YYYY-MM-DD") of an instant. */
export function manilaDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes after Manila midnight of an instant. */
export function manilaMinutes(instant: Date): number {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** 0 for Sunday to 6 for Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = ymd(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "09:00" or Postgres "09:00:00" to minutes after midnight. */
export function parseClock(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes after midnight to "HH:MM", the format of time inputs and Postgres. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "Thu Sep 24". Built by hand because Intl output varies by runtime and can contain non-ASCII spaces. */
export function formatDate(instant: Date): string {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return `${DAYS[shifted.getUTCDay()]} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}`;
}

/** "10:00 AM". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function formatTime(instant: Date): string {
  return formatMinutes(manilaMinutes(instant));
}

/** Every date of a "YYYY-MM" month. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/time.ts tests/unit/time.test.ts; git commit -m "feat: add Manila time helpers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Slot engine

**Files:**
- Create: `src/lib/slots.ts`
- Test: `tests/unit/slots.test.ts`

**Interfaces:**
- Consumes: `manilaInstant`, `manilaDate`, `manilaMinutes`, `weekday`, `addDays` from `@/lib/time`.
- Produces (from `@/lib/slots`):
  - `type Block = { start: number; end: number }` (minutes after Manila midnight)
  - `type Busy = { start: Date; end: Date; id?: string }` (appointments and time off)
  - `type BookingRules = { slotMinutes: number; minNoticeMinutes: number; maxDaysAhead: number }`
  - `openStarts(input: { date: string; blocks: Block[]; busy: Busy[]; durationMinutes: number; rules: BookingRules; now: Date; ignoreId?: string }): Date[]`
  - `openDates(input: { dates: string[]; blocksByWeekday: Block[][]; busy: Busy[]; durationMinutes: number; rules: BookingRules; now: Date; ignoreId?: string }): string[]`
  - `withinHours(start: Date, end: Date, blocksByWeekday: Block[][]): boolean`
  - `fitsAnyBlock(durationMinutes: number, blocksByWeekday: Block[][]): boolean`

`blocksByWeekday` is always 7 arrays, index 0 for Sunday.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitsAnyBlock, openDates, openStarts, withinHours, type Block } from "@/lib/slots";
import { formatTime, manilaInstant } from "@/lib/time";

const rules = { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 };
const day: Block[] = [
  { start: 9 * 60, end: 12 * 60 },
  { start: 13 * 60, end: 17 * 60 },
];
const now = manilaInstant("2026-09-22", 8 * 60); // Tuesday 8:00 AM in Manila
const times = (starts: Date[]) => starts.map(formatTime);
const week = (d: Block[], saturday: Block[] = d): Block[][] => [[], d, d, d, d, d, saturday];

describe("openStarts", () => {
  it("offers every 30 minutes inside each block, skipping the lunch gap", () => {
    const starts = openStarts({ date: "2026-09-24", blocks: day, busy: [], durationMinutes: 30, rules, now });
    expect(times(starts)).toEqual([
      "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM",
      "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
    ]);
  });

  it("keeps the whole appointment inside one block", () => {
    const starts = openStarts({ date: "2026-09-24", blocks: day, busy: [], durationMinutes: 90, rules, now });
    expect(times(starts)).toEqual([
      "9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM",
      "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM",
    ]);
  });

  it("skips starts that overlap a busy interval but allows back-to-back", () => {
    const busy = [{ start: manilaInstant("2026-09-24", 10 * 60), end: manilaInstant("2026-09-24", 11 * 60) }];
    const starts = openStarts({ date: "2026-09-24", blocks: [{ start: 9 * 60, end: 12 * 60 }], busy, durationMinutes: 60, rules, now });
    expect(times(starts)).toEqual(["9:00 AM", "11:00 AM"]);
  });

  it("respects the minimum notice", () => {
    const later = manilaInstant("2026-09-22", 9 * 60 + 15);
    const starts = openStarts({ date: "2026-09-22", blocks: [{ start: 9 * 60, end: 12 * 60 }], busy: [], durationMinutes: 30, rules, now: later });
    expect(times(starts)).toEqual(["11:30 AM"]);
  });

  it("returns nothing for past dates or dates beyond the booking window", () => {
    const base = { blocks: day, busy: [], durationMinutes: 30, rules, now };
    expect(openStarts({ ...base, date: "2026-09-21" })).toEqual([]);
    expect(openStarts({ ...base, date: "2026-11-21" })).toHaveLength(14);
    expect(openStarts({ ...base, date: "2026-11-22" })).toEqual([]);
  });

  it("uses Manila dates when the server clock is UTC", () => {
    const lateUtc = new Date("2026-09-22T17:00:00Z"); // 1:00 AM on Sep 23 in Manila
    const base = { blocks: day, busy: [], durationMinutes: 30, rules, now: lateUtc };
    expect(openStarts({ ...base, date: "2026-09-22" })).toEqual([]);
    expect(openStarts({ ...base, date: "2026-09-23" })).toHaveLength(14);
  });

  it("ignores the appointment being moved", () => {
    const busy = [{ id: "a1", start: manilaInstant("2026-09-24", 9 * 60), end: manilaInstant("2026-09-24", 10 * 60) }];
    const starts = openStarts({ date: "2026-09-24", blocks: [{ start: 9 * 60, end: 10 * 60 }], busy, durationMinutes: 60, rules, now, ignoreId: "a1" });
    expect(times(starts)).toEqual(["9:00 AM"]);
  });
});

describe("openDates", () => {
  it("lists only dates with at least one open start", () => {
    const dates = openDates({
      dates: ["2026-09-26", "2026-09-27", "2026-09-28"],
      blocksByWeekday: week(day, [{ start: 9 * 60, end: 12 * 60 }]),
      busy: [],
      durationMinutes: 30,
      rules,
      now,
    });
    expect(dates).toEqual(["2026-09-26", "2026-09-28"]); // Saturday and Monday; closed Sunday
  });
});

describe("withinHours", () => {
  it("flags appointments outside working hours", () => {
    const blocks = week(day, []);
    expect(withinHours(manilaInstant("2026-09-24", 9 * 60), manilaInstant("2026-09-24", 10 * 60), blocks)).toBe(true);
    expect(withinHours(manilaInstant("2026-09-24", 11 * 60 + 30), manilaInstant("2026-09-24", 12 * 60 + 30), blocks)).toBe(false);
    expect(withinHours(manilaInstant("2026-09-27", 9 * 60), manilaInstant("2026-09-27", 10 * 60), blocks)).toBe(false);
  });
});

describe("fitsAnyBlock", () => {
  it("knows when no block is long enough", () => {
    const blocks: Block[][] = [[], [{ start: 9 * 60, end: 12 * 60 }], [], [], [], [], []];
    expect(fitsAnyBlock(180, blocks)).toBe(true);
    expect(fitsAnyBlock(181, blocks)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/slots.test.ts`
Expected: FAIL, cannot resolve `@/lib/slots`.

- [ ] **Step 3: Implement**

Create `src/lib/slots.ts`:

```ts
import { addDays, manilaDate, manilaInstant, manilaMinutes, weekday } from "@/lib/time";

/** A working block in minutes after Manila midnight, e.g. 9:00 to 12:00 is { start: 540, end: 720 }. */
export type Block = { start: number; end: number };
/** A pending or confirmed appointment, or time off. */
export type Busy = { start: Date; end: Date; id?: string };
export type BookingRules = { slotMinutes: number; minNoticeMinutes: number; maxDaysAhead: number };

type StartsInput = {
  date: string;
  blocks: Block[];
  busy: Busy[];
  durationMinutes: number;
  rules: BookingRules;
  now: Date;
  ignoreId?: string;
};

/** Open start times for one dentist on one Manila date (spec section 8). */
export function openStarts({ date, blocks, busy, durationMinutes, rules, now, ignoreId }: StartsInput): Date[] {
  const today = manilaDate(now);
  if (date < today || date > addDays(today, rules.maxDaysAhead)) return [];
  const earliest = now.getTime() + rules.minNoticeMinutes * 60_000;
  const others = ignoreId ? busy.filter((b) => b.id !== ignoreId) : busy;
  const starts: Date[] = [];
  for (const block of [...blocks].sort((a, b) => a.start - b.start)) {
    for (let m = block.start; m + durationMinutes <= block.end; m += rules.slotMinutes) {
      const start = manilaInstant(date, m);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (start.getTime() < earliest) continue;
      if (others.some((b) => b.start < end && start < b.end)) continue;
      starts.push(start);
    }
  }
  return starts;
}

type DatesInput = Omit<StartsInput, "date" | "blocks"> & { dates: string[]; blocksByWeekday: Block[][] };

/** The dates, out of `dates`, with at least one open start. */
export function openDates({ dates, blocksByWeekday, ...rest }: DatesInput): string[] {
  return dates.filter((date) => openStarts({ ...rest, date, blocks: blocksByWeekday[weekday(date)] }).length > 0);
}

/** True when the appointment lies inside one working block of its Manila weekday. */
export function withinHours(start: Date, end: Date, blocksByWeekday: Block[][]): boolean {
  const from = manilaMinutes(start);
  const to = from + (end.getTime() - start.getTime()) / 60_000;
  return blocksByWeekday[weekday(manilaDate(start))].some((b) => b.start <= from && to <= b.end);
}

/** False when no working block anywhere in the week can hold this duration. */
export function fitsAnyBlock(durationMinutes: number, blocksByWeekday: Block[][]): boolean {
  return blocksByWeekday.some((blocks) => blocks.some((b) => b.end - b.start >= durationMinutes));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/slots.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/slots.ts tests/unit/slots.test.ts; git commit -m "feat: add slot engine for open times and dates" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Phone numbers and input rules

**Files:**
- Create: `src/lib/phone.ts`, `src/lib/validate.ts`
- Test: `tests/unit/phone.test.ts`, `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `@/lib/phone`: `normalizeMobile(input: string): string | null` (to `+639XXXXXXXXX`), `localMobile(e164: string): string` (to `09XXXXXXXXX`)
  - `@/lib/validate`: `RESERVED_SLUGS: Set<string>`, `LIMITS` (object of the Global Constraints limits), `slugProblem(slug: string): string | null`, `slugFromName(name: string): string`, `smsNameProblem(name: string, max: number): string | null`, `cleanText(value: unknown, max: number, optional?: boolean): string | null` (null means invalid; `""` means optional and empty), `cleanBirthday(value: unknown, today: string): string | null` (same convention)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/phone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localMobile, normalizeMobile } from "@/lib/phone";

describe("normalizeMobile", () => {
  it.each([
    "09171234567",
    "9171234567",
    "639171234567",
    "+639171234567",
    "0917 123 4567",
    "0917-123-4567",
    "+63 (917) 123 4567",
  ])("accepts %s", (input) => {
    expect(normalizeMobile(input)).toBe("+639171234567");
  });

  it.each(["(02) 8123 4567", "0281234567", "+14155552671", "091712345", "091712345678", "+6391712345678", "abc", ""])(
    "rejects %s",
    (input) => {
      expect(normalizeMobile(input)).toBeNull();
    },
  );

  it("formats for people and for Semaphore", () => {
    expect(localMobile("+639171234567")).toBe("09171234567");
  });
});
```

Create `tests/unit/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cleanBirthday, cleanText, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";

describe("slugProblem", () => {
  it.each(["elite-dental", "abc", "a1b", "smile-studio-dental-mkt1"])("accepts %s", (slug) => {
    expect(slugProblem(slug)).toBeNull();
  });

  it.each(["ab", "-abc", "abc-", "Elite", "elite_dental", "a".repeat(25)])("rejects %s", (slug) => {
    expect(slugProblem(slug)).not.toBeNull();
  });

  it.each(["app", "login", "privacy", "reset-password"])("rejects reserved %s", (slug) => {
    expect(slugProblem(slug)).toMatch(/reserved/);
  });
});

describe("slugFromName", () => {
  it("turns a clinic name into a booking link", () => {
    expect(slugFromName("Elite Dental Makati")).toBe("elite-dental-makati");
    expect(slugFromName("Dr. Peña's Dental Clinic & Orthodontics")).toBe("dr-pena-s-dental-clinic");
  });
});

describe("smsNameProblem", () => {
  it("accepts a normal short name", () => {
    expect(smsNameProblem("Elite Dental", 20)).toBeNull();
  });

  it("rejects empty and over-long names", () => {
    expect(smsNameProblem("  ", 20)).not.toBeNull();
    expect(smsNameProblem("A".repeat(21), 20)).not.toBeNull();
  });

  it("rejects names the SMS provider would drop", () => {
    expect(smsNameProblem("Test Dental", 20)).toMatch(/test/i);
  });
});

describe("cleanText", () => {
  it("trims and enforces the limit", () => {
    expect(cleanText("  Ana ", 50)).toBe("Ana");
    expect(cleanText("", 50)).toBeNull();
    expect(cleanText("", 36, true)).toBe("");
    expect(cleanText("x".repeat(37), 36, true)).toBeNull();
    expect(cleanText(42, 50)).toBeNull();
  });
});

describe("cleanBirthday", () => {
  const today = "2026-09-22";

  it("accepts an empty or real past date", () => {
    expect(cleanBirthday("", today)).toBe("");
    expect(cleanBirthday("1990-05-17", today)).toBe("1990-05-17");
  });

  it("rejects future, ancient, malformed, and impossible dates", () => {
    expect(cleanBirthday("2026-09-23", today)).toBeNull();
    expect(cleanBirthday("1899-12-31", today)).toBeNull();
    expect(cleanBirthday("17/05/1990", today)).toBeNull();
    expect(cleanBirthday("2026-02-30", today)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/phone.test.ts tests/unit/validate.test.ts`
Expected: FAIL, cannot resolve `@/lib/phone` and `@/lib/validate`.

- [ ] **Step 3: Implement**

Create `src/lib/phone.ts`:

```ts
/** "+639171234567" from any common way of writing a Philippine mobile number, or null. */
export function normalizeMobile(input: string): string | null {
  const match = input.replace(/[\s().-]/g, "").match(/^(?:\+63|63|0)?(9\d{9})$/);
  return match ? `+63${match[1]}` : null;
}

/** "09171234567": how people write it, and the format Semaphore expects. */
export function localMobile(e164: string): string {
  return `0${e164.slice(3)}`;
}
```

Create `src/lib/validate.ts`:

```ts
export const RESERVED_SLUGS = new Set([
  "a", "app", "api", "auth", "login", "signup", "onboarding", "forgot",
  "reset-password", "privacy", "terms", "admin", "static", "_next",
]);

export const LIMITS = {
  clinicName: 80,
  clinicSmsName: 20,
  dentistName: 60,
  dentistSmsName: 16,
  personName: 50,
  reason: 36,
  procedureName: 60,
  hmo: 60,
  address: 200,
} as const;

/** Why a booking link can't be used, or null when it can. */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(slug)) {
    return "Use 3 to 24 lowercase letters, numbers, or hyphens, starting and ending with a letter or number.";
  }
  if (RESERVED_SLUGS.has(slug)) return "That link is reserved. Try another.";
  return null;
}

/** A booking link suggestion: "Elite Dental Makati" becomes "elite-dental-makati". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
}

/** Why a short name for texts can't be used, or null. Semaphore silently drops texts that start with "TEST". */
export function smsNameProblem(name: string, max: number): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > max) return `Use 1 to ${max} characters.`;
  if (/^test/i.test(trimmed)) return 'The SMS provider drops texts that start with "test". Try another name.';
  return null;
}

/** The trimmed text when it fits, "" when optional and empty, otherwise null. */
export function cleanText(value: unknown, max: number, optional = false): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) return optional ? "" : null;
  return trimmed.length <= max ? trimmed : null;
}

/** A "YYYY-MM-DD" birthday between 1900-01-01 and today, "" when empty, otherwise null. */
export function cleanBirthday(value: unknown, today: string): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed >= "1900-01-01" && trimmed <= today ? trimmed : null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit/phone.test.ts tests/unit/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/phone.ts src/lib/validate.ts tests/unit/phone.test.ts tests/unit/validate.test.ts; git commit -m "feat: add mobile number and input validation rules" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: SMS templates

**Files:**
- Create: `src/lib/sms/templates.ts`
- Test: `tests/unit/sms-templates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `@/lib/sms/templates`):
  - `type SmsKind = "otp" | "request_alert" | "confirmed" | "declined" | "moved" | "cancelled" | "reminder" | "patient_cancel_alert" | "low_credit"`
  - `type SmsVars = { clinic?: string; first?: string; lastInitial?: string; dentist?: string; date?: string; time?: string; reason?: string; link?: string; bookLink?: string; appUrl?: string; code?: string; credits?: number }`
  - `toSmsText(text: string): string`
  - `renderSms(kind: SmsKind, vars: SmsVars): string`
  - `smsCredits(kind: SmsKind, body: string): number`

`clinic` is the clinic's short name, `dentist` is the dentist's short name (pass it only when the clinic has 2 or more active dentists), `link` is `{APP_URL}/a/{token}`, `bookLink` is `{APP_URL}/{slug}`. Plan 2 sends the OTP with `code: "{otp}"` so Semaphore fills it in.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/sms-templates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderSms, smsCredits, toSmsText, type SmsKind } from "@/lib/sms/templates";

const kinds: SmsKind[] = [
  "otp", "request_alert", "confirmed", "declined", "moved",
  "cancelled", "reminder", "patient_cancel_alert", "low_credit",
];

// Longest values the database allows (Global Constraints) plus the longest date and time.
const worst = {
  clinic: "C".repeat(20),
  dentist: "D".repeat(16),
  first: "F".repeat(12),
  lastInitial: "L",
  date: "Wed Sep 30",
  time: "10:30 AM",
  reason: "R".repeat(36),
  code: "123456",
  credits: 99999,
};

const appUrls = [...new Set(["https://brightsmile.ph", process.env.APP_URL].filter((u): u is string => !!u))];

describe.each(appUrls)("worst case with %s", (appUrl) => {
  const vars = { ...worst, appUrl, link: `${appUrl}/a/${"t".repeat(12)}`, bookLink: `${appUrl}/${"s".repeat(24)}` };

  it.each(kinds)("%s fits in one text", (kind) => {
    const text = renderSms(kind, vars);
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/^[\x20-\x7E]+$/);
    expect(smsCredits(kind, text)).toBe(kind === "otp" ? 2 : 1);
  });
});

describe("renderSms", () => {
  it("renders a confirmation", () => {
    const text = renderSms("confirmed", {
      clinic: "Elite Dental", first: "Juan", date: "Thu Sep 24", time: "10:00 AM",
      link: "https://brightsmile.ph/a/Ab12Cd34Ef56",
    });
    expect(text).toBe("Elite Dental: Juan's visit on Thu Sep 24, 10:00 AM is confirmed. View or cancel: https://brightsmile.ph/a/Ab12Cd34Ef56");
  });

  it("adds the dentist when given", () => {
    const text = renderSms("reminder", {
      clinic: "Elite Dental", first: "Juan", time: "10:00 AM", dentist: "Dr. Reyes", link: "https://x.ph/a/1",
    });
    expect(text).toBe("Elite Dental: Reminder, Juan's visit is tomorrow at 10:00 AM with Dr. Reyes. Can't come? Cancel: https://x.ph/a/1");
  });

  it("ends a reason with a period", () => {
    const text = renderSms("declined", {
      clinic: "Elite Dental", date: "Thu Sep 24", time: "10:00 AM", reason: "Dentist unavailable", bookLink: "https://x.ph/elite",
    });
    expect(text).toBe("Elite Dental can't take Thu Sep 24, 10:00 AM. Dentist unavailable. Rebook: https://x.ph/elite");
  });

  it("never starts a clinic alert with the patient's name", () => {
    const text = renderSms("patient_cancel_alert", { first: "Tester", lastInitial: "Q", date: "Thu Sep 24", time: "10:00 AM" });
    expect(text).toBe("Cancelled: Tester Q., Thu Sep 24, 10:00 AM.");
  });

  it("cuts long first names to 12 characters", () => {
    const text = renderSms("confirmed", { clinic: "X", first: "Maximilianoooo", date: "d", time: "t", link: "l" });
    expect(text).toContain("Maximilianoo's");
  });
});

describe("toSmsText", () => {
  it("keeps texts in plain ASCII without GSM-7 extension characters", () => {
    expect(toSmsText("Ngiti ng Parañaque \u2018Dental\u2019 \u20B1500 \u2014 ok {x}")).toBe("Ngiti ng Paranaque 'Dental' PHP500 - ok x");
  });
});

describe("smsCredits", () => {
  it("counts parts and doubles the OTP route", () => {
    expect(smsCredits("confirmed", "x".repeat(160))).toBe(1);
    expect(smsCredits("confirmed", "x".repeat(161))).toBe(2);
    expect(smsCredits("otp", "x".repeat(100))).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/sms-templates.test.ts`
Expected: FAIL, cannot resolve `@/lib/sms/templates`.

- [ ] **Step 3: Implement**

Create `src/lib/sms/templates.ts`:

```ts
export type SmsKind =
  | "otp"
  | "request_alert"
  | "confirmed"
  | "declined"
  | "moved"
  | "cancelled"
  | "reminder"
  | "patient_cancel_alert"
  | "low_credit";

export type SmsVars = {
  clinic?: string;
  first?: string;
  lastInitial?: string;
  dentist?: string;
  date?: string;
  time?: string;
  reason?: string;
  link?: string;
  bookLink?: string;
  appUrl?: string;
  code?: string;
  credits?: number;
};

/**
 * Printable ASCII minus the GSM-7 extension characters, so every character costs one unit
 * and no gateway switches the text to Unicode (which cuts a part to 70 characters).
 */
export function toSmsText(text: string): string {
  return text
    .replace(/\u20B1/g, "PHP")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[[\\\]^`{|}~]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Spec section 10.1. Every template fits in 160 characters with the field limits in Global Constraints. */
export function renderSms(kind: SmsKind, v: SmsVars): string {
  const first = (v.first ?? "").slice(0, 12);
  const who = `${first} ${v.lastInitial ?? ""}.`;
  const withDentist = v.dentist ? ` with ${v.dentist}` : "";
  const reason = v.reason ? ` ${/[.!?]$/.test(v.reason) ? v.reason : `${v.reason}.`}` : "";
  const texts: Record<SmsKind, () => string> = {
    otp: () => `Your code for ${v.clinic} is ${v.code}. It expires in 5 minutes. Don't share it with anyone.`,
    request_alert: () => `New request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
    confirmed: () => `${v.clinic}: ${first}'s visit on ${v.date}, ${v.time}${withDentist} is confirmed. View or cancel: ${v.link}`,
    declined: () => `${v.clinic} can't take ${v.date}, ${v.time}.${reason} Rebook: ${v.bookLink}`,
    moved: () => `${v.clinic}: ${first}'s visit moved to ${v.date}, ${v.time}${withDentist}. View or cancel: ${v.link}`,
    cancelled: () => `${v.clinic} cancelled the ${v.date}, ${v.time} visit.${reason} Rebook: ${v.bookLink}`,
    reminder: () => `${v.clinic}: Reminder, ${first}'s visit is tomorrow at ${v.time}${withDentist}. Can't come? Cancel: ${v.link}`,
    patient_cancel_alert: () => `Cancelled: ${who}, ${v.date}, ${v.time}${withDentist}.`,
    low_credit: () => `BrightSmile: Semaphore balance is ${v.credits} credits. Top up before reminders fail.`,
  };
  return toSmsText(texts[kind]());
}

/** Semaphore credits: one per 160 characters (153 per part when split), doubled on the OTP route. */
export function smsCredits(kind: SmsKind, body: string): number {
  const parts = body.length <= 160 ? 1 : Math.ceil(body.length / 153);
  return parts * (kind === "otp" ? 2 : 1);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/sms-templates.test.ts`
Expected: PASS. If a worst-case test fails, shorten that template's wording; never raise a field limit.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/sms/templates.ts tests/unit/sms-templates.test.ts; git commit -m "feat: add SMS templates that always fit one text" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Appointment rules

**Files:**
- Create: `src/lib/appointments.ts`
- Test: `tests/unit/appointments.test.ts`

**Interfaces:**
- Consumes: `addDays`, `manilaDate`, `manilaInstant` from `@/lib/time`.
- Produces (from `@/lib/appointments`):
  - `type Status = "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show" | "expired"`
  - `type Actor = "patient" | "staff" | "system"`
  - `canTransition(from: Status, to: Status, actor: Actor): boolean`
  - `isCancellable(a: { status: Status; starts_at: Date }, now: Date): boolean`
  - `canMarkAttendance(a: { status: Status; starts_at: Date }, now: Date): boolean`
  - `needsReminder(a: { status: Status; starts_at: Date; confirmed_at: Date | null; reminder_sent_at: Date | null }, now: Date): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/appointments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canMarkAttendance, canTransition, isCancellable, needsReminder } from "@/lib/appointments";
import { manilaInstant } from "@/lib/time";

describe("canTransition", () => {
  it.each([
    ["pending", "confirmed", "staff"],
    ["pending", "declined", "staff"],
    ["pending", "cancelled", "patient"],
    ["pending", "expired", "system"],
    ["confirmed", "cancelled", "staff"],
    ["confirmed", "cancelled", "patient"],
    ["confirmed", "completed", "staff"],
    ["confirmed", "no_show", "staff"],
    ["completed", "no_show", "staff"],
    ["no_show", "completed", "staff"],
  ] as const)("allows %s to %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it.each([
    ["pending", "confirmed", "patient"],
    ["pending", "completed", "staff"],
    ["pending", "expired", "staff"],
    ["declined", "confirmed", "staff"],
    ["cancelled", "confirmed", "staff"],
    ["expired", "confirmed", "staff"],
    ["confirmed", "pending", "staff"],
    ["completed", "cancelled", "patient"],
  ] as const)("rejects %s to %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });
});

const now = manilaInstant("2026-09-22", 9 * 60);
const tomorrow10 = manilaInstant("2026-09-23", 10 * 60);
const earlier = manilaInstant("2026-09-22", 8 * 60);

describe("needsReminder", () => {
  const base = {
    status: "confirmed" as const,
    starts_at: tomorrow10,
    confirmed_at: manilaInstant("2026-09-21", 15 * 60),
    reminder_sent_at: null,
  };

  it("reminds tomorrow's confirmed visits that were confirmed before today", () => {
    expect(needsReminder(base, now)).toBe(true);
  });

  it("skips visits confirmed today, already reminded, not tomorrow, or not confirmed", () => {
    expect(needsReminder({ ...base, confirmed_at: earlier }, now)).toBe(false);
    expect(needsReminder({ ...base, reminder_sent_at: now }, now)).toBe(false);
    expect(needsReminder({ ...base, starts_at: manilaInstant("2026-09-24", 10 * 60) }, now)).toBe(false);
    expect(needsReminder({ ...base, status: "pending" }, now)).toBe(false);
  });

  it("uses Manila dates when the server clock is UTC", () => {
    const lateUtc = new Date("2026-09-22T16:30:00Z"); // 12:30 AM on Sep 23 in Manila
    expect(needsReminder({ ...base, starts_at: manilaInstant("2026-09-24", 9 * 60) }, lateUtc)).toBe(true);
  });
});

describe("isCancellable", () => {
  it("lets patients cancel future pending or confirmed visits only", () => {
    expect(isCancellable({ status: "confirmed", starts_at: tomorrow10 }, now)).toBe(true);
    expect(isCancellable({ status: "pending", starts_at: tomorrow10 }, now)).toBe(true);
    expect(isCancellable({ status: "confirmed", starts_at: earlier }, now)).toBe(false);
    expect(isCancellable({ status: "declined", starts_at: tomorrow10 }, now)).toBe(false);
  });
});

describe("canMarkAttendance", () => {
  it("allows marking once the visit has started", () => {
    expect(canMarkAttendance({ status: "confirmed", starts_at: earlier }, now)).toBe(true);
    expect(canMarkAttendance({ status: "no_show", starts_at: earlier }, now)).toBe(true);
    expect(canMarkAttendance({ status: "confirmed", starts_at: tomorrow10 }, now)).toBe(false);
    expect(canMarkAttendance({ status: "pending", starts_at: earlier }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/appointments.test.ts`
Expected: FAIL, cannot resolve `@/lib/appointments`.

- [ ] **Step 3: Implement**

Create `src/lib/appointments.ts`:

```ts
import { addDays, manilaDate, manilaInstant } from "@/lib/time";

export type Status = "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "no_show" | "expired";
export type Actor = "patient" | "staff" | "system";

// Spec section 9.2. Key is "from>to"; value is who may make that change.
const ALLOWED: Record<string, Actor[]> = {
  "pending>confirmed": ["staff"],
  "pending>declined": ["staff"],
  "pending>cancelled": ["patient"],
  "pending>expired": ["system"],
  "confirmed>cancelled": ["staff", "patient"],
  "confirmed>completed": ["staff"],
  "confirmed>no_show": ["staff"],
  "completed>no_show": ["staff"],
  "no_show>completed": ["staff"],
};

export function canTransition(from: Status, to: Status, actor: Actor): boolean {
  return ALLOWED[`${from}>${to}`]?.includes(actor) ?? false;
}

/** The patient's view/cancel link offers Cancel only for future pending or confirmed visits. */
export function isCancellable(a: { status: Status; starts_at: Date }, now: Date): boolean {
  return (a.status === "pending" || a.status === "confirmed") && a.starts_at > now;
}

/** Completed and No-show can be set once the visit has started, and switched to fix mistakes. */
export function canMarkAttendance(a: { status: Status; starts_at: Date }, now: Date): boolean {
  return ["confirmed", "completed", "no_show"].includes(a.status) && a.starts_at <= now;
}

/** Spec section 11: tomorrow's confirmed visits, not yet reminded, confirmed before today (Manila dates). */
export function needsReminder(
  a: { status: Status; starts_at: Date; confirmed_at: Date | null; reminder_sent_at: Date | null },
  now: Date,
): boolean {
  const today = manilaDate(now);
  return (
    a.status === "confirmed" &&
    a.reminder_sent_at === null &&
    a.confirmed_at !== null &&
    manilaDate(a.starts_at) === addDays(today, 1) &&
    a.confirmed_at < manilaInstant(today, 0)
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/appointments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/appointments.ts tests/unit/appointments.test.ts; git commit -m "feat: add appointment status and reminder rules" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Codes, tokens, and the verified-device cookie

**Files:**
- Create: `src/lib/codes.ts`
- Test: `tests/unit/codes.test.ts`

**Interfaces:**
- Consumes: `process.env.APP_SECRET` (throws when missing).
- Produces (from `@/lib/codes`):
  - `OTP = { ttlMs: 300000, maxAttempts: 5, resendMs: 60000, perMobilePerHour: 3, perIpPerHour: 10 }`
  - `newCode(): string` (6 digits)
  - `hashCode(requestId: string, code: string): string`
  - `type CodeCheck = "ok" | "wrong" | "expired" | "locked" | "used"`
  - `checkCode(req: { id: string; code_hash: string; attempts: number; expires_at: Date; verified_at: Date | null }, code: string, now: Date): CodeCheck`
  - `isRateLimited(sentToMobileLastHour: number, sentFromIpLastHour: number): boolean`
  - `newToken(): string` (12 base62 characters)
  - `DEVICE_COOKIE = "bs_verified"`
  - `signDevice(mobiles: string[], now: Date): string`
  - `readDevice(value: string | undefined, now: Date): string[]`

`otp_requests.id` is generated in TypeScript (`crypto.randomUUID()`) before hashing, because the hash binds the code to its request.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/codes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { checkCode, hashCode, isRateLimited, newCode, newToken, OTP, readDevice, signDevice } from "@/lib/codes";

beforeAll(() => {
  process.env.APP_SECRET ??= "unit-test-secret";
});

const now = new Date("2026-09-22T01:00:00Z");

describe("verification codes", () => {
  it("makes 6 digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  const request = () => ({
    id: "r1",
    code_hash: hashCode("r1", "123456"),
    attempts: 0,
    expires_at: new Date(now.getTime() + OTP.ttlMs),
    verified_at: null as Date | null,
  });

  it("accepts the right code and rejects a wrong one", () => {
    expect(checkCode(request(), "123456", now)).toBe("ok");
    expect(checkCode(request(), " 123456 ", now)).toBe("ok");
    expect(checkCode(request(), "654321", now)).toBe("wrong");
  });

  it("refuses used, expired, and locked requests", () => {
    expect(checkCode({ ...request(), verified_at: now }, "123456", now)).toBe("used");
    expect(checkCode(request(), "123456", new Date(now.getTime() + OTP.ttlMs))).toBe("expired");
    expect(checkCode({ ...request(), attempts: OTP.maxAttempts }, "123456", now)).toBe("locked");
  });

  it("binds the hash to its request", () => {
    expect(hashCode("r1", "123456")).not.toBe(hashCode("r2", "123456"));
  });

  it("rate limits at 3 per mobile and 10 per IP address", () => {
    expect(isRateLimited(2, 9)).toBe(false);
    expect(isRateLimited(3, 0)).toBe(true);
    expect(isRateLimited(0, 10)).toBe(true);
  });
});

describe("manage tokens", () => {
  it("are 12 base62 characters and unique", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(newToken()).not.toBe(token);
  });
});

describe("verified-device cookie", () => {
  it("round-trips", () => {
    expect(readDevice(signDevice(["+639171234567"], now), now)).toEqual(["+639171234567"]);
  });

  it("keeps the last 5 distinct mobiles", () => {
    const mobiles = ["+639000000001", "+639000000002", "+639000000003", "+639000000004", "+639000000005", "+639000000006"];
    expect(readDevice(signDevice(mobiles, now), now)).toEqual(mobiles.slice(1));
  });

  it("rejects tampered, expired, and malformed cookies", () => {
    const value = signDevice(["+639171234567"], now);
    const signature = value.split(".")[1];
    const forged = Buffer.from(JSON.stringify({ m: ["+639999999999"], exp: now.getTime() + 1e9 })).toString("base64url");
    expect(readDevice(`${forged}.${signature}`, now)).toEqual([]);
    expect(readDevice(value, new Date(now.getTime() + 181 * 86_400_000))).toEqual([]);
    expect(readDevice("garbage", now)).toEqual([]);
    expect(readDevice(undefined, now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/codes.test.ts`
Expected: FAIL, cannot resolve `@/lib/codes`.

- [ ] **Step 3: Implement**

Create `src/lib/codes.ts`:

```ts
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Spec section 10.3.
export const OTP = {
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendMs: 60_000,
  perMobilePerHour: 3,
  perIpPerHour: 10,
} as const;

export const DEVICE_COOKIE = "bs_verified";
const DEVICE_DAYS = 180;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type CodeCheck = "ok" | "wrong" | "expired" | "locked" | "used";

function hmac(data: string): string {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set");
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function newCode(): string {
  return String(randomInt(1_000_000)).padStart(6, "0");
}

export function hashCode(requestId: string, code: string): string {
  return hmac(`otp:${requestId}:${code}`);
}

export function checkCode(
  req: { id: string; code_hash: string; attempts: number; expires_at: Date; verified_at: Date | null },
  code: string,
  now: Date,
): CodeCheck {
  if (req.verified_at) return "used";
  if (req.expires_at <= now) return "expired";
  if (req.attempts >= OTP.maxAttempts) return "locked";
  return sameText(req.code_hash, hashCode(req.id, code.trim())) ? "ok" : "wrong";
}

export function isRateLimited(sentToMobileLastHour: number, sentFromIpLastHour: number): boolean {
  return sentToMobileLastHour >= OTP.perMobilePerHour || sentFromIpLastHour >= OTP.perIpPerHour;
}

/** About 71 bits: unguessable for a view/cancel link. */
export function newToken(): string {
  return Array.from({ length: 12 }, () => BASE62[randomInt(62)]).join("");
}

/** Signed cookie value remembering up to 5 verified mobiles for 180 days. */
export function signDevice(mobiles: string[], now: Date): string {
  const body = { m: [...new Set(mobiles)].slice(-5), exp: now.getTime() + DEVICE_DAYS * 86_400_000 };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${hmac(`device:${payload}`)}`;
}

export function readDevice(value: string | undefined, now: Date): string[] {
  const [payload, signature] = (value ?? "").split(".");
  if (!payload || !signature || !sameText(signature, hmac(`device:${payload}`))) return [];
  try {
    const { m, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp <= now.getTime() || !Array.isArray(m)) return [];
    return m.filter((x: unknown): x is string => typeof x === "string");
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/codes.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm test`
Expected: every file in `tests/unit` passes.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/codes.ts tests/unit/codes.test.ts; git commit -m "feat: add verification codes, manage tokens, and device cookie" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Database schema and the double-booking guard

**Files:**
- Create: `supabase/migrations/20260922000100_schema.sql`
- Create: `tests/db/helpers.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: `newToken` from `@/lib/codes`; the linked project from Task 2.
- Produces: tables `clinics`, `clinic_members`, `dentists`, `working_hours`, `time_off`, `procedures`, `patients`, `appointments`, `appointment_events`, `sms_log`, `otp_requests`, `push_subscriptions` with the columns below; constraint `no_overlap`; test helpers `adminDb()`, `anonDb()`, `rand()`, `signedInUser()`, `deleteUser(id)`, `seedClinic()`, `deleteClinic(id)`, `appointmentRow(seed, startsAt, endsAt, status?)`, `type Seed`.

RLS is switched on for every table here, with no policies yet, so nothing is reachable through the public API until Task 11 adds the rules.

- [ ] **Step 1: Write the test helpers**

Create `tests/db/helpers.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { newToken } from "@/lib/codes";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Server-side client with the secret key. Bypasses RLS. */
export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, noSession);
}

/** A client with no session: a stranger on the internet. */
export function anonDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, noSession);
}

export const rand = () => Math.random().toString(36).slice(2, 8);

/** A confirmed user, and a client signed in as them. */
export async function signedInUser(): Promise<{ db: SupabaseClient; userId: string }> {
  const email = `bs-test-${rand()}@example.com`;
  const password = `pw-${rand()}-${rand()}-${rand()}`;
  const { data, error } = await adminDb().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anonDb();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id };
}

export async function deleteUser(userId: string) {
  await adminDb().auth.admin.deleteUser(userId);
}

/** A clinic with one dentist working 9:00 to 17:00 every day, and one patient. */
export async function seedClinic() {
  const db = adminDb();
  const { data: clinic } = await db
    .from("clinics")
    .insert({ name: "Seed Clinic", sms_name: "Seed Clinic", slug: `t-${rand()}`, mobile: "+639170000000" })
    .select()
    .single()
    .throwOnError();
  const { data: dentist } = await db
    .from("dentists")
    .insert({ clinic_id: clinic.id, name: "Dr. Seed", sms_name: "Dr. Seed" })
    .select()
    .single()
    .throwOnError();
  await db
    .from("working_hours")
    .insert([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      clinic_id: clinic.id, dentist_id: dentist.id, weekday, start_time: "09:00", end_time: "17:00",
    })))
    .throwOnError();
  const { data: patient } = await db
    .from("patients")
    .insert({ clinic_id: clinic.id, first_name: "Ana", last_name: "Cruz", mobile: "+639171112222" })
    .select()
    .single()
    .throwOnError();
  return { clinic, dentist, patient };
}

export type Seed = Awaited<ReturnType<typeof seedClinic>>;

export async function deleteClinic(id: string) {
  await adminDb().from("clinics").delete().eq("id", id);
}

/** An appointments row for direct inserts (no slot checks). */
export function appointmentRow(seed: Seed, startsAt: string, endsAt: string, status = "confirmed") {
  return {
    clinic_id: seed.clinic.id,
    dentist_id: seed.dentist.id,
    patient_id: seed.patient.id,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    procedure_names: ["Consultation"],
    source: "online",
    manage_token: newToken(),
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, appointmentRow, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;
const at = (clock: string) => `2030-01-07T${clock}:00+08:00`; // far from any real data

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("double booking guard", () => {
  it("rejects an overlapping appointment for the same dentist", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at("09:00"), at("10:00"))).throwOnError();
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("09:30"), at("10:30"), "pending"));
    expect(error?.code).toBe("23P01");
  });

  it("allows back-to-back appointments", async () => {
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("10:00"), at("10:30")));
    expect(error).toBeNull();
  });

  it("ignores declined and cancelled appointments", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00"), "declined")).throwOnError();
    await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00"), "cancelled")).throwOnError();
    const { error } = await db.from("appointments").insert(appointmentRow(seed, at("11:00"), at("12:00")));
    expect(error).toBeNull();
  });

  it("lets two dentists overlap", async () => {
    const { data: other } = await db
      .from("dentists")
      .insert({ clinic_id: seed.clinic.id, name: "Dr. Two", sms_name: "Dr. Two" })
      .select()
      .single()
      .throwOnError();
    const { error } = await db.from("appointments").insert({ ...appointmentRow(seed, at("09:00"), at("10:00")), dentist_id: other.id });
    expect(error).toBeNull();
  });
});

describe("integrity checks", () => {
  it("refuses a dentist from another clinic", async () => {
    const other = await seedClinic();
    const { error } = await db.from("appointments").insert({ ...appointmentRow(seed, at("14:00"), at("15:00")), dentist_id: other.dentist.id });
    expect(error?.code).toBe("23503");
    await deleteClinic(other.clinic.id);
  });

  it("refuses short names that start with test", async () => {
    const { error } = await db.from("clinics").insert({ name: "X", sms_name: "TEST Dental", slug: `t-${rand()}`, mobile: "+639170000000" });
    expect(error?.code).toBe("23514");
  });

  it("refuses badly formed mobiles and booking links", async () => {
    for (const bad of [{ mobile: "09170000000", slug: `t-${rand()}` }, { mobile: "+639170000000", slug: "Bad Slug" }]) {
      const { error } = await db.from("clinics").insert({ name: "X", sms_name: "X", ...bad });
      expect(error?.code).toBe("23514");
    }
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test:db`
Expected: FAIL with errors saying the `clinics` table doesn't exist.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260922000100_schema.sql`:

```sql
-- BrightSmile core schema (spec section 7). All times are timestamptz.

create extension if not exists btree_gist with schema extensions;

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  sms_name text not null check (char_length(sms_name) between 1 and 20 and sms_name !~* '^test'),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$'),
  mobile text not null check (mobile ~ '^\+639[0-9]{9}$'),
  address text not null default '' check (char_length(address) <= 200),
  maps_url text check (maps_url ~ '^https://'),
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  min_notice_minutes int not null default 120 check (min_notice_minutes between 0 and 10080),
  max_days_ahead int not null default 60 check (max_days_ahead between 1 and 365),
  alert_channel text not null default 'push' check (alert_channel in ('push', 'sms')),
  created_at timestamptz not null default now()
);

create table public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role = 'owner'),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);
create index clinic_members_user on public.clinic_members (user_id);

create table public.dentists (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  sms_name text not null check (char_length(sms_name) between 1 and 16),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);

-- Composite foreign keys keep every row inside its own clinic.
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  dentist_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id) on delete cascade
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  dentist_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 100),
  check (starts_at < ends_at),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id) on delete cascade
);
create index time_off_dentist_time on public.time_off (dentist_id, starts_at);

create table public.procedures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  duration_minutes int not null check (duration_minutes between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 50),
  last_name text not null check (char_length(last_name) between 1 and 50),
  mobile text check (mobile ~ '^\+639[0-9]{9}$'),
  birthday date check (birthday >= '1900-01-01'),
  hmo text check (char_length(hmo) <= 60),
  consent_at timestamptz,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, clinic_id)
);
-- One patient per clinic, mobile, and name, so a parent can book several children with one number.
create unique index patients_identity
  on public.patients (clinic_id, mobile, lower(first_name), lower(last_name))
  where anonymized_at is null;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  dentist_id uuid not null,
  patient_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed', 'no_show', 'expired')),
  procedure_names text[] not null check (cardinality(procedure_names) between 1 and 20),
  source text not null check (source in ('online', 'manual')),
  status_reason text check (char_length(status_reason) <= 36),
  manage_token text not null unique check (manage_token ~ '^[A-Za-z0-9]{12}$'),
  confirmed_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  foreign key (dentist_id, clinic_id) references public.dentists (id, clinic_id),
  foreign key (patient_id, clinic_id) references public.patients (id, clinic_id),
  -- Spec section 7: a dentist can never have two overlapping pending or confirmed appointments.
  constraint no_overlap exclude using gist (
    dentist_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);
create index appointments_clinic_time on public.appointments (clinic_id, starts_at);
create index appointments_patient on public.appointments (patient_id);

create table public.appointment_events (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('patient', 'staff', 'system')),
  user_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index appointment_events_appointment on public.appointment_events (appointment_id);

create table public.sms_log (
  id bigint generated always as identity primary key,
  clinic_id uuid references public.clinics (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  to_mobile text not null,
  kind text not null,
  body text,
  credits int not null,
  status text not null check (status in ('logged', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);
create index sms_log_appointment on public.sms_log (appointment_id);
create index sms_log_clinic_time on public.sms_log (clinic_id, created_at);

-- id is generated by the server before hashing, because the code hash is bound to it.
create table public.otp_requests (
  id uuid primary key,
  mobile text not null,
  ip text not null,
  code_hash text not null,
  booking jsonb not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_requests_mobile_time on public.otp_requests (mobile, created_at);
create index otp_requests_ip_time on public.otp_requests (ip, created_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Locked by default. Task 11 adds the access rules.
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.dentists enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.procedures enable row level security;
alter table public.patients enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_events enable row level security;
alter table public.sms_log enable row level security;
alter table public.otp_requests enable row level security;
alter table public.push_subscriptions enable row level security;
```

- [ ] **Step 5: Apply it**

Run: `npm run db:push`
Expected: `Applying migration 20260922000100_schema.sql...` and `Finished supabase db push.`

- [ ] **Step 6: Run the test to see it pass**

Run: `npm run test:db`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/20260922000100_schema.sql tests/db/helpers.ts tests/db/schema.test.ts; git commit -m "feat: add database schema with the double booking guard" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Clinic isolation and the onboarding function

**Files:**
- Create: `supabase/migrations/20260922000200_access.sql`
- Test: `tests/db/access.test.ts`

**Interfaces:**
- Consumes: the schema from Task 10; `adminDb`, `anonDb`, `rand`, `signedInUser`, `deleteUser`, `deleteClinic` from `tests/db/helpers.ts`.
- Produces:
  - Table grants: `authenticated` may select, insert, update, and delete in `public` (rows filtered by RLS); `anon` gets nothing.
  - `public.is_clinic_member(cid uuid) returns boolean`
  - RLS policies on every clinic table (see migration).
  - `public.create_clinic(p jsonb) returns uuid`, callable by signed-in users only. Payload shape:
    ```json
    {
      "name": "Elite Dental", "sms_name": "Elite Dental", "slug": "elite-dental",
      "mobile": "+639171234567", "address": "Makati",
      "dentist": { "name": "Dr. Ana Reyes", "sms_name": "Dr. Reyes" },
      "hours": [{ "weekday": 1, "start": "09:00", "end": "12:00" }],
      "procedures": [{ "name": "Consultation", "minutes": 30 }]
    }
    ```
    Errors: `42501` when not signed in; `23505` when the account already has a clinic or the slug is taken; `23514` when a field breaks a check.

- [ ] **Step 1: Write the failing test**

Create `tests/db/access.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, anonDb, deleteClinic, deleteUser, rand, signedInUser } from "./helpers";

type User = Awaited<ReturnType<typeof signedInUser>>;

const payload = (slug: string) => ({
  name: "Access Clinic",
  sms_name: "Access Clinic",
  slug,
  mobile: "+639170000001",
  address: "Cebu",
  dentist: { name: "Dr. Access", sms_name: "Dr. Access" },
  hours: [
    { weekday: 1, start: "09:00", end: "12:00" },
    { weekday: 1, start: "13:00", end: "17:00" },
  ],
  procedures: [
    { name: "Consultation", minutes: 30 },
    { name: "Braces Adjustment", minutes: 30 },
  ],
});

let a: User;
let b: User;
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  a = await signedInUser();
  b = await signedInUser();
  clinicA = (await a.db.rpc("create_clinic", { p: payload(`a-${rand()}`) }).throwOnError()).data;
  clinicB = (await b.db.rpc("create_clinic", { p: payload(`b-${rand()}`) }).throwOnError()).data;
});

afterAll(async () => {
  await deleteClinic(clinicA);
  await deleteClinic(clinicB);
  await deleteUser(a.userId);
  await deleteUser(b.userId);
});

describe("create_clinic", () => {
  it("creates the clinic with its dentist, hours, and procedures", async () => {
    const { data: dentists } = await a.db.from("dentists").select("name").eq("clinic_id", clinicA).throwOnError();
    expect(dentists.map((d: { name: string }) => d.name)).toEqual(["Dr. Access"]);
    const hours = await a.db.from("working_hours").select("*", { count: "exact", head: true }).eq("clinic_id", clinicA).throwOnError();
    expect(hours.count).toBe(2);
    const procedures = await a.db.from("procedures").select("*", { count: "exact", head: true }).eq("clinic_id", clinicA).throwOnError();
    expect(procedures.count).toBe(2);
  });

  it("allows only one clinic per account", async () => {
    const { error } = await a.db.rpc("create_clinic", { p: payload(`a2-${rand()}`) });
    expect(error?.code).toBe("23505");
  });

  it("reports a taken booking link", async () => {
    const c = await signedInUser();
    const { data: taken } = await adminDb().from("clinics").select("slug").eq("id", clinicA).single().throwOnError();
    const { error } = await c.db.rpc("create_clinic", { p: payload(taken.slug) });
    expect(error?.code).toBe("23505");
    await deleteUser(c.userId);
  });
});

describe("clinic isolation", () => {
  it("shows members only their own clinic", async () => {
    const { data } = await a.db.from("clinics").select("id").throwOnError();
    expect(data.map((c: { id: string }) => c.id)).toEqual([clinicA]);
  });

  it("hides another clinic's patients and blocks writing into it", async () => {
    await adminDb()
      .from("patients")
      .insert({ clinic_id: clinicB, first_name: "Secret", last_name: "Patient", mobile: "+639175550000" })
      .throwOnError();
    const { data } = await a.db.from("patients").select("id").eq("clinic_id", clinicB).throwOnError();
    expect(data).toEqual([]);
    const { error } = await a.db.from("patients").insert({ clinic_id: clinicB, first_name: "Sneaky", last_name: "Insert" });
    expect(error?.code).toBe("42501");
  });

  it("cannot change another clinic", async () => {
    const { data } = await a.db.from("clinics").update({ name: "Hacked" }).eq("id", clinicB).select().throwOnError();
    expect(data).toEqual([]);
  });

  it("gives strangers nothing", async () => {
    const { data } = await anonDb().from("patients").select("id");
    expect(data ?? []).toEqual([]);
    const { error } = await anonDb().rpc("create_clinic", { p: payload(`c-${rand()}`) });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/db/access.test.ts`
Expected: FAIL, `create_clinic` doesn't exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260922000200_access.sql`:

```sql
-- Access rules (spec section 7, RLS). Explicit grants, so behavior doesn't depend on project defaults.

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- security definer so policies can read clinic_members without recursing through its own policy.
create function public.is_clinic_member(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = cid and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function public.is_clinic_member(uuid) from public, anon;
grant execute on function public.is_clinic_member(uuid) to authenticated;

create policy "members manage their clinic" on public.clinics
  for all to authenticated
  using (public.is_clinic_member(id)) with check (public.is_clinic_member(id));

create policy "users see their memberships" on public.clinic_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "members manage dentists" on public.dentists
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage working hours" on public.working_hours
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage time off" on public.time_off
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage procedures" on public.procedures
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage patients" on public.patients
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members manage appointments" on public.appointments
  for all to authenticated
  using (public.is_clinic_member(clinic_id)) with check (public.is_clinic_member(clinic_id));

create policy "members read events" on public.appointment_events
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "members add events" on public.appointment_events
  for insert to authenticated
  with check (public.is_clinic_member(clinic_id));

create policy "members read their texts" on public.sms_log
  for select to authenticated
  using (public.is_clinic_member(clinic_id));

create policy "users manage their push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_clinic_member(clinic_id))
  with check (user_id = (select auth.uid()) and public.is_clinic_member(clinic_id));

-- otp_requests has no policies: only the server's secret key can touch it.

-- Onboarding (spec section 5.4): one call creates the clinic, membership, first dentist,
-- hours, and procedures together. security definer because the clinic row can't pass RLS
-- before its membership exists.
create function public.create_clinic(p jsonb)
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

  return v_clinic;
end;
$$;
revoke execute on function public.create_clinic(jsonb) from public, anon;
grant execute on function public.create_clinic(jsonb) to authenticated;
```

- [ ] **Step 4: Apply it**

Run: `npm run db:push`
Expected: `Applying migration 20260922000200_access.sql...` and `Finished supabase db push.`

- [ ] **Step 5: Run the database tests to see them pass**

Run: `npm run test:db`
Expected: PASS for `schema.test.ts` and `access.test.ts`.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260922000200_access.sql tests/db/access.test.ts; git commit -m "feat: add clinic isolation rules and the onboarding function" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Booking and status functions

**Files:**
- Create: `supabase/migrations/20260922000300_booking_functions.sql`
- Test: `tests/db/booking.test.ts`

**Interfaces:**
- Consumes: Tasks 10 and 11; `newToken` from `@/lib/codes`; the helpers.
- Produces (all `security invoker`, so RLS applies to signed-in staff while the secret key bypasses it):
  - `public.create_booking(p_clinic_id uuid, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_procedure_names text[], p_source text, p_status text, p_manage_token text, p_patient_id uuid, p_first_name text, p_last_name text, p_mobile text, p_birthday date, p_hmo text, p_consent boolean, p_actor text, p_user_id uuid) returns uuid`. Matches or creates the patient (same clinic, same mobile, same names ignoring case), inserts the appointment, writes the first event, all in one transaction. Pass `p_patient_id` to book an existing patient. Raises `23P01` when the time is taken and `P0002` when `p_patient_id` isn't in the clinic. Callable by `authenticated` and `service_role`.
  - `public.set_appointment_status(p_id uuid, p_from text, p_to text, p_actor text, p_user_id uuid, p_reason text) returns boolean`. Changes the status only if it still equals `p_from`; sets `confirmed_at` when confirming; writes an event. Returns false when the appointment moved on. Callers check `canTransition` first.
  - `public.move_appointment(p_id uuid, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_user_id uuid) returns boolean`. Confirmed appointments only; resets `confirmed_at` to now and clears `reminder_sent_at`; writes an event with reason `moved`. Raises `23P01` on overlap.
  - `public.expire_pending() returns integer`. Marks past pending requests `expired` with a `system` event; returns the count. Callable by `service_role` only.

- [ ] **Step 1: Write the failing test**

Create `tests/db/booking.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { adminDb, anonDb, appointmentRow, deleteClinic, deleteUser, seedClinic, signedInUser, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;
const at = (clock: string) => `2030-01-08T${clock}:00+08:00`;

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

function args(overrides: Record<string, unknown> = {}) {
  return {
    p_clinic_id: seed.clinic.id,
    p_dentist_id: seed.dentist.id,
    p_starts_at: at("09:00"),
    p_ends_at: at("09:30"),
    p_procedure_names: ["Consultation"],
    p_source: "online",
    p_status: "pending",
    p_manage_token: newToken(),
    p_patient_id: null,
    p_first_name: "Maria",
    p_last_name: "Santos",
    p_mobile: "+639181234567",
    p_birthday: null,
    p_hmo: "",
    p_consent: true,
    p_actor: "patient",
    p_user_id: null,
    ...overrides,
  };
}

describe("create_booking", () => {
  it("creates the patient, the appointment, and its first event together", async () => {
    const { data: id } = await db.rpc("create_booking", args()).throwOnError();
    const { data: appt } = await db.from("appointments").select("status, patient_id").eq("id", id).single().throwOnError();
    expect(appt.status).toBe("pending");
    const { data: patient } = await db.from("patients").select("first_name, consent_at").eq("id", appt.patient_id).single().throwOnError();
    expect(patient.first_name).toBe("Maria");
    expect(patient.consent_at).not.toBeNull();
    const { data: events } = await db.from("appointment_events").select("to_status, actor").eq("appointment_id", id).throwOnError();
    expect(events).toEqual([{ to_status: "pending", actor: "patient" }]);
  });

  it("reuses the patient when mobile and name match, ignoring case", async () => {
    await db
      .rpc("create_booking", args({ p_starts_at: at("10:00"), p_ends_at: at("10:30"), p_first_name: "MARIA", p_birthday: "1990-05-17" }))
      .throwOnError();
    const { data } = await db
      .from("patients")
      .select("birthday")
      .eq("clinic_id", seed.clinic.id)
      .eq("mobile", "+639181234567")
      .throwOnError();
    expect(data).toEqual([{ birthday: "1990-05-17" }]);
  });

  it("keeps a parent and child with one number as two patients", async () => {
    await db.rpc("create_booking", args({ p_starts_at: at("11:00"), p_ends_at: at("11:30"), p_first_name: "Junior" })).throwOnError();
    const { data } = await db
      .from("patients")
      .select("first_name")
      .eq("clinic_id", seed.clinic.id)
      .eq("mobile", "+639181234567")
      .order("first_name")
      .throwOnError();
    expect(data.map((p: { first_name: string }) => p.first_name)).toEqual(["Junior", "Maria"]);
  });

  it("rolls back a new patient when the time is taken", async () => {
    const { error } = await db.rpc("create_booking", args({ p_first_name: "Late", p_last_name: "Comer" }));
    expect(error?.code).toBe("23P01");
    const { data } = await db.from("patients").select("id").eq("clinic_id", seed.clinic.id).eq("first_name", "Late").throwOnError();
    expect(data).toEqual([]);
  });

  it("lets clinic staff book manually, but not into another clinic", async () => {
    const staff = await signedInUser();
    await db.from("clinic_members").insert({ clinic_id: seed.clinic.id, user_id: staff.userId }).throwOnError();
    const walkIn = args({
      p_starts_at: at("16:30"), p_ends_at: at("17:00"), p_status: "confirmed", p_source: "manual",
      p_actor: "staff", p_user_id: staff.userId, p_first_name: "Walk", p_last_name: "In", p_mobile: null,
    });
    const ok = await staff.db.rpc("create_booking", walkIn);
    expect(ok.error).toBeNull();

    const other = await seedClinic();
    const blocked = await staff.db.rpc("create_booking", args({ p_clinic_id: other.clinic.id, p_dentist_id: other.dentist.id }));
    expect(blocked.error?.code).toBe("42501");

    await deleteClinic(other.clinic.id);
    await deleteUser(staff.userId);
  });

  it("does not let strangers call it", async () => {
    const { error } = await anonDb().rpc("create_booking", args({ p_starts_at: at("12:00"), p_ends_at: at("12:30") }));
    expect(error).not.toBeNull();
  });
});

describe("set_appointment_status", () => {
  it("confirms a pending request once", async () => {
    const { data: id } = await db.rpc("create_booking", args({ p_starts_at: at("13:00"), p_ends_at: at("13:30") })).throwOnError();
    const change = { p_id: id, p_from: "pending", p_to: "confirmed", p_actor: "staff", p_user_id: null, p_reason: null };
    expect((await db.rpc("set_appointment_status", change)).data).toBe(true);
    expect((await db.rpc("set_appointment_status", change)).data).toBe(false);
    const { data: appt } = await db.from("appointments").select("status, confirmed_at").eq("id", id).single().throwOnError();
    expect(appt.status).toBe("confirmed");
    expect(appt.confirmed_at).not.toBeNull();
  });
});

describe("move_appointment", () => {
  it("moves a confirmed appointment and resets its reminder", async () => {
    const { data: id } = await db
      .rpc("create_booking", args({ p_starts_at: at("14:00"), p_ends_at: at("14:30"), p_status: "confirmed", p_source: "manual", p_actor: "staff" }))
      .throwOnError();
    await db.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id).throwOnError();
    const { data: moved } = await db
      .rpc("move_appointment", { p_id: id, p_dentist_id: seed.dentist.id, p_starts_at: at("15:00"), p_ends_at: at("15:30"), p_user_id: null })
      .throwOnError();
    expect(moved).toBe(true);
    const { data: appt } = await db.from("appointments").select("starts_at, reminder_sent_at").eq("id", id).single().throwOnError();
    expect(new Date(appt.starts_at).getTime()).toBe(new Date(at("15:00")).getTime());
    expect(appt.reminder_sent_at).toBeNull();
  });

  it("refuses to move onto another appointment", async () => {
    const { data: id } = await db
      .rpc("create_booking", args({ p_starts_at: at("16:00"), p_ends_at: at("16:30"), p_status: "confirmed", p_source: "manual", p_actor: "staff" }))
      .throwOnError();
    const { error } = await db.rpc("move_appointment", {
      p_id: id, p_dentist_id: seed.dentist.id, p_starts_at: at("15:00"), p_ends_at: at("15:30"), p_user_id: null,
    });
    expect(error?.code).toBe("23P01");
  });
});

describe("expire_pending", () => {
  it("expires pending requests whose time has passed", async () => {
    const start = new Date(Date.now() - 2 * 3_600_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    const { data: row } = await db
      .from("appointments")
      .insert(appointmentRow(seed, start.toISOString(), end.toISOString(), "pending"))
      .select("id")
      .single()
      .throwOnError();
    const { data: count } = await db.rpc("expire_pending").throwOnError();
    expect(count).toBeGreaterThanOrEqual(1);
    const { data: appt } = await db.from("appointments").select("status").eq("id", row.id).single().throwOnError();
    expect(appt.status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/db/booking.test.ts`
Expected: FAIL, `create_booking` doesn't exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260922000300_booking_functions.sql`:

```sql
-- Booking and status changes (spec sections 9.1 and 9.2). security invoker: RLS applies to
-- signed-in staff, while the server's secret key (service_role) bypasses it for online bookings.

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
  p_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_patient uuid := p_patient_id;
  v_id uuid;
begin
  if v_patient is not null then
    perform 1 from public.patients
    where id = v_patient and clinic_id = p_clinic_id and anonymized_at is null;
    if not found then
      raise exception 'patient not found' using errcode = 'P0002';
    end if;
  else
    select id into v_patient from public.patients
    where clinic_id = p_clinic_id
      and anonymized_at is null
      and mobile is not distinct from p_mobile
      and lower(first_name) = lower(p_first_name)
      and lower(last_name) = lower(p_last_name)
    limit 1;

    if v_patient is null then
      insert into public.patients (clinic_id, first_name, last_name, mobile, birthday, hmo, consent_at)
      values (p_clinic_id, p_first_name, p_last_name, p_mobile, p_birthday, nullif(p_hmo, ''),
              case when p_consent then now() end)
      returning id into v_patient;
    else
      update public.patients
      set birthday = coalesce(p_birthday, birthday),
          hmo = coalesce(nullif(p_hmo, ''), hmo),
          consent_at = case when p_consent then now() else consent_at end
      where id = v_patient;
    end if;
  end if;

  insert into public.appointments
    (clinic_id, dentist_id, patient_id, starts_at, ends_at, status, procedure_names, source, manage_token, confirmed_at)
  values
    (p_clinic_id, p_dentist_id, v_patient, p_starts_at, p_ends_at, p_status, p_procedure_names, p_source, p_manage_token,
     case when p_status = 'confirmed' then now() end)
  returning id into v_id;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id)
  values (p_clinic_id, v_id, null, p_status, p_actor, p_user_id);

  return v_id;
end;
$$;
revoke execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid) from public, anon;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text[], text, text, text, uuid, text, text, text, date, text, boolean, text, uuid) to authenticated, service_role;

create function public.set_appointment_status(
  p_id uuid, p_from text, p_to text, p_actor text, p_user_id uuid, p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  update public.appointments
  set status = p_to,
      status_reason = coalesce(nullif(p_reason, ''), status_reason),
      confirmed_at = case when p_to = 'confirmed' then now() else confirmed_at end
  where id = p_id and status = p_from
  returning clinic_id into v_clinic;

  if v_clinic is null then
    return false;
  end if;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id, reason)
  values (v_clinic, p_id, p_from, p_to, p_actor, p_user_id, nullif(p_reason, ''));
  return true;
end;
$$;
revoke execute on function public.set_appointment_status(uuid, text, text, text, uuid, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, text, text, text, uuid, text) to authenticated, service_role;

create function public.move_appointment(
  p_id uuid, p_dentist_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_clinic uuid;
begin
  update public.appointments
  set dentist_id = p_dentist_id,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      confirmed_at = now(),
      reminder_sent_at = null
  where id = p_id and status = 'confirmed'
  returning clinic_id into v_clinic;

  if v_clinic is null then
    return false;
  end if;

  insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor, user_id, reason)
  values (v_clinic, p_id, 'confirmed', 'confirmed', 'staff', p_user_id, 'moved');
  return true;
end;
$$;
revoke execute on function public.move_appointment(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.move_appointment(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

create function public.expire_pending()
returns integer
language sql
security invoker
set search_path = ''
as $$
  with expired as (
    update public.appointments
    set status = 'expired'
    where status = 'pending' and starts_at < now()
    returning id, clinic_id
  ), logged as (
    insert into public.appointment_events (clinic_id, appointment_id, from_status, to_status, actor)
    select clinic_id, id, 'pending', 'expired', 'system' from expired
    returning 1
  )
  select count(*)::int from logged;
$$;
revoke execute on function public.expire_pending() from public, anon, authenticated;
grant execute on function public.expire_pending() to service_role;
```

- [ ] **Step 4: Apply it**

Run: `npm run db:push`
Expected: `Applying migration 20260922000300_booking_functions.sql...` and `Finished supabase db push.`

- [ ] **Step 5: Run the database tests to see them pass**

Run: `npm run test:db`
Expected: PASS for all three files.

- [ ] **Step 6: Commit**

```powershell
git add supabase/migrations/20260922000300_booking_functions.sql tests/db/booking.test.ts; git commit -m "feat: add atomic booking and status change functions" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Verify the foundation

**Files:** none changed unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: the Plan 1 deliverable, proven.

- [ ] **Step 1: Run every check**

Run:
```powershell
npm test; npm run test:db; npm run lint; npm run build
```
Expected: all unit tests pass, all database tests pass, lint reports no errors, and the build succeeds.

In the Step 1 output, confirm `access.test.ts` includes a passing "gives strangers nothing" test: that is the proof the database is closed to anyone without a login.

- [ ] **Step 2: Fix anything that failed, then commit**

If a check failed, use superpowers:systematic-debugging to find the root cause, fix it, re-run Step 1, and commit with a message describing the fix. If everything passed, there is nothing to commit.

- [ ] **Step 3: Report**

Tell Kai: the test counts from Step 1, anything that failed and how it was fixed, and that Plan 2 (accounts and public booking) is next.
