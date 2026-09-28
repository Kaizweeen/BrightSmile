# DentaSync Plan A: Foundation, accounts, settings, and staff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running DentaSync where the owner sets up the practice, configures branches, chairs, procedures, and dentist schedules, prints each branch's staff QR poster, and approves the staff who scan it; every rule is enforced on the server and tested.

**Architecture:** One Next.js 16 app. Drizzle ORM over Postgres 17 (PGlite in process for development and tests, node-postgres in production); Better Auth with username login and database sessions; REST route handlers under `/api/v1` that all pass through one wrapper (`src/server/api.ts`) and one permission table (`src/lib/permissions.ts`); integrity rules live in Postgres (exclusion constraints and triggers in `drizzle/0001_rules.sql`).

**Tech Stack:** Node 24, Next.js 16.3.6, React 19.2, Tailwind CSS 4, shadcn/ui 4.21 (base-nova style on Base UI), TanStack Query 5.104, Zod 4.6, Drizzle ORM 0.45.3 and drizzle-kit 0.31.11, PGlite 0.4.6 (Postgres 17.5), pg 8.23, Better Auth 1.7.6, qrcode 1.5.4, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`. This is plan A of three for part 1: A (this) foundation, accounts, settings, staff; B scheduling and patients; C clinical records and finishing.

## Global Constraints

- Repository: `D:\dentasync`, branch `main`. Run every command from `D:\dentasync`. Commit after each task with a conventional prefix (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`), an imperative subject, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before writing Next.js code, read the matching guide in `node_modules/next/dist/docs/` (Next 16 differs from older versions: `params`, `searchParams`, `cookies()`, and `headers()` are async; `middleware` is `proxy`; `error.tsx` receives `retry`).
- Dev server port 3700 (`npm run dev`). `APP_URL` defaults to `http://localhost:3700`.
- Times are stored as `timestamptz`. Day boundaries, schedule blocks, and display use Asia/Manila (UTC+8, no daylight saving) through `src/lib/time.ts`, never the server's time zone.
- No SMS and no email are ever sent. Accounts use usernames; every user row carries a random `@users.invalid` email because Better Auth requires one.
- Philippine mobiles are stored as `+639XXXXXXXXX`.
- Every route goes through `staffRoute` or `publicRoute` (`src/server/api.ts`). Writes must carry the app's own `Origin` and a JSON body. Every permission check uses `can()` from `src/lib/permissions.ts`.
- Errors have one shape: `{ "error": { "code", "message", "fields"?, "conflicts"?, "warnings"? } }`.
- Copy is plain and direct, and contains no em dashes or en dashes.
- WCAG 2.2 AA: labelled fields and errors, visible focus, keyboard paths, touch targets at least 44 pixels tall on phones, status never shown by colour alone.
- Pin dependency versions exactly as listed; add no other runtime dependency.

---

## File structure (plan A)

```
drizzle.config.ts                 drizzle-kit config
drizzle/0000_tables.sql           generated from src/db/schema.ts
drizzle/0001_rules.sql            exclusion constraints and triggers (hand-written)
vitest.config.mts                 unit and db test projects
src/db/schema.ts                  every part 1 table
src/db/index.ts                   lazy connection: PGlite or node-postgres
src/lib/time.ts                   Manila time math and formatting
src/lib/hours.ts                  branch opening hours
src/lib/validation.ts             shared field schemas
src/lib/tokens.ts                 random tokens, hashing, constant-time compare
src/lib/env.ts                    environment check
src/lib/permissions.ts            the permission table
src/lib/schedule.ts               schedule block validation
src/lib/labels.ts                 role labels
src/lib/nav.ts                    navigation per role
src/lib/paths.ts                  branch URL helper
src/lib/security.ts               CSP and security headers
src/lib/auth.ts                   Better Auth server config
src/lib/auth-client.ts            Better Auth browser client
src/lib/fetcher.ts                browser API client
src/server/errors.ts              ApiError and Postgres error helpers
src/server/audit.ts               audit log writer
src/server/accounts.ts            creating users and setting passwords
src/server/session.ts             the signed-in staff member
src/server/guard.ts               requireCan
src/server/api.ts                 route wrappers
src/server/setup.ts               first run and owner recovery
src/server/home.ts                where each person lands
src/server/practice.ts            practice name
src/server/branches.ts            branches and chairs
src/server/procedures.ts          procedures
src/server/staff.ts               join requests, approvals, staff changes, resets
src/server/schedules.ts           weekly schedules and time off
src/server/qr.ts                  QR code SVG
src/proxy.ts                      per-request CSP nonce
src/instrumentation.ts            environment check and migrations at start
src/app/...                       pages and route handlers
src/components/...                app components (shadcn primitives in src/components/ui)
tests/unit, tests/db, tests/api   Vitest tests; tests/helpers.ts
```

---

### Task 1: Scaffold the app and its tooling

**Files:**
- Create: the Next.js scaffold in `D:\dentasync` (keeps `docs/` and `.git`)
- Create: `.gitattributes`, `.env.example`
- Modify: `.gitignore`, `package.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/native-select.tsx`, `README.md`
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`; shadcn components under `@/components/ui/*`; `cn` from `@/lib/utils`.

- [ ] **Step 1: Scaffold Next.js into the existing folder**

```powershell
cd D:\dentasync
npx --yes create-next-app@16.3.6 . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes --skip-install
```

Expected: "Success! Created dentasync". `docs/` and `.git` are untouched; `AGENTS.md`, `CLAUDE.md`, `src/app/*`, and config files appear.

- [ ] **Step 2: Install pinned dependencies**

```powershell
npm install --save-exact next@16.3.6 react@19.2.8 react-dom@19.2.8 drizzle-orm@0.45.3 @electric-sql/pglite@0.4.6 pg@8.23.0 better-auth@1.7.6 zod@4.6.5 @tanstack/react-query@5.104.0 qrcode@1.5.4
npm install --save-exact -D @types/node@24.19.0 drizzle-kit@0.31.11 vitest@5.0.2 @playwright/test@1.63.0 @types/pg@8.23.1 @types/qrcode@1.5.6
```

Expected: both finish with "added N packages" and no `ERESOLVE` error.

- [ ] **Step 3: Add shadcn/ui and the components the app uses**

```powershell
npx --yes shadcn@4.21.0 init -d --no-monorepo
npx --yes shadcn@4.21.0 add input label textarea native-select dialog badge table tabs dropdown-menu card alert sonner separator --yes
```

Expected: `components.json`, `src/lib/utils.ts`, and `src/components/ui/{button,input,label,textarea,native-select,dialog,badge,table,tabs,dropdown-menu,card,alert,sonner,separator}.tsx` exist.

- [ ] **Step 4: Make controls 44 pixels tall on phones**

In `src/components/ui/button.tsx` make these three replacements:

```text
"h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2"
→ "h-11 gap-1.5 px-3 sm:h-8 sm:px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2"

lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
→ lg: "h-11 gap-1.5 px-3 sm:h-9 sm:px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",

icon: "size-8",
→ icon: "size-11 sm:size-8",
```

In `src/components/ui/input.tsx` replace `"h-8 w-full min-w-0 rounded-lg` with `"h-11 w-full min-w-0 rounded-lg sm:h-8`.

In `src/components/ui/native-select.tsx` replace `className="h-8 w-full min-w-0 appearance-none` with `className="h-11 w-full min-w-0 appearance-none sm:h-8`.

- [ ] **Step 5: Replace `src/app/globals.css`** (dark mode follows the device; teal primary)

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Dark mode follows the device (spec section 10), so there is no theme switch. */
@custom-variant dark (@media (prefers-color-scheme: dark));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.49 0.09 200);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.5 0 0);
  --accent: oklch(0.96 0.02 200);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.87 0 0);
  --ring: oklch(0.49 0.09 200);
  --radius: 0.625rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: oklch(0.16 0.01 220);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.21 0.01 220);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.21 0.01 220);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.74 0.1 195);
    --primary-foreground: oklch(0.2 0.03 200);
    --secondary: oklch(0.27 0.01 220);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.27 0.01 220);
    --muted-foreground: oklch(0.75 0 0);
    --accent: oklch(0.3 0.03 200);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 12%);
    --input: oklch(1 0 0 / 20%);
    --ring: oklch(0.74 0.1 195);
  }
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

- [ ] **Step 6: Replace `src/app/layout.tsx` and `src/app/page.tsx`**

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "DentaSync", template: "%s | DentaSync" },
  description: "Appointments, chairs, and dental charts for a practice with several branches.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (replaced in Task 6):

```tsx
export default function Home() {
  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold">DentaSync</h1>
    </main>
  );
}
```

Delete `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg`.

- [ ] **Step 7: Configure Next, git, the environment, and the scripts**

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite loads its WebAssembly build from node_modules at run time, so it stays out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
```

`.gitattributes`:

```text
* text=auto eol=lf
*.png binary
*.ico binary
```

Append to `.gitignore`:

```text

# DentaSync
!.env.example
/.data/
/playwright-report/
/test-results/
```

`.env.example`:

```text
# Copy to .env.local for development. Production needs all four.

# "pglite:.data/dev" (the default) runs Postgres inside the app for development.
# Production: the Postgres 17 connection string (for example Neon, region Singapore).
DATABASE_URL=pglite:.data/dev

# 32 or more random characters:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
BETTER_AUTH_SECRET=

# The app's own origin, no trailing slash.
APP_URL=http://localhost:3700

# 32 or more random characters. /setup asks for it once, and the owner uses it to reset their own password.
SETUP_TOKEN=
```

Scripts:

```powershell
npm pkg set scripts.dev="next dev -p 3700" scripts.build="next build" scripts.start="next start -p 3700" scripts.lint="eslint" scripts.typecheck="next typegen && tsc --noEmit" scripts.test="vitest run" scripts.test:e2e="playwright test" scripts.db:generate="drizzle-kit generate" scripts.db:migrate="drizzle-kit migrate"
```

Replace `README.md`:

```markdown
# DentaSync

Appointments, chairs, and dental charts for a dental practice with three branches in the Philippines.

- Spec: `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`
- Plans: `docs/superpowers/plans/`

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `BETTER_AUTH_SECRET` and `SETUP_TOKEN`.
3. `npm run dev`, then open http://localhost:3700. The database lives in `.data/dev` and migrates itself.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm test` | Unit and database tests (PGlite, no network) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
```

- [ ] **Step 8: Check that everything builds**

```powershell
npm run lint; npm run typecheck; npm run build
```

Expected: lint prints nothing, typecheck exits 0, build ends with the route table.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "chore: scaffold DentaSync with Next.js 16, shadcn/ui, and the test tools" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database schema, rules, and connection

**Files:**
- Create: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/0000_tables.sql` (generated), `drizzle/0001_rules.sql`, `vitest.config.mts`, `tests/setup-db.ts`, `tests/db/rules.test.ts`

**Interfaces:**
- Produces: every table in `@/db/schema` (`practice`, `branches`, `chairs`, `users`, `sessions`, `accounts`, `verifications`, `rateLimits`, `userBranches`, `dentistSchedules`, `dentistTimeOff`, `procedures`, `patients`, `appointments`, `appointmentProcedures`, `treatmentNotes`, `chartEntries`, `exams`, `auditLog`), the types `OperatingHours` and `ExamFindings`, the constants `ALLERGIES`, `APPOINTMENT_STATUSES`, `CHART_CODES`; `db: Db` and `ready(): Promise<void>` and `type Db` from `@/db`.
- Postgres error codes later tasks rely on: `23P01` (overlap), `DS001` (refused status change), `DS002` (edit of a never-edited record), `23505` (unique), `23514` (check).

- [ ] **Step 1: Write the schema, `src/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Opening and closing time per weekday ("0" Sunday to "6" Saturday), or null when the branch is closed. */
export type OperatingHours = Record<string, { open: string; close: string } | null>;

/** The PDA exam sections: each marked item holds its detail (an empty string when there is none). */
export type ExamFindings = Record<string, Record<string, string>>;

export const practice = pgTable(
  "practice",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("practice_one_row", sql`${t.id}`), check("practice_name", sql`char_length(${t.name}) between 1 and 80`)],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    operatingHours: jsonb("operating_hours").$type<OperatingHours>().notNull(),
    joinCode: text("join_code").notNull().unique(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("branches_code", sql`${t.code} ~ '^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$' and ${t.code} <> 'all'`),
    check("branches_name", sql`char_length(${t.name}) between 1 and 40`),
    check("branches_address", sql`char_length(${t.address}) <= 200`),
    check("branches_phone", sql`char_length(${t.phone}) <= 20`),
    check("branches_hours", sql`jsonb_typeof(${t.operatingHours}) = 'object'`),
  ],
);

export const chairs = pgTable(
  "chairs",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    number: smallint("number").notNull(),
    label: text("label").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.number] }),
    check("chairs_number", sql`${t.number} between 1 and 99`),
    check("chairs_label", sql`char_length(${t.label}) <= 30`),
  ],
);

/** Better Auth's user table (its model "user"), plus DentaSync's staff columns. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    username: text("username").notNull().unique(),
    displayUsername: text("display_username"),
    role: text("role").notNull(),
    status: text("status").notNull(),
    title: text("title"),
    seesPatients: boolean("sees_patients").notNull().default(false),
    primaryBranchId: uuid("primary_branch_id").references(() => branches.id),
    requestedBranchId: uuid("requested_branch_id").references(() => branches.id),
    approvedBy: uuid("approved_by").references((): AnyPgColumn => users.id),
    approvedAt: at("approved_at"),
  },
  (t) => [
    check("users_role", sql`${t.role} in ('owner', 'manager', 'dentist')`),
    check("users_status", sql`${t.status} in ('pending', 'active', 'disabled')`),
    check("users_name", sql`char_length(${t.name}) between 2 and 80`),
    check("users_username", sql`${t.username} ~ '^[a-z0-9._]{3,30}$'`),
    check("users_title", sql`char_length(${t.title}) between 1 and 40`),
    check("users_dentists_see_patients", sql`${t.role} <> 'dentist' or ${t.seesPatients}`),
    check("users_managers_do_not", sql`${t.role} <> 'manager' or not ${t.seesPatients}`),
    uniqueIndex("users_one_owner").on(t.role).where(sql`${t.role} = 'owner'`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: at("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: at("access_token_expires_at"),
    refreshTokenExpiresAt: at("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("accounts_user").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier").on(t.identifier)],
);

export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userBranches = pgTable(
  "user_branches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
);

export const dentistSchedules = pgTable(
  "dentist_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("dentist_schedules_day", sql`${t.dayOfWeek} between 0 and 6`),
    check("dentist_schedules_order", sql`${t.startTime} < ${t.endTime}`),
    check(
      "dentist_schedules_grid",
      sql`extract(minute from ${t.startTime})::int % 15 = 0 and extract(minute from ${t.endTime})::int % 15 = 0
        and extract(second from ${t.startTime}) = 0 and extract(second from ${t.endTime}) = 0`,
    ),
    index("dentist_schedules_dentist").on(t.dentistId, t.dayOfWeek),
  ],
);

export const dentistTimeOff = pgTable(
  "dentist_time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    reason: text("reason").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("dentist_time_off_order", sql`${t.startsAt} < ${t.endsAt}`),
    check("dentist_time_off_reason", sql`char_length(${t.reason}) <= 100`),
    index("dentist_time_off_dentist").on(t.dentistId, t.startsAt),
  ],
);

export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("procedures_name", sql`char_length(${t.name}) between 1 and 60`),
    check("procedures_duration", sql`${t.durationMinutes} between 5 and 480 and ${t.durationMinutes} % 5 = 0`),
    check("procedures_buffer", sql`${t.bufferMinutes} between 0 and 120`),
  ],
);

/** The allergies the PDA form lists; anything else goes in allergies_other. */
export const ALLERGIES = ["local_anesthetic", "penicillin", "sulfa", "aspirin", "latex"] as const;

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartNo: integer("chart_no").generatedAlwaysAsIdentity().notNull().unique(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    birthday: date("birthday"),
    sex: text("sex"),
    mobile: text("mobile"),
    email: text("email"),
    address: text("address"),
    occupation: text("occupation"),
    guardianName: text("guardian_name"),
    emergencyName: text("emergency_name"),
    emergencyMobile: text("emergency_mobile"),
    hmoProvider: text("hmo_provider"),
    hmoMemberNo: text("hmo_member_no"),
    insuranceEffective: date("insurance_effective"),
    allergies: text("allergies").array().notNull().default(sql`'{}'::text[]`),
    allergiesOther: text("allergies_other"),
    medicalAlerts: text("medical_alerts").notNull().default(""),
    consentAt: at("consent_at"),
    consentBy: uuid("consent_by").references(() => users.id),
    homeBranchId: uuid("home_branch_id").references(() => branches.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("patients_last_name", sql`char_length(${t.lastName}) between 1 and 50`),
    check("patients_first_name", sql`char_length(${t.firstName}) between 1 and 50`),
    check("patients_middle_name", sql`char_length(${t.middleName}) between 1 and 50`),
    check("patients_birthday", sql`${t.birthday} >= '1900-01-01'`),
    check("patients_sex", sql`${t.sex} in ('female', 'male')`),
    check("patients_mobile", sql`${t.mobile} ~ '^\\+639[0-9]{9}$'`),
    check("patients_emergency_mobile", sql`${t.emergencyMobile} ~ '^\\+639[0-9]{9}$'`),
    check("patients_email", sql`char_length(${t.email}) <= 254 and ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("patients_address", sql`char_length(${t.address}) between 1 and 200`),
    check("patients_occupation", sql`char_length(${t.occupation}) between 1 and 60`),
    check("patients_guardian", sql`char_length(${t.guardianName}) between 1 and 100`),
    check("patients_emergency_name", sql`char_length(${t.emergencyName}) between 1 and 100`),
    check("patients_hmo_provider", sql`char_length(${t.hmoProvider}) between 1 and 60`),
    check("patients_hmo_member_no", sql`char_length(${t.hmoMemberNo}) between 1 and 40`),
    check(
      "patients_allergies",
      sql`${t.allergies} <@ array['local_anesthetic', 'penicillin', 'sulfa', 'aspirin', 'latex']::text[]`,
    ),
    check("patients_allergies_other", sql`char_length(${t.allergiesOther}) between 1 and 100`),
    check("patients_medical_alerts", sql`char_length(${t.medicalAlerts}) <= 500`),
    check("patients_consent", sql`(${t.consentAt} is null) = (${t.consentBy} is null)`),
    index("patients_last_name_lower").on(sql`lower(${t.lastName})`),
    index("patients_mobile").on(t.mobile),
  ],
);

export const APPOINTMENT_STATUSES = [
  "requested",
  "confirmed",
  "checked_in",
  "in_treatment",
  "completed",
  "no_show",
  "cancelled",
] as const;

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    chairNumber: smallint("chair_number").notNull(),
    startTime: at("start_time").notNull(),
    endTime: at("end_time").notNull(),
    chairFreeAt: at("chair_free_at").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    note: text("note").notNull().default(""),
    cancelReason: text("cancel_reason"),
    confirmedAt: at("confirmed_at"),
    checkedInAt: at("checked_in_at"),
    treatmentStartedAt: at("treatment_started_at"),
    completedAt: at("completed_at"),
    cancelledAt: at("cancelled_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.branchId, t.chairNumber], foreignColumns: [chairs.branchId, chairs.number] }),
    check(
      "appointments_status",
      sql`${t.status} in ('requested', 'confirmed', 'checked_in', 'in_treatment', 'completed', 'no_show', 'cancelled')`,
    ),
    check("appointments_source", sql`${t.source} in ('staff', 'walk_in', 'portal')`),
    check("appointments_times", sql`${t.startTime} < ${t.endTime} and ${t.endTime} <= ${t.chairFreeAt}`),
    check("appointments_note", sql`char_length(${t.note}) <= 500`),
    check("appointments_cancel_reason", sql`char_length(${t.cancelReason}) between 1 and 200`),
    check("appointments_cancelled_has_reason", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
    index("appointments_branch_time").on(t.branchId, t.startTime),
    index("appointments_dentist_time").on(t.dentistId, t.startTime),
    index("appointments_patient_time").on(t.patientId, t.startTime),
  ],
);

export const appointmentProcedures = pgTable(
  "appointment_procedures",
  {
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appointmentId, t.position] })],
);

export const treatmentNotes = pgTable(
  "treatment_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    amendsId: uuid("amends_id").references((): AnyPgColumn => treatmentNotes.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("treatment_notes_body", sql`char_length(${t.body}) between 1 and 4000`),
    index("treatment_notes_patient").on(t.patientId, t.createdAt),
  ],
);

/** The PDA chart legend; "present" is the check mark. */
export const CHART_CODES = [
  "present",
  "D",
  "M",
  "MO",
  "Im",
  "Sp",
  "Rf",
  "Un",
  "Am",
  "Co",
  "JC",
  "Ab",
  "Att",
  "P",
  "In",
  "Imp",
  "S",
  "Rm",
  "X",
  "XO",
] as const;

export const chartEntries = pgTable(
  "chart_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    branchId: uuid("branch_id").references(() => branches.id),
    tooth: smallint("tooth").notNull(),
    surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
    code: text("code").notNull(),
    note: text("note").notNull().default(""),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedAt: at("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    check(
      "chart_entries_tooth",
      sql`${t.tooth} between 11 and 18 or ${t.tooth} between 21 and 28 or ${t.tooth} between 31 and 38
        or ${t.tooth} between 41 and 48 or ${t.tooth} between 51 and 55 or ${t.tooth} between 61 and 65
        or ${t.tooth} between 71 and 75 or ${t.tooth} between 81 and 85`,
    ),
    check("chart_entries_surfaces", sql`${t.surfaces} <@ array['M', 'D', 'O', 'B', 'L']::text[]`),
    check(
      "chart_entries_code",
      sql`${t.code} in ('present', 'D', 'M', 'MO', 'Im', 'Sp', 'Rf', 'Un', 'Am', 'Co', 'JC', 'Ab', 'Att', 'P', 'In', 'Imp', 'S', 'Rm', 'X', 'XO')`,
    ),
    check("chart_entries_note", sql`char_length(${t.note}) <= 300`),
    check("chart_entries_void_reason", sql`char_length(${t.voidReason}) between 1 and 200`),
    check(
      "chart_entries_void_complete",
      sql`(${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.voidedAt} is null) = (${t.voidReason} is null)`,
    ),
    index("chart_entries_patient").on(t.patientId, t.tooth),
  ],
);

export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .unique()
      .references(() => appointments.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    findings: jsonb("findings").$type<ExamFindings>().notNull(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("exams_findings", sql`jsonb_typeof(${t.findings}) = 'object' and octet_length(${t.findings}::text) <= 4000`),
    index("exams_patient").on(t.patientId),
  ],
);

/** Who did what and when. user_id has no foreign key: a declined request deletes its user, and the log keeps the id. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: at("at").notNull().defaultNow(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    branchId: uuid("branch_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_log_entity").on(t.entity, t.entityId, t.at),
    index("audit_log_user").on(t.userId, t.at),
    index("audit_log_at").on(t.at),
  ],
);
```

- [ ] **Step 2: Write `drizzle.config.ts` and generate the table migration**

```ts
import { defineConfig } from "drizzle-kit";

// `npm run db:generate` writes migrations from src/db/schema.ts. `npm run db:migrate` applies them to the Postgres in
// DATABASE_URL (production). PGlite databases migrate themselves when the app starts (src/db/index.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL?.startsWith("postgres") ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
```

```powershell
npx drizzle-kit generate --name tables
npx drizzle-kit generate --custom --name rules
```

Expected: "19 tables", then `drizzle/0000_tables.sql`, an empty `drizzle/0001_rules.sql`, and `drizzle/meta/_journal.json`.

- [ ] **Step 3: Fill `drizzle/0001_rules.sql`**

```sql
-- Rules Drizzle cannot express (spec section 7, "Enforced by the database"). Errors raised here use two
-- DentaSync codes: DS001 for a status change the lifecycle refuses, DS002 for editing a record that is never edited.
create extension if not exists btree_gist;
--> statement-breakpoint

-- 1 to 3. No overlapping active visits for a dentist (at any branch), a chair (visit plus turnover), or a patient.
alter table appointments add constraint appointments_dentist_no_overlap exclude using gist (
  dentist_id with =,
  tstzrange(start_time, end_time) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint
alter table appointments add constraint appointments_chair_no_overlap exclude using gist (
  branch_id with =,
  chair_number with =,
  tstzrange(start_time, chair_free_at) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint
alter table appointments add constraint appointments_patient_no_overlap exclude using gist (
  patient_id with =,
  tstzrange(start_time, end_time) with &&
) where (status in ('requested', 'confirmed', 'checked_in', 'in_treatment'));
--> statement-breakpoint

-- 4. A dentist's weekly blocks never overlap on a weekday, even at different branches (split days are allowed).
alter table dentist_schedules add constraint dentist_schedules_no_overlap exclude using gist (
  dentist_id with =,
  day_of_week with =,
  tsrange(date '2000-01-03' + start_time, date '2000-01-03' + end_time) with &&
);
--> statement-breakpoint

-- 5. The lifecycle (spec 8.6). Inserts start as requested, confirmed, or checked in; every other change must be one
-- of the listed pairs. The matching timestamp is stamped here so it can never disagree with the status.
create function appointments_status_flow() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('requested', 'confirmed', 'checked_in') then
      raise exception 'a visit starts as requested, confirmed, or checked in' using errcode = 'DS001';
    end if;
    if new.status in ('confirmed', 'checked_in') then
      new.confirmed_at := now();
    end if;
    if new.status = 'checked_in' then
      new.checked_in_at := now();
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;
  if (old.status, new.status) not in (
    ('requested', 'confirmed'), ('requested', 'cancelled'),
    ('confirmed', 'checked_in'), ('confirmed', 'no_show'), ('confirmed', 'cancelled'),
    ('checked_in', 'in_treatment'), ('checked_in', 'cancelled'), ('checked_in', 'confirmed'),
    ('in_treatment', 'completed'),
    ('no_show', 'checked_in')
  ) then
    raise exception 'a visit cannot go from % to %', old.status, new.status using errcode = 'DS001';
  end if;

  if new.status = 'confirmed' and old.status = 'checked_in' then
    new.checked_in_at := null;
  elsif new.status = 'confirmed' then
    new.confirmed_at := now();
  elsif new.status = 'checked_in' then
    new.checked_in_at := now();
  elsif new.status = 'in_treatment' then
    new.treatment_started_at := now();
  elsif new.status = 'completed' then
    new.completed_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
--> statement-breakpoint
create trigger appointments_status_flow
  before insert or update of status on appointments
  for each row execute function appointments_status_flow();
--> statement-breakpoint

-- 7. Treatment notes and the audit log are never changed or deleted; a chart entry only ever gains its void columns,
-- once.
create function refuse_edit() returns trigger language plpgsql as $$
begin
  raise exception '% rows are never changed or deleted', tg_table_name using errcode = 'DS002';
end;
$$;
--> statement-breakpoint
create trigger treatment_notes_never_edited
  before update or delete on treatment_notes
  for each row execute function refuse_edit();
--> statement-breakpoint
create trigger audit_log_never_edited
  before update or delete on audit_log
  for each row execute function refuse_edit();
--> statement-breakpoint
create function chart_entries_void_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.voided_at is not null
     or (new.patient_id, new.appointment_id, new.branch_id, new.tooth, new.surfaces, new.code, new.note,
         new.author_id, new.created_at)
        is distinct from
        (old.patient_id, old.appointment_id, old.branch_id, old.tooth, old.surfaces, old.code, old.note,
         old.author_id, old.created_at) then
    raise exception 'chart entries are only ever voided, once' using errcode = 'DS002';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger chart_entries_void_only
  before update or delete on chart_entries
  for each row execute function chart_entries_void_only();
```

- [ ] **Step 4: Write the connection, `src/db/index.ts`**

```ts
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
type Connection = { db: Db; ready: Promise<void> };

/**
 * DATABASE_URL picks the database: "pglite:memory" (tests), "pglite:<folder>" (development, the default), or a
 * postgres:// URL (production). PGlite runs inside this process and migrates itself; a real Postgres is migrated with
 * `npm run db:migrate`.
 */
function connect(url = process.env.DATABASE_URL || "pglite:.data/dev"): Connection {
  if (!url.startsWith("pglite:")) {
    const db = drizzlePostgres(new Pool({ connectionString: url, max: 5 }), { schema });
    return { db: db as unknown as Db, ready: Promise.resolve() };
  }
  const target = url.slice("pglite:".length);
  if (target !== "memory") mkdirSync(target, { recursive: true });
  const client =
    target === "memory"
      ? new PGlite({ extensions: { btree_gist } })
      : new PGlite(target, { extensions: { btree_gist } });
  const db = drizzlePglite(client, { schema });
  const ready = (async () => {
    await client.exec("set time zone 'UTC'");
    await migrate(db, { migrationsFolder: "./drizzle" });
  })();
  return { db: db as unknown as Db, ready };
}

// One connection per process, kept across hot reloads. It opens on first use, never at import, so `next build`
// (which imports every route) never opens the development database.
const cache = globalThis as unknown as { __dentasync?: Connection };
const current = (): Connection => (cache.__dentasync ??= connect());

export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const real = current().db as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(real, property, real);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

/** Resolves once the database is ready: migrated (PGlite) or at once (Postgres). */
export function ready(): Promise<void> {
  return current().ready;
}
```

- [ ] **Step 5: Configure Vitest**

`vitest.config.mts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    env: {
      DATABASE_URL: "pglite:memory",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
      APP_URL: "http://localhost:3700",
      SETUP_TOKEN: "test-setup-token-that-is-at-least-32-chars",
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts", "tests/api/**/*.test.ts"],
          // Each file runs its own in-memory Postgres; more than two at once can crash the workers on Windows.
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
          setupFiles: ["tests/setup-db.ts"],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```

`tests/setup-db.ts` (each test file gets its own in-memory database, migrated here):

```ts
import { ready } from "@/db";

await ready();
```

- [ ] **Step 6: Write the failing rules test, `tests/db/rules.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import * as s from "@/db/schema";

const OPEN = { open: "09:00", close: "18:00" };
const HOURS = { "0": null, "1": OPEN, "2": OPEN, "3": OPEN, "4": OPEN, "5": OPEN, "6": OPEN };

function sqlState(error: unknown): string | undefined {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return sqlState(error);
  }
  return undefined;
}

let n = 0;
async function world() {
  n += 1;
  const [a] = await db
    .insert(s.branches)
    .values({ code: `a${n}`, name: "Downtown", operatingHours: HOURS, joinCode: `ja${n}` })
    .returning();
  const [b] = await db
    .insert(s.branches)
    .values({ code: `b${n}`, name: "Westside", operatingHours: HOURS, joinCode: `jb${n}` })
    .returning();
  await db.insert(s.chairs).values([
    { branchId: a.id, number: 1 },
    { branchId: a.id, number: 2 },
    { branchId: b.id, number: 1 },
  ]);
  const dentist = async (name: string) =>
    (
      await db
        .insert(s.users)
        .values({
          name: `Dr ${name}`,
          email: `${name}${n}@users.invalid`,
          username: `${name}${n}`,
          role: "dentist",
          status: "active",
          seesPatients: true,
        })
        .returning()
    )[0];
  const patient = async (firstName: string) =>
    (await db.insert(s.patients).values({ lastName: "Santos", firstName }).returning())[0];
  return { a, b, reyes: await dentist("reyes"), lim: await dentist("lim"), ana: await patient("Ana"), ben: await patient("Ben") };
}

const at = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00+08:00`);

function visit(v: {
  patientId: string;
  dentistId: string;
  branchId: string;
  chair?: number;
  start: string;
  end: string;
  free?: string;
  status?: string;
}) {
  return {
    patientId: v.patientId,
    dentistId: v.dentistId,
    branchId: v.branchId,
    chairNumber: v.chair ?? 1,
    startTime: at(v.start),
    endTime: at(v.end),
    chairFreeAt: at(v.free ?? v.end),
    status: v.status ?? "confirmed",
    source: "staff",
  };
}

describe("overlaps", () => {
  it("refuses one dentist at two branches at once", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.b.id, start: "09:30", end: "10:30" })),
    );
    expect(code).toBe("23P01");
  });

  it("refuses a chair during turnover and frees it when turnover ends", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "09:45", free: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.lim.id, branchId: w.a.id, start: "09:50", end: "10:20" })),
    );
    expect(code).toBe("23P01");
    await db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.lim.id, branchId: w.a.id, start: "10:00", end: "10:30" }));
  });

  it("lets the dentist start at another chair during turnover", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "09:45", free: "10:00" }));
    await db.insert(s.appointments).values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.a.id, chair: 2, start: "09:45", end: "10:15" }));
  });

  it("refuses one patient in two visits at once", async () => {
    const w = await world();
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.lim.id, branchId: w.b.id, start: "09:30", end: "10:00" })),
    );
    expect(code).toBe("23P01");
  });

  it("frees the time of cancelled and no-show visits", async () => {
    const w = await world();
    const [first] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    await db.update(s.appointments).set({ status: "cancelled", cancelReason: "Patient called" }).where(eq(s.appointments.id, first.id));
    const [second] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ben.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    await db.update(s.appointments).set({ status: "no_show" }).where(eq(s.appointments.id, second.id));
    await db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }));
  });
});

describe("lifecycle", () => {
  it("walks every allowed change and stamps each time", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00", status: "requested" }))
      .returning();
    expect(v.confirmedAt).toBeNull();
    const move = async (status: string) =>
      (await db.update(s.appointments).set({ status }).where(eq(s.appointments.id, v.id)).returning())[0];
    expect((await move("confirmed")).confirmedAt).not.toBeNull();
    expect((await move("checked_in")).checkedInAt).not.toBeNull();
    expect((await move("confirmed")).checkedInAt).toBeNull();
    await move("no_show");
    await move("checked_in");
    expect((await move("in_treatment")).treatmentStartedAt).not.toBeNull();
    expect((await move("completed")).completedAt).not.toBeNull();
  });

  it("refuses every other change", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    for (const status of ["completed", "in_treatment", "requested"]) {
      expect(await refusal(db.update(s.appointments).set({ status }).where(eq(s.appointments.id, v.id)))).toBe("DS001");
    }
    await db.update(s.appointments).set({ status: "cancelled", cancelReason: "Moved away" }).where(eq(s.appointments.id, v.id));
    expect(await refusal(db.update(s.appointments).set({ status: "confirmed" }).where(eq(s.appointments.id, v.id)))).toBe("DS001");
  });

  it("starts a visit only as requested, confirmed, or checked in", async () => {
    const w = await world();
    for (const status of ["completed", "in_treatment", "no_show"]) {
      const code = await refusal(
        db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "11:00", end: "11:30", status })),
      );
      expect(code).toBe("DS001");
    }
    const [walkIn] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "11:00", end: "11:30", status: "checked_in" }))
      .returning();
    expect(walkIn.checkedInAt).not.toBeNull();
  });

  it("needs a reason to cancel", async () => {
    const w = await world();
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    expect(await refusal(db.update(s.appointments).set({ status: "cancelled" }).where(eq(s.appointments.id, v.id)))).toBe("23514");
  });

  it("keeps a chair inside its branch", async () => {
    const w = await world();
    const code = await refusal(
      db.insert(s.appointments).values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.b.id, chair: 2, start: "09:00", end: "10:00" })),
    );
    expect(code).toBe("23503");
  });
});

describe("schedules", () => {
  it("refuses overlapping blocks at two branches but allows split days", async () => {
    const w = await world();
    await db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" });
    const code = await refusal(
      db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.b.id, dayOfWeek: 1, startTime: "11:00", endTime: "15:00" }),
    );
    expect(code).toBe("23P01");
    await db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" });
  });

  it("keeps blocks on the 15-minute grid", async () => {
    const w = await world();
    const code = await refusal(
      db.insert(s.dentistSchedules).values({ dentistId: w.reyes.id, branchId: w.a.id, dayOfWeek: 2, startTime: "09:10", endTime: "12:00" }),
    );
    expect(code).toBe("23514");
  });
});

describe("records that are never edited", () => {
  it("refuses changing or deleting the audit log and treatment notes", async () => {
    const w = await world();
    const [log] = await db.insert(s.auditLog).values({ action: "test", entity: "test" }).returning();
    expect(await refusal(db.delete(s.auditLog).where(eq(s.auditLog.id, log.id)))).toBe("DS002");
    const [v] = await db
      .insert(s.appointments)
      .values(visit({ patientId: w.ana.id, dentistId: w.reyes.id, branchId: w.a.id, start: "09:00", end: "10:00" }))
      .returning();
    const [note] = await db
      .insert(s.treatmentNotes)
      .values({ appointmentId: v.id, patientId: w.ana.id, authorId: w.reyes.id, body: "Cleaning done." })
      .returning();
    expect(await refusal(db.update(s.treatmentNotes).set({ body: "Changed" }).where(eq(s.treatmentNotes.id, note.id)))).toBe("DS002");
  });

  it("voids a chart entry once and changes nothing else", async () => {
    const w = await world();
    const [entry] = await db
      .insert(s.chartEntries)
      .values({ patientId: w.ana.id, tooth: 16, surfaces: ["O"], code: "Co", authorId: w.reyes.id })
      .returning();
    expect(await refusal(db.update(s.chartEntries).set({ code: "Am" }).where(eq(s.chartEntries.id, entry.id)))).toBe("DS002");
    await db
      .update(s.chartEntries)
      .set({ voidedAt: new Date(), voidedBy: w.reyes.id, voidReason: "Wrong tooth" })
      .where(eq(s.chartEntries.id, entry.id));
    expect(await refusal(db.update(s.chartEntries).set({ voidReason: "Again" }).where(eq(s.chartEntries.id, entry.id)))).toBe("DS002");
    expect(await refusal(db.insert(s.chartEntries).values({ patientId: w.ana.id, tooth: 19, code: "Co", authorId: w.reyes.id }))).toBe("23514");
  });
});

describe("people", () => {
  it("allows one owner", async () => {
    await db.insert(s.users).values({ name: "First Owner", email: "o1@users.invalid", username: "owner.one", role: "owner", status: "active" });
    const code = await refusal(
      db.insert(s.users).values({ name: "Second Owner", email: "o2@users.invalid", username: "owner.two", role: "owner", status: "active" }),
    );
    expect(code).toBe("23505");
  });

  it("checks mobiles and allergies", async () => {
    expect(await refusal(db.insert(s.patients).values({ lastName: "Cruz", firstName: "Carlo", mobile: "09171234567" }))).toBe("23514");
    expect(await refusal(db.insert(s.patients).values({ lastName: "Cruz", firstName: "Carlo", allergies: ["peanuts"] }))).toBe("23514");
    const [p] = await db
      .insert(s.patients)
      .values({ lastName: "Cruz", firstName: "Carlo", mobile: "+639171234567", allergies: ["latex"] })
      .returning();
    expect(p.chartNo).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 7: Run it**

```powershell
npx vitest run tests/db/rules.test.ts
```

Expected: PASS, 16 tests. (If `drizzle/0001_rules.sql` were still empty the overlap tests would fail with `expected undefined to be "23P01"`.)

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "feat: add the database schema with overlap, lifecycle, and audit rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Time, hours, field rules, tokens, and the environment check

**Files:**
- Create: `src/lib/time.ts`, `src/lib/hours.ts`, `src/lib/validation.ts`, `src/lib/tokens.ts`, `src/lib/env.ts`
- Test: `tests/unit/time.test.ts`, `tests/unit/hours.test.ts`, `tests/unit/validation.test.ts`, `tests/unit/tokens.test.ts`, `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: `type OperatingHours` from `@/db/schema`.
- Produces:
  - `@/lib/time`: `ZONE`, `manilaDate(instant: Date): string`, `manilaMinutes(instant: Date): number`, `manilaInstant(date: string, minutes: number): Date`, `weekday(date: string): number`, `addDays(date: string, days: number): string`, `toMinutes(hhmm: string): number`, `fromMinutes(minutes: number): string`, `fromManilaLocal(value: string): Date`, `toManilaLocal(instant: Date): string`, `formatTime(instant: Date): string`, `formatDate(instant: Date): string`, `formatDay(date: string): string`, `formatDateTime(instant: Date): string`.
  - `@/lib/hours`: `WEEKDAYS`, `dayHoursSchema`, `operatingHoursSchema`, `DEFAULT_HOURS: OperatingHours`, `hoursOn(hours, day): { open: number; close: number } | null`, `hoursSummary(hours): string`.
  - `@/lib/validation`: `usernameSchema`, `passwordSchema`, `personNameSchema`, `titleSchema`, `staffRoleSchema`, `normalizeMobile(input: string): string | null`, `mobileSchema`.
  - `@/lib/tokens`: `randomToken(bytes: number): string`, `sha256(value: string): string`, `sameSecret(a: string, b: string): boolean`.
  - `@/lib/env`: `envProblems(env): string[]`, `assertEnv(env): void`, `appUrl(): string`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  fromManilaLocal,
  fromMinutes,
  manilaDate,
  manilaInstant,
  manilaMinutes,
  toManilaLocal,
  toMinutes,
  weekday,
} from "@/lib/time";

describe("Manila time", () => {
  it("finds the Manila date and minutes of an instant", () => {
    const lateSunday = new Date("2026-10-04T16:30:00Z"); // 00:30 on Monday in Manila
    expect(manilaDate(lateSunday)).toBe("2026-10-05");
    expect(manilaMinutes(lateSunday)).toBe(30);
  });

  it("turns a Manila date and time back into the instant", () => {
    expect(manilaInstant("2026-10-05", 9 * 60).toISOString()).toBe("2026-10-05T01:00:00.000Z");
    expect(manilaInstant("2026-10-05", 0).toISOString()).toBe("2026-10-04T16:00:00.000Z");
  });

  it("knows the weekday and adds days across months and years", () => {
    expect(weekday("2026-10-05")).toBe(1);
    expect(weekday("2026-10-04")).toBe(0);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("converts clock times", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("09:30:00")).toBe(570);
    expect(fromMinutes(570)).toBe("09:30");
    expect(fromMinutes(0)).toBe("00:00");
  });

  it("reads and writes datetime-local values as Manila time", () => {
    const instant = fromManilaLocal("2026-10-05T14:15");
    expect(instant.toISOString()).toBe("2026-10-05T06:15:00.000Z");
    expect(toManilaLocal(instant)).toBe("2026-10-05T14:15");
  });
});
```

`tests/unit/hours.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS, hoursOn, hoursSummary, operatingHoursSchema } from "@/lib/hours";

describe("operating hours", () => {
  it("accepts the default week", () => {
    expect(operatingHoursSchema.parse(DEFAULT_HOURS)).toEqual(DEFAULT_HOURS);
  });

  it("needs all seven days", () => {
    const sixDays = Object.fromEntries(Object.entries(DEFAULT_HOURS).filter(([day]) => day !== "0"));
    expect(operatingHoursSchema.safeParse(sixDays).success).toBe(false);
  });

  it("refuses closing before opening and times off the 15-minute grid", () => {
    expect(operatingHoursSchema.safeParse({ ...DEFAULT_HOURS, "1": { open: "18:00", close: "09:00" } }).success).toBe(false);
    expect(operatingHoursSchema.safeParse({ ...DEFAULT_HOURS, "1": { open: "09:10", close: "18:00" } }).success).toBe(false);
  });

  it("gives a weekday's hours in minutes", () => {
    expect(hoursOn(DEFAULT_HOURS, 1)).toEqual({ open: 540, close: 1080 });
    expect(hoursOn(DEFAULT_HOURS, 0)).toBeNull();
  });

  it("summarises the week", () => {
    expect(hoursSummary(DEFAULT_HOURS)).toBe("Mon to Sat 09:00 to 18:00");
    expect(hoursSummary({ ...DEFAULT_HOURS, "6": { open: "09:00", close: "12:00" } })).toBe(
      "Mon to Fri 09:00 to 18:00, Sat 09:00 to 12:00",
    );
    const closed = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null };
    expect(hoursSummary(closed)).toBe("Closed every day");
  });
});
```

`tests/unit/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mobileSchema, normalizeMobile, passwordSchema, usernameSchema } from "@/lib/validation";

describe("field rules", () => {
  it("normalizes usernames", () => {
    expect(usernameSchema.parse("  Ana.Cruz ")).toBe("ana.cruz");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("ana cruz").success).toBe(false);
  });

  it("needs 10 to 128 password characters", () => {
    expect(passwordSchema.safeParse("123456789").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("normalizes Philippine mobiles", () => {
    for (const input of ["09171234567", "0917 123 4567", "+63 917 123 4567", "639171234567", "9171234567"]) {
      expect(normalizeMobile(input)).toBe("+639171234567");
    }
    expect(normalizeMobile("0817 123 4567")).toBeNull();
    expect(normalizeMobile("12345")).toBeNull();
    expect(mobileSchema.parse("0917-123-4567")).toBe("+639171234567");
    expect(mobileSchema.safeParse("12345").success).toBe(false);
  });
});
```

`tests/unit/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomToken, sameSecret, sha256 } from "@/lib/tokens";

describe("tokens", () => {
  it("makes URL-safe tokens of the right length", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(24)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });

  it("hashes and compares secrets", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sameSecret("a-secret-value", "a-secret-value")).toBe(true);
    expect(sameSecret("a-secret-value", "another")).toBe(false);
  });
});
```

`tests/unit/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertEnv, envProblems } from "@/lib/env";

const good = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "https://dentasync.example.com",
  SETUP_TOKEN: "y".repeat(32),
};

describe("environment check", () => {
  it("accepts a complete production environment", () => {
    expect(envProblems(good)).toEqual([]);
  });

  it("names each missing production variable", () => {
    expect(envProblems({ NODE_ENV: "production" })).toEqual([
      "DATABASE_URL is not set",
      "BETTER_AUTH_SECRET is not set",
      "APP_URL is not set",
      "SETUP_TOKEN is not set",
    ]);
  });

  it("refuses PGlite, short secrets, and an APP_URL that is not an origin", () => {
    const problems = envProblems({
      ...good,
      DATABASE_URL: "pglite:.data/dev",
      BETTER_AUTH_SECRET: "short",
      APP_URL: "https://dentasync.example.com/",
    });
    expect(problems).toContain("DATABASE_URL must be a Postgres URL in production");
    expect(problems).toContain("BETTER_AUTH_SECRET must be at least 32 characters");
    expect(problems.some((p) => p.startsWith("APP_URL must be an origin"))).toBe(true);
  });

  it("needs nothing in development", () => {
    expect(envProblems({ NODE_ENV: "development" })).toEqual([]);
  });

  it("throws with the problems listed", () => {
    expect(() => assertEnv({ NODE_ENV: "production" })).toThrow(/DATABASE_URL is not set/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

```powershell
npx vitest run --project unit
```

Expected: FAIL, the modules cannot be found.

- [ ] **Step 3: Write `src/lib/time.ts`**

```ts
/** Manila is UTC+8 all year (no daylight saving), so date math uses a fixed offset; display uses Intl. */
export const ZONE = "Asia/Manila";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the Manila calendar day that contains this instant. */
export function manilaDate(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Minutes since Manila midnight for this instant. */
export function manilaMinutes(instant: Date): number {
  const shifted = new Date(instant.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The instant at a number of minutes after midnight on a Manila date. */
export function manilaInstant(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET_MS + minutes * 60_000);
}

/** 0 Sunday to 6 Saturday, for a "YYYY-MM-DD" date. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "HH:MM" or "HH:MM:SS" to minutes since midnight. */
export function toMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight to "HH:MM". */
export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Reads an <input type="datetime-local"> value ("YYYY-MM-DDTHH:MM") as Manila time. */
export function fromManilaLocal(value: string): Date {
  const [date, clock] = value.split("T");
  return manilaInstant(date, toMinutes(clock));
}

/** Formats an instant for an <input type="datetime-local">, in Manila time. */
export function toManilaLocal(instant: Date): string {
  return `${manilaDate(instant)}T${fromMinutes(manilaMinutes(instant))}`;
}

const timeFormat = new Intl.DateTimeFormat("en-PH", { timeZone: ZONE, hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-PH", {
  timeZone: ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** "9:30 AM", Manila time. */
export function formatTime(instant: Date): string {
  return timeFormat.format(instant);
}

/** "Mon, Oct 5, 2026", Manila time. */
export function formatDate(instant: Date): string {
  return dateFormat.format(instant);
}

/** A "YYYY-MM-DD" Manila date, formatted like formatDate. */
export function formatDay(date: string): string {
  return dateFormat.format(manilaInstant(date, 12 * 60));
}

/** "Mon, Oct 5, 2026, 9:30 AM", Manila time. */
export function formatDateTime(instant: Date): string {
  return `${formatDate(instant)}, ${formatTime(instant)}`;
}
```

- [ ] **Step 4: Write `src/lib/hours.ts`**

```ts
import { z } from "zod";
import type { OperatingHours } from "@/db/schema";
import { toMinutes } from "./time";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;

const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00")
  .refine((value) => toMinutes(value) % 15 === 0, "Use 15-minute steps");

export const dayHoursSchema = z
  .object({ open: clock, close: clock })
  .refine((day) => toMinutes(day.open) < toMinutes(day.close), {
    message: "Closing time must be after opening time",
    path: ["close"],
  });

/** All seven days, each open with its hours or null when closed. */
export const operatingHoursSchema = z.record(z.enum(DAY_KEYS), dayHoursSchema.nullable());

/** Monday to Saturday, 9:00 to 18:00: the starting week for a new branch. */
export const DEFAULT_HOURS: OperatingHours = {
  "0": null,
  "1": { open: "09:00", close: "18:00" },
  "2": { open: "09:00", close: "18:00" },
  "3": { open: "09:00", close: "18:00" },
  "4": { open: "09:00", close: "18:00" },
  "5": { open: "09:00", close: "18:00" },
  "6": { open: "09:00", close: "18:00" },
};

/** A weekday's opening hours in minutes since midnight, or null when the branch is closed that day. */
export function hoursOn(hours: OperatingHours, day: number): { open: number; close: number } | null {
  const today = hours[String(day)];
  return today ? { open: toMinutes(today.open), close: toMinutes(today.close) } : null;
}

/** "Mon to Sat 09:00 to 18:00": consecutive days (Monday first) with the same hours share one entry. */
export function hoursSummary(hours: OperatingHours): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parts: string[] = [];
  for (let i = 0; i < order.length; ) {
    const day = hours[String(order[i])];
    if (!day) {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < order.length) {
      const next = hours[String(order[j + 1])];
      if (!next || next.open !== day.open || next.close !== day.close) break;
      j += 1;
    }
    const days = i === j ? SHORT[order[i]] : `${SHORT[order[i]]} to ${SHORT[order[j]]}`;
    parts.push(`${days} ${day.open} to ${day.close}`);
    i = j + 1;
  }
  return parts.length > 0 ? parts.join(", ") : "Closed every day";
}
```

- [ ] **Step 5: Write `src/lib/validation.ts`**

```ts
import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, "Use 3 to 30 letters, numbers, dots, or underscores");

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters");

export const personNameSchema = z.string().trim().min(2, "Enter the full name").max(80, "Use at most 80 characters");

export const titleSchema = z.string().trim().min(1, "Enter a title").max(40, "Use at most 40 characters");

/** The roles a join request or an approval can give. Only /setup creates the owner. */
export const staffRoleSchema = z.enum(["manager", "dentist"]);

/** A Philippine mobile number in any common form, as +639XXXXXXXXX, or null. */
export function normalizeMobile(input: string): string | null {
  const compact = input.replace(/[\s()-]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact);
  return match ? `+63${match[1]}` : null;
}

export const mobileSchema = z
  .string()
  .refine((value) => normalizeMobile(value) !== null, "Use a Philippine mobile number like 0917 123 4567")
  .transform((value) => normalizeMobile(value) as string);
```

- [ ] **Step 6: Write `src/lib/tokens.ts`**

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A random URL-safe token: 16 bytes make 22 characters, 24 bytes make 32. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Compares two secrets in constant time, whatever their lengths. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}
```

- [ ] **Step 7: Write `src/lib/env.ts`**

```ts
type Env = Record<string, string | undefined>;

const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "SETUP_TOKEN"];

/** What is wrong with the environment, by variable name only: a value never appears in a message. */
export function envProblems(env: Env): string[] {
  const production = env.NODE_ENV === "production";
  const problems = production
    ? REQUIRED_IN_PRODUCTION.filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`)
    : [];
  if (production && env.DATABASE_URL?.startsWith("pglite:")) {
    problems.push("DATABASE_URL must be a Postgres URL in production");
  }
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length < 32) {
    problems.push("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 32) problems.push("SETUP_TOKEN must be at least 32 characters");
  if (env.APP_URL) {
    let url: URL | null;
    try {
      url = new URL(env.APP_URL);
    } catch {
      url = null;
    }
    if (!url || url.origin !== env.APP_URL) {
      problems.push("APP_URL must be an origin such as https://dentasync.example.com, with no path or trailing slash");
    } else if (production && url.protocol !== "https:" && url.hostname !== "localhost") {
      problems.push("APP_URL must use https in production");
    }
  }
  return problems;
}

/** Called once when the server starts (src/instrumentation.ts), so a broken deployment fails loudly. */
export function assertEnv(env: Env): void {
  const problems = envProblems(env);
  if (problems.length > 0) throw new Error(`DentaSync environment check failed:\n- ${problems.join("\n- ")}`);
}

/** The app's own origin: APP_URL, or the development default. */
export function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3700";
}
```

- [ ] **Step 8: Run the tests**

```powershell
npx vitest run --project unit
```

Expected: PASS, 5 files, 20 tests.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: add Manila time, opening hours, field rules, tokens, and the environment check" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The permission table

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `tests/unit/permissions.test.ts`

**Interfaces:**
- Produces: `type Role = "owner" | "manager" | "dentist"`, `type Subject = { id: string; role: Role; seesPatients: boolean; branchIds: readonly string[] }`, `type Action` (the 17 actions below), `type Target = { branchId?; branchIds?; dentistId?; userId?; userRole? }`, `covers(s, branchId): boolean`, `can(s, action, target?): boolean`.

- [ ] **Step 1: Write the failing test, `tests/unit/permissions.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { can, covers, type Subject } from "@/lib/permissions";

const DT = "downtown-id";
const WS = "westside-id";
const MN = "metro-id";
const owner: Subject = { id: "owner", role: "owner", seesPatients: false, branchIds: [DT, WS, MN] };
const ownerWhoTreats: Subject = { ...owner, id: "owner-dentist", seesPatients: true };
const manager: Subject = { id: "mgr", role: "manager", seesPatients: false, branchIds: [DT] };
const twoBranchManager: Subject = { id: "mgr2", role: "manager", seesPatients: false, branchIds: [DT, WS] };
const dentist: Subject = { id: "dr", role: "dentist", seesPatients: true, branchIds: [DT, WS] };

describe("covers", () => {
  it("covers every branch for the owner and the listed ones for others", () => {
    expect(covers(owner, "any-branch")).toBe(true);
    expect(covers(manager, DT)).toBe(true);
    expect(covers(manager, WS)).toBe(false);
  });
});

describe("calendar and visits", () => {
  it("shows a branch's calendar to the people who cover it, and a dentist their own visits anywhere", () => {
    expect(can(owner, "calendar.view", { branchId: MN })).toBe(true);
    expect(can(manager, "calendar.view", { branchId: DT })).toBe(true);
    expect(can(manager, "calendar.view", { branchId: WS })).toBe(false);
    expect(can(dentist, "calendar.view", { branchId: WS })).toBe(true);
    expect(can(dentist, "calendar.view", { branchId: MN })).toBe(false);
    expect(can(dentist, "calendar.view", { branchId: MN, dentistId: "dr" })).toBe(true);
    expect(can(dentist, "calendar.view", { branchId: MN, dentistId: "someone-else" })).toBe(false);
  });

  it("lets the owner and the branch's managers book and manage visits", () => {
    for (const action of ["appointment.book", "appointment.manage"] as const) {
      expect(can(owner, action, { branchId: MN })).toBe(true);
      expect(can(manager, action, { branchId: DT })).toBe(true);
      expect(can(manager, action, { branchId: WS })).toBe(false);
      expect(can(dentist, action, { branchId: DT })).toBe(false);
    }
  });

  it("lets dentists start and complete only their own visits", () => {
    expect(can(owner, "appointment.treat", { branchId: MN, dentistId: "someone-else" })).toBe(true);
    expect(can(dentist, "appointment.treat", { branchId: DT, dentistId: "dr" })).toBe(true);
    expect(can(dentist, "appointment.treat", { branchId: DT, dentistId: "someone-else" })).toBe(false);
    expect(can(manager, "appointment.treat", { branchId: DT, dentistId: "someone-else" })).toBe(true);
    expect(can(manager, "appointment.treat", { branchId: WS, dentistId: "someone-else" })).toBe(false);
  });
});

describe("patients and clinical records", () => {
  it("lets everyone read patients and clinical records, and edit allergies and alerts", () => {
    for (const s of [owner, manager, dentist]) {
      expect(can(s, "patient.view")).toBe(true);
      expect(can(s, "clinical.read")).toBe(true);
      expect(can(s, "patient.editAlerts")).toBe(true);
    }
  });

  it("lets only the owner and managers edit patient details", () => {
    expect(can(owner, "patient.edit")).toBe(true);
    expect(can(manager, "patient.edit")).toBe(true);
    expect(can(dentist, "patient.edit")).toBe(false);
  });

  it("lets dentists write clinical records on their own visits or with no visit", () => {
    expect(can(dentist, "clinical.write", { dentistId: "dr" })).toBe(true);
    expect(can(dentist, "clinical.write", {})).toBe(true);
    expect(can(dentist, "clinical.write", { dentistId: "someone-else" })).toBe(false);
    expect(can(manager, "clinical.write", { dentistId: null })).toBe(false);
    expect(can(owner, "clinical.write", { dentistId: "someone-else" })).toBe(false);
    expect(can(ownerWhoTreats, "clinical.write", { dentistId: "someone-else" })).toBe(true);
  });
});

describe("schedules", () => {
  const drTarget = { dentistId: "dr", branchIds: [DT, WS] };

  it("shows a schedule to the owner, managers who share a branch, and the dentist", () => {
    expect(can(owner, "schedule.view", drTarget)).toBe(true);
    expect(can(manager, "schedule.view", drTarget)).toBe(true);
    expect(can(manager, "schedule.view", { dentistId: "x", branchIds: [MN] })).toBe(false);
    expect(can(dentist, "schedule.view", drTarget)).toBe(true);
    expect(can(dentist, "schedule.view", { dentistId: "x", branchIds: [DT] })).toBe(false);
  });

  it("lets the owner and those managers edit it, never the dentist", () => {
    expect(can(owner, "schedule.edit", drTarget)).toBe(true);
    expect(can(manager, "schedule.edit", drTarget)).toBe(true);
    expect(can(manager, "schedule.edit", { dentistId: "x", branchIds: [MN] })).toBe(false);
    expect(can(dentist, "schedule.edit", drTarget)).toBe(false);
  });
});

describe("staff", () => {
  it("shows staff to the owner and managers", () => {
    expect(can(owner, "staff.view")).toBe(true);
    expect(can(manager, "staff.view")).toBe(true);
    expect(can(dentist, "staff.view")).toBe(false);
  });

  it("lets managers approve requests for their branches only", () => {
    expect(can(owner, "staff.approve", { branchId: MN })).toBe(true);
    expect(can(manager, "staff.approve", { branchId: DT })).toBe(true);
    expect(can(manager, "staff.approve", { branchId: WS })).toBe(false);
    expect(can(dentist, "staff.approve", { branchId: DT })).toBe(false);
  });

  it("lets managers manage non-owner staff who share a branch, and nobody manage themselves", () => {
    expect(can(manager, "staff.manage", { userId: "dr", userRole: "dentist", branchIds: [DT, WS] })).toBe(true);
    expect(can(manager, "staff.manage", { userId: "x", userRole: "dentist", branchIds: [MN] })).toBe(false);
    expect(can(manager, "staff.manage", { userId: "owner", userRole: "owner", branchIds: [DT] })).toBe(false);
    expect(can(manager, "staff.manage", { userId: "mgr", userRole: "manager", branchIds: [DT] })).toBe(false);
    expect(can(owner, "staff.manage", { userId: "mgr", userRole: "manager", branchIds: [DT] })).toBe(true);
    expect(can(owner, "staff.manage", { userId: "owner", userRole: "owner" })).toBe(false);
    expect(can(dentist, "staff.manage", { userId: "x", userRole: "manager", branchIds: [DT] })).toBe(false);
  });
});

describe("owner-only areas", () => {
  it("keeps settings and the access log to the owner", () => {
    for (const action of ["settings.edit", "audit.view"] as const) {
      expect(can(owner, action)).toBe(true);
      expect(can(twoBranchManager, action)).toBe(false);
      expect(can(dentist, action)).toBe(false);
    }
  });

  it("shows All branches to the owner and to managers of two or more branches", () => {
    expect(can(owner, "overview.view")).toBe(true);
    expect(can(manager, "overview.view")).toBe(false);
    expect(can(twoBranchManager, "overview.view")).toBe(true);
    expect(can(dentist, "overview.view")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/unit/permissions.test.ts
```

Expected: FAIL, `@/lib/permissions` cannot be found.

- [ ] **Step 3: Write `src/lib/permissions.ts`**

```ts
export type Role = "owner" | "manager" | "dentist";

/** Who is asking: their id, their role, whether they see patients, and the branches they cover. */
export type Subject = { id: string; role: Role; seesPatients: boolean; branchIds: readonly string[] };

export type Action =
  | "calendar.view"
  | "appointment.book"
  | "appointment.manage"
  | "appointment.treat"
  | "patient.view"
  | "patient.edit"
  | "patient.editAlerts"
  | "clinical.read"
  | "clinical.write"
  | "schedule.view"
  | "schedule.edit"
  | "staff.view"
  | "staff.approve"
  | "staff.manage"
  | "settings.edit"
  | "overview.view"
  | "audit.view";

/** What the action is about: a branch, a dentist's visit or schedule, or a staff member. */
export type Target = {
  branchId?: string;
  branchIds?: readonly string[];
  dentistId?: string | null;
  userId?: string;
  userRole?: Role;
};

/** The owner covers every branch; everyone else covers the branches listed for them. */
export function covers(s: Subject, branchId: string): boolean {
  return s.role === "owner" || s.branchIds.includes(branchId);
}

/** The permission table (spec section 5). Every route and page asks it before touching data. */
export function can(s: Subject, action: Action, t: Target = {}): boolean {
  const owner = s.role === "owner";
  const manager = s.role === "manager";
  const dentist = s.role === "dentist";
  const inBranch = t.branchId !== undefined && covers(s, t.branchId);
  const sharesBranch = (t.branchIds ?? []).some((branchId) => covers(s, branchId));
  const own = t.dentistId != null && t.dentistId === s.id;

  switch (action) {
    case "calendar.view":
      return inBranch || (dentist && own);
    case "appointment.book":
    case "appointment.manage":
      return owner || (manager && inBranch);
    case "appointment.treat":
      return owner || (manager && inBranch) || (dentist && own);
    case "patient.view":
    case "patient.editAlerts":
    case "clinical.read":
      return true;
    case "patient.edit":
      return owner || manager;
    case "clinical.write":
      return owner ? s.seesPatients : dentist && (t.dentistId == null || own);
    case "schedule.view":
      return owner || (manager && sharesBranch) || (dentist && own);
    case "schedule.edit":
      return owner || (manager && sharesBranch);
    case "staff.view":
      return owner || manager;
    case "staff.approve":
      return owner || (manager && inBranch);
    case "staff.manage":
      return t.userId !== s.id && (owner || (manager && t.userRole !== "owner" && sharesBranch));
    case "settings.edit":
    case "audit.view":
      return owner;
    case "overview.view":
      return owner || (manager && s.branchIds.length >= 2);
  }
}
```

- [ ] **Step 4: Run it**

```powershell
npx vitest run tests/unit/permissions.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat: add the permission table for owners, managers, and dentists" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sign-in, the signed-in staff member, and the route wrapper

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`, `src/server/errors.ts`, `src/server/audit.ts`, `src/server/accounts.ts`, `src/server/session.ts`, `src/server/guard.ts`, `src/server/api.ts`, `tests/helpers.ts`
- Test: `tests/api/auth.test.ts`

**Interfaces:**
- Consumes: `db`, `Db`, tables from Task 2; `appUrl` from Task 3; `can`, `Subject`, `Role`, `Action`, `Target` from Task 4.
- Produces:
  - `@/lib/auth`: `auth` (Better Auth), `SESSION_SECONDS`.
  - `@/lib/auth-client`: `authClient` (browser; `signIn.username`, `signOut`, `changePassword`).
  - `@/server/errors`: `class ApiError(status, code, message, extra?)`, `notFound(what?)`, `forbidden(message?)`, `pgCode(error)`, `pgMessage(error)`, `pgConstraint(error)`.
  - `@/server/audit`: `audit(entry: AuditEntry, tx?: Db): Promise<void>`, `type AuditEntry = { userId: string | null; action: string; entity: string; entityId?: string | null; branchId?: string | null; details?: Record<string, unknown> }`.
  - `@/server/accounts`: `placeholderEmail()`, `type NewUser`, `createCredentialUser(user: NewUser, passwordHash: string, tx?: Db): Promise<{ id: string }>`, `setPasswordHash(userId, passwordHash, tx?)`, `endSessions(userId, tx?)`.
  - `@/server/session`: `type Staff = Subject & { name; username; title; status; primaryBranchId }`, `staffById(id)`, `staffFromHeaders(headers)`, `requireStaff()` (pages).
  - `@/server/guard`: `requireCan(s, action, target?)`.
  - `@/server/api`: `json(data, status?)`, `toResponse(error)`, `fieldErrors(zodError)`, `staffRoute<P>(handler: (req, staff, params: P) => Promise<Response>)`, `publicRoute<P>(handler: (req, params: P) => Promise<Response>)`, `readJson(req, schema)`, `clientIp(req)`.
  - `tests/helpers.ts`: `PASSWORD`, `makeBranch(opts?)`, `makeUser(opts)`, `signIn(username, password?)`, `request(path, opts?)`, `call(handler, req, params?)`.

- [ ] **Step 1: Write the test helpers, `tests/helpers.ts`**

```ts
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { branches, userBranches, users, type OperatingHours } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Role } from "@/lib/permissions";
import { randomToken } from "@/lib/tokens";
import { createCredentialUser } from "@/server/accounts";
import { staffById, type Staff } from "@/server/session";

export const PASSWORD = "correct horse battery";
const passwordHash = hashPassword(PASSWORD);
let seq = 0;

export async function makeBranch(opts: { code?: string; name?: string; hours?: OperatingHours } = {}) {
  seq += 1;
  const [row] = await db
    .insert(branches)
    .values({
      code: opts.code ?? `branch-${seq}`,
      name: opts.name ?? `Branch ${seq}`,
      operatingHours: opts.hours ?? DEFAULT_HOURS,
      joinCode: randomToken(16),
    })
    .returning();
  return row;
}

/** A staff member with the test password. Pending accounts get requestedBranchId; others get branchIds. */
export async function makeUser(opts: {
  role: Role;
  branchIds?: string[];
  seesPatients?: boolean;
  status?: "pending" | "active" | "disabled";
  requestedBranchId?: string;
  name?: string;
}): Promise<Staff> {
  seq += 1;
  const { id } = await createCredentialUser(
    {
      name: opts.name ?? `Test ${opts.role} ${seq}`,
      username: `${opts.role}.${seq}`,
      role: opts.role,
      status: opts.status ?? "active",
      seesPatients: opts.seesPatients ?? opts.role === "dentist",
      requestedBranchId: opts.requestedBranchId ?? null,
      primaryBranchId: opts.branchIds?.[0] ?? opts.requestedBranchId ?? null,
    },
    await passwordHash,
  );
  if (opts.branchIds?.length) {
    await db.insert(userBranches).values(opts.branchIds.map((branchId) => ({ userId: id, branchId })));
  }
  const staff = await staffById(id);
  if (!staff) throw new Error("makeUser: the user was not created");
  return staff;
}

/** Signs in through Better Auth and returns the session cookie ("name=value"). */
export async function signIn(username: string, password = PASSWORD): Promise<string> {
  const res = await auth.api.signInUsername({ body: { username, password }, returnHeaders: true });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("signIn: no session cookie");
  return cookie.split(";")[0];
}

/** A request as the browser sends it: writes carry the app's Origin and JSON unless told otherwise. */
export function request(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; origin?: string | null; contentType?: string } = {},
): NextRequest {
  const method = opts.method ?? "GET";
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (method !== "GET") {
    if (opts.origin !== null) headers.set("origin", opts.origin ?? "http://localhost:3700");
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  return new NextRequest(new URL(path, "http://localhost:3700"), {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
}

/** Calls a route handler the way Next.js does. */
export function call<P extends Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  req: NextRequest,
  params: P = {} as P,
): Promise<Response> {
  return handler(req, { params: Promise.resolve(params) });
}

/** Reads a user row, for assertions. */
export async function userRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}
```

- [ ] **Step 2: Write the failing test, `tests/api/auth.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/db";
import { appointments, auditLog, chairs, patients } from "@/db/schema";
import { auth } from "@/lib/auth";
import { endSessions } from "@/server/accounts";
import { json, readJson, staffRoute } from "@/server/api";
import { ApiError } from "@/server/errors";
import { call, makeBranch, makeUser, PASSWORD, request, signIn } from "../helpers";

const whoAmI = staffRoute(async (_req, staff) => json({ id: staff.id, role: staff.role }));

describe("signing in", () => {
  it("signs in with a username and finds the staff member", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const res = await call(whoAmI, request("/api/v1/test", { cookie }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ana.id, role: "manager" });
  });

  it("refuses a wrong password", async () => {
    const ana = await makeUser({ role: "manager" });
    await expect(signIn(ana.username, "not the password")).rejects.toThrow();
  });

  it("audits every sign-in, a failed one with the username only", async () => {
    const ben = await makeUser({ role: "manager" });
    await signIn(ben.username);
    await expect(signIn(ben.username, "a wrong password")).rejects.toThrow();
    const rows = (await db.select().from(auditLog)).filter((r) => r.entityId === ben.id || r.details.username === ben.username);
    expect(rows.map((r) => r.action)).toEqual(["auth.signed_in", "auth.sign_in_failed"]);
    expect(JSON.stringify(rows)).not.toContain("a wrong password");
  });

  it("keeps Better Auth's own sign-up closed", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "someone@users.invalid", password: PASSWORD, name: "Someone" } }),
    ).rejects.toThrow();
  });
});

describe("staffRoute", () => {
  it("answers 401 without a session", async () => {
    const res = await call(whoAmI, request("/api/v1/test"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "signed_out", message: "Sign in again." } });
  });

  it("answers 403 to an account that is waiting for approval", async () => {
    const branch = await makeBranch();
    const newcomer = await makeUser({ role: "dentist", status: "pending", requestedBranchId: branch.id });
    const cookie = await signIn(newcomer.username);
    expect((await call(whoAmI, request("/api/v1/test", { cookie }))).status).toBe(403);
  });

  it("signs a person out at once when their sessions end", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    await endSessions(ana.id);
    expect((await call(whoAmI, request("/api/v1/test", { cookie }))).status).toBe(401);
  });

  it("refuses writes from another origin or without JSON", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const write = staffRoute(async () => json({ ok: true }));
    expect((await call(write, request("/x", { method: "POST", cookie, origin: "https://evil.example" }))).status).toBe(403);
    expect((await call(write, request("/x", { method: "POST", cookie, origin: null }))).status).toBe(403);
    expect((await call(write, request("/x", { method: "POST", cookie, contentType: "text/plain" }))).status).toBe(415);
    expect((await call(write, request("/x", { method: "POST", cookie }))).status).toBe(200);
  });

  it("maps thrown errors to the spec's error shape", async () => {
    const ana = await makeUser({ role: "manager" });
    const cookie = await signIn(ana.username);
    const failing = (error: unknown) =>
      staffRoute(async () => {
        throw error;
      });

    let res = await call(failing(new ApiError(422, "nope", "Not allowed.", { fields: { a: "b" } })), request("/x", { cookie }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { code: "nope", message: "Not allowed.", fields: { a: "b" } } });

    const validating = staffRoute(async (req) => json(await readJson(req, z.object({ name: z.string().min(2, "Too short") }))));
    res = await call(validating, request("/x", { method: "POST", cookie, body: { name: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ name: "Too short" });

    res = await call(failing(new Error("boom")), request("/x", { cookie }));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
  });

  it("turns an overlap refused by the database into 409", async () => {
    const branch = await makeBranch();
    await db.insert(chairs).values({ branchId: branch.id, number: 1 });
    const dentist = await makeUser({ role: "dentist", branchIds: [branch.id] });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const [ben] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ben" }).returning();
    const start = new Date("2026-10-05T01:00:00Z");
    const end = new Date("2026-10-05T02:00:00Z");
    const row = (patientId: string) => ({
      patientId,
      dentistId: dentist.id,
      branchId: branch.id,
      chairNumber: 1,
      startTime: start,
      endTime: end,
      chairFreeAt: end,
      status: "confirmed",
      source: "staff",
    });
    await db.insert(appointments).values(row(ana.id));
    const booking = staffRoute(async () => {
      await db.insert(appointments).values(row(ben.id));
      return json({ ok: true });
    });
    const cookie = await signIn((await makeUser({ role: "manager", branchIds: [branch.id] })).username);
    const res = await call(booking, request("/x", { method: "POST", cookie }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });
});
```

- [ ] **Step 3: Run it to see it fail**

```powershell
npx vitest run tests/api/auth.test.ts
```

Expected: FAIL, `@/lib/auth` cannot be found.

- [ ] **Step 4: Write `src/lib/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getIP } from "better-auth/api";
import { username } from "better-auth/plugins/username";
import { db } from "@/db";
import { accounts, auditLog, rateLimits, sessions, users, verifications } from "@/db/schema";
import { appUrl } from "@/lib/env";

/** One working day (spec 6.7). Sessions are never extended by activity. */
export const SESSION_SECONDS = 12 * 60 * 60;

export const auth = betterAuth({
  appName: "DentaSync",
  baseURL: appUrl(),
  // Production refuses to start without BETTER_AUTH_SECRET (src/lib/env.ts); this default only serves development.
  secret: process.env.BETTER_AUTH_SECRET || "development-only-secret-do-not-use-in-production",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications, rateLimit: rateLimits },
  }),
  // Accounts are created only by /setup and the join QR (src/server/setup.ts, src/server/staff.ts).
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10, maxPasswordLength: 128 },
  plugins: [username()],
  // Better Auth refuses a user table with required columns it does not know. These two are DentaSync's, and only our
  // own code (src/server/accounts.ts) writes them.
  user: { additionalFields: { role: { type: "string", input: false }, status: { type: "string", input: false } } },
  session: { expiresIn: SESSION_SECONDS, disableSessionRefresh: true },
  hooks: {
    // Spec 13: every sign-in is audited, a failed one with the username tried (never the password).
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/username") return;
      const user = ctx.context.newSession?.user;
      const from = ctx.request ?? ctx.headers;
      const ip = from ? getIP(from, ctx.context.options) : null;
      await db.insert(auditLog).values({
        userId: user?.id ?? null,
        action: user ? "auth.signed_in" : "auth.sign_in_failed",
        entity: "user",
        entityId: user?.id ?? null,
        details: user ? { ip } : { ip, username: String(ctx.body?.username ?? "").trim().toLowerCase().slice(0, 30) },
      });
    }),
  },
  rateLimit: { storage: "database", customRules: { "/sign-in/username": { window: 15 * 60, max: 10 } } },
  disabledPaths: ["/sign-up/email", "/sign-in/email", "/update-user", "/is-username-available"],
  advanced: { database: { generateId: "uuid" } },
  telemetry: { enabled: false },
});
```

- [ ] **Step 5: Write `src/lib/auth-client.ts` and the auth route**

`src/lib/auth-client.ts`:

```ts
"use client";

import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [usernameClient()] });
```

`src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 6: Write `src/server/errors.ts`**

```ts
/** An error a route answers with its own status and code (spec section 12). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what = "That") => new ApiError(404, "not_found", `${what} was not found.`);

export const forbidden = (message = "You do not have access to this.") => new ApiError(403, "forbidden", message);

type PgLike = { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };

/** The Postgres error inside Drizzle's wrapper (DrizzleQueryError keeps it as `cause`). */
function pgError(error: unknown): PgLike | undefined {
  for (let e = error as PgLike | undefined; e; e = e.cause as PgLike | undefined) {
    if (!(e instanceof ApiError) && typeof e.code === "string") return e;
  }
  return undefined;
}

export function pgCode(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.code === "string" ? e.code : undefined;
}

export function pgMessage(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.message === "string" ? e.message : undefined;
}

export function pgConstraint(error: unknown): string | undefined {
  const e = pgError(error);
  return typeof e?.constraint === "string" ? e.constraint : undefined;
}
```

- [ ] **Step 7: Write `src/server/audit.ts` and `src/server/guard.ts`**

`src/server/audit.ts`:

```ts
import { db, type Db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditEntry = {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  branchId?: string | null;
  details?: Record<string, unknown>;
};

/** Records who did what (spec 13). Pass the transaction so the entry commits with the change. Never log health data. */
export async function audit(entry: AuditEntry, tx: Db = db): Promise<void> {
  await tx.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    branchId: entry.branchId ?? null,
    details: entry.details ?? {},
  });
}
```

`src/server/guard.ts`:

```ts
import { can, type Action, type Subject, type Target } from "@/lib/permissions";
import { forbidden } from "./errors";

/** Throws 403 unless the permission table allows the action. */
export function requireCan(s: Subject, action: Action, target?: Target): void {
  if (!can(s, action, target)) throw forbidden();
}
```

- [ ] **Step 8: Write `src/server/accounts.ts`**

```ts
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type Db } from "@/db";
import { accounts, sessions, users } from "@/db/schema";
import type { Role } from "@/lib/permissions";

/** Better Auth needs an email on every user. Ours are random addresses under the reserved .invalid domain. */
export function placeholderEmail(): string {
  return `${randomUUID()}@users.invalid`;
}

export type NewUser = {
  name: string;
  username: string;
  role: Role;
  status: "pending" | "active" | "disabled";
  seesPatients: boolean;
  title?: string | null;
  requestedBranchId?: string | null;
  primaryBranchId?: string | null;
};

/** Creates a user with a password the way Better Auth's own sign-up would: provider "credential", accountId = user id. */
export async function createCredentialUser(user: NewUser, passwordHash: string, tx: Db = db): Promise<{ id: string }> {
  const [row] = await tx
    .insert(users)
    .values({ ...user, displayUsername: user.username, email: placeholderEmail() })
    .returning({ id: users.id });
  await tx.insert(accounts).values({ userId: row.id, accountId: row.id, providerId: "credential", password: passwordHash });
  return row;
}

/** Replaces a password and signs the person out everywhere. */
export async function setPasswordHash(userId: string, passwordHash: string, tx: Db = db): Promise<void> {
  await tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
  await endSessions(userId, tx);
}

/** Ends every session of a person; their next request finds none. */
export async function endSessions(userId: string, tx: Db = db): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}
```

- [ ] **Step 9: Write `src/server/session.ts`**

```ts
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { branches, userBranches, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Role, Subject } from "@/lib/permissions";

export type StaffStatus = "pending" | "active" | "disabled";

export type Staff = Subject & {
  name: string;
  username: string;
  title: string | null;
  status: StaffStatus;
  primaryBranchId: string | null;
};

/** A staff member as the guard sees them, read fresh from the database. The owner covers every active branch. */
export async function staffById(id: string): Promise<Staff | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) return null;
  const branchIds =
    row.role === "owner"
      ? (await db.select({ id: branches.id }).from(branches).where(eq(branches.active, true))).map((b) => b.id)
      : (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, id))).map(
          (b) => b.id,
        );
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role as Role,
    status: row.status as StaffStatus,
    seesPatients: row.seesPatients,
    title: row.title,
    primaryBranchId: row.primaryBranchId,
    branchIds,
  };
}

/** The signed-in person for these request headers, or null. */
export async function staffFromHeaders(requestHeaders: Headers): Promise<Staff | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  return session ? staffById(session.user.id) : null;
}

/** For pages: the signed-in, approved staff member, or a redirect to where they belong. */
export const requireStaff = cache(async (): Promise<Staff> => {
  const staff = await staffFromHeaders(await headers());
  if (!staff || staff.status === "disabled") redirect("/login");
  if (staff.status === "pending") redirect("/waiting");
  return staff;
});
```

- [ ] **Step 10: Write `src/server/api.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, z } from "zod";
import { appUrl } from "@/lib/env";
import { ApiError, pgCode, pgMessage } from "./errors";
import { staffFromHeaders, type Staff } from "./session";

type Params = Record<string, string>;

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function errorBody(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
  return fields;
}

/** Maps anything a handler throws to the error shape of spec section 12. */
export function toResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return errorBody(error.status, error.code, error.message, error.extra);
  if (error instanceof ZodError) {
    return errorBody(400, "invalid", "Check the highlighted fields.", { fields: fieldErrors(error) });
  }
  switch (pgCode(error)) {
    case "23P01":
      return errorBody(409, "conflict", "That time was just taken. Refresh and try again.");
    case "DS001":
      return errorBody(422, "status_change", pgMessage(error) ?? "That status change is not allowed.");
    case "DS002":
      return errorBody(422, "locked", "This record cannot be changed.");
    case "23505":
      return errorBody(409, "duplicate", "That already exists.");
  }
  const requestId = crypto.randomUUID();
  console.error(`Request ${requestId} failed:`, error);
  return errorBody(500, "server_error", `Something went wrong. Reference: ${requestId}`, { requestId });
}

/** Writes must come from DentaSync's own pages, as JSON (spec section 11). */
function refuseForeignWrite(req: NextRequest): NextResponse | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (req.headers.get("origin") !== new URL(appUrl()).origin) {
    return errorBody(403, "bad_origin", "This request did not come from DentaSync.");
  }
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return errorBody(415, "not_json", "Send the request as JSON.");
  }
  return null;
}

/** A route for approved staff: checks the write, the session, and the account, and maps every error. */
export function staffRoute<P extends Params = Params>(
  handler: (req: NextRequest, staff: Staff, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const refused = refuseForeignWrite(req);
    if (refused) return refused;
    try {
      const staff = await staffFromHeaders(req.headers);
      if (!staff || staff.status === "disabled") return errorBody(401, "signed_out", "Sign in again.");
      if (staff.status !== "active") return errorBody(403, "pending", "Your account is waiting for approval.");
      return await handler(req, staff, await ctx.params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** A route for the signed-out forms: setup, recovery, joining, and password reset. */
export function publicRoute<P extends Params = Params>(handler: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    const refused = refuseForeignWrite(req);
    if (refused) return refused;
    try {
      return await handler(req, await ctx.params);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** Parses the JSON body with a Zod schema. A bad body throws, and the route answers 400. */
export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "invalid", "The request body is not valid JSON.");
  }
  return schema.parse(raw);
}

/** The caller's IP address, for rate limits. Hosting platforms set x-forwarded-for. */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
```

- [ ] **Step 11: Run the tests**

```powershell
npx vitest run tests/api/auth.test.ts
```

Expected: PASS, 10 tests (the 500 case prints one "Request ... failed" line; that is expected).

- [ ] **Step 12: Typecheck and commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat: add username sign-in, the signed-in staff member, and the route wrapper" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: First run, sign-in, and owner recovery

**Files:**
- Modify: `src/lib/validation.ts` (add `practiceNameSchema`), `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/server/setup.ts`, `src/server/home.ts`, `src/app/api/v1/setup/route.ts`, `src/app/api/v1/setup/recover/route.ts`, `src/lib/fetcher.ts`, `src/components/providers.tsx`, `src/components/text-field.tsx`, `src/components/auth-card.tsx`, `src/components/form-alert.tsx`, `src/app/login/page.tsx`, `src/app/login/login-form.tsx`, `src/app/setup/page.tsx`, `src/app/setup/setup-form.tsx`, `src/app/setup/recover/page.tsx`, `src/app/setup/recover/recover-form.tsx`
- Test: `tests/db/setup.test.ts`

**Interfaces:**
- Consumes: Task 5's `createCredentialUser`, `setPasswordHash`, `audit`, `ApiError`, `publicRoute`, `readJson`, `json`, `staffFromHeaders`, `authClient`; Task 3's `sameSecret`, field schemas.
- Produces:
  - `@/lib/validation`: `practiceNameSchema`.
  - `@/server/setup`: `setupSchema`, `recoverSchema`, `ownerExists(): Promise<boolean>`, `createOwner(input): Promise<{ username }>`, `recoverOwner(input): Promise<{ username }>`.
  - `@/server/home`: `homePath(staff: Staff): Promise<string>`.
  - `@/lib/fetcher`: `type ErrorBody`, `class RequestError(status, body)`, `api<T>(path, init?)`, `errorMessage(error)`, `fieldErrors(error)`.
  - Components: `Providers`, `TextField` (props: `label`, `error?`, `hint?`, plus `<input>` props), `AuthCard` (`title`, `description?`, `children`), `FormAlert` (`message: string | null`).
  - Routes: `POST /api/v1/setup` (201 `{ username }`), `POST /api/v1/setup/recover` (200 `{ username }`).

- [ ] **Step 1: Write the failing test, `tests/db/setup.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import * as recoverRoute from "@/app/api/v1/setup/recover/route";
import * as setupRoute from "@/app/api/v1/setup/route";
import { db } from "@/db";
import { auditLog, practice } from "@/db/schema";
import { ownerExists } from "@/server/setup";
import { staffFromHeaders } from "@/server/session";
import { call, PASSWORD, request, signIn } from "../helpers";

const SETUP = process.env.SETUP_TOKEN as string;
const owner = { practiceName: "Smile Dental", name: "Dr. Maria Santos", username: "Maria.Santos", password: PASSWORD };
const post = (path: string, body: unknown) => request(path, { method: "POST", body });

describe("first run", () => {
  it("refuses a wrong setup code", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: "wrong" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.fields).toEqual({ setupCode: "That setup code is not right." });
    expect(await ownerExists()).toBe(false);
  });

  it("checks the fields", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP, username: "x", password: "short" }));
    expect(res.status).toBe(400);
    const { fields } = (await res.json()).error;
    expect(Object.keys(fields).sort()).toEqual(["password", "username"]);
  });

  it("creates the practice and its owner, once", async () => {
    const res = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ username: "maria.santos" });
    expect(await ownerExists()).toBe(true);
    expect((await db.select().from(practice))[0].name).toBe("Smile Dental");
    await signIn("maria.santos");

    const again = await call(setupRoute.POST, post("/api/v1/setup", { ...owner, setupCode: SETUP, username: "second.owner" }));
    expect(again.status).toBe(409);
    const actions = (await db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toContain("setup.completed");
  });
});

describe("owner recovery", () => {
  it("refuses a wrong setup code", async () => {
    const res = await call(recoverRoute.POST, post("/api/v1/setup/recover", { setupCode: "wrong", password: "a brand new password" }));
    expect(res.status).toBe(403);
  });

  it("sets a new password with the setup code and signs the owner out", async () => {
    const cookie = await signIn("maria.santos");
    const res = await call(recoverRoute.POST, post("/api/v1/setup/recover", { setupCode: SETUP, password: "a brand new password" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: "maria.santos" });
    expect(await staffFromHeaders(new Headers({ cookie }))).toBeNull();
    await signIn("maria.santos", "a brand new password");
    await expect(signIn("maria.santos")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/db/setup.test.ts
```

Expected: FAIL, `@/app/api/v1/setup/recover/route` cannot be found.

- [ ] **Step 3: Add `practiceNameSchema` to `src/lib/validation.ts`**

Append:

```ts
export const practiceNameSchema = z.string().trim().min(1, "Enter the practice name").max(80, "Use at most 80 characters");
```

- [ ] **Step 4: Write `src/server/setup.ts`**

```ts
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { practice, users } from "@/db/schema";
import { sameSecret } from "@/lib/tokens";
import { passwordSchema, personNameSchema, practiceNameSchema, usernameSchema } from "@/lib/validation";
import { createCredentialUser, setPasswordHash } from "./accounts";
import { audit } from "./audit";
import { ApiError } from "./errors";

export const setupSchema = z.object({
  setupCode: z.string().min(1, "Enter the setup code"),
  practiceName: practiceNameSchema,
  name: personNameSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const recoverSchema = z.object({
  setupCode: z.string().min(1, "Enter the setup code"),
  password: passwordSchema,
});

export async function ownerExists(): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1);
  return row !== undefined;
}

function checkSetupCode(code: string): void {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !sameSecret(code, expected)) {
    throw new ApiError(403, "bad_setup_code", "That setup code is not right.", {
      fields: { setupCode: "That setup code is not right." },
    });
  }
}

/** First run (spec 6.1): creates the practice and its owner, once. */
export async function createOwner(input: z.infer<typeof setupSchema>): Promise<{ username: string }> {
  checkSetupCode(input.setupCode);
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1);
    if (existing) throw new ApiError(409, "already_set_up", "DentaSync is already set up. Sign in instead.");
    await tx
      .insert(practice)
      .values({ name: input.practiceName })
      .onConflictDoUpdate({ target: practice.id, set: { name: input.practiceName } });
    const owner = await createCredentialUser(
      { name: input.name, username: input.username, role: "owner", status: "active", seesPatients: false },
      passwordHash,
      tx,
    );
    await audit({ userId: owner.id, action: "setup.completed", entity: "user", entityId: owner.id }, tx);
  });
  return { username: input.username };
}

/** The owner's own password reset with the setup code (spec 6.6). Ends the owner's sessions. */
export async function recoverOwner(input: z.infer<typeof recoverSchema>): Promise<{ username: string }> {
  checkSetupCode(input.setupCode);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.role, "owner"));
    if (!owner) throw new ApiError(404, "not_set_up", "DentaSync is not set up yet. Open /setup first.");
    await setPasswordHash(owner.id, passwordHash, tx);
    await audit({ userId: owner.id, action: "setup.owner_password_reset", entity: "user", entityId: owner.id }, tx);
    return { username: owner.username };
  });
}
```

- [ ] **Step 5: Write the two routes**

`src/app/api/v1/setup/route.ts`:

```ts
import { json, publicRoute, readJson } from "@/server/api";
import { createOwner, setupSchema } from "@/server/setup";

export const POST = publicRoute(async (req) => json(await createOwner(await readJson(req, setupSchema)), 201));
```

`src/app/api/v1/setup/recover/route.ts`:

```ts
import { json, publicRoute, readJson } from "@/server/api";
import { recoverOwner, recoverSchema } from "@/server/setup";

export const POST = publicRoute(async (req) => json(await recoverOwner(await readJson(req, recoverSchema))));
```

- [ ] **Step 6: Run the test**

```powershell
npx vitest run tests/db/setup.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Write `src/server/home.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import type { Staff } from "./session";

/** Where each person lands after signing in. Plan B points these at the calendar. */
export async function homePath(staff: Staff): Promise<string> {
  if (staff.role === "owner") return "/all/settings";
  const branchId = staff.primaryBranchId ?? staff.branchIds[0];
  const [branch] = branchId
    ? await db.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId))
    : [];
  if (!branch) throw new Error("This account has no branch. Ask the owner to give it one.");
  return staff.role === "manager" ? `/${branch.code}/staff` : `/${branch.code}/settings`;
}
```

- [ ] **Step 8: Write the browser API client, `src/lib/fetcher.ts`**

```ts
export type ErrorBody = {
  code: string;
  message: string;
  fields?: Record<string, string>;
  conflicts?: unknown[];
  warnings?: { code: string; message: string }[];
  requestId?: string;
};

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
    this.name = "RequestError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Calls DentaSync's own API. Writes always send JSON, which the server requires. */
export async function api<T = unknown>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(
    `/api/v1${path}`,
    method === "GET"
      ? { cache: "no-store" }
      : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body ?? {}) },
  );
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const body = (data as { error?: ErrorBody } | null)?.error;
    throw new RequestError(res.status, body ?? { code: "server_error", message: "Something went wrong. Try again." });
  }
  return data as T;
}

/** The message to show for a failed call. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Field errors from a failed call, keyed by field name. */
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof RequestError ? (error.body.fields ?? {}) : {};
}
```

- [ ] **Step 9: Write the shared form pieces**

`src/components/providers.tsx`:

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors closeButton />
    </QueryClientProvider>
  );
}
```

`src/components/text-field.tsx`:

```tsx
"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<"input"> & { label: string; error?: string; hint?: string };

/** A labelled input with its hint and error wired to it for screen readers. */
export function TextField({ label, error, hint, id, className, ...input }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
```

`src/components/auth-card.tsx`:

```tsx
export function AuthCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-primary">DentaSync</p>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {children}
    </main>
  );
}
```

`src/components/form-alert.tsx`:

```tsx
import { Alert, AlertDescription } from "@/components/ui/alert";

/** A form-level error, announced to screen readers. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 10: Wrap the app in the providers, `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "DentaSync", template: "%s | DentaSync" },
  description: "Appointments, chairs, and dental charts for a practice with several branches.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Write the root page, `src/app/page.tsx`**

```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { homePath } from "@/server/home";
import { staffFromHeaders } from "@/server/session";
import { ownerExists } from "@/server/setup";

/** Sends each visitor where they belong: setup, sign-in, the waiting page, or their home. */
export default async function Home() {
  // Request time only: `next build` must never open the database.
  await connection();
  if (!(await ownerExists())) redirect("/setup");
  const staff = await staffFromHeaders(await headers());
  if (!staff || staff.status === "disabled") redirect("/login");
  if (staff.status === "pending") redirect("/waiting");
  redirect(await homePath(staff));
}
```

- [ ] **Step 12: Write the sign-in page**

`src/app/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthCard title="Sign in" description="Use the username and password you chose when you joined.">
      <LoginForm />
      <p className="text-sm text-muted-foreground">Forgot your password? Ask your manager for a reset QR.</p>
    </AuthCard>
  );
}
```

`src/app/login/login-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setAlert(null);
    const { error } = await authClient.signIn.username({
      username: String(form.get("username") ?? "").trim().toLowerCase(),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setAlert(
        error.status === 429
          ? "Too many attempts. Wait 15 minutes, then try again."
          : "That username and password do not match.",
      );
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormAlert message={alert} />
      <TextField name="username" label="Username" required autoComplete="username" autoCapitalize="none" />
      <TextField name="password" label="Password" type="password" required autoComplete="current-password" />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 13: Write the setup page**

`src/app/setup/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { ownerExists } from "@/server/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  // Spec 6.1: once an owner exists, /setup answers 404; the owner's own reset lives at /setup/recover.
  if (await ownerExists()) notFound();
  return (
    <AuthCard
      title="Set up DentaSync"
      description="Name the practice and create the owner's account. You add the branches next."
    >
      <SetupForm />
    </AuthCard>
  );
}
```

`src/app/setup/setup-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function SetupForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("password") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      const { username } = await api<{ username: string }>("/setup", {
        method: "POST",
        body: {
          setupCode: value("setupCode"),
          practiceName: value("practiceName"),
          name: value("name"),
          username: value("username"),
          password: value("password"),
        },
      });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("DentaSync is set up, but signing in failed. Sign in on the next page.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      setAlert(Object.keys(fields).length > 0 ? null : errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormAlert message={alert} />
      <TextField name="setupCode" label="Setup code" type="password" autoComplete="off" error={errors.setupCode} hint="The SETUP_TOKEN value from the server's settings." />
      <TextField name="practiceName" label="Practice name" maxLength={80} error={errors.practiceName} />
      <TextField name="name" label="Your full name" autoComplete="name" maxLength={80} error={errors.name} />
      <TextField name="username" label="Username" autoComplete="username" autoCapitalize="none" maxLength={30} error={errors.username} hint="3 to 30 letters, numbers, dots, or underscores." />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <Button type="submit" disabled={pending}>
        {pending ? "Setting up..." : "Set up DentaSync"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 14: Write the owner recovery page**

`src/app/setup/recover/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Owner password" };

export default function RecoverPage() {
  return (
    <AuthCard title="Reset the owner's password" description="Enter the setup code from the server's settings and a new password.">
      <RecoverForm />
    </AuthCard>
  );
}
```

`src/app/setup/recover/recover-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function RecoverForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("password") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      const { username } = await api<{ username: string }>("/setup/recover", {
        method: "POST",
        body: { setupCode: value("setupCode"), password: value("password") },
      });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("The password is changed, but signing in failed. Sign in with the new password.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      setAlert(Object.keys(fields).length > 0 ? null : errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormAlert message={alert} />
      <TextField name="setupCode" label="Setup code" type="password" autoComplete="off" error={errors.setupCode} />
      <TextField name="password" label="New password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Set the new password"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 15: Check it in the browser**

Create `.env.local` from `.env.example` with `BETTER_AUTH_SECRET` and `SETUP_TOKEN` set to two different values from `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Run `npm run dev` and open http://localhost:3700.

Expected: `/` redirects to `/setup`. Submitting with a wrong code shows "That setup code is not right." under the code field. The right code creates the owner and lands on `/all/settings` (a 404 until Task 10; that is expected here). `/setup` now answers 404, and signing in at `/login` with the new username works.

- [ ] **Step 16: Run everything and commit**

```powershell
npm test; npm run lint; npm run typecheck
git add -A
git commit -m "feat: add first-run setup, sign-in, and the owner's password recovery" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Practice name, branches, chairs, and procedures

**Files:**
- Create: `src/server/practice.ts`, `src/server/branches.ts`, `src/server/procedures.ts`
- Create routes: `src/app/api/v1/practice/route.ts`, `src/app/api/v1/branches/route.ts`, `src/app/api/v1/branches/[code]/route.ts`, `src/app/api/v1/branches/[code]/join-code/route.ts`, `src/app/api/v1/branches/[code]/chairs/route.ts`, `src/app/api/v1/branches/[code]/chairs/[number]/route.ts`, `src/app/api/v1/procedures/route.ts`, `src/app/api/v1/procedures/[id]/route.ts`
- Test: `tests/db/settings.test.ts`

**Interfaces:**
- Consumes: `requireCan`, `audit`, `ApiError`, `notFound`, `staffRoute`, `readJson`, `json`; `operatingHoursSchema`; `randomToken`; tables.
- Produces:
  - `@/server/practice`: `practiceSchema`, `practiceName(): Promise<string>`, `renamePractice(actor, input)`.
  - `@/server/branches`: `ACTIVE_STATUSES`, `branchCodeSchema`, `branchSchema`, `branchPatchSchema`, `chairSchema`, `chairPatchSchema`, `type BranchView = { id; code; name; address; phone; operatingHours; active; sort; chairCount }`, `listBranches(): Promise<BranchView[]>`, `branchByCode(code)`, `requireBranch(code)` (throws 404), `createBranch(actor, input): Promise<{ id; code }>`, `updateBranch(actor, code, patch): Promise<{ id; code }>`, `replaceJoinCode(actor, code)`, `listChairs(branchId)`, `addChair(actor, branchId, input)`, `updateChair(actor, branchId, number, patch)`.
  - `@/server/procedures`: `procedureSchema`, `procedurePatchSchema`, `type ProcedureRow`, `listProcedures(opts?: { activeOnly?: boolean })`, `createProcedure(actor, input)`, `updateProcedure(actor, id, patch)`.
  - Routes: `PATCH /practice`; `GET, POST /branches`; `PATCH /branches/{code}`; `POST /branches/{code}/join-code`; `GET, POST /branches/{code}/chairs`; `PATCH /branches/{code}/chairs/{number}`; `GET, POST /procedures` (`GET ?active=1` lists active ones); `PATCH /procedures/{id}`.

- [ ] **Step 1: Write the failing test, `tests/db/settings.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as chairRoute from "@/app/api/v1/branches/[code]/chairs/[number]/route";
import * as chairsRoute from "@/app/api/v1/branches/[code]/chairs/route";
import * as joinCodeRoute from "@/app/api/v1/branches/[code]/join-code/route";
import * as branchRoute from "@/app/api/v1/branches/[code]/route";
import * as branchesRoute from "@/app/api/v1/branches/route";
import * as practiceRoute from "@/app/api/v1/practice/route";
import * as procedureRoute from "@/app/api/v1/procedures/[id]/route";
import * as proceduresRoute from "@/app/api/v1/procedures/route";
import { db } from "@/db";
import { appointments, branches, patients, practice } from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Staff } from "@/server/session";
import { call, makeUser, request, signIn } from "../helpers";

// A practice has one owner, so the whole file shares one.
let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}
const branchBody = (code: string, name = "Downtown") => ({ code, name, address: "1 Rizal Ave", phone: "02 8123 4567", operatingHours: DEFAULT_HOURS });

describe("practice", () => {
  it("lets the owner rename the practice", async () => {
    await db.insert(practice).values({ name: "Old Name" }).onConflictDoNothing();
    const { cookie } = await ownerCookie();
    const res = await call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body: { name: "Smile Dental Group" } }));
    expect(res.status).toBe(200);
    expect((await db.select().from(practice))[0].name).toBe("Smile Dental Group");
  });
});

describe("branches", () => {
  it("lets the owner add branches and refuses a code in use", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("downtown") }));
    expect(res.status).toBe(201);
    const again = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("downtown", "Other") }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.fields).toEqual({ code: "Another branch uses that code." });
    const bad = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("all") }));
    expect(bad.status).toBe(400);
  });

  it("refuses managers", async () => {
    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const manager = await makeUser({ role: "manager", branchIds: [b.id] });
    const cookie = await signIn(manager.username);
    const res = await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("westside") }));
    expect(res.status).toBe(403);
    const list = await call(branchesRoute.GET, request("/api/v1/branches", { cookie }));
    expect(list.status).toBe(200);
  });

  it("lists branches with their active chair count and no join code", async () => {
    const { cookie } = await ownerCookie();
    await call(chairsRoute.POST, request("/api/v1/branches/downtown/chairs", { method: "POST", cookie, body: { label: "General" } }), { code: "downtown" });
    await call(chairsRoute.POST, request("/api/v1/branches/downtown/chairs", { method: "POST", cookie, body: { label: "Ortho" } }), { code: "downtown" });
    const list = await (await call(branchesRoute.GET, request("/api/v1/branches", { cookie }))).json();
    const downtown = list.find((b: { code: string }) => b.code === "downtown");
    expect(downtown.chairCount).toBe(2);
    expect(downtown).not.toHaveProperty("joinCode");
  });

  it("numbers chairs, renames them, and keeps a chair with upcoming visits active", async () => {
    const { cookie } = await ownerCookie();
    const chairs = await (await call(chairsRoute.GET, request("/api/v1/branches/downtown/chairs", { cookie }), { code: "downtown" })).json();
    expect(chairs.map((c: { number: number; label: string }) => [c.number, c.label])).toEqual([
      [1, "General"],
      [2, "Ortho"],
    ]);
    const renamed = await call(chairRoute.PATCH, request("/api/v1/branches/downtown/chairs/2", { method: "PATCH", cookie, body: { label: "Orthodontics" } }), { code: "downtown", number: "2" });
    expect(renamed.status).toBe(200);

    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const dentist = await makeUser({ role: "dentist", branchIds: [b.id] });
    const [p] = await db.insert(patients).values({ lastName: "Reyes", firstName: "Lia" }).returning();
    const start = new Date(Date.now() + 7 * 86_400_000);
    await db.insert(appointments).values({
      patientId: p.id, dentistId: dentist.id, branchId: b.id, chairNumber: 1,
      startTime: start, endTime: new Date(start.getTime() + 3_600_000), chairFreeAt: new Date(start.getTime() + 3_600_000),
      status: "confirmed", source: "staff",
    });
    const off = await call(chairRoute.PATCH, request("/api/v1/branches/downtown/chairs/1", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown", number: "1" });
    expect(off.status).toBe(422);
    expect((await off.json()).error.message).toBe("Chair 1 has 1 upcoming visit. Move it first.");
  });

  it("keeps at least one branch open", async () => {
    const { cookie } = await ownerCookie();
    await call(branchesRoute.POST, request("/api/v1/branches", { method: "POST", cookie, body: branchBody("westside", "Westside") }));
    const off = await call(branchRoute.PATCH, request("/api/v1/branches/westside", { method: "PATCH", cookie, body: { active: false } }), { code: "westside" });
    expect(off.status).toBe(200);
    await db.update(appointments).set({ status: "cancelled", cancelReason: "Test" });
    const lastOff = await call(branchRoute.PATCH, request("/api/v1/branches/downtown", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown" });
    expect(lastOff.status).toBe(422);
    expect((await lastOff.json()).error.code).toBe("last_branch");
  });

  it("replaces a branch's join code", async () => {
    const { cookie } = await ownerCookie();
    const [before] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const res = await call(joinCodeRoute.POST, request("/api/v1/branches/downtown/join-code", { method: "POST", cookie }), { code: "downtown" });
    expect(res.status).toBe(200);
    const [after] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    expect(after.joinCode).not.toBe(before.joinCode);
    expect(after.joinCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("procedures", () => {
  it("adds, validates, and updates procedures", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis", durationMinutes: 45, bufferMinutes: 15 } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const dup = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis", durationMinutes: 30, bufferMinutes: 0 } }));
    expect(dup.status).toBe(409);
    const bad = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Odd", durationMinutes: 42, bufferMinutes: 0 } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields.durationMinutes).toBe("Use 5-minute steps");
    const off = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { active: false } }), { id });
    expect(off.status).toBe(200);
    const active = await (await call(proceduresRoute.GET, request("/api/v1/procedures?active=1", { cookie }))).json();
    expect(active).toEqual([]);
  });

  it("keeps a branch with visits not over yet open, counting one in the chair now", async () => {
    const { cookie } = await ownerCookie();
    const on = await call(branchRoute.PATCH, request("/api/v1/branches/westside", { method: "PATCH", cookie, body: { active: true } }), { code: "westside" });
    expect(on.status).toBe(200);
    const [b] = await db.select().from(branches).where(eq(branches.code, "downtown"));
    const dentist = await makeUser({ role: "dentist", branchIds: [b.id] });
    const [p] = await db.insert(patients).values({ lastName: "Cruz", firstName: "Ben" }).returning();
    const start = new Date(Date.now() - 600_000);
    await db.insert(appointments).values({
      patientId: p.id, dentistId: dentist.id, branchId: b.id, chairNumber: 2,
      startTime: start, endTime: new Date(start.getTime() + 3_600_000), chairFreeAt: new Date(start.getTime() + 3_600_000),
      status: "confirmed", source: "staff",
    });
    const off = await call(branchRoute.PATCH, request("/api/v1/branches/downtown", { method: "PATCH", cookie, body: { active: false } }), { code: "downtown" });
    expect(off.status).toBe(422);
    expect((await off.json()).error).toMatchObject({ code: "has_visits", message: "This branch has 1 upcoming visit. Move or cancel it first." });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/db/settings.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 3: Write `src/server/practice.ts`**

```ts
import { z } from "zod";
import { db } from "@/db";
import { practice } from "@/db/schema";
import { practiceNameSchema } from "@/lib/validation";
import { audit } from "./audit";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const practiceSchema = z.object({ name: practiceNameSchema });

export async function practiceName(): Promise<string> {
  const [row] = await db.select({ name: practice.name }).from(practice);
  return row?.name ?? "DentaSync";
}

export async function renamePractice(actor: Staff, input: z.infer<typeof practiceSchema>): Promise<void> {
  requireCan(actor, "settings.edit");
  await db.transaction(async (tx) => {
    await tx.insert(practice).values({ name: input.name }).onConflictDoUpdate({ target: practice.id, set: { name: input.name } });
    await audit({ userId: actor.id, action: "practice.renamed", entity: "practice", details: { name: input.name } }, tx);
  });
}
```

- [ ] **Step 4: Write `src/server/branches.ts`**

```ts
import { and, asc, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, chairs, type OperatingHours } from "@/db/schema";
import { operatingHoursSchema } from "@/lib/hours";
import { randomToken } from "@/lib/tokens";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

/** Statuses that hold time: the exclusion constraints' "active" (spec section 7). */
export const ACTIVE_STATUSES = ["requested", "confirmed", "checked_in", "in_treatment"] as const;

const somethingToChange = (patch: Record<string, unknown>) => Object.values(patch).some((value) => value !== undefined);

export const branchCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/, "Use 2 to 24 lowercase letters, numbers, or hyphens")
  .refine((code) => code !== "all", "That code is reserved");

export const branchSchema = z.object({
  code: branchCodeSchema,
  name: z.string().trim().min(1, "Enter a name").max(40, "Use at most 40 characters"),
  address: z.string().trim().max(200, "Use at most 200 characters"),
  phone: z.string().trim().max(20, "Use at most 20 characters"),
  operatingHours: operatingHoursSchema,
});

export const branchPatchSchema = branchSchema
  .partial()
  .extend({ active: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() })
  .refine(somethingToChange, "Nothing to change");

export const chairSchema = z.object({ label: z.string().trim().max(30, "Use at most 30 characters") });

export const chairPatchSchema = z
  .object({ label: chairSchema.shape.label.optional(), active: z.boolean().optional() })
  .refine(somethingToChange, "Nothing to change");

export type BranchView = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  operatingHours: OperatingHours;
  active: boolean;
  sort: number;
  chairCount: number;
};

/** Every branch with its count of active chairs (the prompt's chairs_count). Join codes never leave the server here. */
export async function listBranches(): Promise<BranchView[]> {
  return db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      address: branches.address,
      phone: branches.phone,
      operatingHours: branches.operatingHours,
      active: branches.active,
      sort: branches.sort,
      chairCount: sql<number>`(select count(*)::int from ${chairs} where ${chairs.branchId} = ${branches.id} and ${chairs.active})`,
    })
    .from(branches)
    .orderBy(asc(branches.sort), asc(branches.name));
}

export async function branchByCode(code: string) {
  const [row] = await db.select().from(branches).where(eq(branches.code, code));
  return row ?? null;
}

export async function requireBranch(code: string) {
  const branch = await branchByCode(code);
  if (!branch) throw notFound("That branch");
  return branch;
}

const codeTaken = () =>
  new ApiError(409, "code_taken", "Another branch uses that code.", { fields: { code: "Another branch uses that code." } });

export async function createBranch(actor: Staff, input: z.infer<typeof branchSchema>): Promise<{ id: string; code: string }> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, input.code));
    if (taken) throw codeTaken();
    const [row] = await tx
      .insert(branches)
      .values({ ...input, joinCode: randomToken(16) })
      .returning({ id: branches.id, code: branches.code });
    await audit({ userId: actor.id, action: "branch.created", entity: "branch", entityId: row.id, branchId: row.id, details: { code: row.code } }, tx);
    return row;
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function updateBranch(
  actor: Staff,
  code: string,
  patch: z.infer<typeof branchPatchSchema>,
): Promise<{ id: string; code: string }> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.code, code)).for("update");
    if (!branch) throw notFound("That branch");
    if (patch.code && patch.code !== branch.code) {
      const [taken] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, patch.code));
      if (taken) throw codeTaken();
    }
    if (patch.active === false && branch.active) {
      const [others] = await tx
        .select({ n: count() })
        .from(branches)
        .where(and(eq(branches.active, true), ne(branches.id, branch.id)));
      if (others.n === 0) throw new ApiError(422, "last_branch", "Keep at least one branch open.");
      const [visits] = await tx
        .select({ n: count() })
        .from(appointments)
        // Visits not over yet count, including one in the chair right now.
        .where(and(eq(appointments.branchId, branch.id), inArray(appointments.status, [...ACTIVE_STATUSES]), gt(appointments.endTime, new Date())));
      if (visits.n > 0) {
        throw new ApiError(422, "has_visits", `This branch has ${plural(visits.n, "upcoming visit")}. Move or cancel ${visits.n === 1 ? "it" : "them"} first.`);
      }
    }
    const [row] = await tx.update(branches).set(patch).where(eq(branches.id, branch.id)).returning({ id: branches.id, code: branches.code });
    await audit({ userId: actor.id, action: "branch.updated", entity: "branch", entityId: branch.id, branchId: branch.id, details: patch }, tx);
    return row;
  });
}

/** A new QR code for the branch; the printed old one stops working at once (spec 6.2). */
export async function replaceJoinCode(actor: Staff, code: string): Promise<void> {
  requireCan(actor, "settings.edit");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(branches).set({ joinCode: randomToken(16) }).where(eq(branches.code, code)).returning({ id: branches.id });
    if (!row) throw notFound("That branch");
    await audit({ userId: actor.id, action: "branch.qr_replaced", entity: "branch", entityId: row.id, branchId: row.id }, tx);
  });
}

export async function listChairs(branchId: string) {
  return db.select().from(chairs).where(eq(chairs.branchId, branchId)).orderBy(asc(chairs.number));
}

export async function addChair(actor: Staff, branchId: string, input: z.infer<typeof chairSchema>) {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${chairs.number}), 0)::int + 1` })
      .from(chairs)
      .where(eq(chairs.branchId, branchId));
    if (next > 99) throw new ApiError(422, "too_many_chairs", "A branch can have at most 99 chairs.");
    const [row] = await tx.insert(chairs).values({ branchId, number: next, label: input.label }).returning();
    await audit({ userId: actor.id, action: "chair.added", entity: "chair", entityId: `${branchId}:${next}`, branchId, details: { label: input.label } }, tx);
    return row;
  });
}

export async function updateChair(actor: Staff, branchId: string, number: number, patch: z.infer<typeof chairPatchSchema>) {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    if (patch.active === false) {
      const [visits] = await tx
        .select({ n: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.branchId, branchId),
            eq(appointments.chairNumber, number),
            inArray(appointments.status, [...ACTIVE_STATUSES]),
            gt(appointments.endTime, new Date()),
          ),
        );
      if (visits.n > 0) {
        throw new ApiError(422, "has_visits", `Chair ${number} has ${plural(visits.n, "upcoming visit")}. Move ${visits.n === 1 ? "it" : "them"} first.`);
      }
    }
    const [row] = await tx.update(chairs).set(patch).where(and(eq(chairs.branchId, branchId), eq(chairs.number, number))).returning();
    if (!row) throw notFound("That chair");
    await audit({ userId: actor.id, action: "chair.updated", entity: "chair", entityId: `${branchId}:${number}`, branchId, details: patch }, tx);
    return row;
  });
}
```

- [ ] **Step 5: Write `src/server/procedures.ts`**

```ts
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { procedures } from "@/db/schema";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const procedureSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters"),
  durationMinutes: z.number().int().min(5, "At least 5 minutes").max(480, "At most 480 minutes").multipleOf(5, "Use 5-minute steps"),
  bufferMinutes: z.number().int().min(0, "0 or more minutes").max(120, "At most 120 minutes"),
});

export const procedurePatchSchema = procedureSchema
  .partial()
  .extend({ active: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export type ProcedureRow = typeof procedures.$inferSelect;

const nameTaken = () =>
  new ApiError(409, "name_taken", "Another procedure has that name.", { fields: { name: "Another procedure has that name." } });

export async function listProcedures(opts: { activeOnly?: boolean } = {}): Promise<ProcedureRow[]> {
  return db
    .select()
    .from(procedures)
    .where(opts.activeOnly ? eq(procedures.active, true) : undefined)
    .orderBy(asc(procedures.sort), asc(procedures.name));
}

export async function createProcedure(actor: Staff, input: z.infer<typeof procedureSchema>): Promise<ProcedureRow> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, input.name));
    if (taken) throw nameTaken();
    const [row] = await tx.insert(procedures).values(input).returning();
    await audit({ userId: actor.id, action: "procedure.created", entity: "procedure", entityId: row.id, details: input }, tx);
    return row;
  });
}

export async function updateProcedure(actor: Staff, id: string, patch: z.infer<typeof procedurePatchSchema>): Promise<ProcedureRow> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    if (patch.name) {
      const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, patch.name));
      if (taken && taken.id !== id) throw nameTaken();
    }
    const [row] = await tx.update(procedures).set(patch).where(eq(procedures.id, id)).returning();
    if (!row) throw notFound("That procedure");
    await audit({ userId: actor.id, action: "procedure.updated", entity: "procedure", entityId: id, details: patch }, tx);
    return row;
  });
}
```

- [ ] **Step 6: Write the routes**

`src/app/api/v1/practice/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { practiceSchema, renamePractice } from "@/server/practice";

export const PATCH = staffRoute(async (req, staff) => {
  await renamePractice(staff, await readJson(req, practiceSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/branches/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { branchSchema, createBranch, listBranches } from "@/server/branches";

export const GET = staffRoute(async () => json(await listBranches()));

export const POST = staffRoute(async (req, staff) => json(await createBranch(staff, await readJson(req, branchSchema)), 201));
```

`src/app/api/v1/branches/[code]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { branchPatchSchema, updateBranch } from "@/server/branches";

export const PATCH = staffRoute<{ code: string }>(async (req, staff, { code }) =>
  json(await updateBranch(staff, code, await readJson(req, branchPatchSchema))),
);
```

`src/app/api/v1/branches/[code]/join-code/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { replaceJoinCode } from "@/server/branches";

export const POST = staffRoute<{ code: string }>(async (_req, staff, { code }) => {
  await replaceJoinCode(staff, code);
  return json({ ok: true });
});
```

`src/app/api/v1/branches/[code]/chairs/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { addChair, chairSchema, listChairs, requireBranch } from "@/server/branches";

export const GET = staffRoute<{ code: string }>(async (_req, _staff, { code }) => json(await listChairs((await requireBranch(code)).id)));

export const POST = staffRoute<{ code: string }>(async (req, staff, { code }) => {
  const branch = await requireBranch(code);
  return json(await addChair(staff, branch.id, await readJson(req, chairSchema)), 201);
});
```

`src/app/api/v1/branches/[code]/chairs/[number]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { chairPatchSchema, requireBranch, updateChair } from "@/server/branches";

export const PATCH = staffRoute<{ code: string; number: string }>(async (req, staff, { code, number }) => {
  const branch = await requireBranch(code);
  return json(await updateChair(staff, branch.id, Number(number), await readJson(req, chairPatchSchema)));
});
```

`src/app/api/v1/procedures/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { createProcedure, listProcedures, procedureSchema } from "@/server/procedures";

export const GET = staffRoute(async (req) =>
  json(await listProcedures({ activeOnly: req.nextUrl.searchParams.get("active") === "1" })),
);

export const POST = staffRoute(async (req, staff) => json(await createProcedure(staff, await readJson(req, procedureSchema)), 201));
```

`src/app/api/v1/procedures/[id]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { procedurePatchSchema, updateProcedure } from "@/server/procedures";

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await updateProcedure(staff, id, await readJson(req, procedurePatchSchema))),
);
```

- [ ] **Step 7: Run the test**

```powershell
npx vitest run tests/db/settings.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 8: Commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat: add the practice name, branches, chairs, and procedures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Staff: joining by QR, approvals, changes, and password resets

**Files:**
- Create: `src/server/qr.ts`, `src/server/staff.ts`
- Modify: `src/lib/auth.ts` (refuse sign-in for disabled accounts)
- Create routes: `src/app/api/v1/join/[code]/route.ts`, `src/app/api/v1/reset/[token]/route.ts`, `src/app/api/v1/join-requests/route.ts`, `src/app/api/v1/join-requests/[id]/approve/route.ts`, `src/app/api/v1/join-requests/[id]/decline/route.ts`, `src/app/api/v1/staff/route.ts`, `src/app/api/v1/staff/[id]/route.ts`, `src/app/api/v1/staff/[id]/reset-link/route.ts`
- Test: `tests/db/staff.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 7.
- Produces:
  - `@/server/qr`: `qrSvg(text: string): Promise<string>`.
  - `@/server/staff`: `joinSchema`, `approveSchema`, `updateStaffSchema`, `resetSchema`, `branchForJoinCode(code): Promise<{ id; name } | null>`, `requestToJoin(code, input, ip): Promise<{ username }>`, `type JoinRequestView = { id; name; username; role; branchId; branchName; createdAt }`, `listJoinRequests(actor)`, `approveRequest(actor, userId, input)`, `declineRequest(actor, userId)`, `type StaffView = { id; name; username; role; title; status; seesPatients; branchIds; canManage }`, `listStaff(actor)`, `updateStaff(actor, userId, patch)`, `createResetLink(actor, userId): Promise<{ url; expiresAt; qrSvg }>`, `resetWithToken(token, input): Promise<{ username }>`.
  - Routes: `POST /join/{code}` (201 `{ username }`), `POST /reset/{token}` (`{ username }`), `GET /join-requests`, `POST /join-requests/{id}/approve`, `POST /join-requests/{id}/decline`, `GET /staff`, `PATCH /staff/{id}`, `POST /staff/{id}/reset-link` (`{ url, expiresAt, qrSvg }`).

- [ ] **Step 1: Write the failing test, `tests/db/staff.test.ts`**

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as approveRoute from "@/app/api/v1/join-requests/[id]/approve/route";
import * as declineRoute from "@/app/api/v1/join-requests/[id]/decline/route";
import * as requestsRoute from "@/app/api/v1/join-requests/route";
import * as joinRoute from "@/app/api/v1/join/[code]/route";
import * as resetRoute from "@/app/api/v1/reset/[token]/route";
import * as resetLinkRoute from "@/app/api/v1/staff/[id]/reset-link/route";
import * as staffMemberRoute from "@/app/api/v1/staff/[id]/route";
import * as staffListRoute from "@/app/api/v1/staff/route";
import { db } from "@/db";
import { auditLog, branches, dentistSchedules, userBranches, users, verifications } from "@/db/schema";
import { staffById, staffFromHeaders, type Staff } from "@/server/session";
import { call, makeBranch, makeUser, PASSWORD, request, signIn, userRow } from "../helpers";

let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}

const newcomer = (username: string, role = "dentist") => ({ name: "New Person", username, password: PASSWORD, role });
const join = (code: string, body: unknown, ip = "10.0.0.1") =>
  call(joinRoute.POST, request(`/api/v1/join/${code}`, { method: "POST", body, headers: { "x-forwarded-for": ip } }), { code });
const approve = (cookie: string, id: string, body: unknown) =>
  call(approveRoute.POST, request(`/api/v1/join-requests/${id}/approve`, { method: "POST", cookie, body }), { id });
const patch = (cookie: string, id: string, body: unknown) =>
  call(staffMemberRoute.PATCH, request(`/api/v1/staff/${id}`, { method: "PATCH", cookie, body }), { id });
const branchesOf = async (userId: string) =>
  (await db.select().from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.branchId).sort();

describe("joining by QR", () => {
  it("creates a pending account that can sign in but reaches nothing", async () => {
    const branch = await makeBranch();
    const res = await join(branch.joinCode, newcomer("Ana.Cruz"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ username: "ana.cruz" });
    const [row] = await db.select().from(users).where(eq(users.username, "ana.cruz"));
    expect(row).toMatchObject({ status: "pending", role: "dentist", seesPatients: true, requestedBranchId: branch.id });
    const cookie = await signIn("ana.cruz");
    expect((await staffFromHeaders(new Headers({ cookie })))?.status).toBe("pending");
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "staff.join_requested"));
    expect(log.details).toMatchObject({ ip: "10.0.0.1", username: "ana.cruz" });
  });

  it("refuses a replaced code and a taken username", async () => {
    const branch = await makeBranch();
    const replaced = await join("not-a-current-code", newcomer("ben.lim"));
    expect(replaced.status).toBe(404);
    expect((await replaced.json()).error.code).toBe("qr_replaced");
    const taken = await join(branch.joinCode, newcomer("ana.cruz"), "10.0.0.2");
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.fields).toEqual({ username: "That username is taken. Try another." });
  });

  it("allows 5 requests an hour from one connection", async () => {
    const branch = await makeBranch();
    for (let i = 1; i <= 5; i += 1) expect((await join(branch.joinCode, newcomer(`lim.${i}`), "10.0.0.9")).status).toBe(201);
    const sixth = await join(branch.joinCode, newcomer("lim.6"), "10.0.0.9");
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("too_many_requests");
  });

  it("holds at most 20 open requests per branch", async () => {
    const branch = await makeBranch();
    for (let i = 0; i < 20; i += 1) await makeUser({ role: "dentist", status: "pending", requestedBranchId: branch.id });
    const res = await join(branch.joinCode, newcomer("one.more"), "10.0.0.10");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("branch_full");
  });

  it("deletes requests older than 7 days on the next join", async () => {
    const branch = await makeBranch();
    const old = await makeUser({ role: "manager", status: "pending", requestedBranchId: branch.id });
    await db.update(users).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(users.id, old.id));
    expect((await join(branch.joinCode, newcomer("fresh.one"), "10.0.0.11")).status).toBe(201);
    expect(await userRow(old.id)).toBeUndefined();
  });

  it("deletes expired requests when the approval screen loads, and refuses their sign-in", async () => {
    const branch = await makeBranch();
    const old = await makeUser({ role: "dentist", status: "pending", requestedBranchId: branch.id });
    await db.update(users).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(users.id, old.id));
    await expect(signIn(old.username)).rejects.toThrow();
    const { cookie } = await ownerCookie();
    expect((await call(requestsRoute.GET, request("/api/v1/join-requests", { cookie }))).status).toBe(200);
    expect(await userRow(old.id)).toBeUndefined();
  });
});

describe("approving", () => {
  it("shows managers their branches' requests and lets them approve there", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const atA = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const atB = await makeUser({ role: "dentist", status: "pending", requestedBranchId: b.id });
    const cookie = await signIn(manager.username);
    const list = await (await call(requestsRoute.GET, request("/api/v1/join-requests", { cookie }))).json();
    const ids = list.map((r: { id: string }) => r.id);
    expect(ids).toContain(atA.id);
    expect(ids).not.toContain(atB.id);

    const res = await approve(cookie, atA.id, { role: "dentist", branchIds: [a.id], title: "Orthodontist" });
    expect(res.status).toBe(200);
    expect(await userRow(atA.id)).toMatchObject({ status: "active", title: "Orthodontist", approvedBy: manager.id, primaryBranchId: a.id });
    expect(await branchesOf(atA.id)).toEqual([a.id]);
  });

  it("refuses approvals outside a manager's branches", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const cookie = await signIn(manager.username);
    const atB = await makeUser({ role: "dentist", status: "pending", requestedBranchId: b.id });
    expect((await approve(cookie, atB.id, { role: "dentist", branchIds: [b.id] })).status).toBe(403);
    const atA = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const wide = await approve(cookie, atA.id, { role: "dentist", branchIds: [a.id, b.id] });
    expect(wide.status).toBe(403);
    expect((await wide.json()).error.message).toBe("You can only give branches you work at.");
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    expect((await call(requestsRoute.GET, request("/api/v1/join-requests", { cookie: dentistCookie }))).status).toBe(403);
  });

  it("lets the owner approve with open branches only", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const b = await makeBranch();
    const closed = await makeBranch();
    await db.update(branches).set({ active: false }).where(eq(branches.id, closed.id));
    const pending = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    expect((await approve(cookie, pending.id, { role: "manager", branchIds: [a.id, closed.id] })).status).toBe(400);
    expect((await approve(cookie, pending.id, { role: "manager", branchIds: [b.id, a.id] })).status).toBe(200);
    expect(await userRow(pending.id)).toMatchObject({ role: "manager", seesPatients: false, primaryBranchId: a.id });
  });

  it("declines by deleting the account", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const pending = await makeUser({ role: "dentist", status: "pending", requestedBranchId: a.id });
    const res = await call(declineRoute.POST, request(`/api/v1/join-requests/${pending.id}/decline`, { method: "POST", cookie }), { id: pending.id });
    expect(res.status).toBe(200);
    expect(await userRow(pending.id)).toBeUndefined();
    const actions = (await db.select().from(auditLog).where(eq(auditLog.entityId, pending.id))).map((row) => row.action);
    expect(actions).toContain("staff.declined");
  });
});

describe("changing staff", () => {
  it("lets a manager disable a dentist at their branch, ending sessions and sign-ins at once", async () => {
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    const res = await patch(await signIn(manager.username), dentist.id, { status: "disabled" });
    expect(res.status).toBe(200);
    expect(await staffFromHeaders(new Headers({ cookie: dentistCookie }))).toBeNull();
    await expect(signIn(dentist.username)).rejects.toThrow();
  });

  it("keeps managers away from the owner and from themselves", async () => {
    const { owner } = await ownerCookie();
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const cookie = await signIn(manager.username);
    expect((await patch(cookie, owner.id, { title: "Boss" })).status).toBe(403);
    expect((await patch(cookie, manager.id, { title: "Head" })).status).toBe(403);
  });

  it("lets the owner switch their own access to patients but not their role", async () => {
    const { owner, cookie } = await ownerCookie();
    expect((await patch(cookie, owner.id, { seesPatients: true, title: "Dentist" })).status).toBe(200);
    expect((await staffById(owner.id))?.seesPatients).toBe(true);
    expect((await patch(cookie, owner.id, { role: "manager" })).status).toBe(403);
  });

  it("keeps a dentist's other branches when a manager changes theirs", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id, b.id] });
    await db.insert(dentistSchedules).values([
      { dentistId: dentist.id, branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { dentistId: dentist.id, branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    ]);
    expect((await patch(await signIn(manager.username), dentist.id, { branchIds: [] })).status).toBe(200);
    expect(await branchesOf(dentist.id)).toEqual([b.id]);
    const left = await db.select().from(dentistSchedules).where(eq(dentistSchedules.dentistId, dentist.id));
    expect(left.map((row) => row.branchId)).toEqual([b.id]);
    const { cookie } = await ownerCookie();
    const none = await patch(cookie, dentist.id, { branchIds: [] });
    expect(none.status).toBe(400);
    expect((await none.json()).error.fields).toEqual({ branchIds: "Keep at least one branch." });
  });

  it("refuses a branch the manager does not cover", async () => {
    const a = await makeBranch();
    const b = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const res = await patch(await signIn(manager.username), dentist.id, { branchIds: [a.id, b.id] });
    expect(res.status).toBe(403);
    expect(await branchesOf(dentist.id)).toEqual([a.id]);
  });

  it("lists the staff each person may see", async () => {
    const a = await makeBranch();
    const c = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const colleague = await makeUser({ role: "dentist", branchIds: [a.id] });
    const elsewhere = await makeUser({ role: "dentist", branchIds: [c.id] });
    const seen = await (await call(staffListRoute.GET, request("/api/v1/staff", { cookie: await signIn(manager.username) }))).json();
    const ids = seen.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([manager.id, colleague.id]));
    expect(ids).not.toContain(elsewhere.id);
    const { cookie } = await ownerCookie();
    const all = await (await call(staffListRoute.GET, request("/api/v1/staff", { cookie }))).json();
    expect(all.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([manager.id, colleague.id, elsewhere.id]));
  });
});

describe("password reset by QR", () => {
  it("works once, for 15 minutes, and signs the person out everywhere", async () => {
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const dentistCookie = await signIn(dentist.username);
    const res = await call(resetLinkRoute.POST, request(`/api/v1/staff/${dentist.id}/reset-link`, { method: "POST", cookie: await signIn(manager.username) }), { id: dentist.id });
    expect(res.status).toBe(200);
    const link = await res.json();
    expect(link.url).toMatch(/^http:\/\/localhost:3700\/reset\/[A-Za-z0-9_-]{32}$/);
    expect(link.qrSvg).toContain("<svg");
    const minutes = (Date.parse(link.expiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);

    const token = link.url.split("/reset/")[1];
    const reset = (password: string) => call(resetRoute.POST, request(`/api/v1/reset/${token}`, { method: "POST", body: { password } }), { token });
    const done = await reset("a fresh password 1");
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ username: dentist.username });
    expect(await staffFromHeaders(new Headers({ cookie: dentistCookie }))).toBeNull();
    await signIn(dentist.username, "a fresh password 1");
    const again = await reset("another password 2");
    expect(again.status).toBe(404);
    expect((await again.json()).error.code).toBe("link_expired");
  });

  it("refuses an expired link", async () => {
    const { cookie } = await ownerCookie();
    const a = await makeBranch();
    const dentist = await makeUser({ role: "dentist", branchIds: [a.id] });
    const link = await (await call(resetLinkRoute.POST, request(`/api/v1/staff/${dentist.id}/reset-link`, { method: "POST", cookie }), { id: dentist.id })).json();
    await db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verifications.value, dentist.id));
    const token = link.url.split("/reset/")[1];
    const res = await call(resetRoute.POST, request(`/api/v1/reset/${token}`, { method: "POST", body: { password: "a fresh password 1" } }), { token });
    expect(res.status).toBe(404);
  });

  it("does not let a manager reset the owner", async () => {
    const { owner } = await ownerCookie();
    const a = await makeBranch();
    const manager = await makeUser({ role: "manager", branchIds: [a.id] });
    const res = await call(resetLinkRoute.POST, request(`/api/v1/staff/${owner.id}/reset-link`, { method: "POST", cookie: await signIn(manager.username) }), { id: owner.id });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Let the test helper send extra headers**

In `tests/helpers.ts`, change `request` to accept `headers` and apply them:

```ts
export function request(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    contentType?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const method = opts.method ?? "GET";
  const headers = new Headers(opts.headers);
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (method !== "GET") {
    if (opts.origin !== null) headers.set("origin", opts.origin ?? "http://localhost:3700");
    headers.set("content-type", opts.contentType ?? "application/json");
  }
  return new NextRequest(new URL(path, "http://localhost:3700"), {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
  });
}
```

- [ ] **Step 3: Run the test to see it fail**

```powershell
npx vitest run tests/db/staff.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 4: Refuse sign-in for disabled accounts in `src/lib/auth.ts`**

Add `import { eq } from "drizzle-orm";` at the top, and add this option to the `betterAuth({...})` call, after `session`:

```ts
  databaseHooks: {
    session: {
      create: {
        // A disabled account cannot sign in (spec 6.5), nor a join request older than 7 days (spec 6.3). A pending one
        // can, to see the waiting page.
        before: async (session) => {
          const [user] = await db.select({ status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.id, session.userId));
          const expired = user?.status === "pending" && user.createdAt.getTime() < Date.now() - 7 * 86_400_000;
          return user?.status === "disabled" || expired ? false : undefined;
        },
      },
    },
  },
```

- [ ] **Step 5: Write `src/server/qr.ts`**

```ts
import QRCode from "qrcode";

/** A QR code as an SVG string: black on white, with a quiet zone, readable by any phone camera. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
}
```

- [ ] **Step 6: Write `src/server/staff.ts`**

```ts
import { hashPassword } from "better-auth/crypto";
import { and, asc, count, eq, gt, inArray, like, lt, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { auditLog, branches, dentistSchedules, userBranches, users, verifications } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { can, covers, type Role } from "@/lib/permissions";
import { randomToken, sha256 } from "@/lib/tokens";
import { passwordSchema, personNameSchema, staffRoleSchema, titleSchema, usernameSchema } from "@/lib/validation";
import { createCredentialUser, endSessions, setPasswordHash } from "./accounts";
import { audit } from "./audit";
import { ApiError, forbidden, notFound } from "./errors";
import { requireCan } from "./guard";
import { qrSvg } from "./qr";
import type { Staff } from "./session";

const REQUESTS_PER_IP_PER_HOUR = 5;
const OPEN_REQUESTS_PER_BRANCH = 20;
const RESET_MINUTES = 15;
const RESET_PREFIX = "staff-reset:";
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

/** Spec 6.3: an expired request is deleted the next time a join or approval screen loads. */
function deleteExpiredRequests(tx: Db = db) {
  return tx.delete(users).where(and(eq(users.status, "pending"), lt(users.createdAt, SEVEN_DAYS_AGO)));
}

export const joinSchema = z.object({
  name: personNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: staffRoleSchema,
});

export const approveSchema = z.object({
  role: staffRoleSchema,
  branchIds: z.array(z.uuid()).min(1, "Pick at least one branch").max(20),
  title: titleSchema.nullable().optional(),
});

export const updateStaffSchema = z
  .object({
    role: staffRoleSchema.optional(),
    branchIds: z.array(z.uuid()).max(20).optional(),
    title: titleSchema.nullable().optional(),
    seesPatients: z.boolean().optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export const resetSchema = z.object({ password: passwordSchema });

/** The branch a join QR belongs to, while the code is current and the branch is open. */
export async function branchForJoinCode(code: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.joinCode, code), eq(branches.active, true)));
  return row ?? null;
}

const usernameTaken = () =>
  new ApiError(409, "username_taken", "That username is taken. Try another.", {
    fields: { username: "That username is taken. Try another." },
  });

/** Spec 6.3: a pending account for the QR's branch. It can sign in, but reaches nothing until someone approves it. */
export async function requestToJoin(code: string, input: z.infer<typeof joinSchema>, ip: string): Promise<{ username: string }> {
  const branch = await branchForJoinCode(code);
  if (!branch) throw new ApiError(404, "qr_replaced", "This QR code no longer works. Ask the owner for the current one.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // One join at a time, so two requests cannot both pass the per-connection and per-branch counts below. Joins are rare.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dentasync.join'))`);
    await deleteExpiredRequests(tx);
    const [fromIp] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff.join_requested"), sql`${auditLog.details}->>'ip' = ${ip}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
    if (fromIp.n >= REQUESTS_PER_IP_PER_HOUR) {
      throw new ApiError(429, "too_many_requests", "Too many requests from this connection. Try again in an hour.");
    }
    const [open] = await tx
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.status, "pending"), eq(users.requestedBranchId, branch.id)));
    if (open.n >= OPEN_REQUESTS_PER_BRANCH) {
      throw new ApiError(429, "branch_full", "This branch has too many requests waiting. Ask the owner or a manager to approve or decline them first.");
    }
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, input.username));
    if (taken) throw usernameTaken();
    const user = await createCredentialUser(
      {
        name: input.name,
        username: input.username,
        role: input.role,
        status: "pending",
        seesPatients: input.role === "dentist",
        requestedBranchId: branch.id,
        primaryBranchId: branch.id,
      },
      passwordHash,
      tx,
    );
    await audit(
      { userId: user.id, action: "staff.join_requested", entity: "user", entityId: user.id, branchId: branch.id, details: { ip, username: input.username, role: input.role } },
      tx,
    );
    return { username: input.username };
  });
}

export type JoinRequestView = {
  id: string;
  name: string;
  username: string;
  role: Role;
  branchId: string;
  branchName: string;
  createdAt: Date;
};

export async function listJoinRequests(actor: Staff): Promise<JoinRequestView[]> {
  requireCan(actor, "staff.view");
  await deleteExpiredRequests();
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, branchId: branches.id, branchName: branches.name, createdAt: users.createdAt })
    .from(users)
    .innerJoin(branches, eq(branches.id, users.requestedBranchId))
    .where(and(eq(users.status, "pending"), gt(users.createdAt, SEVEN_DAYS_AGO)))
    .orderBy(asc(users.createdAt));
  return rows
    .filter((row) => can(actor, "staff.approve", { branchId: row.branchId }))
    .map((row) => ({ ...row, role: row.role as Role }));
}

async function pendingRequest(tx: Db, userId: string) {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "pending"), gt(users.createdAt, SEVEN_DAYS_AGO)))
    .for("update");
  if (!row?.requestedBranchId) throw new ApiError(404, "not_found", "This request no longer exists.");
  return { ...row, requestedBranchId: row.requestedBranchId };
}

/** Spec 6.4: the owner, or a manager of the request's branch, gives the role and branches. */
export async function approveRequest(actor: Staff, userId: string, input: z.infer<typeof approveSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await pendingRequest(tx, userId);
    requireCan(actor, "staff.approve", { branchId: target.requestedBranchId });
    const granted = [...new Set(input.branchIds)];
    if (granted.some((branchId) => !covers(actor, branchId))) throw forbidden("You can only give branches you work at.");
    const open = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(inArray(branches.id, granted), eq(branches.active, true)));
    if (open.length !== granted.length) {
      throw new ApiError(400, "invalid", "Pick open branches only.", { fields: { branchIds: "Pick open branches only." } });
    }
    await tx
      .update(users)
      .set({
        status: "active",
        role: input.role,
        title: input.title ?? null,
        seesPatients: input.role === "dentist",
        primaryBranchId: granted.includes(target.requestedBranchId) ? target.requestedBranchId : granted[0],
        approvedBy: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.insert(userBranches).values(granted.map((branchId) => ({ userId, branchId })));
    await audit(
      { userId: actor.id, action: "staff.approved", entity: "user", entityId: userId, branchId: target.requestedBranchId, details: { role: input.role, branchIds: granted } },
      tx,
    );
  });
}

export async function declineRequest(actor: Staff, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await pendingRequest(tx, userId);
    requireCan(actor, "staff.approve", { branchId: target.requestedBranchId });
    await tx.delete(users).where(eq(users.id, userId));
    await audit(
      { userId: actor.id, action: "staff.declined", entity: "user", entityId: userId, branchId: target.requestedBranchId, details: { username: target.username } },
      tx,
    );
  });
}

export type StaffView = {
  id: string;
  name: string;
  username: string;
  role: Role;
  title: string | null;
  status: "active" | "disabled";
  seesPatients: boolean;
  branchIds: string[];
  canManage: boolean;
};

async function branchesByUser(tx: Db = db): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const link of await tx.select().from(userBranches)) map.set(link.userId, [...(map.get(link.userId) ?? []), link.branchId]);
  return map;
}

/** Approved staff: everyone for the owner; for a manager, themselves and the staff who share a branch with them. */
export async function listStaff(actor: Staff): Promise<StaffView[]> {
  requireCan(actor, "staff.view");
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, title: users.title, status: users.status, seesPatients: users.seesPatients })
    .from(users)
    .where(ne(users.status, "pending"))
    .orderBy(asc(users.name));
  const links = await branchesByUser();
  return rows
    .map((row) => {
      const role = row.role as Role;
      const branchIds = links.get(row.id) ?? [];
      const ownerSelf = row.id === actor.id && role === "owner";
      return {
        ...row,
        role,
        status: row.status as StaffView["status"],
        branchIds,
        canManage: ownerSelf || can(actor, "staff.manage", { userId: row.id, userRole: role, branchIds }),
      };
    })
    .filter((row) => actor.role === "owner" || row.id === actor.id || row.branchIds.some((branchId) => covers(actor, branchId)));
}

/** Spec 6.5. Role, branch, and status changes act on the person's next request; disabling also ends their sessions. */
export async function updateStaff(actor: Staff, userId: string, patch: z.infer<typeof updateStaffSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), ne(users.status, "pending")))
      .for("update");
    if (!target) throw notFound("That person");
    const current = (await tx.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.id);
    const targetRole = target.role as Role;
    if (target.id === actor.id) {
      // Only the owner (settings.edit) edits themselves: their title and whether they see patients, nothing else.
      if (!can(actor, "settings.edit") || patch.role || patch.branchIds || patch.status) throw forbidden("Ask the owner to change your own access.");
    } else {
      requireCan(actor, "staff.manage", { userId, userRole: targetRole, branchIds: current });
    }
    if (patch.seesPatients !== undefined && targetRole !== "owner") {
      throw new ApiError(400, "invalid", "Only the owner's own access to patients can be switched.", {
        fields: { seesPatients: "Only the owner's own access to patients can be switched." },
      });
    }

    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.seesPatients !== undefined) set.seesPatients = patch.seesPatients;
    if (patch.status) set.status = patch.status;
    if (patch.role) {
      set.role = patch.role;
      set.seesPatients = patch.role === "dentist";
      if (patch.role === "manager") await tx.delete(dentistSchedules).where(eq(dentistSchedules.dentistId, userId));
    }
    if (patch.branchIds) {
      const wanted = [...new Set(patch.branchIds)];
      if (actor.role !== "owner" && wanted.some((branchId) => !current.includes(branchId) && !covers(actor, branchId))) {
        throw forbidden("You can only give branches you work at.");
      }
      // A manager changes only the branches they cover; the person keeps their other branches.
      const next = [
        ...new Set(
          actor.role === "owner"
            ? wanted
            : [...current.filter((branchId) => !covers(actor, branchId)), ...wanted.filter((branchId) => covers(actor, branchId))],
        ),
      ];
      if (next.length === 0) {
        throw new ApiError(400, "invalid", "Keep at least one branch.", { fields: { branchIds: "Keep at least one branch." } });
      }
      const known = await tx.select({ id: branches.id }).from(branches).where(inArray(branches.id, next));
      if (known.length !== next.length) {
        throw new ApiError(400, "invalid", "Pick branches that exist.", { fields: { branchIds: "Pick branches that exist." } });
      }
      await tx.delete(userBranches).where(eq(userBranches.userId, userId));
      await tx.insert(userBranches).values(next.map((branchId) => ({ userId, branchId })));
      await tx.delete(dentistSchedules).where(and(eq(dentistSchedules.dentistId, userId), notInArray(dentistSchedules.branchId, next)));
      if (!target.primaryBranchId || !next.includes(target.primaryBranchId)) set.primaryBranchId = next[0];
    }
    await tx.update(users).set(set).where(eq(users.id, userId));
    if (patch.status === "disabled") await endSessions(userId, tx);
    await audit({ userId: actor.id, action: "staff.updated", entity: "user", entityId: userId, details: patch }, tx);
  });
}

/** Spec 6.6: a one-use link, valid 15 minutes, shown as a QR. Only the token's hash is stored. */
export async function createResetLink(actor: Staff, userId: string): Promise<{ url: string; expiresAt: Date; qrSvg: string }> {
  const [target] = await db.select().from(users).where(and(eq(users.id, userId), ne(users.status, "pending")));
  if (!target) throw notFound("That person");
  const current = (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.id);
  requireCan(actor, "staff.manage", { userId, userRole: target.role as Role, branchIds: current });
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
  await db.transaction(async (tx) => {
    await tx.delete(verifications).where(and(like(verifications.identifier, `${RESET_PREFIX}%`), eq(verifications.value, userId)));
    await tx.insert(verifications).values({ identifier: `${RESET_PREFIX}${sha256(token)}`, value: userId, expiresAt });
    await audit({ userId: actor.id, action: "staff.reset_link_created", entity: "user", entityId: userId }, tx);
  });
  const url = `${appUrl()}/reset/${token}`;
  return { url, expiresAt, qrSvg: await qrSvg(url) };
}

export async function resetWithToken(token: string, input: z.infer<typeof resetSchema>): Promise<{ username: string }> {
  const passwordHash = await hashPassword(input.password);
  const expired = () =>
    new ApiError(404, "link_expired", "This reset link has expired or was already used. Ask your manager for a new one.");
  return db.transaction(async (tx) => {
    const [link] = await tx
      .delete(verifications)
      .where(and(eq(verifications.identifier, `${RESET_PREFIX}${sha256(token)}`), gt(verifications.expiresAt, new Date())))
      .returning();
    if (!link) throw expired();
    const [user] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.id, link.value), eq(users.status, "active")));
    if (!user) throw expired();
    await setPasswordHash(user.id, passwordHash, tx);
    await audit({ userId: user.id, action: "staff.password_reset", entity: "user", entityId: user.id }, tx);
    return { username: user.username };
  });
}
```

- [ ] **Step 7: Write the routes**

`src/app/api/v1/join/[code]/route.ts`:

```ts
import { clientIp, json, publicRoute, readJson } from "@/server/api";
import { joinSchema, requestToJoin } from "@/server/staff";

export const POST = publicRoute<{ code: string }>(async (req, { code }) =>
  json(await requestToJoin(code, await readJson(req, joinSchema), clientIp(req)), 201),
);
```

`src/app/api/v1/reset/[token]/route.ts`:

```ts
import { json, publicRoute, readJson } from "@/server/api";
import { resetSchema, resetWithToken } from "@/server/staff";

export const POST = publicRoute<{ token: string }>(async (req, { token }) =>
  json(await resetWithToken(token, await readJson(req, resetSchema))),
);
```

`src/app/api/v1/join-requests/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { listJoinRequests } from "@/server/staff";

export const GET = staffRoute(async (_req, staff) => json(await listJoinRequests(staff)));
```

`src/app/api/v1/join-requests/[id]/approve/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { approveRequest, approveSchema } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await approveRequest(staff, id, await readJson(req, approveSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/join-requests/[id]/decline/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { declineRequest } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await declineRequest(staff, id);
  return json({ ok: true });
});
```

`src/app/api/v1/staff/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { listStaff } from "@/server/staff";

export const GET = staffRoute(async (_req, staff) => json(await listStaff(staff)));
```

`src/app/api/v1/staff/[id]/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { updateStaff, updateStaffSchema } from "@/server/staff";

export const PATCH = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await updateStaff(staff, id, await readJson(req, updateStaffSchema));
  return json({ ok: true });
});
```

`src/app/api/v1/staff/[id]/reset-link/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { createResetLink } from "@/server/staff";

export const POST = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await createResetLink(staff, id)));
```

- [ ] **Step 8: Run the tests**

```powershell
npx vitest run tests/db/staff.test.ts tests/api/auth.test.ts
```

Expected: PASS, 19 and 10 tests.

- [ ] **Step 9: Commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat: add joining by branch QR, approvals, staff changes, and reset links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Weekly schedules and time off

**Files:**
- Create: `src/lib/schedule.ts`, `src/server/schedules.ts`
- Create routes: `src/app/api/v1/dentists/route.ts`, `src/app/api/v1/dentists/[id]/schedule/route.ts`, `src/app/api/v1/dentists/[id]/time-off/route.ts`, `src/app/api/v1/time-off/[id]/route.ts`
- Test: `tests/unit/schedule.test.ts`, `tests/db/schedules.test.ts`

**Interfaces:**
- Consumes: `hoursOn`, `WEEKDAYS` (Task 3), `ACTIVE_STATUSES` (Task 7), `can`, `covers`.
- Produces:
  - `@/lib/schedule`: `type Block = { branchId: string; dayOfWeek: number; startTime: string; endTime: string }`, `type BlockProblem = { index: number; message: string }`, `blockProblems(blocks, ctx: { allowedBranchIds: ReadonlySet<string>; hours: ReadonlyMap<string, OperatingHours> }): BlockProblem[]`.
  - `@/server/schedules`: `weekSchema`, `timeOffSchema`, `type DentistView = { id; name; title; branchIds }`, `type WeekBlock = Block & { id }`, `type TimeOffView = { id; startsAt; endsAt; reason }`, `type AffectedVisit = { id; startTime; branchName; patientName }`, `listDentists(actor)`, `dentistWeek(actor, dentistId)`, `replaceWeek(actor, dentistId, input): Promise<WeekBlock[]>`, `listTimeOff(actor, dentistId)`, `addTimeOff(actor, dentistId, input): Promise<{ id; affected: AffectedVisit[] }>`, `removeTimeOff(actor, id)`.
  - Routes: `GET /dentists`; `GET, PUT /dentists/{id}/schedule` (400 answers carry `blocks: BlockProblem[]` with the indexes the client sent); `GET, POST /dentists/{id}/time-off`; `DELETE /time-off/{id}`.

- [ ] **Step 1: Write the failing unit test, `tests/unit/schedule.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HOURS } from "@/lib/hours";
import { blockProblems } from "@/lib/schedule";

const A = "downtown";
const B = "westside";
const ctx = {
  allowedBranchIds: new Set([A, B]),
  hours: new Map([
    [A, DEFAULT_HOURS],
    [B, { ...DEFAULT_HOURS, "1": { open: "12:00", close: "20:00" } }],
  ]),
};

describe("schedule blocks", () => {
  it("accepts a split day at two branches", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
          { branchId: B, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it("names the first rule each block breaks", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 1, startTime: "12:00", endTime: "09:00" },
          { branchId: A, dayOfWeek: 1, startTime: "09:10", endTime: "10:00" },
          { branchId: "elsewhere", dayOfWeek: 1, startTime: "09:00", endTime: "10:00" },
          { branchId: A, dayOfWeek: 0, startTime: "09:00", endTime: "10:00" },
          { branchId: B, dayOfWeek: 1, startTime: "10:00", endTime: "13:00" },
        ],
        ctx,
      ),
    ).toEqual([
      { index: 0, message: "The block must end after it starts." },
      { index: 1, message: "Use 15-minute steps." },
      { index: 2, message: "This dentist does not work at that branch." },
      { index: 3, message: "The branch is closed on Sunday." },
      { index: 4, message: "The branch is open 12:00 to 20:00 on Monday." },
    ]);
  });

  it("flags both blocks of an overlap, even at different branches", () => {
    expect(
      blockProblems(
        [
          { branchId: A, dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
          { branchId: B, dayOfWeek: 2, startTime: "11:00", endTime: "14:00" },
        ],
        ctx,
      ),
    ).toEqual([
      { index: 0, message: "Overlaps another block on Tuesday." },
      { index: 1, message: "Overlaps another block on Tuesday." },
    ]);
  });
});
```

- [ ] **Step 2: Write `src/lib/schedule.ts` and run the unit test**

```ts
import type { OperatingHours } from "@/db/schema";
import { hoursOn, WEEKDAYS } from "./hours";
import { fromMinutes, toMinutes } from "./time";

export type Block = { branchId: string; dayOfWeek: number; startTime: string; endTime: string };
export type BlockProblem = { index: number; message: string };

/** Spec 7: blocks on the 15-minute grid, at a branch the dentist works at, inside its hours, never overlapping. */
export function blockProblems(
  blocks: readonly Block[],
  ctx: { allowedBranchIds: ReadonlySet<string>; hours: ReadonlyMap<string, OperatingHours> },
): BlockProblem[] {
  const problems = new Map<number, string>();
  const flag = (index: number, message: string) => {
    if (!problems.has(index)) problems.set(index, message);
  };
  blocks.forEach((block, index) => {
    const start = toMinutes(block.startTime);
    const end = toMinutes(block.endTime);
    const day = WEEKDAYS[block.dayOfWeek];
    if (start >= end) return flag(index, "The block must end after it starts.");
    if (start % 15 !== 0 || end % 15 !== 0) return flag(index, "Use 15-minute steps.");
    const hours = ctx.hours.get(block.branchId);
    if (!ctx.allowedBranchIds.has(block.branchId) || !hours) return flag(index, "This dentist does not work at that branch.");
    const open = hoursOn(hours, block.dayOfWeek);
    if (!open) return flag(index, `The branch is closed on ${day}.`);
    if (start < open.open || end > open.close) {
      return flag(index, `The branch is open ${fromMinutes(open.open)} to ${fromMinutes(open.close)} on ${day}.`);
    }
  });
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      const overlap =
        a.dayOfWeek === b.dayOfWeek &&
        toMinutes(a.startTime) < toMinutes(b.endTime) &&
        toMinutes(b.startTime) < toMinutes(a.endTime);
      if (overlap) {
        flag(i, `Overlaps another block on ${WEEKDAYS[a.dayOfWeek]}.`);
        flag(j, `Overlaps another block on ${WEEKDAYS[b.dayOfWeek]}.`);
      }
    }
  }
  return [...problems.entries()].sort(([a], [b]) => a - b).map(([index, message]) => ({ index, message }));
}
```

```powershell
npx vitest run tests/unit/schedule.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Write the failing database test, `tests/db/schedules.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import * as dentistsRoute from "@/app/api/v1/dentists/route";
import * as scheduleRoute from "@/app/api/v1/dentists/[id]/schedule/route";
import * as timeOffListRoute from "@/app/api/v1/dentists/[id]/time-off/route";
import * as timeOffRoute from "@/app/api/v1/time-off/[id]/route";
import { db } from "@/db";
import { appointments, chairs, patients } from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import type { Staff } from "@/server/session";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

let ownerSession: Promise<{ owner: Staff; cookie: string }> | undefined;
function ownerCookie() {
  ownerSession ??= (async () => {
    const owner = await makeUser({ role: "owner" });
    return { owner, cookie: await signIn(owner.username) };
  })();
  return ownerSession;
}

async function setting() {
  const a = await makeBranch({ name: "Downtown" });
  const b = await makeBranch({ name: "Westside", hours: { ...DEFAULT_HOURS, "1": { open: "12:00", close: "20:00" } } });
  const dentist = await makeUser({ role: "dentist", branchIds: [a.id, b.id] });
  const manager = await makeUser({ role: "manager", branchIds: [a.id] });
  return { a, b, dentist, manager };
}

const put = (cookie: string, id: string, blocks: unknown[]) =>
  call(scheduleRoute.PUT, request(`/api/v1/dentists/${id}/schedule`, { method: "PUT", cookie, body: { blocks } }), { id });
const get = (cookie: string, id: string) => call(scheduleRoute.GET, request(`/api/v1/dentists/${id}/schedule`, { cookie }), { id });

describe("weekly schedules", () => {
  it("lets the owner set a split week and reads it back in order", async () => {
    const { a, b, dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [
      { branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
      { branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
    ]);
    expect(res.status).toBe(200);
    const week = await (await get(cookie, dentist.id)).json();
    expect(week.map((block: { branchId: string; startTime: string }) => [block.branchId, block.startTime])).toEqual([
      [a.id, "09:00"],
      [b.id, "13:00"],
    ]);
  });

  it("names each block that breaks a rule, by the index sent", async () => {
    const { a, b, dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [
      { branchId: a.id, dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 1, startTime: "10:00", endTime: "13:00" },
      { branchId: a.id, dayOfWeek: 0, startTime: "10:00", endTime: "12:00" },
      { branchId: a.id, dayOfWeek: 2, startTime: "09:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 2, startTime: "11:00", endTime: "14:00" },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({
      "blocks.0": "The branch is open 09:00 to 18:00 on Monday.",
      "blocks.1": "The branch is open 12:00 to 20:00 on Monday.",
      "blocks.2": "The branch is closed on Sunday.",
      "blocks.3": "Overlaps another block on Tuesday.",
      "blocks.4": "Overlaps another block on Tuesday.",
    });
  });

  it("refuses a branch the dentist does not work at", async () => {
    const { dentist } = await setting();
    const other = await makeBranch();
    const { cookie } = await ownerCookie();
    const res = await put(cookie, dentist.id, [{ branchId: other.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" }]);
    expect((await res.json()).error.fields).toEqual({ "blocks.0": "This dentist does not work at that branch." });
  });

  it("lets a manager change only the blocks at their branches", async () => {
    const { a, b, dentist, manager } = await setting();
    const { cookie } = await ownerCookie();
    await put(cookie, dentist.id, [
      { branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "12:00" },
      { branchId: b.id, dayOfWeek: 1, startTime: "13:00", endTime: "17:00" },
    ]);
    const mine = await put(await signIn(manager.username), dentist.id, [{ branchId: a.id, dayOfWeek: 1, startTime: "09:00", endTime: "11:00" }]);
    expect(mine.status).toBe(200);
    const week = await (await get(cookie, dentist.id)).json();
    expect(week.map((block: { branchId: string; endTime: string }) => [block.branchId, block.endTime])).toEqual([
      [a.id, "11:00"],
      [b.id, "17:00"],
    ]);
  });

  it("shows a dentist their own week and nothing more", async () => {
    const { a, dentist } = await setting();
    const other = await makeUser({ role: "dentist", branchIds: [a.id] });
    const cookie = await signIn(dentist.username);
    expect((await get(cookie, dentist.id)).status).toBe(200);
    expect((await put(cookie, dentist.id, [])).status).toBe(403);
    expect((await get(cookie, other.id)).status).toBe(403);
  });
});

describe("dentist list", () => {
  it("lists the dentists each person may see", async () => {
    const { dentist, manager } = await setting();
    const elsewhere = await makeUser({ role: "dentist", branchIds: [(await makeBranch()).id] });
    const list = async (cookie: string) =>
      ((await (await call(dentistsRoute.GET, request("/api/v1/dentists", { cookie }))).json()) as { id: string }[]).map((d) => d.id);
    const forManager = await list(await signIn(manager.username));
    expect(forManager).toContain(dentist.id);
    expect(forManager).not.toContain(elsewhere.id);
    expect(await list(await signIn(dentist.username))).toEqual([dentist.id]);
    expect(await list((await ownerCookie()).cookie)).toEqual(expect.arrayContaining([dentist.id, elsewhere.id]));
  });
});

describe("time off", () => {
  it("adds time off, names the visits it covers, and removes it", async () => {
    const { a, dentist, manager } = await setting();
    await db.insert(chairs).values({ branchId: a.id, number: 1 });
    const [ana] = await db.insert(patients).values({ lastName: "Santos", firstName: "Ana" }).returning();
    const day = addDays(manilaDate(new Date()), 1);
    await db.insert(appointments).values({
      patientId: ana.id, dentistId: dentist.id, branchId: a.id, chairNumber: 1,
      startTime: manilaInstant(day, 10 * 60), endTime: manilaInstant(day, 11 * 60), chairFreeAt: manilaInstant(day, 11 * 60),
      status: "confirmed", source: "staff",
    });
    const cookie = await signIn(manager.username);
    const res = await call(
      timeOffListRoute.POST,
      request(`/api/v1/dentists/${dentist.id}/time-off`, {
        method: "POST",
        cookie,
        body: { startsAt: manilaInstant(day, 9 * 60).toISOString(), endsAt: manilaInstant(day, 12 * 60).toISOString(), reason: "Seminar" },
      }),
      { id: dentist.id },
    );
    expect(res.status).toBe(201);
    const { id, affected } = await res.json();
    expect(affected).toHaveLength(1);
    expect(affected[0].patientName).toBe("Santos, Ana");

    const listed = await (await call(timeOffListRoute.GET, request(`/api/v1/dentists/${dentist.id}/time-off`, { cookie }), { id: dentist.id })).json();
    expect(listed.map((t: { reason: string }) => t.reason)).toEqual(["Seminar"]);
    expect((await call(timeOffRoute.DELETE, request(`/api/v1/time-off/${id}`, { method: "DELETE", cookie }), { id })).status).toBe(200);
    const after = await (await call(timeOffListRoute.GET, request(`/api/v1/dentists/${dentist.id}/time-off`, { cookie }), { id: dentist.id })).json();
    expect(after).toEqual([]);
  });

  it("refuses an end before the start", async () => {
    const { dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await call(
      timeOffListRoute.POST,
      request(`/api/v1/dentists/${dentist.id}/time-off`, {
        method: "POST",
        cookie,
        body: { startsAt: "2026-10-05T12:00:00+08:00", endsAt: "2026-10-05T09:00:00+08:00", reason: "" },
      }),
      { id: dentist.id },
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({ endsAt: "The end must be after the start" });
  });

  it("refuses times without an offset, which would be read in the server's time zone", async () => {
    const { dentist } = await setting();
    const { cookie } = await ownerCookie();
    const res = await call(
      timeOffListRoute.POST,
      request(`/api/v1/dentists/${dentist.id}/time-off`, {
        method: "POST",
        cookie,
        body: { startsAt: "2026-10-05T09:00:00", endsAt: "2026-10-05T12:00:00", reason: "" },
      }),
      { id: dentist.id },
    );
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).error.fields).sort()).toEqual(["endsAt", "startsAt"]);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

```powershell
npx vitest run tests/db/schedules.test.ts
```

Expected: FAIL, the route modules cannot be found.

- [ ] **Step 5: Write `src/server/schedules.ts`**

```ts
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, dentistSchedules, dentistTimeOff, patients, userBranches, users } from "@/db/schema";
import { can, covers } from "@/lib/permissions";
import { blockProblems, type Block } from "@/lib/schedule";
import { audit } from "./audit";
import { ACTIVE_STATUSES } from "./branches";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");

export const weekSchema = z.object({
  blocks: z
    .array(z.object({ branchId: z.uuid(), dayOfWeek: z.number().int().min(0).max(6), startTime: clock, endTime: clock }))
    .max(60),
});

export const timeOffSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(100, "Use at most 100 characters"),
  })
  .refine((t) => Date.parse(t.startsAt) < Date.parse(t.endsAt), { message: "The end must be after the start", path: ["endsAt"] });

export type DentistView = { id: string; name: string; title: string | null; branchIds: string[] };
export type WeekBlock = Block & { id: string };
export type TimeOffView = { id: string; startsAt: Date; endsAt: Date; reason: string };
export type AffectedVisit = { id: string; startTime: Date; branchName: string; patientName: string };

async function openBranchIds(): Promise<string[]> {
  return (await db.select({ id: branches.id }).from(branches).where(eq(branches.active, true))).map((b) => b.id);
}

/** An active person who sees patients, with the branches they work at (a treating owner works at every open branch). */
async function dentist(id: string): Promise<DentistView> {
  const [row] = await db
    .select({ id: users.id, name: users.name, title: users.title, role: users.role, status: users.status, seesPatients: users.seesPatients })
    .from(users)
    .where(eq(users.id, id));
  if (!row || row.status !== "active" || !row.seesPatients) throw notFound("That dentist");
  const branchIds =
    row.role === "owner"
      ? await openBranchIds()
      : (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, id))).map((b) => b.id);
  return { id: row.id, name: row.name, title: row.title, branchIds };
}

/** Everyone who sees patients, as far as the caller may see their schedules. */
export async function listDentists(actor: Staff): Promise<DentistView[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, title: users.title, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
    .orderBy(asc(users.name));
  const links = await db.select().from(userBranches);
  const open = await openBranchIds();
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      branchIds: row.role === "owner" ? open : links.filter((link) => link.userId === row.id).map((link) => link.branchId),
    }))
    .filter((d) => can(actor, "schedule.view", { dentistId: d.id, branchIds: d.branchIds }));
}

const toBlock = (row: typeof dentistSchedules.$inferSelect): WeekBlock => ({
  id: row.id,
  branchId: row.branchId,
  dayOfWeek: row.dayOfWeek,
  startTime: row.startTime.slice(0, 5),
  endTime: row.endTime.slice(0, 5),
});

async function weekOf(dentistId: string, tx = db): Promise<WeekBlock[]> {
  const rows = await tx
    .select()
    .from(dentistSchedules)
    .where(eq(dentistSchedules.dentistId, dentistId))
    .orderBy(asc(dentistSchedules.dayOfWeek), asc(dentistSchedules.startTime));
  return rows.map(toBlock);
}

export async function dentistWeek(actor: Staff, dentistId: string): Promise<WeekBlock[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.view", { dentistId, branchIds: d.branchIds });
  return weekOf(dentistId);
}

/** Replaces a dentist's week. A manager changes only the blocks at branches they cover; the other blocks stay. */
export async function replaceWeek(actor: Staff, dentistId: string, input: z.infer<typeof weekSchema>): Promise<WeekBlock[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.edit", { dentistId, branchIds: d.branchIds });
  const all = await db.select({ id: branches.id, active: branches.active, hours: branches.operatingHours }).from(branches);
  const hours = new Map(all.map((b) => [b.id, b.hours]));
  const allowed = new Set(d.branchIds.filter((id) => all.some((b) => b.id === id && b.active)));
  const mine = (block: { branchId: string }) => covers(actor, block.branchId);

  return db.transaction(async (tx) => {
    const current = await tx.select().from(dentistSchedules).where(eq(dentistSchedules.dentistId, dentistId));
    const submitted = input.blocks.map((block, index) => ({ block, index })).filter(({ block }) => mine(block));
    const kept = current.filter((row) => !mine(row)).map(toBlock);
    const problems = blockProblems([...submitted.map((s) => s.block), ...kept], { allowedBranchIds: allowed, hours })
      .filter((problem) => problem.index < submitted.length)
      .map((problem) => ({ index: submitted[problem.index].index, message: problem.message }));
    if (problems.length > 0) {
      // Spec 12: each broken block is a field error keyed "blocks.<index sent>", like any array field.
      throw new ApiError(400, "invalid", "Check the highlighted blocks.", {
        fields: Object.fromEntries(problems.map((problem) => [`blocks.${problem.index}`, problem.message])),
      });
    }

    const replaced = current.filter(mine).map((row) => row.id);
    if (replaced.length > 0) await tx.delete(dentistSchedules).where(inArray(dentistSchedules.id, replaced));
    if (submitted.length > 0) await tx.insert(dentistSchedules).values(submitted.map(({ block }) => ({ dentistId, ...block })));
    await audit({ userId: actor.id, action: "schedule.replaced", entity: "user", entityId: dentistId, details: { blocks: submitted.length } }, tx);
    return weekOf(dentistId, tx);
  });
}

export async function listTimeOff(actor: Staff, dentistId: string): Promise<TimeOffView[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.view", { dentistId, branchIds: d.branchIds });
  return db
    .select({ id: dentistTimeOff.id, startsAt: dentistTimeOff.startsAt, endsAt: dentistTimeOff.endsAt, reason: dentistTimeOff.reason })
    .from(dentistTimeOff)
    .where(and(eq(dentistTimeOff.dentistId, dentistId), gt(dentistTimeOff.endsAt, sql`now() - interval '30 days'`)))
    .orderBy(asc(dentistTimeOff.startsAt));
}

/** Spec 7: adding time off over booked visits names them; nothing is cancelled automatically. */
export async function addTimeOff(
  actor: Staff,
  dentistId: string,
  input: z.infer<typeof timeOffSchema>,
): Promise<{ id: string; affected: AffectedVisit[] }> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.edit", { dentistId, branchIds: d.branchIds });
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dentistTimeOff)
      .values({ dentistId, startsAt, endsAt, reason: input.reason, createdBy: actor.id })
      .returning({ id: dentistTimeOff.id });
    await audit({ userId: actor.id, action: "time_off.added", entity: "user", entityId: dentistId, details: { startsAt: input.startsAt, endsAt: input.endsAt } }, tx);
    const visits = await tx
      .select({ id: appointments.id, startTime: appointments.startTime, branchName: branches.name, lastName: patients.lastName, firstName: patients.firstName })
      .from(appointments)
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.dentistId, dentistId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
          lt(appointments.startTime, endsAt),
          gt(appointments.endTime, startsAt),
        ),
      )
      .orderBy(asc(appointments.startTime));
    return {
      id: row.id,
      affected: visits.map((v) => ({ id: v.id, startTime: v.startTime, branchName: v.branchName, patientName: `${v.lastName}, ${v.firstName}` })),
    };
  });
}

export async function removeTimeOff(actor: Staff, id: string): Promise<void> {
  const [row] = await db.select().from(dentistTimeOff).where(eq(dentistTimeOff.id, id));
  if (!row) throw notFound("That time off");
  const d = await dentist(row.dentistId);
  requireCan(actor, "schedule.edit", { dentistId: row.dentistId, branchIds: d.branchIds });
  await db.transaction(async (tx) => {
    await tx.delete(dentistTimeOff).where(eq(dentistTimeOff.id, id));
    await audit({ userId: actor.id, action: "time_off.removed", entity: "user", entityId: row.dentistId }, tx);
  });
}
```

- [ ] **Step 6: Write the routes**

`src/app/api/v1/dentists/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { listDentists } from "@/server/schedules";

export const GET = staffRoute(async (_req, staff) => json(await listDentists(staff)));
```

`src/app/api/v1/dentists/[id]/schedule/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { dentistWeek, replaceWeek, weekSchema } from "@/server/schedules";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await dentistWeek(staff, id)));

export const PUT = staffRoute<{ id: string }>(async (req, staff, { id }) => json(await replaceWeek(staff, id, await readJson(req, weekSchema))));
```

`src/app/api/v1/dentists/[id]/time-off/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { addTimeOff, listTimeOff, timeOffSchema } from "@/server/schedules";

export const GET = staffRoute<{ id: string }>(async (_req, staff, { id }) => json(await listTimeOff(staff, id)));

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) =>
  json(await addTimeOff(staff, id, await readJson(req, timeOffSchema)), 201),
);
```

`src/app/api/v1/time-off/[id]/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { removeTimeOff } from "@/server/schedules";

export const DELETE = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await removeTimeOff(staff, id);
  return json({ ok: true });
});
```

- [ ] **Step 7: Run all tests**

```powershell
npm test
```

Expected: PASS, every file.

- [ ] **Step 8: Commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat: add weekly dentist schedules with split days, and time off" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: The app shell, branch switcher, and security headers

**Files:**
- Create: `src/lib/security.ts`, `src/lib/labels.ts`, `src/lib/nav.ts`, `src/lib/paths.ts`, `src/proxy.ts`, `src/instrumentation.ts`, `src/app/robots.ts`, `src/components/app-shell.tsx`, `src/components/user-menu.tsx`, `src/components/sign-out-button.tsx`, `src/components/confirm-dialog.tsx`, `src/app/[branch]/layout.tsx`, `src/app/[branch]/page.tsx`, `src/app/waiting/page.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`
- Modify: `next.config.ts`, `src/app/layout.tsx`, `src/components/auth-card.tsx` (children optional)
- Test: `tests/unit/shell.test.ts`

**Interfaces:**
- Produces:
  - `@/lib/security`: `contentSecurityPolicy(nonce, { dev, https }): string`, `SECURITY_HEADERS`, `HSTS`.
  - `@/lib/labels`: `roleLabel(role, title): string`.
  - `@/lib/nav`: `type NavItem = { href: string; label: string }`, `navItems(staff: { role; seesPatients }, branch: string): NavItem[]` (plan B adds items).
  - `@/lib/paths`: `withBranch(pathname, branch): string`.
  - Components: `AppShell`, `UserMenu`, `SignOutButton`, `ConfirmDialog({ open, title, description, confirmLabel, pending?, destructive?, onConfirm, onOpenChange, children? })`.

- [ ] **Step 1: Write the failing test, `tests/unit/shell.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { roleLabel } from "@/lib/labels";
import { navItems } from "@/lib/nav";
import { withBranch } from "@/lib/paths";
import { contentSecurityPolicy } from "@/lib/security";

describe("content security policy", () => {
  it("allows only scripts with this request's nonce", () => {
    const csp = contentSecurityPolicy("abc123", { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("adds eval only for the development server and skips the https upgrade on plain http", () => {
    const csp = contentSecurityPolicy("n", { dev: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("shell helpers", () => {
  it("labels roles", () => {
    expect(roleLabel("owner", null)).toBe("Owner");
    expect(roleLabel("owner", "Dentist")).toBe("Owner, Dentist");
    expect(roleLabel("manager", null)).toBe("Front desk");
    expect(roleLabel("dentist", "Orthodontist")).toBe("Orthodontist");
    expect(roleLabel("dentist", null)).toBe("Dentist");
  });

  it("builds the navigation for each role", () => {
    expect(navItems({ role: "owner", seesPatients: false }, "all").map((i) => i.label)).toEqual(["Staff", "Settings"]);
    expect(navItems({ role: "manager", seesPatients: false }, "downtown").map((i) => i.href)).toEqual(["/downtown/staff", "/downtown/settings"]);
    expect(navItems({ role: "dentist", seesPatients: true }, "downtown").map((i) => i.label)).toEqual(["Schedules"]);
  });

  it("keeps the page when switching branch", () => {
    expect(withBranch("/downtown/staff", "westside")).toBe("/westside/staff");
    expect(withBranch("/all/settings", "downtown")).toBe("/downtown/settings");
    expect(withBranch("/downtown", "all")).toBe("/all");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```powershell
npx vitest run tests/unit/shell.test.ts
```

Expected: FAIL, the modules cannot be found.

- [ ] **Step 3: Write the helpers**

`src/lib/security.ts`:

```ts
/**
 * Next's CSP guide, with a nonce per request: a script runs only with this request's nonce. Styles may be inline
 * because React writes style attributes. 'unsafe-eval' is only for next dev (React's debugging).
 */
export function contentSecurityPolicy(nonce: string, opts: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Sent on every response (next.config.ts). same-origin keeps join and reset tokens out of Referer headers. */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

export const HSTS = { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" };
```

`src/lib/labels.ts`:

```ts
import type { Role } from "./permissions";

/** How a role reads on screen: managers are the front desk, and dentists show their title. */
export function roleLabel(role: Role, title: string | null): string {
  if (role === "owner") return title ? `Owner, ${title}` : "Owner";
  if (role === "manager") return title ?? "Front desk";
  return title ?? "Dentist";
}
```

`src/lib/nav.ts`:

```ts
import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch (or "all"). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = [];
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
```

`src/lib/paths.ts`:

```ts
/** The same page at another branch: "/downtown/staff" becomes "/westside/staff". */
export function withBranch(pathname: string, branch: string): string {
  return `/${branch}${pathname.replace(/^\/[^/]+/, "")}`;
}
```

```powershell
npx vitest run tests/unit/shell.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 4: Add the security headers, robots rules, and start-up check**

`src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, HSTS } from "@/lib/security";

/** A fresh nonce for every page (Next's CSP guide), so only DentaSync's own scripts run. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const https = request.nextUrl.protocol === "https:";
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development", https });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  if (https) response.headers.set(HSTS.key, HSTS.value);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite loads its WebAssembly build from node_modules at run time, so it stays out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
```

`src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

/** DentaSync is private: nothing here is for search engines. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
```

`src/instrumentation.ts`:

```ts
/** Runs once when the server starts: refuse a broken environment, and migrate PGlite before the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("@/lib/env");
  assertEnv(process.env);
  const { ready } = await import("@/db");
  await ready();
}
```

In `src/app/layout.tsx`, make every page render per request so the nonce reaches it: add `import { connection } from "next/server";`, make the component `async`, and call `await connection();` as its first line:

```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

In `src/components/auth-card.tsx` change the props type to `children?: React.ReactNode`.

- [ ] **Step 5: Write the shell components**

`src/components/confirm-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
};

/** A yes-or-go-back question before a change that is hard to undo. */
export function ConfirmDialog({ open, title, description, confirmLabel, pending, destructive = true, onConfirm, onOpenChange, children }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending} onClick={onConfirm}>
            {pending ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/sign-out-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
```

`src/components/user-menu.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "ghost" })}>
          {name}
          <span className="sr-only">{`, ${role}. Open the account menu.`}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{role}</p>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setChanging(true)}>Change password</DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
    </>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("newPassword").length < 10) {
      setErrors({ newPassword: "Use at least 10 characters" });
      return;
    }
    if (value("newPassword") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    const { error } = await authClient.changePassword({
      currentPassword: value("currentPassword"),
      newPassword: value("newPassword"),
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setAlert(error.status === 400 || error.status === 401 ? "Your current password is not right." : "The password could not be changed. Try again.");
      return;
    }
    toast.success("Password changed. Your other devices are signed out.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other devices signed in to your account are signed out.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormAlert message={alert} />
          <TextField name="currentPassword" label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword} />
          <TextField name="newPassword" label="New password" type="password" autoComplete="new-password" error={errors.newPassword} hint="At least 10 characters." />
          <TextField name="confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`src/components/app-shell.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { UserMenu } from "@/components/user-menu";
import type { NavItem } from "@/lib/nav";
import { withBranch } from "@/lib/paths";
import { cn } from "@/lib/utils";

type Props = {
  practice: string;
  branch: string;
  branches: { code: string; name: string }[];
  nav: NavItem[];
  user: { name: string; role: string };
  children: React.ReactNode;
};

/** Header with the branch switcher, the navigation, and the account menu (spec section 10). */
export function AppShell({ practice, branch, branches, nav, user, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Link href="/" className="font-semibold">
            {practice}
          </Link>
          <label htmlFor="branch-switcher" className="sr-only">
            Branch
          </label>
          <NativeSelect
            id="branch-switcher"
            value={branch}
            onChange={(event) => router.push(withBranch(pathname, event.target.value))}
            className="w-44"
          >
            {branches.map((b) => (
              <NativeSelectOption key={b.code} value={b.code}>
                {b.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <nav aria-label="Main" className="order-last -mx-1 flex w-full gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
            {nav.map((item) => {
              const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium sm:h-9",
                    current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <UserMenu name={user.name} role={user.role} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Write the branch layout and index**

`src/app/[branch]/layout.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { roleLabel } from "@/lib/labels";
import { navItems } from "@/lib/nav";
import { can, covers } from "@/lib/permissions";
import { listBranches } from "@/server/branches";
import { homePath } from "@/server/home";
import { practiceName } from "@/server/practice";
import { requireStaff } from "@/server/session";

/** Every signed-in page lives under /{branch}/, a branch code or "all" (spec section 10). */
export default async function BranchLayout({ children, params }: { children: React.ReactNode; params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const branches = await listBranches();
  if (branch === "all") {
    if (!can(staff, "overview.view")) redirect(await homePath(staff));
  } else {
    const current = branches.find((b) => b.code === branch);
    if (!current || !covers(staff, current.id)) notFound();
  }
  const options = [
    ...(can(staff, "overview.view") ? [{ code: "all", name: "All branches" }] : []),
    ...branches.filter((b) => (b.active || b.code === branch) && covers(staff, b.id)).map((b) => ({ code: b.code, name: b.name })),
  ];
  return (
    <AppShell
      practice={await practiceName()}
      branch={branch}
      branches={options}
      nav={navItems(staff, branch)}
      user={{ name: staff.name, role: roleLabel(staff.role, staff.title) }}
    >
      {children}
    </AppShell>
  );
}
```

`src/app/[branch]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { navItems } from "@/lib/nav";
import { requireStaff } from "@/server/session";

/** A bare branch URL opens its first section. */
export default async function BranchIndex({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  redirect(navItems(staff, branch)[0].href);
}
```

- [ ] **Step 7: Write the waiting, not-found, and error pages**

`src/app/waiting/page.tsx`:

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { SignOutButton } from "@/components/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { listBranches } from "@/server/branches";
import { staffFromHeaders } from "@/server/session";

export const metadata: Metadata = { title: "Waiting for approval" };

export default async function WaitingPage() {
  const staff = await staffFromHeaders(await headers());
  if (!staff) redirect("/login");
  if (staff.status !== "pending") redirect("/");
  const branch = (await listBranches()).find((b) => b.id === staff.primaryBranchId);
  return (
    <AuthCard
      title="Waiting for approval"
      description={`Ask the owner or a manager at ${branch?.name ?? "your branch"} to approve you. Requests expire after 7 days.`}
    >
      <div className="flex flex-wrap gap-3">
        <Link href="/" className={buttonVariants()}>
          Check again
        </Link>
        <SignOutButton />
      </div>
    </AuthCard>
  );
}
```

`src/app/not-found.tsx`:

```tsx
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AuthCard title="Not found" description="This page does not exist, or you do not have access to it.">
      <Link href="/" className={buttonVariants({ className: "w-fit" })}>
        Go to DentaSync
      </Link>
    </AuthCard>
  );
}
```

`src/app/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto grid max-w-md gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        {error.digest ? `Reference: ${error.digest}. ` : ""}Try again. If it keeps happening, tell the owner.
      </p>
      <div>
        <Button onClick={() => retry()}>Try again</Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Check the headers**

```powershell
npm run lint; npm run typecheck; npm run build
```

Then run `npm run dev`, open http://localhost:3700/login in the browser, and check the response headers of the page:

Expected: `Content-Security-Policy` with a `'nonce-...'` value that changes on every reload, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow`; the sign-in page works with no CSP errors in the browser console.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: add the app shell with the branch switcher, and strict security headers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Joining, password reset, and the Staff screen

**Files:**
- Create: `src/lib/queries.ts`, `src/components/staff-fields.tsx`, `src/components/state-badge.tsx`, `src/app/join/[code]/page.tsx`, `src/app/join/[code]/join-form.tsx`, `src/app/reset/[token]/page.tsx`, `src/app/reset/[token]/reset-form.tsx`, `src/app/[branch]/staff/page.tsx`, `src/app/[branch]/staff/staff-screen.tsx`

**Interfaces:**
- Consumes: routes from Tasks 7 and 8; `ConfirmDialog`, `TextField`, `FormAlert`, `AuthCard`; `api`, `RequestError`, `errorMessage`, `fieldErrors`.
- Produces:
  - `@/lib/queries`: `type Branch`, `type Dentist`, `useBranches()`, `useDentists()` (TanStack Query keys `["branches"]`, `["dentists"]`).
  - `@/components/staff-fields`: `RoleChoice({ value, onChange })`, `BranchChoice({ branches, value, onChange, error? })`.

- [ ] **Step 1: Write the shared queries, `src/lib/queries.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { OperatingHours } from "@/db/schema";
import { api } from "./fetcher";

export type Branch = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  operatingHours: OperatingHours;
  active: boolean;
  sort: number;
  chairCount: number;
};

export type Dentist = { id: string; name: string; title: string | null; branchIds: string[] };

export const useBranches = () => useQuery({ queryKey: ["branches"], queryFn: () => api<Branch[]>("/branches") });

export const useDentists = () => useQuery({ queryKey: ["dentists"], queryFn: () => api<Dentist[]>("/dentists") });
```

- [ ] **Step 2: Write the role and branch choices, `src/components/staff-fields.tsx`**

```tsx
"use client";

type StaffRole = "manager" | "dentist";

const ROLES: readonly [StaffRole, string, string][] = [
  ["manager", "Front desk", "Books visits, checks patients in, and approves staff at their branches."],
  ["dentist", "Dentist or hygienist", "Sees their own visits and writes charts and notes."],
];

export function RoleChoice({ value, onChange }: { value: StaffRole; onChange: (role: StaffRole) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Role</legend>
      {ROLES.map(([role, label, hint]) => (
        <label key={role} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
          <input type="radio" name="role" value={role} checked={value === role} onChange={() => onChange(role)} className="mt-1 size-4 accent-primary" />
          <span className="grid gap-0.5">
            <span className="font-medium">{label}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function BranchChoice({
  branches,
  value,
  onChange,
  error,
}: {
  branches: { id: string; name: string }[];
  value: string[];
  onChange: (branchIds: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="grid gap-2" aria-describedby={error ? "branch-choice-error" : undefined}>
      <legend className="mb-1 text-sm font-medium">Branches</legend>
      {branches.map((branch) => (
        <label key={branch.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
          <input
            type="checkbox"
            checked={value.includes(branch.id)}
            onChange={(event) => onChange(event.target.checked ? [...value, branch.id] : value.filter((id) => id !== branch.id))}
            className="size-4 accent-primary"
          />
          {branch.name}
        </label>
      ))}
      {error && (
        <p id="branch-choice-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
```

`src/components/state-badge.tsx`, the on or off badge the Staff page and the Settings panels show (a word and an icon):

```tsx
import { CircleCheck, CircleMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * On or off (a person active or disabled, a branch open or closed, a procedure offered or retired) as a word and an
 * icon: spec 10 never shows a state by colour alone.
 */
export function StateBadge({ on, yes, no, warn = false }: { on: boolean; yes: string; no: string; warn?: boolean }) {
  const Icon = on ? CircleCheck : CircleMinus;
  return (
    <Badge variant={on ? "secondary" : warn ? "destructive" : "outline"}>
      <Icon data-icon="inline-start" aria-hidden />
      {on ? yes : no}
    </Badge>
  );
}
```

- [ ] **Step 3: Write the join page**

`src/app/join/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { practiceName } from "@/server/practice";
import { branchForJoinCode } from "@/server/staff";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const branch = await branchForJoinCode(code);
  if (!branch) return <AuthCard title="This QR code no longer works" description="Ask the owner for the current one." />;
  return (
    <AuthCard
      title="Ask for a staff account"
      description={`${await practiceName()}, ${branch.name}. The owner or a manager here approves your account.`}
    >
      <JoinForm code={code} />
    </AuthCard>
  );
}
```

`src/app/join/[code]/join-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { RoleChoice } from "@/components/staff-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [role, setRole] = useState<"manager" | "dentist">("manager");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("password") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      const { username } = await api<{ username: string }>(`/join/${code}`, {
        method: "POST",
        body: { name: value("name"), username: value("username"), password: value("password"), role },
      });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("Your request is sent, but signing in failed. Sign in to see whether it is approved.");
      router.replace("/waiting");
      router.refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      setAlert(Object.keys(fields).length > 0 ? null : errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormAlert message={alert} />
      <TextField name="name" label="Your full name" autoComplete="name" maxLength={80} error={errors.name} />
      <TextField name="username" label="Username" autoComplete="username" autoCapitalize="none" maxLength={30} error={errors.username} hint="3 to 30 letters, numbers, dots, or underscores. You sign in with it." />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <RoleChoice value={role} onChange={setRole} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Ask for an account"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Write the reset page**

`src/app/reset/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth-card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AuthCard title="Set a new password" description="This link works once. Setting a new password signs you out on every device.">
      <ResetForm token={token} />
    </AuthCard>
  );
}
```

`src/app/reset/[token]/reset-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("password") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      const { username } = await api<{ username: string }>(`/reset/${token}`, { method: "POST", body: { password: value("password") } });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("The password is changed, but signing in failed. Sign in with the new password.");
      router.replace("/");
      router.refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      setAlert(Object.keys(fields).length > 0 ? null : errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormAlert message={alert} />
      <TextField name="password" label="New password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Set the new password"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Write the Staff page**

`src/app/[branch]/staff/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/lib/permissions";
import { listBranches } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { StaffScreen } from "./staff-screen";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const staff = await requireStaff();
  if (!can(staff, "staff.view")) notFound();
  const branches = (await listBranches()).filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }));
  return <StaffScreen me={{ id: staff.id, role: staff.role, branchIds: [...staff.branchIds] }} branches={branches} />;
}
```

`src/app/[branch]/staff/staff-screen.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { StateBadge } from "@/components/state-badge";
import { BranchChoice, RoleChoice } from "@/components/staff-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { roleLabel } from "@/lib/labels";
import type { Role } from "@/lib/permissions";
import { formatDateTime, formatTime } from "@/lib/time";
import type { JoinRequestView, StaffView } from "@/server/staff";

type BranchOption = { id: string; name: string };
type Me = { id: string; role: Role; branchIds: string[] };
type JoinRequest = Omit<JoinRequestView, "createdAt"> & { createdAt: string };
type ResetLink = { url: string; expiresAt: string; qrSvg: string };

export function StaffScreen({ me, branches }: { me: Me; branches: BranchOption[] }) {
  const client = useQueryClient();
  const requests = useQuery({ queryKey: ["join-requests"], queryFn: () => api<JoinRequest[]>("/join-requests") });
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<StaffView[]>("/staff") });
  const [approving, setApproving] = useState<JoinRequest | null>(null);
  const [declining, setDeclining] = useState<JoinRequest | null>(null);
  const [editing, setEditing] = useState<StaffView | null>(null);
  const [resetting, setResetting] = useState<StaffView | null>(null);
  const [toggling, setToggling] = useState<StaffView | null>(null);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["join-requests"] }),
      client.invalidateQueries({ queryKey: ["staff"] }),
      client.invalidateQueries({ queryKey: ["dentists"] }),
    ]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "A closed branch";
  const grantable = me.role === "owner" ? branches : branches.filter((b) => me.branchIds.includes(b.id));

  const decline = useMutation({
    mutationFn: (r: JoinRequest) => api(`/join-requests/${r.id}/decline`, { method: "POST" }),
    onSuccess: async (_data, r) => {
      toast.success(`Declined ${r.name}.`);
      setDeclining(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (s: StaffView) => api(`/staff/${s.id}`, { method: "PATCH", body: { status: s.status === "active" ? "disabled" : "active" } }),
    onSuccess: async (_data, s) => {
      toast.success(s.status === "active" ? `${s.name} is disabled and signed out.` : `${s.name} can sign in again.`);
      setToggling(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-8">
      <section aria-labelledby="requests-title" className="grid gap-3">
        <h1 id="requests-title" className="text-xl font-semibold">
          Join requests
        </h1>
        {requests.isPending ? (
          <p className="text-muted-foreground">Loading requests...</p>
        ) : requests.isError ? (
          <FormAlert message={errorMessage(requests.error)} />
        ) : requests.data.length === 0 ? (
          <p className="text-muted-foreground">No one is waiting. New staff scan the QR poster at their branch to ask for an account.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {requests.data.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{r.name}</CardTitle>
                    <CardDescription>
                      {`@${r.username} asks to join ${r.branchName} as ${r.role === "manager" ? "front desk" : "a dentist or hygienist"}. Sent ${formatDateTime(new Date(r.createdAt))}.`}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="gap-2">
                    <Button onClick={() => setApproving(r)}>Approve</Button>
                    <Button variant="outline" onClick={() => setDeclining(r)}>
                      Decline
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="staff-title" className="grid gap-3">
        <h2 id="staff-title" className="text-xl font-semibold">
          Staff
        </h2>
        {staff.isPending ? (
          <p className="text-muted-foreground">Loading staff...</p>
        ) : staff.isError ? (
          <FormAlert message={errorMessage(staff.error)} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.id === me.id ? " (you)" : ""}
                    </TableCell>
                    <TableCell>{`@${s.username}`}</TableCell>
                    <TableCell>{roleLabel(s.role, s.title)}</TableCell>
                    <TableCell>{s.role === "owner" ? "All branches" : s.branchIds.map(branchName).join(", ") || "None"}</TableCell>
                    <TableCell>
                      <StateBadge on={s.status === "active"} yes="Active" no="Disabled" warn />
                    </TableCell>
                    <TableCell>
                      {s.canManage && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => setEditing(s)}>
                            Edit
                          </Button>
                          {s.id !== me.id && (
                            <Button variant="ghost" onClick={() => setResetting(s)}>
                              Reset password
                            </Button>
                          )}
                          {s.id !== me.id && (
                            <Button variant="ghost" onClick={() => setToggling(s)}>
                              {s.status === "active" ? "Disable" : "Enable"}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {approving && <ApproveDialog request={approving} branches={grantable} onClose={() => setApproving(null)} onDone={refresh} />}
      <ConfirmDialog
        open={declining !== null}
        title={`Decline ${declining?.name ?? ""}?`}
        description="Their account is deleted. They can scan the QR poster again to ask anew."
        confirmLabel="Decline"
        pending={decline.isPending}
        onConfirm={() => declining && decline.mutate(declining)}
        onOpenChange={(open) => !open && setDeclining(null)}
      />
      {editing && <EditDialog person={editing} me={me} branches={grantable} onClose={() => setEditing(null)} onDone={refresh} />}
      {resetting && <ResetDialog person={resetting} onClose={() => setResetting(null)} />}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === "active" ? `Disable ${toggling?.name ?? ""}?` : `Enable ${toggling?.name ?? ""}?`}
        description={
          toggling?.status === "active"
            ? "They are signed out at once and cannot sign in. Their name stays on everything they did."
            : "They can sign in again with their password."
        }
        confirmLabel={toggling?.status === "active" ? "Disable" : "Enable"}
        destructive={toggling?.status === "active"}
        pending={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
      />
    </div>
  );
}

function ApproveDialog({
  request,
  branches,
  onClose,
  onDone,
}: {
  request: JoinRequest;
  branches: BranchOption[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<"manager" | "dentist">(request.role === "dentist" ? "dentist" : "manager");
  const [branchIds, setBranchIds] = useState<string[]>(branches.some((b) => b.id === request.branchId) ? [request.branchId] : []);
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const approve = useMutation({
    mutationFn: () => api(`/join-requests/${request.id}/approve`, { method: "POST", body: { role, branchIds, title: role === "dentist" ? title.trim() || null : null } }),
    onSuccess: async () => {
      toast.success(`${request.name} can now use DentaSync.`);
      onClose();
      await onDone();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Approve ${request.name}`}</DialogTitle>
          <DialogDescription>Choose their role and the branches they work at.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            approve.mutate();
          }}
        >
          <RoleChoice value={role} onChange={setRole} />
          <BranchChoice branches={branches} value={branchIds} onChange={setBranchIds} error={errors.branchIds} />
          {role === "dentist" && (
            <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dentist, Orthodontist, Hygienist" maxLength={40} error={errors.title} />
          )}
          <DialogFooter>
            <Button type="submit" disabled={approve.isPending || branchIds.length === 0}>
              {approve.isPending ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  person,
  me,
  branches,
  onClose,
  onDone,
}: {
  person: StaffView;
  me: Me;
  branches: BranchOption[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const isOwner = person.role === "owner";
  const [role, setRole] = useState<"manager" | "dentist">(person.role === "dentist" ? "dentist" : "manager");
  const [branchIds, setBranchIds] = useState(person.branchIds.filter((id) => branches.some((b) => b.id === id)));
  const [title, setTitle] = useState(person.title ?? "");
  const [seesPatients, setSeesPatients] = useState(person.seesPatients);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api(`/staff/${person.id}`, {
        method: "PATCH",
        body: isOwner ? { title: title.trim() || null, seesPatients } : { role, branchIds, title: title.trim() || null },
      }),
    onSuccess: async () => {
      toast.success(`Saved ${person.name}.`);
      onClose();
      await onDone();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Edit ${person.name}`}</DialogTitle>
          <DialogDescription>Changes apply on their next click.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {isOwner ? (
            <label className="flex min-h-11 items-start gap-3 rounded-md border p-3">
              <input type="checkbox" checked={seesPatients} onChange={(event) => setSeesPatients(event.target.checked)} className="mt-1 size-4 accent-primary" />
              <span className="grid gap-0.5">
                <span className="font-medium">I see patients</span>
                <span className="text-sm text-muted-foreground">Gives you a schedule, your own visits, and writing on charts and notes.</span>
              </span>
            </label>
          ) : (
            <>
              <RoleChoice value={role} onChange={setRole} />
              <BranchChoice branches={branches} value={branchIds} onChange={setBranchIds} error={errors.branchIds} />
              {me.role !== "owner" && <p className="text-sm text-muted-foreground">Branches you do not work at stay as they are.</p>}
            </>
          )}
          <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dentist, Orthodontist, Hygienist" maxLength={40} error={errors.title} />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ person, onClose }: { person: StaffView; onClose: () => void }) {
  const create = useMutation({
    mutationFn: () => api<ResetLink>(`/staff/${person.id}/reset-link`, { method: "POST" }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Reset the password of ${person.name}`}</DialogTitle>
          <DialogDescription>
            They scan the code with their phone and choose a new password. It works once, for 15 minutes, and signs them out everywhere.
          </DialogDescription>
        </DialogHeader>
        {create.data ? (
          <div className="grid justify-items-center gap-3">
            <div className="w-56 rounded-md bg-white p-2" role="img" aria-label="Password reset QR code" dangerouslySetInnerHTML={{ __html: create.data.qrSvg }} />
            <p className="text-sm text-muted-foreground">{`Works until ${formatTime(new Date(create.data.expiresAt))}.`}</p>
            <p className="max-w-full text-sm break-all">{create.data.url}</p>
          </div>
        ) : (
          <DialogFooter>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Show the reset QR"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Check it in the browser**

With `npm run dev` running and the owner from Task 6 signed in, add a branch from the browser console (the Settings screen arrives in Task 12):

```js
await fetch("/api/v1/branches", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    code: "downtown", name: "Downtown", address: "", phone: "",
    operatingHours: { "0": null, "1": { open: "09:00", close: "18:00" }, "2": { open: "09:00", close: "18:00" }, "3": { open: "09:00", close: "18:00" }, "4": { open: "09:00", close: "18:00" }, "5": { open: "09:00", close: "18:00" }, "6": { open: "09:00", close: "18:00" } },
  }),
});
```

Then check:

Expected: `/all/staff` shows the shell (practice name, a branch switcher with All branches and Downtown, Staff and Settings links, the account menu), "Join requests" with the empty message, and the Staff table listing the owner "(you)" with an Edit button. Edit opens a dialog with "I see patients" and Title, and saving shows a toast. `/join/not-a-code` shows "This QR code no longer works". `/reset/anything` shows the new-password form, and submitting two matching passwords shows "This reset link has expired or was already used. Ask your manager for a new one." At 375px wide nothing scrolls sideways. (Joining with a real QR is walked in Task 12.)

- [ ] **Step 7: Commit**

```powershell
npm run lint; npm run typecheck
git add -A
git commit -m "feat: add the join and reset pages and the Staff screen" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Settings screens and the QR poster

**Files:**
- Create: `src/components/hours-editor.tsx`, `src/app/[branch]/settings/page.tsx`, `src/app/[branch]/settings/settings-screen.tsx`, `src/app/[branch]/settings/practice-panel.tsx`, `src/app/[branch]/settings/branches-panel.tsx`, `src/app/[branch]/settings/chairs-panel.tsx`, `src/app/[branch]/settings/procedures-panel.tsx`, `src/app/[branch]/settings/dentist-picker.tsx`, `src/app/[branch]/settings/schedule-panel.tsx`, `src/app/[branch]/settings/time-off-panel.tsx`, `src/app/poster/[code]/page.tsx`, `src/app/poster/[code]/print-button.tsx`

**Interfaces:**
- Consumes: every route from Tasks 7 to 9; `useBranches`, `useDentists`; `hoursSummary`, `WEEKDAYS`, `DEFAULT_HOURS`; `fromManilaLocal`, `formatDateTime`.
- Produces: `HoursEditor({ value, onChange, error? })`; `DentistPicker({ dentists, value, onChange })`.

- [ ] **Step 1: Write the hours editor, `src/components/hours-editor.tsx`**

```tsx
"use client";

import type { OperatingHours } from "@/db/schema";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/hours";

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** One row per weekday: open or closed, and the opening and closing times on the 15-minute grid. */
export function HoursEditor({ value, onChange, error }: { value: OperatingHours; onChange: (hours: OperatingHours) => void; error?: string }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Opening hours</legend>
      {MONDAY_FIRST.map((day) => {
        const today = value[String(day)];
        const set = (next: { open: string; close: string } | null) => onChange({ ...value, [String(day)]: next });
        return (
          <div key={day} className="flex flex-wrap items-end gap-x-3 gap-y-1 rounded-md border p-2">
            <label className="flex min-h-11 w-40 items-center gap-2 sm:min-h-9">
              <input type="checkbox" checked={today !== null} onChange={(event) => set(event.target.checked ? { open: "09:00", close: "18:00" } : null)} className="size-4 accent-primary" />
              <span className="font-medium">{WEEKDAYS[day]}</span>
            </label>
            {today ? (
              <>
                <label className="grid gap-1 text-sm">
                  Opens
                  <Input type="time" step={900} aria-label={`${WEEKDAYS[day]} opens`} value={today.open} onChange={(event) => set({ ...today, open: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  Closes
                  <Input type="time" step={900} aria-label={`${WEEKDAYS[day]} closes`} value={today.close} onChange={(event) => set({ ...today, close: event.target.value })} />
                </label>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Closed</span>
            )}
          </div>
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}
```

- [ ] **Step 2: Write the settings page and screen**

`src/app/[branch]/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { can } from "@/lib/permissions";
import { practiceName } from "@/server/practice";
import { requireStaff } from "@/server/session";
import { SettingsScreen } from "./settings-screen";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ branch: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const owner = can(staff, "settings.edit");
  return (
    <SettingsScreen
      owner={owner}
      canEditSchedules={staff.role !== "dentist"}
      me={{ id: staff.id, role: staff.role, branchIds: [...staff.branchIds] }}
      currentBranch={branch}
      practice={owner ? await practiceName() : ""}
    />
  );
}
```

`src/app/[branch]/settings/settings-screen.tsx`:

```tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Role } from "@/lib/permissions";
import { BranchesPanel } from "./branches-panel";
import { ChairsPanel } from "./chairs-panel";
import { PracticePanel } from "./practice-panel";
import { ProceduresPanel } from "./procedures-panel";
import { SchedulePanel } from "./schedule-panel";
import { TimeOffPanel } from "./time-off-panel";

export type Me = { id: string; role: Role; branchIds: string[] };

/** The owner sees every section; managers and dentists see schedules and time off (spec section 5). */
export function SettingsScreen({
  owner,
  canEditSchedules,
  me,
  currentBranch,
  practice,
}: {
  owner: boolean;
  canEditSchedules: boolean;
  me: Me;
  currentBranch: string;
  practice: string;
}) {
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">{owner ? "Settings" : "Schedules"}</h1>
      <Tabs defaultValue={owner ? "branches" : "schedules"}>
        <TabsList className="h-auto flex-wrap">
          {owner && <TabsTrigger value="practice">Practice</TabsTrigger>}
          {owner && <TabsTrigger value="branches">Branches</TabsTrigger>}
          {owner && <TabsTrigger value="chairs">Chairs</TabsTrigger>}
          {owner && <TabsTrigger value="procedures">Procedures</TabsTrigger>}
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
        </TabsList>
        {owner && (
          <TabsContent value="practice" className="pt-4">
            <PracticePanel initialName={practice} />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="branches" className="pt-4">
            <BranchesPanel />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="chairs" className="pt-4">
            <ChairsPanel initialBranch={currentBranch} />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="procedures" className="pt-4">
            <ProceduresPanel />
          </TabsContent>
        )}
        <TabsContent value="schedules" className="pt-4">
          <SchedulePanel me={me} canEdit={canEditSchedules} />
        </TabsContent>
        <TabsContent value="time-off" className="pt-4">
          <TimeOffPanel canEdit={canEditSchedules} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 3: Write the practice panel, `src/app/[branch]/settings/practice-panel.tsx`**

```tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function PracticePanel({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () => api("/practice", { method: "PATCH", body: { name } }),
    onSuccess: () => {
      toast.success("Practice name saved.");
      setError(undefined);
      router.refresh();
    },
    onError: (e) => setError(fieldErrors(e).name ?? errorMessage(e)),
  });
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <TextField label="Practice name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} error={error} />
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Write the branches panel, `src/app/[branch]/settings/branches-panel.tsx`**

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StateBadge } from "@/components/state-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { HoursEditor } from "@/components/hours-editor";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { DEFAULT_HOURS, hoursSummary } from "@/lib/hours";
import { useBranches, type Branch } from "@/lib/queries";

export function BranchesPanel() {
  const branches = useBranches();
  const client = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [replacing, setReplacing] = useState<Branch | null>(null);
  const saved = async () => {
    await client.invalidateQueries({ queryKey: ["branches"] });
    router.refresh();
  };
  const replace = useMutation({
    mutationFn: (b: Branch) => api(`/branches/${b.code}/join-code`, { method: "POST" }),
    onSuccess: (_data, b) => {
      toast.success(`${b.name} has a new QR code. Print the new poster; the old one no longer works.`);
      setReplacing(null);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (branches.isPending) return <p className="text-muted-foreground">Loading branches...</p>;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Each branch has its own hours, chairs, and staff QR poster.</p>
        <Button onClick={() => setEditing("new")}>Add branch</Button>
      </div>
      {branches.data.length === 0 ? (
        <p>No branches yet. Add the first one.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Chairs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.data.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-sm text-muted-foreground">{[b.code, b.address, b.phone].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="whitespace-normal">{hoursSummary(b.operatingHours)}</TableCell>
                  <TableCell>{b.chairCount}</TableCell>
                  <TableCell><StateBadge on={b.active} yes="Open" no="Closed" /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => setEditing(b)}>
                        Edit
                      </Button>
                      <Link href={`/poster/${b.code}`} target="_blank" className={buttonVariants({ variant: "ghost" })}>
                        QR poster
                      </Link>
                      <Button variant="ghost" onClick={() => setReplacing(b)}>
                        Replace QR
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <BranchDialog branch={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}
      <ConfirmDialog
        open={replacing !== null}
        title={`Replace the QR code of ${replacing?.name ?? ""}?`}
        description="The printed poster stops working at once. Requests already sent stay open."
        confirmLabel="Replace QR"
        pending={replace.isPending}
        onConfirm={() => replacing && replace.mutate(replacing)}
        onOpenChange={(open) => !open && setReplacing(null)}
      />
    </div>
  );
}

function BranchDialog({ branch, onClose, onSaved }: { branch: Branch | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({
    code: branch?.code ?? "",
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    operatingHours: branch?.operatingHours ?? DEFAULT_HOURS,
    active: branch?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      branch
        ? api(`/branches/${branch.code}`, { method: "PATCH", body: form })
        : api("/branches", { method: "POST", body: { code: form.code, name: form.name, address: form.address, phone: form.phone, operatingHours: form.operatingHours } }),
    onSuccess: async () => {
      toast.success(branch ? `Saved ${form.name}.` : `Added ${form.name}.`);
      onClose();
      await onSaved();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const hoursError = Object.entries(errors).find(([key]) => key.startsWith("operatingHours"))?.[1];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
          <DialogDescription>The code appears in addresses, such as /downtown/calendar.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={40} error={errors.name} />
          <TextField label="Code" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={24} autoCapitalize="none" error={errors.code} hint="2 to 24 lowercase letters, numbers, or hyphens." />
          <TextField label="Address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={200} error={errors.address} />
          <TextField label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={20} error={errors.phone} />
          <HoursEditor value={form.operatingHours} onChange={(operatingHours) => setForm({ ...form, operatingHours })} error={hoursError} />
          {branch && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Open (a closed branch takes no bookings)
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Write the chairs panel, `src/app/[branch]/settings/chairs-panel.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage } from "@/lib/fetcher";
import { useBranches } from "@/lib/queries";

type Chair = { branchId: string; number: number; label: string; active: boolean };

export function ChairsPanel({ initialBranch }: { initialBranch: string }) {
  const branches = useBranches();
  const [picked, setPicked] = useState<string | null>(initialBranch === "all" ? null : initialBranch);
  const code = picked ?? branches.data?.find((b) => b.active)?.code ?? null;
  const client = useQueryClient();
  const chairs = useQuery({ queryKey: ["chairs", code], queryFn: () => api<Chair[]>(`/branches/${code}/chairs`), enabled: code !== null });
  const [label, setLabel] = useState("");
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["chairs", code] }), client.invalidateQueries({ queryKey: ["branches"] })]);
  const add = useMutation({
    mutationFn: () => api<Chair>(`/branches/${code}/chairs`, { method: "POST", body: { label } }),
    onSuccess: async (chair) => {
      toast.success(`Added chair ${chair.number}.`);
      setLabel("");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (branches.isPending) return <p className="text-muted-foreground">Loading...</p>;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  if (code === null) return <p>Add a branch first.</p>;
  return (
    <div className="grid max-w-2xl gap-4">
      <label className="grid w-fit gap-1 text-sm font-medium">
        Branch
        <NativeSelect value={code} onChange={(event) => setPicked(event.target.value)} className="w-56">
          {branches.data.map((b) => (
            <NativeSelectOption key={b.id} value={b.code}>
              {b.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      {chairs.isPending ? (
        <p className="text-muted-foreground">Loading chairs...</p>
      ) : chairs.isError ? (
        <FormAlert message={errorMessage(chairs.error)} />
      ) : (
        <ul className="grid gap-2">
          {chairs.data.length === 0 && <li className="text-muted-foreground">No chairs yet.</li>}
          {chairs.data.map((chair) => (
            <ChairRow key={`${code}-${chair.number}`} code={code} chair={chair} onChanged={refresh} />
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <label className="grid gap-1 text-sm font-medium">
          New chair label
          <Input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} placeholder="General, Ortho, Surgery" className="w-64" />
        </label>
        <Button type="submit" disabled={add.isPending}>
          Add chair
        </Button>
      </form>
    </div>
  );
}

function ChairRow({ code, chair, onChanged }: { code: string; chair: Chair; onChanged: () => Promise<unknown> }) {
  const [label, setLabel] = useState(chair.label);
  const update = useMutation({
    mutationFn: (patch: { label?: string; active?: boolean }) => api(`/branches/${code}/chairs/${chair.number}`, { method: "PATCH", body: patch }),
    onSuccess: async () => {
      toast.success(`Saved chair ${chair.number}.`);
      await onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <span className="w-20 font-medium">{`Chair ${chair.number}`}</span>
      <label className="sr-only" htmlFor={`chair-${chair.number}`}>{`Label of chair ${chair.number}`}</label>
      <Input id={`chair-${chair.number}`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} className="w-48" />
      {label !== chair.label && (
        <Button variant="outline" onClick={() => update.mutate({ label })} disabled={update.isPending}>
          Save
        </Button>
      )}
      <label className="ml-auto flex min-h-11 items-center gap-2 sm:min-h-9">
        <input type="checkbox" checked={chair.active} onChange={(event) => update.mutate({ active: event.target.checked })} className="size-4 accent-primary" />
        In use
      </label>
    </li>
  );
}
```

- [ ] **Step 6: Write the procedures panel, `src/app/[branch]/settings/procedures-panel.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { StateBadge } from "@/components/state-badge";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

type Procedure = { id: string; name: string; durationMinutes: number; bufferMinutes: number; active: boolean };

export function ProceduresPanel() {
  const procedures = useQuery({ queryKey: ["procedures"], queryFn: () => api<Procedure[]>("/procedures") });
  const [editing, setEditing] = useState<Procedure | "new" | null>(null);
  if (procedures.isPending) return <p className="text-muted-foreground">Loading procedures...</p>;
  if (procedures.isError) return <FormAlert message={errorMessage(procedures.error)} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">A visit lasts as long as its procedures; the longest turnover then keeps the chair free for cleaning.</p>
        <Button onClick={() => setEditing("new")}>Add procedure</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead>Length</TableHead>
              <TableHead>Turnover</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {procedures.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No procedures yet.
                </TableCell>
              </TableRow>
            )}
            {procedures.data.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{`${p.durationMinutes} min`}</TableCell>
                <TableCell>{`${p.bufferMinutes} min`}</TableCell>
                <TableCell><StateBadge on={p.active} yes="Offered" no="Retired" /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <ProcedureDialog procedure={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProcedureDialog({ procedure, onClose }: { procedure: Procedure | null; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: procedure?.name ?? "",
    durationMinutes: String(procedure?.durationMinutes ?? 30),
    bufferMinutes: String(procedure?.bufferMinutes ?? 10),
    active: procedure?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const body = { name: form.name, durationMinutes: Number(form.durationMinutes), bufferMinutes: Number(form.bufferMinutes) };
  const save = useMutation({
    mutationFn: () =>
      procedure ? api(`/procedures/${procedure.id}`, { method: "PATCH", body: { ...body, active: form.active } }) : api("/procedures", { method: "POST", body }),
    onSuccess: async () => {
      toast.success(`Saved ${form.name}.`);
      onClose();
      await client.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{procedure ? `Edit ${procedure.name}` : "Add a procedure"}</DialogTitle>
          <DialogDescription>Lengths use 5-minute steps. Turnover is the chair cleaning time after the visit.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} error={errors.name} />
          <TextField label="Length in minutes" type="number" inputMode="numeric" min={5} max={480} step={5} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} error={errors.durationMinutes} />
          <TextField label="Turnover in minutes" type="number" inputMode="numeric" min={0} max={120} step={5} value={form.bufferMinutes} onChange={(event) => setForm({ ...form, bufferMinutes: event.target.value })} error={errors.bufferMinutes} />
          {procedure && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Offered (retired procedures cannot be booked)
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 7: Write the dentist picker and the schedule panel**

`src/app/[branch]/settings/dentist-picker.tsx`:

```tsx
"use client";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Dentist } from "@/lib/queries";

export function DentistPicker({ dentists, value, onChange }: { dentists: Dentist[]; value: string; onChange: (id: string) => void }) {
  if (dentists.length <= 1) return null;
  return (
    <label className="grid w-fit gap-1 text-sm font-medium">
      Dentist
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} className="w-64">
        {dentists.map((d) => (
          <NativeSelectOption key={d.id} value={d.id}>
            {d.title ? `${d.name}, ${d.title}` : d.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
```

`src/app/[branch]/settings/schedule-panel.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { WEEKDAYS } from "@/lib/hours";
import { useBranches, useDentists, type Branch, type Dentist } from "@/lib/queries";
import type { Block } from "@/lib/schedule";
import { DentistPicker } from "./dentist-picker";
import type { Me } from "./settings-screen";

type WeekBlock = Block & { id: string };
type Draft = Block & { key: string };
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

export function SchedulePanel({ me, canEdit }: { me: Me; canEdit: boolean }) {
  const dentists = useDentists();
  const branches = useBranches();
  const [picked, setPicked] = useState<string | null>(null);
  const dentist = dentists.data?.find((d) => d.id === picked) ?? dentists.data?.[0];
  const week = useQuery({ queryKey: ["schedule", dentist?.id], queryFn: () => api<WeekBlock[]>(`/dentists/${dentist?.id}/schedule`), enabled: dentist !== undefined });

  if (dentists.isPending || branches.isPending) return <p className="text-muted-foreground">Loading schedules...</p>;
  if (dentists.isError) return <FormAlert message={errorMessage(dentists.error)} />;
  if (branches.isError) return <FormAlert message={errorMessage(branches.error)} />;
  if (!dentist) return <p>No one sees patients yet. Approve a dentist in Staff, or switch on seeing patients for the owner.</p>;
  const editable = new Set(canEdit ? (me.role === "owner" ? branches.data.map((b) => b.id) : me.branchIds) : []);
  return (
    <div className="grid gap-4">
      <DentistPicker dentists={dentists.data} value={dentist.id} onChange={setPicked} />
      {week.isPending ? (
        <p className="text-muted-foreground">Loading the week...</p>
      ) : week.isError ? (
        <FormAlert message={errorMessage(week.error)} />
      ) : (
        <WeekEditor key={`${dentist.id}-${week.dataUpdatedAt}`} dentist={dentist} blocks={week.data} branches={branches.data} editable={editable} />
      )}
    </div>
  );
}

function WeekEditor({ dentist, blocks, branches, editable }: { dentist: Dentist; blocks: WeekBlock[]; branches: Branch[]; editable: Set<string> }) {
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<Draft[]>(() => blocks.map(({ id, ...block }) => ({ key: id, ...block })));
  const [problems, setProblems] = useState<Record<number, string>>({});
  const workplaces = branches.filter((b) => b.active && dentist.branchIds.includes(b.id) && editable.has(b.id));
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "A closed branch";
  const change = (next: Draft[]) => {
    setDrafts(next);
    setProblems({});
  };
  const save = useMutation({
    mutationFn: () =>
      api<WeekBlock[]>(`/dentists/${dentist.id}/schedule`, {
        method: "PUT",
        body: { blocks: drafts.map(({ branchId, dayOfWeek, startTime, endTime }) => ({ branchId, dayOfWeek, startTime, endTime })) },
      }),
    onSuccess: async () => {
      toast.success(`Saved the week of ${dentist.name}.`);
      await client.invalidateQueries({ queryKey: ["schedule", dentist.id] });
    },
    onError: (error) => {
      // Each broken block comes back as a field error keyed "blocks.<row>".
      const rows = Object.entries(fieldErrors(error)).filter(([key]) => key.startsWith("blocks."));
      if (rows.length > 0) {
        setProblems(Object.fromEntries(rows.map(([key, message]) => [Number(key.slice("blocks.".length)), message])));
        toast.error("Check the highlighted hours.");
      } else toast.error(errorMessage(error));
    },
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {MONDAY_FIRST.map((day) => {
        const rows = drafts.map((draft, index) => ({ draft, index })).filter(({ draft }) => draft.dayOfWeek === day);
        return (
          <fieldset key={day} className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 font-medium">{WEEKDAYS[day]}</legend>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">Not working.</p>}
            {rows.map(({ draft, index }) =>
              editable.has(draft.branchId) ? (
                <div key={draft.key} className="grid gap-1">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="grid gap-1 text-sm">
                      Branch
                      <NativeSelect value={draft.branchId} onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, branchId: event.target.value } : d)))} className="w-48">
                        {workplaces.map((b) => (
                          <NativeSelectOption key={b.id} value={b.id}>
                            {b.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <label className="grid gap-1 text-sm">
                      From
                      <Input type="time" step={900} value={draft.startTime} onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, startTime: event.target.value } : d)))} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      To
                      <Input type="time" step={900} value={draft.endTime} onChange={(event) => change(drafts.map((d, i) => (i === index ? { ...d, endTime: event.target.value } : d)))} />
                    </label>
                    <Button type="button" variant="ghost" onClick={() => change(drafts.filter((_, i) => i !== index))}>
                      Remove
                    </Button>
                  </div>
                  {problems[index] && <p className="text-sm text-destructive">{problems[index]}</p>}
                </div>
              ) : (
                <p key={draft.key} className="text-sm">
                  {`${branchName(draft.branchId)}, ${draft.startTime} to ${draft.endTime}`}
                </p>
              ),
            )}
            {workplaces.length > 0 && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => change([...drafts, { key: `new-${Date.now()}-${drafts.length}`, branchId: workplaces[0].id, dayOfWeek: day, startTime: "09:00", endTime: "12:00" }])}
                >
                  Add hours
                </Button>
              </div>
            )}
          </fieldset>
        );
      })}
      {editable.size > 0 && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save the week"}
          </Button>
        </div>
      )}
    </form>
  );
}
```

- [ ] **Step 8: Write the time-off panel, `src/app/[branch]/settings/time-off-panel.tsx`**

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";
import { formatDateTime, fromManilaLocal } from "@/lib/time";
import { DentistPicker } from "./dentist-picker";

type TimeOff = { id: string; startsAt: string; endsAt: string; reason: string };
type Affected = { id: string; startTime: string; branchName: string; patientName: string };

export function TimeOffPanel({ canEdit }: { canEdit: boolean }) {
  const dentists = useDentists();
  const client = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const dentist = dentists.data?.find((d) => d.id === picked) ?? dentists.data?.[0];
  const list = useQuery({ queryKey: ["time-off", dentist?.id], queryFn: () => api<TimeOff[]>(`/dentists/${dentist?.id}/time-off`), enabled: dentist !== undefined });
  const [form, setForm] = useState({ startsAt: "", endsAt: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [affected, setAffected] = useState<Affected[]>([]);
  const refresh = () => client.invalidateQueries({ queryKey: ["time-off", dentist?.id] });

  const add = useMutation({
    mutationFn: () => {
      if (!form.startsAt || !form.endsAt) throw new Error("Choose when the time off starts and ends.");
      return api<{ id: string; affected: Affected[] }>(`/dentists/${dentist?.id}/time-off`, {
        method: "POST",
        body: { startsAt: fromManilaLocal(form.startsAt).toISOString(), endsAt: fromManilaLocal(form.endsAt).toISOString(), reason: form.reason },
      });
    },
    onSuccess: async (result) => {
      setAffected(result.affected);
      setForm({ startsAt: "", endsAt: "", reason: "" });
      setErrors({});
      toast.success("Time off added.");
      await refresh();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/time-off/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Time off removed.");
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (dentists.isPending) return <p className="text-muted-foreground">Loading...</p>;
  if (dentists.isError) return <FormAlert message={errorMessage(dentists.error)} />;
  if (!dentist) return <p>No one sees patients yet.</p>;
  return (
    <div className="grid max-w-2xl gap-4">
      <DentistPicker dentists={dentists.data} value={dentist.id} onChange={(id) => { setPicked(id); setAffected([]); }} />
      {affected.length > 0 && (
        <Alert>
          <AlertTitle>These visits fall in the time off. Move them.</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {affected.map((v) => (
                <li key={v.id}>{`${formatDateTime(new Date(v.startTime))}, ${v.patientName}, ${v.branchName}`}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {list.isPending ? (
        <p className="text-muted-foreground">Loading time off...</p>
      ) : list.isError ? (
        <FormAlert message={errorMessage(list.error)} />
      ) : list.data.length === 0 ? (
        <p className="text-muted-foreground">No time off in the last 30 days or ahead.</p>
      ) : (
        <ul className="grid gap-2">
          {list.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <span>{`${formatDateTime(new Date(t.startsAt))} to ${formatDateTime(new Date(t.endsAt))}`}</span>
              {t.reason && <span className="text-muted-foreground">{t.reason}</span>}
              {canEdit && (
                <Button variant="ghost" className="ml-auto" onClick={() => remove.mutate(t.id)} disabled={remove.isPending}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="grid gap-3 rounded-lg border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <h2 className="font-medium">Add time off</h2>
          <div className="flex flex-wrap gap-3">
            <TextField label="Starts" type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} error={errors.startsAt} />
            <TextField label="Ends" type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} error={errors.endsAt} />
          </div>
          <TextField label="Reason" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} maxLength={100} placeholder="Leave, seminar" error={errors.reason} />
          <div>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? "Adding..." : "Add time off"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Write the printable QR poster**

`src/app/poster/[code]/print-button.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return <Button onClick={() => window.print()}>Print this poster</Button>;
}
```

`src/app/poster/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appUrl } from "@/lib/env";
import { can } from "@/lib/permissions";
import { branchByCode } from "@/server/branches";
import { practiceName } from "@/server/practice";
import { qrSvg } from "@/server/qr";
import { requireStaff } from "@/server/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Staff QR poster" };

/** Spec 6.2: an A4 poster with the branch's join QR. Printed on white whatever the screen's theme. */
export default async function PosterPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff();
  if (!can(staff, "settings.edit")) notFound();
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const joinUrl = `${appUrl()}/join/${branch.joinCode}`;
  const svg = await qrSvg(joinUrl);
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-2xl content-center gap-8 bg-white p-8 text-center text-black">
      <div className="grid gap-2">
        <p className="text-lg">{await practiceName()}</p>
        <h1 className="text-4xl font-semibold">{branch.name}</h1>
      </div>
      <div className="mx-auto w-72 sm:w-80" role="img" aria-label="Staff QR code" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="grid gap-2">
        <p className="text-2xl font-semibold">Staff only</p>
        <p className="text-lg">Scan to ask for a DentaSync account. The owner or a manager approves it.</p>
      </div>
      <p className="text-xs break-all">{joinUrl}</p>
      <p className="text-sm">If the owner replaces this QR code, this poster stops working.</p>
      <div className="print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
```

- [ ] **Step 10: Walk the whole plan A in the browser**

With `npm run dev` and the owner signed in:

1. `/all/settings` opens on Branches. Add "Downtown" (code `downtown`) and "Westside" with Monday to Saturday hours; the switcher now lists them.
2. Chairs: add two chairs to Downtown ("General", "Ortho"); the Branches table shows 2 chairs.
3. Procedures: add "Oral prophylaxis", 45 and 15 minutes; a length of 42 shows "Use 5-minute steps".
4. Open the Downtown QR poster: practice name, "Downtown", a QR, "Staff only". Print preview shows one page on white.
5. In a private window, open the poster's join link (the QR's URL), ask to join as a dentist; the waiting page names Downtown.
6. Back as the owner: Staff shows the request; approve as dentist at Downtown and Westside with title "Dentist".
7. Settings, Schedules: give the dentist Monday 09:00 to 12:00 at Downtown and 13:00 to 17:00 at Westside; save. Try 08:00 at Downtown: "The branch is open 09:00 to 18:00 on Monday."
8. Time off: add tomorrow 09:00 to 12:00 "Seminar"; it lists; remove it.
9. Staff: Reset password for the dentist shows a QR and the time it expires; opening the link sets a new password and lands on the dentist's Schedules page, read-only.
10. Resize to 375px wide: the settings tabs wrap, tables scroll inside their frame, and the page never scrolls sideways.

Expected: every step behaves as written, with no errors in the browser console or the server log.

- [ ] **Step 11: Run every check and commit**

```powershell
npm test; npm run lint; npm run typecheck; npm run build
git add -A
git commit -m "feat: add the settings screens, weekly schedule editor, time off, and the QR poster" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Plan A self-check

- Spec 5 (roles): Task 4's table; enforced in every service through `requireCan` (Tasks 7 to 9) and checked per role in the tests.
- Spec 6 (accounts by QR): 6.1 Task 6; 6.2 Tasks 7 and 12 (poster, replace); 6.3 and 6.4 Task 8 and 11; 6.5 Task 8 (changes, disabling, sign-in refusal) and 11; 6.6 Task 8 and 11 (reset QR), Task 6 (owner recovery); 6.7 Task 5 (12-hour sessions, rate limit).
- Spec 7 (data model and database rules): Task 2, all tables and rules at once, so plans B and C add no migration for part 1.
- Spec 8.1 time and the weekly schedules: Tasks 3 and 9. Booking rules (8.2 to 8.8): plan B.
- Spec 10 shell, branch URL, switcher, Staff, Settings, poster: Tasks 10 to 12. Calendar, patients, charts: plans B and C.
- Spec 12 errors: Task 5 (`toResponse`); Spec 13 headers, CSP, noindex, audit: Tasks 5 and 10.
