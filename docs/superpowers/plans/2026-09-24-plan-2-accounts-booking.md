# BrightSmile Plan 2: Accounts and Public Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clinic signs up, sets up its clinic in onboarding, and receives a verified online booking request from its public booking page in development, and the patient can view and cancel it from their link.

**Architecture:** Two server-only Supabase clients: a cookie-bound client with the publishable key for signed-in staff (RLS applies) and a secret-key client for the public flow (booking, codes, texts, patient link). `src/proxy.ts` refreshes the staff session and guards `/app` and `/onboarding`. Business logic lives in small modules under `src/lib`: pure ones (input parsing, onboarding rules, SMS preparation, push payloads, routing rules) are unit-tested, and I/O services (availability, SMS sender, clinic alerts, booking service, patient link) are integration-tested against the development Supabase project. Pages and Server Actions are thin wrappers that read cookies and headers and call those services. The public booking page never receives busy intervals or patient data: open dates and open start times come from Server Actions computed on the server with `src/lib/slots`.

**Tech Stack:** Next.js 16.3 (App Router, Turbopack, Server Actions, `proxy.ts`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12 (`getAll`/`setAll` cookie API), `@supabase/supabase-js` 2.116, Vitest 5, Semaphore SMS HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (sections 5.1, 5.2, 5.4, 6, 9, 10, 12, 13 drive this plan).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| Proxy (Next 16 renamed Middleware to Proxy) | `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` (note: Server Actions are POSTs to their page's route, so the matcher also decides which actions the proxy sees) |
| `cookies()` (async; set only in Server Actions and Route Handlers) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md` |
| `headers()` (async, read-only) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md` |
| Server Actions and forms, `useActionState` | `node_modules/next/dist/docs/01-app/02-guides/forms.md`, `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` (actions are public POST endpoints and run one at a time per client) |
| Route Handlers | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` |
| `redirect` (throws; call it outside `try`) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` |
| `refresh` (re-render after an action) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md` |
| `params` is a Promise, `generateMetadata` | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md` |
| `not-found.js`, `error.js` (the error boundary gets `retry`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md`, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` |
| `server-only` (built into Next, no install) | `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` (section "Preventing environment poisoning") |
| Supabase SSR cookie API (`setAll(cookies, headers)`) | `node_modules/@supabase/ssr/dist/main/types.d.ts` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/(auth)"` and `"src/app/[slug]/page.tsx"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer the session adds (CONTRIBUTING.md). The commit commands in this plan leave it out; add your own. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-2-accounts-booking`, one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone. Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and clock times as minutes after midnight (or `"HH:MM"` in forms and Postgres).
- Mobile numbers are stored as `+639XXXXXXXXX`. Semaphore gets `09XXXXXXXXX` (`localMobile`).
- Field limits: clinic name 80; clinic short name for texts 20 (must not start with "test" in any case); dentist name 60; dentist short name 16; first and last name 50 each; status reason 36; procedure name 60 with a duration of 5 to 480 minutes; HMO 60; address 200; booking link (slug) 3 to 24 characters of `[a-z0-9-]`, starting and ending with a letter or digit. At most 20 procedures per appointment (the database checks `procedure_names` cardinality).
- Reserved booking links: `a`, `app`, `api`, `auth`, `login`, `signup`, `onboarding`, `forgot`, `reset-password`, `privacy`, `terms`, `admin`, `static`, `_next`.
- Booking rule defaults: 30 minute slots (15, 30, or 60 allowed), 120 minutes minimum notice, 60 day booking window, clinic alerts by push.
- Verification codes (spec 10.3): 6 digits, valid 5 minutes, 5 wrong attempts per code, resend after 60 seconds, at most 3 codes per mobile and 10 per IP address in any rolling hour, verified-device cookie `bs_verified` (httpOnly, SameSite=Lax, Secure in production) for 180 days and up to 5 mobiles. All constants come from `OTP` in `src/lib/codes.ts`.
- Texts are printable ASCII without the GSM-7 extension characters, at most 160 characters with worst-case inputs (`renderSms` guarantees this). A text that fails to send never throws: `sendSms` records `status = 'failed'` and the error in `sms_log`.
- `SMS_MODE=log` writes texts to `sms_log` with status `logged` and prints them to the server console; the OTP body keeps the real code. `SMS_MODE=live` sends through Semaphore; the stored OTP body shows `******`. Tests and local development always use `log`.
- Never log codes (in live mode) or full patient details. Error logs carry the error message only.
- Environment variable names follow Supabase's current key names: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. No new environment variables in this plan.
- The secret key is used only through `src/lib/supabase/admin.ts`. Every module that imports it starts with `import "server-only"`. A `"use client"` file may only `import type` from such modules.
- Spec section 6: public pages never receive patient data or busy intervals. The booking page receives clinic profile, dentists (with hours), procedures, and rules; open dates and open starts come from Server Actions.
- Every Server Action treats its arguments as untrusted input and validates them on the server (spec 12), whatever the client did.
- No database migrations in this plan. The applied schema already has everything Plan 2 needs (`create_clinic`, `create_booking`, `set_appointment_status`, `otp_requests`, `sms_log`). Clinics are select and update only for staff; `anon` has no privileges; `otp_requests` is secret-key only.
- Database tests run only against the development project (`tests/db/helpers.ts` refuses anything else), and each test creates and removes its own clinics.
- Dev server port: 3600 (`.claude/launch.json` entry `brightsmile`).
- Dependencies: none added. `server-only` is resolved by Next.js itself (its docs say installing it is optional); Vitest aliases it to Next's empty module. Adding anything else needs a stated reason in the PR.

## Plan map

1. Foundation (done): scaffold, design foundation, pure domain logic, database.
2. **Accounts and public booking (this plan):** Supabase clients and proxy, sign up and log in (with forgot password and the `/auth/confirm` callback), onboarding, availability loader, SMS sender, clinic alerts, booking service, the public booking page, and the patient view/cancel link. Deliverable: a clinic signs up and receives a verified online request in development.
3. Clinic dashboard: shell and navigation, Requests, Schedule, New appointment and Move, Patients, Settings. Deliverable: a clinic runs its whole day from the dashboard.
4. Launch readiness: PWA and push, the daily job with Vercel Cron, landing and legal pages, the Playwright happy path, and an impeccable polish and audit pass. Deliverable: v1 ready to deploy.

## File map for this plan

| File | Responsibility |
|---|---|
| `vitest.config.mts` | Adds the `server-only` alias so server modules load in tests |
| `src/lib/supabase/admin.ts` | Secret-key client (bypasses RLS), server only |
| `src/lib/supabase/server.ts` | Cookie-bound publishable-key client for staff, and `signedInStaff()` |
| `src/lib/routes.ts` | Pure rules: where the proxy sends a visitor, safe `next` paths |
| `src/proxy.ts` | Refreshes the staff session, guards `/app` and `/onboarding` |
| `src/lib/validate.ts` | Adds `cleanEmail` and `passwordProblem` |
| `src/components/Field.tsx` | Labelled form field used by every form |
| `src/app/(auth)/actions.ts`, `src/app/(auth)/AuthForm.tsx` | Sign up, log in, forgot and reset password, sign out |
| `src/app/(auth)/signup/page.tsx`, `login/page.tsx`, `forgot/page.tsx`, `reset-password/page.tsx` | The four auth pages |
| `src/app/auth/confirm/route.ts` | Email link callback: creates the session and redirects |
| `src/lib/onboarding.ts` | Pure onboarding defaults and validation, builds the `create_clinic` payload |
| `src/app/onboarding/page.tsx`, `Onboarding.tsx`, `actions.ts` | Onboarding screens 2 to 4 and "Your link is ready" |
| `src/app/app/page.tsx` | Interim staff home: pending requests and sign out (Plan 3 replaces it) |
| `src/lib/sms/prepare.ts` | Pure: SMS mode, message and stored body (code masking), Semaphore reply parsing |
| `src/lib/sms/send.ts` | `sendSms`: log or send through Semaphore, write `sms_log`, never throw |
| `src/lib/push.ts` | Push payload without names, and the push sender stub (Plan 4 adds web-push) |
| `src/lib/notify.ts` | `alertClinic`: push first, text fallback |
| `src/lib/booking-input.ts` | Client-safe types and pure parsing for the public booking flow, HMO suggestions |
| `src/lib/slots.ts` | Adds `mergeWeeks` (clinic hours from all dentists) |
| `src/lib/availability.ts` | Loads the public clinic, computes open dates and starts on the server |
| `src/lib/request.ts` | Client IP from `x-forwarded-for` |
| `src/lib/booking.ts` | Booking service: validate, re-check, codes, rate limits, create, alert |
| `src/app/[slug]/page.tsx`, `actions.ts`, `BookingSheet.tsx`, `MonthSheet.tsx`, `not-found.tsx`, `error.tsx` | The public booking page on real data |
| `src/lib/sample-clinic.ts` | Deleted |
| `src/lib/patient-link.ts` | Loads the patient view and cancels by token |
| `src/app/a/[token]/page.tsx`, `CancelButton.tsx`, `actions.ts`, `not-found.tsx` | The patient view and cancel link |
| `tests/unit/*.test.ts` | Unit tests (no network) |
| `tests/db/*.test.ts` | Integration tests against the development Supabase project |

---

### Task 1: Supabase clients, routing rules, and the proxy

**Files:**
- Create: `src/lib/supabase/admin.ts`, `src/lib/supabase/server.ts`, `src/lib/routes.ts`, `src/proxy.ts`
- Modify: `vitest.config.mts`
- Test: `tests/unit/routes.test.ts`, `tests/db/clients.test.ts`

**Interfaces:**
- Consumes: env `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; table `clinic_members` (staff see only their own row; one row per user).
- Produces:
  - `adminClient(): SupabaseClient` from `@/lib/supabase/admin` (secret key, one instance per process, server only)
  - `serverClient(): Promise<ServerDb>` and `type ServerDb` from `@/lib/supabase/server` (cookie-bound, publishable key, RLS applies)
  - `signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null } | null>` from `@/lib/supabase/server`
  - `type Visitor = { signedIn: boolean; hasClinic: boolean }`, `guardRedirect(path: string, visitor: Visitor): string | null`, `safeNext(value: string | null, fallback: string): string` from `@/lib/routes`
  - `src/proxy.ts` with `export async function proxy(request: NextRequest)` and a matcher for `/app/:path*`, `/onboarding/:path*`, `/login`, `/signup`
  - Vitest resolves `import "server-only"` to Next's empty module

- [ ] **Step 1: Write the failing routing test**

Create `tests/unit/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guardRedirect, safeNext } from "@/lib/routes";

const out = { signedIn: false, hasClinic: false };
const noClinic = { signedIn: true, hasClinic: false };
const staff = { signedIn: true, hasClinic: true };

describe("guardRedirect", () => {
  it("sends signed-out visitors from the dashboard and onboarding to log in", () => {
    expect(guardRedirect("/app", out)).toBe("/login");
    expect(guardRedirect("/app/requests", out)).toBe("/login");
    expect(guardRedirect("/onboarding", out)).toBe("/login");
    expect(guardRedirect("/login", out)).toBeNull();
    expect(guardRedirect("/signup", out)).toBeNull();
  });

  it("does not mistake /apple-icon.png for the dashboard", () => {
    expect(guardRedirect("/apple-icon.png", out)).toBeNull();
  });

  it("sends signed-in users without a clinic to onboarding", () => {
    expect(guardRedirect("/app", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/login", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/signup", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/onboarding", noClinic)).toBeNull();
  });

  it("sends staff with a clinic to the dashboard", () => {
    expect(guardRedirect("/onboarding", staff)).toBe("/app");
    expect(guardRedirect("/login", staff)).toBe("/app");
    expect(guardRedirect("/app", staff)).toBeNull();
    expect(guardRedirect("/app/schedule", staff)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/onboarding", "/app")).toBe("/onboarding");
    expect(safeNext("/reset-password", "/app")).toBe("/reset-password");
  });

  it("falls back for anything that could leave the site", () => {
    expect(safeNext(null, "/app")).toBe("/app");
    expect(safeNext("", "/app")).toBe("/app");
    expect(safeNext("//evil.example", "/app")).toBe("/app");
    expect(safeNext("https://evil.example", "/app")).toBe("/app");
    expect(safeNext("/\\evil.example", "/app")).toBe("/app");
    expect(safeNext("/app?x=1", "/app")).toBe("/app");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/routes.test.ts`
Expected: FAIL, cannot resolve `@/lib/routes`.

- [ ] **Step 3: Write the routing rules**

Create `src/lib/routes.ts`:

```ts
export type Visitor = { signedIn: boolean; hasClinic: boolean };

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Where the proxy sends a visitor, or null to let the request through. */
export function guardRedirect(path: string, visitor: Visitor): string | null {
  const dashboard = under(path, "/app");
  const onboarding = under(path, "/onboarding");
  const authPage = path === "/login" || path === "/signup";
  if (!visitor.signedIn) return dashboard || onboarding ? "/login" : null;
  if (!visitor.hasClinic) return dashboard || authPage ? "/onboarding" : null;
  return onboarding || authPage ? "/app" : null;
}

/** A same-site path to continue to after an email link, or the fallback. Letters, digits, hyphens, and slashes only. */
export function safeNext(value: string | null, fallback: string): string {
  return value && /^\/(?!\/)[A-Za-z0-9\-/]*$/.test(value) ? value : fallback;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Teach Vitest about `server-only`**

Next.js resolves `import "server-only"` internally, but Vitest does not. Replace the `resolve` block in `vitest.config.mts` so the whole file reads:

```ts
process.env.TZ = "UTC";

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
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next.js handles "server-only" itself. Outside Next, point it at Next's own empty module.
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 6: Write the failing admin client test**

Create `tests/db/clients.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
// helpers refuses to run outside the development project.
import "./helpers";

describe("adminClient", () => {
  it("reads otp_requests, which only the secret key can reach", async () => {
    const { error } = await adminClient().from("otp_requests").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("is created once per process", () => {
    expect(adminClient()).toBe(adminClient());
  });
});
```

Run: `npx vitest run tests/db/clients.test.ts`
Expected: FAIL, cannot resolve `@/lib/supabase/admin`.

- [ ] **Step 7: Write the admin client**

Create `src/lib/supabase/admin.ts`:

```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes,
 * sms_log, and patient links. Staff pages use serverClient() so RLS applies.
 */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is not set");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
```

Run: `npx vitest run tests/db/clients.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Write the staff client**

Create `src/lib/supabase/server.ts`:

```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cookie-bound client with the publishable key: acts as the signed-in staff member, so RLS applies. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components can't set cookies. src/proxy.ts refreshes the session for staff pages.
        }
      },
    },
  });
}

export type ServerDb = Awaited<ReturnType<typeof serverClient>>;

/** The signed-in staff member and their clinic, or null when nobody is signed in. */
export async function signedInStaff(): Promise<{ db: ServerDb; userId: string; clinicId: string | null } | null> {
  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const { data: member } = await db.from("clinic_members").select("clinic_id").maybeSingle();
  return { db, userId, clinicId: (member?.clinic_id as string | undefined) ?? null };
}
```

- [ ] **Step 9: Write the proxy**

Create `src/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { guardRedirect } from "@/lib/routes";

/** Refreshes the staff session and keeps visitors on the right side of /app and /onboarding. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Verifies the session and refreshes it when it is about to expire (new cookies go through setAll).
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  let hasClinic = false;
  if (signedIn) {
    const { data: member } = await supabase.from("clinic_members").select("clinic_id").maybeSingle();
    hasClinic = Boolean(member);
  }

  const target = guardRedirect(request.nextUrl.pathname, { signedIn, hasClinic });
  if (!target) return response;
  const redirect = NextResponse.redirect(new URL(target, request.url));
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

// Public pages (the booking page and patient links) never touch the staff session, so they skip the proxy.
export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/login", "/signup"],
};
```

- [ ] **Step 10: Lint, build, and check the redirect**

Run:
```powershell
npm run lint; npm test; npm run build
```
Expected: lint has no errors, all unit tests pass, and the build succeeds.

Start the dev server (preview_start with the `brightsmile` entry, or `npm run dev` in a second terminal), then run:
```powershell
curl.exe -s -o NUL -w "%{http_code} %{redirect_url}" http://localhost:3600/app
```
Expected: `307 http://localhost:3600/login`.

- [ ] **Step 11: Commit**

```powershell
git add src/lib/supabase src/lib/routes.ts src/proxy.ts vitest.config.mts tests/unit/routes.test.ts tests/db/clients.test.ts; git commit -m "feat: add Supabase clients and the session proxy"
```

---

### Task 2: Sign up, log in, forgot password, and the email link callback

**Files:**
- Create: `src/components/Field.tsx`, `src/app/(auth)/actions.ts`, `src/app/(auth)/AuthForm.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/forgot/page.tsx`, `src/app/(auth)/reset-password/page.tsx`, `src/app/auth/confirm/route.ts`
- Modify: `src/lib/validate.ts`
- Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: `serverClient()` from `@/lib/supabase/server`; `safeNext(value, fallback)` from `@/lib/routes`; env `APP_URL`.
- Produces:
  - `cleanEmail(value: unknown): string | null` and `passwordProblem(password: string): string | null` from `@/lib/validate`
  - `Field` default export from `@/components/Field`: props `{ label: string; children: ReactNode; error?: string; optional?: boolean; hint?: string }`
  - From `@/app/(auth)/actions`: `type AuthState = { error?: string; sent?: string; email?: string }`, `signUp`, `logIn`, `sendReset`, `setNewPassword` (all `(state: AuthState, form: FormData) => Promise<AuthState>`), and `signOut(): Promise<void>` (redirects to `/login`)
  - Routes `/signup`, `/login`, `/forgot`, `/reset-password`, and `GET /auth/confirm?token_hash=...&type=...&next=...` (or `?code=...&next=...`)

Supabase sends two kinds of email link. With the default templates the link returns with `?code=` (PKCE, works in the browser that signed up). With the token-hash templates in Step 1 it returns with `?token_hash=&type=` (works on any device). `/auth/confirm` accepts both, so the flow works whichever templates the project uses and whether email confirmation is on or off.

- [ ] **Step 1: Kai configures Supabase Auth in the development project**

Claude can't change Supabase dashboard settings. Ask Kai to do this, and wait until Kai confirms:

1. Supabase dashboard, development project, **Authentication > URL Configuration**: set **Site URL** to `http://localhost:3600` and add `http://localhost:3600/**` under **Redirect URLs**.
2. **Authentication > Emails > Templates** (recommended, so links work on any device):
   - **Confirm signup**: set the link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - **Reset password**: set the link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
3. Tell Claude whether **Authentication > Sign In / Providers > Email > Confirm email** is on or off. Both work; it only changes whether signup shows "check your email".

- [ ] **Step 2: Write the failing validation tests**

In `tests/unit/validate.test.ts`, replace the import line

```ts
import { cleanBirthday, cleanText, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";
```

with

```ts
import { cleanBirthday, cleanEmail, cleanText, passwordProblem, slugFromName, slugProblem, smsNameProblem } from "@/lib/validate";
```

and append at the end of the file:

```ts
describe("cleanEmail", () => {
  it("trims and lowercases a real address", () => {
    expect(cleanEmail("  Ana.Reyes@Example.COM ")).toBe("ana.reyes@example.com");
  });

  it.each(["", "ana", "ana@", "@example.com", "ana @example.com", "ana@example"])("rejects %j", (value) => {
    expect(cleanEmail(value)).toBeNull();
  });

  it("rejects non-strings and overlong addresses", () => {
    expect(cleanEmail(42)).toBeNull();
    expect(cleanEmail(null)).toBeNull();
    expect(cleanEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("wants 8 to 72 characters", () => {
    expect(passwordProblem("short")).toBe("Use at least 8 characters.");
    expect(passwordProblem("a".repeat(73))).toBe("Use at most 72 characters.");
    expect(passwordProblem("a".repeat(8))).toBeNull();
    expect(passwordProblem("a".repeat(72))).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/validate.test.ts`
Expected: FAIL, `cleanEmail` is not exported.

- [ ] **Step 3: Add the rules**

Append to `src/lib/validate.ts`:

```ts
/** A trimmed, lowercased email address, or null. */
export function cleanEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Why a password can't be used, or null. 72 is bcrypt's limit, which Supabase Auth uses. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Use at most 72 characters.";
  return null;
}
```

Run: `npx vitest run tests/unit/validate.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the shared form field**

Create `src/components/Field.tsx`:

```tsx
import type { ReactNode } from "react";

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
      </span>
      {children}
      {hint && !error && <span className="f-hint block">{hint}</span>}
      {error && <span className="field-err block">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 5: Write the auth actions**

Create `src/app/(auth)/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import { cleanEmail, passwordProblem } from "@/lib/validate";

export type AuthState = { error?: string; sent?: string; email?: string };

const GENERIC = "Something went wrong. Please try again.";
const TOO_MANY_EMAILS = "Too many emails were sent. Wait a few minutes and try again.";
const appUrl = () => process.env.APP_URL ?? "http://localhost:3600";

export async function signUp(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email) return { error: "Enter a valid email address." };
  const weak = passwordProblem(password);
  if (weak) return { error: weak, email };

  const db = await serverClient();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${appUrl()}/auth/confirm?next=/onboarding` },
  });
  if (error) {
    if (error.code === "user_already_exists") return { error: "That email already has an account. Log in instead.", email };
    if (error.code === "weak_password") return { error: "Choose a stronger password.", email };
    if (error.code === "over_email_send_rate_limit") return { error: TOO_MANY_EMAILS, email };
    return { error: GENERIC, email };
  }
  // With email confirmation on, no session comes back until the link is opened.
  if (!data.session) return { sent: `We sent a confirmation link to ${email}. Open it to set up your clinic.` };
  redirect("/onboarding");
}

export async function logIn(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email: email ?? "" };

  const db = await serverClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first. Open the link we sent when you signed up.", email };
    if (error.code === "invalid_credentials") return { error: "That email and password don't match.", email };
    return { error: GENERIC, email };
  }
  // The proxy sends accounts without a clinic on to onboarding.
  redirect("/app");
}

export async function sendReset(_state: AuthState, form: FormData): Promise<AuthState> {
  const email = cleanEmail(form.get("email"));
  if (!email) return { error: "Enter a valid email address." };

  const db = await serverClient();
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl()}/auth/confirm?next=/reset-password`,
  });
  if (error?.code === "over_email_send_rate_limit") return { error: TOO_MANY_EMAILS, email };
  // The same answer whether or not the account exists, so this form can't be used to find accounts.
  return { sent: `If ${email} has an account, we sent it a link to set a new password.` };
}

export async function setNewPassword(_state: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  const weak = passwordProblem(password);
  if (weak) return { error: weak };

  const db = await serverClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return { error: "This reset link has expired. Ask for a new one from the log in page." };
  const { error } = await db.auth.updateUser({ password });
  if (error) return { error: error.code === "same_password" ? "Choose a password you have not used here before." : GENERIC };
  redirect("/app");
}

export async function signOut(): Promise<void> {
  const db = await serverClient();
  await db.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 6: Write the auth form**

Create `src/app/(auth)/AuthForm.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useActionState } from "react";
import Field from "@/components/Field";
import type { AuthState } from "./actions";

type Mode = "signup" | "login" | "forgot" | "reset";
type Props = {
  mode: Mode;
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  notice?: string;
};

const COPY: Record<Mode, { title: string; sub: string; button: string }> = {
  signup: {
    title: "Create your clinic account",
    sub: "Step 1 of 4. Next you set up your clinic, your dentist, and your procedures.",
    button: "Create account",
  },
  login: { title: "Log in", sub: "Welcome back to BrightSmile.", button: "Log in" },
  forgot: { title: "Reset your password", sub: "We will email you a link to set a new one.", button: "Send reset link" },
  reset: { title: "Set a new password", sub: "Use at least 8 characters.", button: "Save password" },
};

export default function AuthForm({ mode, action, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const copy = COPY[mode];

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{copy.title}</h1>
        <p className="sub">{copy.sub}</p>
        {notice && <p className="note-box warn mb-4">{notice}</p>}

        {state.sent ? (
          <p className="note-box" role="status">
            {state.sent}
          </p>
        ) : (
          <form action={formAction}>
            {mode !== "reset" && (
              <Field label="Email">
                <input
                  className="f-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={state.email}
                />
              </Field>
            )}
            {mode !== "forgot" && (
              <Field label="Password" hint={mode === "login" ? undefined : "At least 8 characters."}>
                <input
                  className="f-input"
                  name="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "login" ? undefined : 8}
                  maxLength={72}
                  required
                />
              </Field>
            )}
            {state.error && (
              <p className="field-err mt-3" role="alert">
                {state.error}
              </p>
            )}
            <button type="submit" className="btn btn-primary wide-btn mt-6" disabled={pending}>
              {pending ? "One moment..." : copy.button}
            </button>
          </form>
        )}

        <p className="f-hint mt-4">
          {mode === "signup" && (
            <>
              Already have an account?{" "}
              <Link href="/login" className="link">
                Log in
              </Link>
            </>
          )}
          {mode === "login" && (
            <>
              <Link href="/forgot" className="link">
                Forgot password?
              </Link>{" "}
              New here?{" "}
              <Link href="/signup" className="link">
                Create an account
              </Link>
            </>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <Link href="/login" className="link">
              Back to log in
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the four pages**

Create `src/app/(auth)/signup/page.tsx`:

```tsx
import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return <AuthForm mode="signup" action={signUp} />;
}
```

Create `src/app/(auth)/login/page.tsx`:

```tsx
import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";

export const metadata: Metadata = { title: "Log in" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const notice = error === "link" ? "That link has expired or was already used. Log in, or ask for a new link." : undefined;
  return <AuthForm mode="login" action={logIn} notice={notice} />;
}
```

Create `src/app/(auth)/forgot/page.tsx`:

```tsx
import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { sendReset } from "../actions";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return <AuthForm mode="forgot" action={sendReset} />;
}
```

Create `src/app/(auth)/reset-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { setNewPassword } from "../actions";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return <AuthForm mode="reset" action={setNewPassword} />;
}
```

- [ ] **Step 8: Add the email link callback**

Pages can't set cookies, so the session from an email link is created in this Route Handler (spec section 6).

Create `src/app/auth/confirm/route.ts`:

```ts
import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/routes";
import { serverClient } from "@/lib/supabase/server";

/** Signup confirmation and password reset links land here, then continue to `next`. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"), "/app");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");

  const db = await serverClient();
  let ok = false;
  if (tokenHash && type) {
    ok = !(await db.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await db.auth.exchangeCodeForSession(code)).error;
  }
  redirect(ok ? next : "/login?error=link");
}
```

- [ ] **Step 9: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run build
```
Expected: no lint errors, all unit tests pass, the build lists `/signup`, `/login`, `/forgot`, `/reset-password`, and `/auth/confirm`.

- [ ] **Step 10: Try it in the browser**

With the dev server running, open http://localhost:3600/signup at phone width (375 by 812) and sign up with an address Kai can receive (ask Kai for one; Supabase's built-in mailer flags bounces from made-up addresses).

Expected, depending on Step 1's answer:
- Confirmation on: the card shows "We sent a confirmation link to ...". Opening the email's link lands on `/onboarding` (a 404 page until Task 3).
- Confirmation off: the browser goes straight to `/onboarding` (a 404 page until Task 3).

Then, in a fresh browser tab with no session (a signed-in visitor is sent from `/login` to `/onboarding`; clear the site's cookies or use a private window), open http://localhost:3600/login, enter the same email with a wrong password, and expect "That email and password don't match." Open http://localhost:3600/auth/confirm?code=bogus and expect a redirect to `/login?error=link` with the expired-link notice.

- [ ] **Step 11: Commit**

```powershell
git add src/components/Field.tsx "src/app/(auth)" src/app/auth src/lib/validate.ts tests/unit/validate.test.ts; git commit -m "feat: add sign up, log in, password reset, and the email link callback"
```

---

### Task 3: Onboarding and the interim staff home

**Files:**
- Create: `src/lib/onboarding.ts`, `src/app/onboarding/page.tsx`, `src/app/onboarding/Onboarding.tsx`, `src/app/onboarding/actions.ts`, `src/app/app/page.tsx`
- Test: `tests/unit/onboarding.test.ts`, `tests/db/onboarding.test.ts`

**Interfaces:**
- Consumes: `serverClient()`, `signedInStaff()` from `@/lib/supabase/server`; `signOut()` from `@/app/(auth)/actions`; `Field` from `@/components/Field`; `normalizeMobile` from `@/lib/phone`; `cleanText`, `LIMITS`, `slugFromName`, `slugProblem`, `smsNameProblem` from `@/lib/validate`; SQL `public.create_clinic(p jsonb)` (security definer, one clinic per account, `23505` with constraint `clinics_slug_key` when the link is taken); `formatDate`, `formatTime` from `@/lib/time`.
- Produces (from `@/lib/onboarding`, pure, client-safe):
  - `type Clock = { start: string; end: string }` ("HH:MM")
  - `type ProcedureDraft = { name: string; minutes: number }`
  - `type OnboardingInput = { name: string; smsName: string; slug: string; mobile: string; address: string; dentistName: string; dentistSmsName: string; hours: Clock[][]; procedures: ProcedureDraft[] }` (`hours[0]` is Sunday)
  - `type OnboardingField = keyof OnboardingInput`, `type Problems = Partial<Record<OnboardingField, string>>`
  - `type CreateClinicPayload` (the `create_clinic` jsonb shape)
  - `DEFAULT_HOURS: Clock[][]`, `DEFAULT_PROCEDURES: ProcedureDraft[]`
  - `dentistShortName(name: string): string`
  - `clinicProblems(i: OnboardingInput): Problems`, `dentistProblems(i: OnboardingInput): Problems`, `procedureProblems(i: OnboardingInput): Problems`
  - `parseOnboarding(input: unknown): { ok: true; payload: CreateClinicPayload } | { ok: false; field: OnboardingField; error: string }`
- Produces (routes): `/onboarding` (screens 2 to 4 of spec 5.4, then "Your link is ready"); Server Action `createClinic(input: unknown): Promise<OnboardingResult>` with `type OnboardingResult = { ok: true; slug: string } | { ok: false; field: OnboardingField | "form"; error: string }`; `/app` interim home listing pending requests (Plan 3 replaces it with the dashboard).

Screen 1 of spec 5.4 (account) is `/signup` from Task 2, so `/onboarding` shows the Account step as done.

- [ ] **Step 1: Write the failing onboarding rules test**

Create `tests/unit/onboarding.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOURS,
  DEFAULT_PROCEDURES,
  dentistShortName,
  parseOnboarding,
  type OnboardingInput,
} from "@/lib/onboarding";

const good: OnboardingInput = {
  name: "Bright Dental Makati",
  smsName: "Bright Dental",
  slug: "bright-dental-makati",
  mobile: "0917 123 4567",
  address: "2F Ayala Avenue, Makati",
  dentistName: "Dr. Ana Reyes",
  dentistSmsName: "Dr. Reyes",
  hours: DEFAULT_HOURS,
  procedures: DEFAULT_PROCEDURES,
};

const withHours = (day: number, blocks: { start: string; end: string }[]) =>
  ({ ...good, hours: good.hours.map((b, d) => (d === day ? blocks : b)) });

describe("onboarding defaults", () => {
  it("pins the spec 5.4 procedures", () => {
    expect(DEFAULT_PROCEDURES).toEqual([
      { name: "Consultation", minutes: 30 },
      { name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
      { name: "Tooth Restoration (Pasta)", minutes: 60 },
      { name: "Tooth Extraction (Bunot)", minutes: 60 },
      { name: "Braces Consultation", minutes: 30 },
      { name: "Braces Adjustment", minutes: 30 },
      { name: "Root Canal Treatment", minutes: 90 },
      { name: "Teeth Whitening", minutes: 90 },
      { name: "Dentures Consultation", minutes: 30 },
      { name: "Others", minutes: 30 },
    ]);
  });

  it("presets Monday to Saturday, 9 to 12 and 1 to 5, closed Sunday", () => {
    const day = [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }];
    expect(DEFAULT_HOURS).toEqual([[], day, day, day, day, day, day]);
  });
});

describe("dentistShortName", () => {
  it("keeps the title and the last name", () => {
    expect(dentistShortName("Dr. Ana Reyes")).toBe("Dr. Reyes");
    expect(dentistShortName("Dra. Liza Santos")).toBe("Dra. Santos");
    expect(dentistShortName("  Dr.   Reyes ")).toBe("Dr. Reyes");
  });

  it("uses the last name alone without a title", () => {
    expect(dentistShortName("Ana Reyes")).toBe("Reyes");
    expect(dentistShortName("")).toBe("");
  });

  it("fits the 16 character limit", () => {
    expect(dentistShortName("Dr. Anastasia Villanueva-Fernandez")).toBe("Dr. Villanueva-F");
  });
});

describe("parseOnboarding", () => {
  it("builds the create_clinic payload", () => {
    const result = parseOnboarding(good);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      name: "Bright Dental Makati",
      sms_name: "Bright Dental",
      slug: "bright-dental-makati",
      mobile: "+639171234567",
      address: "2F Ayala Avenue, Makati",
      dentist: { name: "Dr. Ana Reyes", sms_name: "Dr. Reyes" },
    });
    expect(result.payload.hours).toHaveLength(12);
    expect(result.payload.hours[0]).toEqual({ weekday: 1, start: "09:00", end: "12:00" });
    expect(result.payload.hours.some((h) => h.weekday === 0)).toBe(false);
    expect(result.payload.procedures).toEqual(DEFAULT_PROCEDURES);
  });

  it("trims names before saving", () => {
    const result = parseOnboarding({ ...good, name: "  Bright Dental  ", procedures: [{ name: " Cleaning ", minutes: 60 }] });
    expect(result.ok && result.payload.name).toBe("Bright Dental");
    expect(result.ok && result.payload.procedures).toEqual([{ name: "Cleaning", minutes: 60 }]);
  });

  it.each([
    [{ ...good, slug: "app" }, "slug", "That link is reserved. Try another."],
    [{ ...good, smsName: "Test Dental" }, "smsName", 'The SMS provider drops texts that start with "test". Try another name.'],
    [{ ...good, mobile: "02 8123 4567" }, "mobile", "Enter a Philippine mobile number, like 0917 123 4567."],
    [{ ...good, address: "" }, "address", "Enter the clinic address, up to 200 characters."],
    [{ ...good, dentistSmsName: "Dr. Maximiliano R" }, "dentistSmsName", "Use 1 to 16 characters."],
    [withHours(1, [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "15:00" }]), "hours", "The blocks on Monday overlap."],
    [withHours(2, [{ start: "12:00", end: "09:00" }]), "hours", "Check the hours on Tuesday: each block must end after it starts."],
    [{ ...good, hours: [[], [], [], [], [], [], []] }, "hours", "Add at least one working block."],
    [{ ...good, procedures: [] }, "procedures", "Add at least one procedure."],
    [{ ...good, procedures: [{ name: "Cleaning", minutes: 3 }] }, "procedures", "Cleaning: use 5 to 480 minutes."],
    [{ ...good, procedures: [{ name: " ", minutes: 30 }] }, "procedures", "Procedure 1: enter a name, up to 60 characters."],
  ])("rejects %#", (input, field, error) => {
    expect(parseOnboarding(input)).toEqual({ ok: false, field, error });
  });

  it("reports the first problem in screen order", () => {
    const result = parseOnboarding({ ...good, name: "", procedures: [] });
    expect(result).toMatchObject({ ok: false, field: "name" });
  });

  it("rejects something that is not a form at all", () => {
    expect(parseOnboarding(null)).toMatchObject({ ok: false, field: "name" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/onboarding.test.ts`
Expected: FAIL, cannot resolve `@/lib/onboarding`.

- [ ] **Step 3: Write the onboarding rules**

Create `src/lib/onboarding.ts`:

```ts
import { normalizeMobile } from "@/lib/phone";
import { cleanText, LIMITS, slugProblem, smsNameProblem } from "@/lib/validate";

/** A working block as the form holds it, in "HH:MM" clock times. */
export type Clock = { start: string; end: string };
export type ProcedureDraft = { name: string; minutes: number };

export type OnboardingInput = {
  name: string;
  smsName: string;
  slug: string;
  mobile: string;
  address: string;
  dentistName: string;
  dentistSmsName: string;
  /** Index 0 is Sunday, 6 is Saturday. */
  hours: Clock[][];
  procedures: ProcedureDraft[];
};

export type OnboardingField = keyof OnboardingInput;
export type Problems = Partial<Record<OnboardingField, string>>;

/** The jsonb argument of public.create_clinic (supabase/migrations/20260922000200_access.sql). */
export type CreateClinicPayload = {
  name: string;
  sms_name: string;
  slug: string;
  mobile: string;
  address: string;
  dentist: { name: string; sms_name: string };
  hours: { weekday: number; start: string; end: string }[];
  procedures: { name: string; minutes: number }[];
};

const MORNING: Clock = { start: "09:00", end: "12:00" };
const AFTERNOON: Clock = { start: "13:00", end: "17:00" };

/** Spec 5.4: Monday to Saturday, 9:00 AM to 12:00 PM and 1:00 PM to 5:00 PM. */
export const DEFAULT_HOURS: Clock[][] = [[], ...Array.from({ length: 6 }, () => [MORNING, AFTERNOON])];

/** Spec 5.4 default procedures. The clinic edits them before saving. */
export const DEFAULT_PROCEDURES: ProcedureDraft[] = [
  { name: "Consultation", minutes: 30 },
  { name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
  { name: "Tooth Restoration (Pasta)", minutes: 60 },
  { name: "Tooth Extraction (Bunot)", minutes: 60 },
  { name: "Braces Consultation", minutes: 30 },
  { name: "Braces Adjustment", minutes: 30 },
  { name: "Root Canal Treatment", minutes: 90 },
  { name: "Teeth Whitening", minutes: 90 },
  { name: "Dentures Consultation", minutes: 30 },
  { name: "Others", minutes: 30 },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** "Dr. Ana Reyes" suggests "Dr. Reyes": the title, if any, and the last word. */
export function dentistShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const title = words.length > 1 && /^dra?\.?$/i.test(words[0]) ? `${words[0]} ` : "";
  return `${title}${words[words.length - 1]}`.slice(0, LIMITS.dentistSmsName);
}

/** Screen 2: the clinic. */
export function clinicProblems(i: OnboardingInput): Problems {
  const p: Problems = {};
  if (!cleanText(i.name, LIMITS.clinicName)) p.name = `Enter the clinic name, up to ${LIMITS.clinicName} characters.`;
  const sms = smsNameProblem(text(i.smsName), LIMITS.clinicSmsName);
  if (sms) p.smsName = sms;
  const slug = slugProblem(text(i.slug));
  if (slug) p.slug = slug;
  if (!normalizeMobile(text(i.mobile))) p.mobile = "Enter a Philippine mobile number, like 0917 123 4567.";
  if (!cleanText(i.address, LIMITS.address)) p.address = `Enter the clinic address, up to ${LIMITS.address} characters.`;
  return p;
}

function hoursProblem(hours: unknown): string | null {
  if (!Array.isArray(hours) || hours.length !== 7) return "Set the working hours for each day.";
  let blocks = 0;
  for (let day = 0; day < 7; day++) {
    const list: unknown = hours[day];
    if (!Array.isArray(list)) return "Set the working hours for each day.";
    if (list.length > 6) return `Use at most 6 blocks on ${DAYS[day]}.`;
    const clean = list
      .map((b) => ({ start: text(b?.start), end: text(b?.end) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (const [k, b] of clean.entries()) {
      if (!CLOCK.test(b.start) || !CLOCK.test(b.end) || b.start >= b.end) {
        return `Check the hours on ${DAYS[day]}: each block must end after it starts.`;
      }
      if (k > 0 && b.start < clean[k - 1].end) return `The blocks on ${DAYS[day]} overlap.`;
      blocks++;
    }
  }
  return blocks === 0 ? "Add at least one working block." : null;
}

/** Screen 3: the first dentist and their weekly hours. */
export function dentistProblems(i: OnboardingInput): Problems {
  const p: Problems = {};
  if (!cleanText(i.dentistName, LIMITS.dentistName)) p.dentistName = `Enter the dentist's name, up to ${LIMITS.dentistName} characters.`;
  const sms = smsNameProblem(text(i.dentistSmsName), LIMITS.dentistSmsName);
  if (sms) p.dentistSmsName = sms;
  const hours = hoursProblem(i.hours);
  if (hours) p.hours = hours;
  return p;
}

/** Screen 4: the procedures. */
export function procedureProblems(i: OnboardingInput): Problems {
  const list: unknown = i.procedures;
  if (!Array.isArray(list) || list.length === 0) return { procedures: "Add at least one procedure." };
  if (list.length > 40) return { procedures: "Use at most 40 procedures." };
  for (const [k, x] of list.entries()) {
    const name = cleanText(x?.name, LIMITS.procedureName);
    if (!name) return { procedures: `Procedure ${k + 1}: enter a name, up to ${LIMITS.procedureName} characters.` };
    const minutes = x?.minutes;
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { procedures: `${name}: use 5 to 480 minutes.` };
  }
  return {};
}

/** Validates every screen on the server and builds the create_clinic payload. */
export function parseOnboarding(
  input: unknown,
): { ok: true; payload: CreateClinicPayload } | { ok: false; field: OnboardingField; error: string } {
  if (typeof input !== "object" || input === null) return { ok: false, field: "name", error: "Something is missing. Start again." };
  const i = input as OnboardingInput;
  const problems: Problems = { ...clinicProblems(i), ...dentistProblems(i), ...procedureProblems(i) };
  const first = Object.entries(problems)[0] as [OnboardingField, string] | undefined;
  if (first) return { ok: false, field: first[0], error: first[1] };
  return {
    ok: true,
    payload: {
      name: i.name.trim(),
      sms_name: i.smsName.trim(),
      slug: i.slug,
      mobile: normalizeMobile(i.mobile)!,
      address: i.address.trim(),
      dentist: { name: i.dentistName.trim(), sms_name: i.dentistSmsName.trim() },
      hours: i.hours.flatMap((blocks, weekday) => blocks.map((b) => ({ weekday, start: b.start, end: b.end }))),
      procedures: i.procedures.map((x) => ({ name: x.name.trim(), minutes: x.minutes })),
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run tests/unit/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing database test**

This proves the payload shape matches the SQL function.

Create `tests/db/onboarding.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_HOURS, DEFAULT_PROCEDURES, parseOnboarding } from "@/lib/onboarding";
import { adminDb, deleteClinic, deleteUser, rand, signedInUser } from "./helpers";

const cleanup: { clinicId?: string; userId?: string } = {};

afterAll(async () => {
  if (cleanup.clinicId) await deleteClinic(cleanup.clinicId);
  if (cleanup.userId) await deleteUser(cleanup.userId);
});

describe("onboarding payload", () => {
  it("creates a clinic from the onboarding defaults", async () => {
    const user = await signedInUser();
    cleanup.userId = user.userId;
    const parsed = parseOnboarding({
      name: "Onboard Dental",
      smsName: "Onboard Dental",
      slug: `ob-${rand()}`,
      mobile: "0917 123 4567",
      address: "Makati",
      dentistName: "Dr. Ana Reyes",
      dentistSmsName: "Dr. Reyes",
      hours: DEFAULT_HOURS,
      procedures: DEFAULT_PROCEDURES,
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const { data: clinicId } = await user.db.rpc("create_clinic", { p: parsed.payload }).throwOnError();
    cleanup.clinicId = clinicId;

    const db = adminDb();
    const { data: clinic } = await db.from("clinics").select("mobile, address").eq("id", clinicId).single().throwOnError();
    expect(clinic).toEqual({ mobile: "+639171234567", address: "Makati" });
    const { data: hours } = await db.from("working_hours").select("weekday, start_time, end_time").eq("clinic_id", clinicId).throwOnError();
    expect(hours).toHaveLength(12);
    expect(hours).toContainEqual({ weekday: 6, start_time: "13:00:00", end_time: "17:00:00" });
    const { data: procedures } = await db.from("procedures").select("name, duration_minutes").eq("clinic_id", clinicId).throwOnError();
    expect(procedures).toHaveLength(10);
    expect(procedures).toContainEqual({ name: "Root Canal Treatment", duration_minutes: 90 });
  });
});
```

Run: `npx vitest run tests/db/onboarding.test.ts`
Expected: PASS (the SQL function already exists; this pins the contract between the two).

- [ ] **Step 6: Write the onboarding action**

Create `src/app/onboarding/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { parseOnboarding, type OnboardingField } from "@/lib/onboarding";
import { serverClient } from "@/lib/supabase/server";

export type OnboardingResult = { ok: true; slug: string } | { ok: false; field: OnboardingField | "form"; error: string };

export async function createClinic(input: unknown): Promise<OnboardingResult> {
  const parsed = parseOnboarding(input);
  if (!parsed.ok) return parsed;

  const db = await serverClient();
  const { data: auth } = await db.auth.getClaims();
  if (!auth?.claims?.sub) return { ok: false, field: "form", error: "Your session ended. Log in again to finish." };

  const { error } = await db.rpc("create_clinic", { p: parsed.payload });
  if (!error) return { ok: true, slug: parsed.payload.slug };
  if (error.message.includes("clinics_slug_key")) {
    return { ok: false, field: "slug", error: "That booking link is taken. Try another." };
  }
  // Any other unique violation means this account already has a clinic.
  if (error.code === "23505") redirect("/app");
  console.error("create_clinic failed", error.code, error.message);
  return { ok: false, field: "form", error: "Something went wrong. Please try again." };
}
```

- [ ] **Step 7: Write the onboarding screens**

Create `src/app/onboarding/Onboarding.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(auth)/actions";
import Field from "@/components/Field";
import { createClinic } from "./actions";
import {
  clinicProblems,
  DEFAULT_HOURS,
  DEFAULT_PROCEDURES,
  dentistProblems,
  dentistShortName,
  procedureProblems,
  type Clock,
  type OnboardingField,
  type OnboardingInput,
  type ProcedureDraft,
  type Problems,
} from "@/lib/onboarding";
import { LIMITS, slugFromName } from "@/lib/validate";

type Screen = "clinic" | "dentist" | "procedures" | "ready";
type Errors = Problems & { form?: string };

const STEPS: { id: Screen | "account"; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "clinic", label: "Clinic" },
  { id: "dentist", label: "Dentist" },
  { id: "procedures", label: "Procedures" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCREEN_OF: Record<OnboardingField, Screen> = {
  name: "clinic",
  smsName: "clinic",
  slug: "clinic",
  mobile: "clinic",
  address: "clinic",
  dentistName: "dentist",
  dentistSmsName: "dentist",
  hours: "dentist",
  procedures: "procedures",
};
const START: OnboardingInput = {
  name: "",
  smsName: "",
  slug: "",
  mobile: "",
  address: "",
  dentistName: "",
  dentistSmsName: "",
  hours: DEFAULT_HOURS,
  procedures: DEFAULT_PROCEDURES,
};

export default function Onboarding({ appUrl }: { appUrl: string }) {
  const [screen, setScreen] = useState<Screen>("clinic");
  const [input, setInput] = useState<OnboardingInput>(START);
  const [edited, setEdited] = useState({ smsName: false, slug: false, dentistSmsName: false });
  const [errors, setErrors] = useState<Errors>({});
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const host = appUrl.replace(/^https?:\/\//, "");
  const link = `${appUrl}/${input.slug}`;
  const stepIndex = STEPS.findIndex((s) => s.id === screen);

  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);

  function set<K extends keyof OnboardingInput>(key: K, value: OnboardingInput[K]) {
    setInput((i) => ({ ...i, [key]: value }));
  }

  // The short name and booking link follow the clinic name until the clinic edits them.
  function setName(name: string) {
    setInput((i) => ({
      ...i,
      name,
      smsName: edited.smsName ? i.smsName : name.trim().slice(0, LIMITS.clinicSmsName).trim(),
      slug: edited.slug ? i.slug : slugFromName(name),
    }));
  }

  function setDentistName(name: string) {
    setInput((i) => ({ ...i, dentistName: name, dentistSmsName: edited.dentistSmsName ? i.dentistSmsName : dentistShortName(name) }));
  }

  function setDay(day: number, blocks: Clock[]) {
    setInput((i) => ({ ...i, hours: i.hours.map((b, d) => (d === day ? blocks : b)) }));
  }

  function setProcedure(index: number, change: Partial<ProcedureDraft>) {
    setInput((i) => ({ ...i, procedures: i.procedures.map((p, k) => (k === index ? { ...p, ...change } : p)) }));
  }

  function next(problems: Problems, to: Screen) {
    setErrors(problems);
    if (Object.keys(problems).length === 0) setScreen(to);
  }

  async function finish() {
    const problems = procedureProblems(input);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setWorking(true);
    try {
      const result = await createClinic(input);
      if (result.ok) {
        setScreen("ready");
        return;
      }
      setErrors({ [result.field]: result.error } as Errors);
      if (result.field !== "form") setScreen(SCREEN_OF[result.field]);
    } catch {
      setErrors({ form: "Something went wrong. Please try again." });
    } finally {
      setWorking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: input.name, url: link });
    } catch {
      // The share sheet was dismissed.
    }
  }

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        {screen !== "ready" && (
          <div className="step-row" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.id} className="flex items-center gap-2" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                <span className={`step-pip ${s.id === screen ? "active" : ""} ${i < stepIndex ? "done" : ""}`}>
                  <span className="num">{i < stepIndex ? "✓" : i + 1}</span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="step-sep" />}
              </span>
            ))}
          </div>
        )}

        {errors.form && (
          <p role="alert" className="note-box warn mb-4">
            {errors.form}
          </p>
        )}

        {screen === "clinic" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your clinic
            </h1>
            <p className="sub">Patients see this on your booking page.</p>

            <Field label="Clinic name" error={errors.name}>
              <input
                className="f-input"
                value={input.name}
                maxLength={LIMITS.clinicName}
                autoComplete="organization"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Short name for texts"
              error={errors.smsName}
              hint={`Starts every text your patients get. Up to ${LIMITS.clinicSmsName} characters.`}
            >
              <input
                className="f-input"
                value={input.smsName}
                maxLength={LIMITS.clinicSmsName}
                onChange={(e) => {
                  setEdited((x) => ({ ...x, smsName: true }));
                  set("smsName", e.target.value);
                }}
              />
            </Field>
            <Field label="Booking link" error={errors.slug}>
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  {host}/
                </span>
                <input
                  className="f-input"
                  value={input.slug}
                  maxLength={24}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setEdited((x) => ({ ...x, slug: true }));
                    set("slug", e.target.value.toLowerCase());
                  }}
                />
              </span>
            </Field>
            <Field label="Clinic mobile" error={errors.mobile} hint="Shown to patients, and where we text you new requests.">
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  +63
                </span>
                <input
                  className="f-input"
                  value={input.mobile}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="917 123 4567"
                  onChange={(e) => set("mobile", e.target.value)}
                />
              </span>
            </Field>
            <Field label="Address" error={errors.address}>
              <input
                className="f-input"
                value={input.address}
                maxLength={LIMITS.address}
                autoComplete="street-address"
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>

            <button type="button" className="btn btn-primary wide-btn mt-6" onClick={() => next(clinicProblems(input), "dentist")}>
              Next: dentist and hours
            </button>
          </section>
        )}

        {screen === "dentist" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your first dentist
            </h1>
            <p className="sub">You can add more dentists later.</p>

            <Field label="Dentist name" error={errors.dentistName}>
              <input
                className="f-input"
                value={input.dentistName}
                maxLength={LIMITS.dentistName}
                placeholder="Dr. Ana Reyes"
                onChange={(e) => setDentistName(e.target.value)}
              />
            </Field>
            <Field
              label="Short name for texts"
              error={errors.dentistSmsName}
              hint={`Like Dr. Reyes. Up to ${LIMITS.dentistSmsName} characters.`}
            >
              <input
                className="f-input"
                value={input.dentistSmsName}
                maxLength={LIMITS.dentistSmsName}
                onChange={(e) => {
                  setEdited((x) => ({ ...x, dentistSmsName: true }));
                  set("dentistSmsName", e.target.value);
                }}
              />
            </Field>

            <fieldset className="mt-5">
              <legend className="f-label">Working hours</legend>
              {input.hours.map((blocks, day) => (
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
              {errors.hours && <p className="field-err">{errors.hours}</p>}
            </fieldset>

            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setScreen("clinic")}>
                Back
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => next(dentistProblems(input), "procedures")}>
                Next: procedures
              </button>
            </div>
          </section>
        )}

        {screen === "procedures" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your procedures
            </h1>
            <p className="sub">Patients pick from this list. The minutes set how long each visit takes.</p>

            {input.procedures.map((p, k) => (
              <div key={k} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <input
                  className="f-input"
                  aria-label={`Procedure ${k + 1} name`}
                  value={p.name}
                  maxLength={LIMITS.procedureName}
                  onChange={(e) => setProcedure(k, { name: e.target.value })}
                />
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="number"
                    className="f-input"
                    style={{ width: 96 }}
                    aria-label={`${p.name || `Procedure ${k + 1}`} minutes`}
                    min={5}
                    max={480}
                    step={5}
                    value={Number.isFinite(p.minutes) ? p.minutes : ""}
                    onChange={(e) => setProcedure(k, { minutes: e.target.valueAsNumber })}
                  />
                  <span className="meta">min</span>
                  <button
                    type="button"
                    className="link ml-auto py-3"
                    onClick={() => set("procedures", input.procedures.filter((_, j) => j !== k))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="link py-3"
              onClick={() => set("procedures", [...input.procedures, { name: "", minutes: 30 }])}
            >
              Add a procedure
            </button>
            {errors.procedures && <p className="field-err">{errors.procedures}</p>}

            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setScreen("dentist")}>
                Back
              </button>
              <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void finish()}>
                {working ? "Creating your link..." : "Create my booking link"}
              </button>
            </div>
          </section>
        )}

        {screen === "ready" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your link is ready
            </h1>
            <p className="sub">Share it on your Facebook page and in Messenger. Patients request times from it.</p>

            <div className="cf-box">
              <p className="font-display text-[15px] font-semibold break-all">{link}</p>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" className="btn btn-ghost flex-1" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => void share()}>
                Share
              </button>
            </div>
            <p className="f-hint mt-4">
              <Link href={`/${input.slug}`} className="link">
                Open your booking page
              </Link>
            </p>
            <Link href="/app" className="btn btn-soft wide-btn mt-6">
              Go to your requests
            </Link>
          </section>
        )}

        {screen !== "ready" && (
          <form action={signOut} className="mt-6 text-center">
            <button type="submit" className="link py-3">
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Write the onboarding page**

Create `src/app/onboarding/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Onboarding from "./Onboarding";
import { signedInStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your clinic" };

export default async function OnboardingPage() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (staff.clinicId) redirect("/app");
  return <Onboarding appUrl={process.env.APP_URL ?? "http://localhost:3600"} />;
}
```

- [ ] **Step 9: Write the interim staff home**

The dashboard is Plan 3. Until then `/app` lists pending requests so a clinic can see its online requests arrive (the Plan 2 deliverable). It reads through the staff client, so RLS limits it to the clinic's own rows.

Create `src/app/app/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/(auth)/actions";
import { signedInStaff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export const metadata: Metadata = { title: "Requests" };

type Pending = {
  id: string;
  starts_at: string;
  procedure_names: string[];
  patient: { first_name: string; last_name: string };
};

/** Interim home until Plan 3 builds the dashboard and /app/requests. */
export default async function AppHome() {
  const staff = await signedInStaff();
  if (!staff) redirect("/login");
  if (!staff.clinicId) redirect("/onboarding");

  const [clinic, pending] = await Promise.all([
    staff.db.from("clinics").select("name, slug").eq("id", staff.clinicId).single().throwOnError(),
    staff.db
      .from("appointments")
      .select("id, starts_at, procedure_names, patient:patients(first_name, last_name)")
      .eq("clinic_id", staff.clinicId)
      .eq("status", "pending")
      .order("starts_at")
      .limit(50)
      .throwOnError(),
  ]);
  const { name, slug } = clinic.data as { name: string; slug: string };
  const rows = pending.data as unknown as Pending[];

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{name}</h1>
        <p className="sub">
          Your booking link:{" "}
          <Link href={`/${slug}`} className="link">
            /{slug}
          </Link>
        </p>

        <h2 className="font-display text-[17px] font-bold">Waiting for you</h2>
        {rows.length === 0 ? (
          <p className="empty-note">No requests yet.</p>
        ) : (
          <div className="member-list mt-3">
            {rows.map((r) => {
              const start = new Date(r.starts_at);
              return (
                <div key={r.id} className="member-row">
                  <span className="nm">
                    {r.patient.first_name} {r.patient.last_name}
                    <span className="meta block">{r.procedure_names.join(", ")}</span>
                  </span>
                  <span className="chip chip-amber">{`${formatDate(start)}, ${formatTime(start)}`}</span>
                </div>
              );
            })}
          </div>
        )}

        <form action={signOut} className="mt-6">
          <button type="submit" className="btn btn-ghost wide-btn">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run build
```
Expected: no lint errors, all unit tests pass, the build lists `/onboarding` and `/app`.

- [ ] **Step 11: Walk onboarding in the browser**

With the dev server running and signed in as the Task 2 account, open http://localhost:3600/onboarding at phone width (375 by 812).

1. Clinic screen: type "Walk Dental Clinic". Expect the short name to fill "Walk Dental Clinic" and the link to fill `walk-dental-clinic`. Enter mobile `0917 000 0000` (use Kai's test number if Kai gives one) and an address. Press Next.
2. Dentist screen: type "Dr. Ana Reyes" and expect the short name "Dr. Reyes". Expect Monday to Saturday with two blocks each and Sunday closed. Press Next.
3. Procedures screen: expect the 10 defaults. Press "Create my booking link".
4. Expect "Your link is ready" with `http://localhost:3600/walk-dental-clinic`. Press "Go to your requests" and expect `/app` with "No requests yet."
5. Visit http://localhost:3600/onboarding again and expect a redirect to `/app`.

If the link is taken, expect the Clinic screen to come back with "That booking link is taken. Try another." under the link.

- [ ] **Step 12: Commit**

```powershell
git add src/lib/onboarding.ts src/app/onboarding src/app/app tests/unit/onboarding.test.ts tests/db/onboarding.test.ts; git commit -m "feat: add clinic onboarding and the interim requests page"
```

---

### Task 4: The SMS sender

**Files:**
- Create: `src/lib/sms/prepare.ts`, `src/lib/sms/send.ts`
- Test: `tests/unit/sms-prepare.test.ts`, `tests/db/sms.test.ts`

**Interfaces:**
- Consumes: `renderSms(kind, vars)`, `smsCredits(kind, body)`, `type SmsKind`, `type SmsVars` from `@/lib/sms/templates`; `localMobile(e164)` from `@/lib/phone`; `adminClient()` from `@/lib/supabase/admin`; env `SMS_MODE`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`; table `sms_log` (`appointment_id` must belong to `clinic_id`).
- Produces:
  - From `@/lib/sms/prepare` (pure): `type SmsMode = "log" | "live"`, `smsMode(value?: string): SmsMode`, `type PreparedSms = { message: string; stored: string; code: string | null; credits: number }`, `prepareSms(kind: SmsKind, vars: SmsVars, mode: SmsMode): PreparedSms`, `type SemaphoreReply = { ok: true; id: string } | { ok: false; error: string }`, `readSemaphoreReply(status: number, body: unknown): SemaphoreReply`
  - From `@/lib/sms/send` (server only): `type SmsStatus = "logged" | "sent" | "failed"`, `type SendSmsInput = { kind: SmsKind; to: string; vars: SmsVars; clinicId: string | null; appointmentId?: string | null }`, `sendSms(input: SendSmsInput): Promise<SmsStatus>` (never throws)

Semaphore's API (spec sources: https://www.semaphore.co/docs): `POST https://api.semaphore.co/api/v4/messages` with form fields `apikey`, `number`, `message`, `sendername` for standard texts, and `POST https://api.semaphore.co/api/v4/otp` with the same fields plus `code` for verification codes, where the message carries the `{otp}` placeholder (spec 10.3). A success returns a JSON array of message objects with `message_id`. The HTTP call lives in one function, `semaphore()` in `send.ts`, and the reply parsing in `readSemaphoreReply`, so a correction to the API touches only those two.

- [ ] **Step 1: Write the failing test for the pure part**

Create `tests/unit/sms-prepare.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { prepareSms, readSemaphoreReply, smsMode } from "@/lib/sms/prepare";

const otp = { clinic: "Bright Dental", code: "123456" };

describe("smsMode", () => {
  it("sends only when told to exactly", () => {
    expect(smsMode("live")).toBe("live");
    expect(smsMode("log")).toBe("log");
    expect(smsMode(undefined)).toBe("log");
    expect(smsMode("LIVE")).toBe("log");
  });
});

describe("prepareSms", () => {
  it("stores the real code in log mode so tests can read it", () => {
    expect(prepareSms("otp", otp, "log")).toEqual({
      message: "Your code for Bright Dental is {otp}. It expires in 5 minutes. Don't share it with anyone.",
      stored: "Your code for Bright Dental is 123456. It expires in 5 minutes. Don't share it with anyone.",
      code: "123456",
      credits: 2,
    });
  });

  it("masks the code in live mode (spec 10.6)", () => {
    const sms = prepareSms("otp", otp, "live");
    expect(sms.stored).toBe("Your code for Bright Dental is ******. It expires in 5 minutes. Don't share it with anyone.");
    expect(sms.stored).not.toContain("123456");
    expect(sms.message).toContain("{otp}");
    expect(sms.code).toBe("123456");
  });

  it("sends and stores other texts as rendered", () => {
    const vars = { first: "Ana", lastInitial: "C", date: "Thu Sep 24", time: "10:00 AM" };
    expect(prepareSms("patient_cancel_alert", vars, "live")).toEqual({
      message: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      stored: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      code: null,
      credits: 1,
    });
  });
});

describe("readSemaphoreReply", () => {
  it("takes the message id from a success", () => {
    expect(readSemaphoreReply(200, [{ message_id: 4242, status: "Pending" }])).toEqual({ ok: true, id: "4242" });
  });

  it("reports validation errors", () => {
    expect(readSemaphoreReply(200, { number: ["The number format is invalid."] })).toEqual({
      ok: false,
      error: 'Semaphore 200: {"number":["The number format is invalid."]}',
    });
  });

  it("reports server errors and empty replies", () => {
    expect(readSemaphoreReply(500, "Server Error")).toEqual({ ok: false, error: "Semaphore 500: Server Error" });
    expect(readSemaphoreReply(200, [])).toEqual({ ok: false, error: "Semaphore 200: []" });
  });

  it("keeps errors to 300 characters", () => {
    const reply = readSemaphoreReply(500, "x".repeat(1000));
    expect(reply.ok === false && reply.error.length).toBe(300);
  });
});
```

Run: `npx vitest run tests/unit/sms-prepare.test.ts`
Expected: FAIL, cannot resolve `@/lib/sms/prepare`.

- [ ] **Step 2: Write the pure part**

Create `src/lib/sms/prepare.ts`:

```ts
import { renderSms, smsCredits, type SmsKind, type SmsVars } from "@/lib/sms/templates";

export type SmsMode = "log" | "live";
/** `message` goes to the gateway, `stored` goes to sms_log. They differ only for codes. */
export type PreparedSms = { message: string; stored: string; code: string | null; credits: number };
export type SemaphoreReply = { ok: true; id: string } | { ok: false; error: string };

/** Anything but exactly "live" logs instead of sending, so a typo never sends real texts. */
export function smsMode(value: string | undefined = process.env.SMS_MODE): SmsMode {
  return value === "live" ? "live" : "log";
}

/**
 * Spec 10.3 and 10.6: codes go out through Semaphore's OTP route with the {otp} placeholder and the
 * code as a separate field. The stored body keeps the real code in log mode (tests read it) and
 * shows ****** in live mode, so a code never reaches a log in production.
 */
export function prepareSms(kind: SmsKind, vars: SmsVars, mode: SmsMode): PreparedSms {
  const real = renderSms(kind, vars);
  const credits = smsCredits(kind, real);
  if (kind !== "otp") return { message: real, stored: real, code: null, credits };
  return {
    message: renderSms("otp", { ...vars, code: "{otp}" }),
    stored: mode === "log" ? real : renderSms("otp", { ...vars, code: "******" }),
    code: vars.code ?? "",
    credits,
  };
}

/** A Semaphore success is a JSON array of messages with a message_id; anything else is an error. */
export function readSemaphoreReply(status: number, body: unknown): SemaphoreReply {
  const first: unknown = Array.isArray(body) ? body[0] : body;
  if (status >= 200 && status < 300 && typeof first === "object" && first !== null && "message_id" in first) {
    return { ok: true, id: String((first as { message_id: unknown }).message_id) };
  }
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: false, error: `Semaphore ${status}: ${detail}`.slice(0, 300) };
}
```

Run: `npx vitest run tests/unit/sms-prepare.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test for the sender**

Create `tests/db/sms.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sendSms } from "@/lib/sms/send";
import { adminDb, deleteClinic, seedClinic, type Seed } from "./helpers";

const db = adminDb();
let seed: Seed;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  process.env.SMS_MODE = "log";
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

async function lastLog() {
  const { data } = await db
    .from("sms_log")
    .select("kind, to_mobile, body, credits, status, error, provider_message_id")
    .eq("clinic_id", seed.clinic.id)
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return data;
}

describe("sendSms", () => {
  it("logs a text in log mode", async () => {
    const status = await sendSms({
      kind: "patient_cancel_alert",
      to: "+639170000000",
      clinicId: seed.clinic.id,
      vars: { first: "Ana", lastInitial: "C", date: "Thu Sep 24", time: "10:00 AM" },
    });
    expect(status).toBe("logged");
    expect(await lastLog()).toEqual({
      kind: "patient_cancel_alert",
      to_mobile: "+639170000000",
      body: "Cancelled: Ana C., Thu Sep 24, 10:00 AM.",
      credits: 1,
      status: "logged",
      error: null,
      provider_message_id: null,
    });
  });

  it("keeps the real code in log mode", async () => {
    await sendSms({ kind: "otp", to: "+639181112222", clinicId: seed.clinic.id, vars: { clinic: "Seed Clinic", code: "123456" } });
    const row = await lastLog();
    expect(row.body).toBe("Your code for Seed Clinic is 123456. It expires in 5 minutes. Don't share it with anyone.");
    expect(row.credits).toBe(2);
  });

  it("masks the code, records the failure, and does not throw when live sending can't work", async () => {
    const saved = { mode: process.env.SMS_MODE, key: process.env.SEMAPHORE_API_KEY };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.SMS_MODE = "live";
    process.env.SEMAPHORE_API_KEY = "";
    try {
      const status = await sendSms({ kind: "otp", to: "+639181112222", clinicId: seed.clinic.id, vars: { clinic: "Seed Clinic", code: "654321" } });
      expect(status).toBe("failed");
      const row = await lastLog();
      expect(row.body).toContain("******");
      expect(row.body).not.toContain("654321");
      expect(row).toMatchObject({ status: "failed", credits: 0, error: "SEMAPHORE_API_KEY is not set" });
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("semaphore.co"))).toBe(false);
    } finally {
      restoreEnv("SMS_MODE", saved.mode);
      restoreEnv("SEMAPHORE_API_KEY", saved.key);
      fetchSpy.mockRestore();
    }
  });
});
```

Run: `npx vitest run tests/db/sms.test.ts`
Expected: FAIL, cannot resolve `@/lib/sms/send`.

- [ ] **Step 4: Write the sender**

Create `src/lib/sms/send.ts`:

```ts
import "server-only";
import { localMobile } from "@/lib/phone";
import { prepareSms, readSemaphoreReply, smsMode, type SemaphoreReply } from "@/lib/sms/prepare";
import type { SmsKind, SmsVars } from "@/lib/sms/templates";
import { adminClient } from "@/lib/supabase/admin";

export type SmsStatus = "logged" | "sent" | "failed";
export type SendSmsInput = {
  kind: SmsKind;
  to: string;
  vars: SmsVars;
  clinicId: string | null;
  appointmentId?: string | null;
};

const SEMAPHORE = "https://api.semaphore.co/api/v4";

/** The one place that talks to Semaphore. Form-encoded POST; the OTP route also takes `code`. */
async function semaphore(route: "messages" | "otp", fields: Record<string, string>): Promise<SemaphoreReply> {
  try {
    const res = await fetch(`${SEMAPHORE}/${route}`, {
      method: "POST",
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: keep the raw text for the error.
    }
    return readSemaphoreReply(res.status, body);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

/**
 * Sends (live) or logs (log) one text and records it in sms_log. Never throws (spec 13):
 * a failed text is recorded with status "failed" and its error, and the caller's action goes on.
 */
export async function sendSms({ kind, to, vars, clinicId, appointmentId = null }: SendSmsInput): Promise<SmsStatus> {
  const mode = smsMode();
  const sms = prepareSms(kind, vars, mode);
  let status: SmsStatus = "logged";
  let providerId: string | null = null;
  let error: string | null = null;

  if (mode === "log") {
    console.log(`[sms ${kind}] to ${to}: ${sms.stored}`);
  } else {
    const key = process.env.SEMAPHORE_API_KEY;
    if (!key) {
      status = "failed";
      error = "SEMAPHORE_API_KEY is not set";
    } else {
      const fields: Record<string, string> = { apikey: key, number: localMobile(to), message: sms.message };
      const sender = process.env.SEMAPHORE_SENDER_NAME;
      if (sender) fields.sendername = sender;
      if (sms.code) fields.code = sms.code;
      const reply = await semaphore(sms.code ? "otp" : "messages", fields);
      if (reply.ok) {
        status = "sent";
        providerId = reply.id;
      } else {
        status = "failed";
        error = reply.error;
      }
    }
  }

  try {
    const { error: dbError } = await adminClient()
      .from("sms_log")
      .insert({
        clinic_id: clinicId,
        appointment_id: appointmentId,
        to_mobile: to,
        kind,
        body: sms.stored,
        credits: status === "failed" ? 0 : sms.credits,
        status,
        provider_message_id: providerId,
        error,
      });
    if (dbError) console.error("sms_log insert failed", dbError.message);
  } catch (e) {
    console.error("sms_log insert failed", e instanceof Error ? e.message : e);
  }
  return status;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/db/sms.test.ts; npm test`
Expected: the 3 sender tests pass, and every unit test passes.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/sms/prepare.ts src/lib/sms/send.ts tests/unit/sms-prepare.test.ts tests/db/sms.test.ts; git commit -m "feat: add the SMS sender with log and live modes"
```

---

### Task 5: Clinic alerts

**Files:**
- Create: `src/lib/push.ts`, `src/lib/notify.ts`
- Test: `tests/unit/push.test.ts`, `tests/db/notify.test.ts`

**Interfaces:**
- Consumes: `sendSms(input): Promise<SmsStatus>` from `@/lib/sms/send`; `adminClient()`; `formatDate`, `formatTime` from `@/lib/time`; env `APP_URL`; table `clinics` (`mobile`, `alert_channel`).
- Produces:
  - From `@/lib/push`: `type AlertKind = "request_alert" | "patient_cancel_alert"`, `type PushPayload = { title: string; body: string; url: string }`, `pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload`, `sendPush(clinicId: string, payload: PushPayload): Promise<number>` (delivered count; always 0 until Plan 4)
  - From `@/lib/notify` (server only): `type ClinicAlert = { kind: AlertKind; clinicId: string; appointmentId: string; first: string; last: string; startsAt: Date; dentist: string | null }`, `alertClinic(alert: ClinicAlert): Promise<"push" | "sms" | "failed">` (never throws)

`dentist` is the dentist's short name when the clinic has 2 or more active dentists, otherwise `null` (spec 10.1). The caller decides, because it already has the clinic loaded.

- [ ] **Step 1: Write the failing push payload test**

Create `tests/unit/push.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pushPayload, sendPush } from "@/lib/push";
import { manilaInstant } from "@/lib/time";

const start = manilaInstant("2026-09-24", 600);

describe("pushPayload", () => {
  it("describes a new request by date, time, and dentist", () => {
    expect(pushPayload("request_alert", start, "Dr. Reyes")).toEqual({
      title: "New booking request",
      body: "Thu Sep 24, 10:00 AM with Dr. Reyes",
      url: "/app/requests",
    });
  });

  it("describes a cancellation without a dentist for one-dentist clinics", () => {
    expect(pushPayload("patient_cancel_alert", start, null)).toEqual({
      title: "Request cancelled",
      body: "Thu Sep 24, 10:00 AM",
      url: "/app/requests",
    });
  });

  it("has nowhere to put a patient's name (spec 10.4)", () => {
    expect(Object.keys(pushPayload("request_alert", start, null)).sort()).toEqual(["body", "title", "url"]);
  });
});

describe("sendPush", () => {
  it("delivers to nobody until Plan 4 adds web push, so alerts fall back to texts", async () => {
    expect(await sendPush("any-clinic", pushPayload("request_alert", start, null))).toBe(0);
  });
});
```

Run: `npx vitest run tests/unit/push.test.ts`
Expected: FAIL, cannot resolve `@/lib/push`.

- [ ] **Step 2: Write the push module**

Create `src/lib/push.ts`:

```ts
import { formatDate, formatTime } from "@/lib/time";

export type AlertKind = "request_alert" | "patient_cancel_alert";
export type PushPayload = { title: string; body: string; url: string };

/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: kind === "request_alert" ? "New booking request" : "Request cancelled", body: when, url: "/app/requests" };
}

/**
 * Sends a push to every subscription of the clinic's members and returns how many were delivered.
 * ponytail: always 0 until Plan 4 adds web-push and subscriptions, so every alert falls back to a text.
 */
export async function sendPush(clinicId: string, payload: PushPayload): Promise<number> {
  void clinicId;
  void payload;
  return 0;
}
```

Run: `npx vitest run tests/unit/push.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing alert test**

Create `tests/db/notify.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { alertClinic } from "@/lib/notify";
import { addDays, formatDate, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const start = manilaInstant(addDays(manilaDate(new Date()), 5), 600);
let seed: Seed;
let appointmentId: string;

beforeAll(async () => {
  seed = await seedClinic();
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data } = await db
    .from("appointments")
    .insert(appointmentRow(seed, start.toISOString(), end.toISOString(), "pending"))
    .select("id")
    .single()
    .throwOnError();
  appointmentId = data.id;
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

async function lastText() {
  const { data } = await db
    .from("sms_log")
    .select("kind, to_mobile, body, status")
    .eq("appointment_id", appointmentId)
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  return data;
}

const alert = { clinicId: "", appointmentId: "", first: "Maria", last: "Santos", startsAt: start };

describe("alertClinic", () => {
  it("texts the clinic when push reached nobody", async () => {
    const via = await alertClinic({ ...alert, kind: "request_alert", clinicId: seed.clinic.id, appointmentId, dentist: "Dr. Seed" });
    expect(via).toBe("sms");
    expect(await lastText()).toEqual({
      kind: "request_alert",
      to_mobile: "+639170000000",
      status: "logged",
      body: `New request: Maria S., ${formatDate(start)} ${formatTime(start)} with Dr. Seed. Approve at ${process.env.APP_URL}/app/requests`,
    });
  });

  it("texts the clinic when it chose texts", async () => {
    await db.from("clinics").update({ alert_channel: "sms" }).eq("id", seed.clinic.id).throwOnError();
    const via = await alertClinic({ ...alert, kind: "patient_cancel_alert", clinicId: seed.clinic.id, appointmentId, dentist: null });
    expect(via).toBe("sms");
    expect(await lastText()).toMatchObject({
      kind: "patient_cancel_alert",
      body: `Cancelled: Maria S., ${formatDate(start)}, ${formatTime(start)}.`,
    });
  });

  it("never throws, even for a clinic that does not exist", async () => {
    const via = await alertClinic({
      ...alert,
      kind: "request_alert",
      clinicId: "00000000-0000-0000-0000-000000000000",
      appointmentId,
      dentist: null,
    });
    expect(via).toBe("failed");
  });
});
```

Run: `npx vitest run tests/db/notify.test.ts`
Expected: FAIL, cannot resolve `@/lib/notify`.

- [ ] **Step 4: Write the alert service**

Create `src/lib/notify.ts`:

```ts
import "server-only";
import { pushPayload, sendPush, type AlertKind } from "@/lib/push";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { formatDate, formatTime } from "@/lib/time";

export type ClinicAlert = {
  kind: AlertKind;
  clinicId: string;
  appointmentId: string;
  first: string;
  last: string;
  startsAt: Date;
  /** The dentist's short name when the clinic has 2 or more active dentists, otherwise null. */
  dentist: string | null;
};

/**
 * Spec 10.4: push first when the clinic chose push; a text to the clinic mobile when no push was
 * delivered or the clinic chose texts. Never throws, so a failed alert never undoes a booking.
 */
export async function alertClinic(alert: ClinicAlert): Promise<"push" | "sms" | "failed"> {
  try {
    const { data, error } = await adminClient().from("clinics").select("mobile, alert_channel").eq("id", alert.clinicId).single();
    if (error) throw error;
    const clinic = data as { mobile: string; alert_channel: "push" | "sms" };

    if (clinic.alert_channel === "push") {
      const delivered = await sendPush(alert.clinicId, pushPayload(alert.kind, alert.startsAt, alert.dentist));
      if (delivered > 0) return "push";
    }

    const status = await sendSms({
      kind: alert.kind,
      to: clinic.mobile,
      clinicId: alert.clinicId,
      appointmentId: alert.appointmentId,
      vars: {
        first: alert.first,
        lastInitial: alert.last.trim().charAt(0).toUpperCase(),
        date: formatDate(alert.startsAt),
        time: formatTime(alert.startsAt),
        dentist: alert.dentist ?? undefined,
        appUrl: process.env.APP_URL,
      },
    });
    return status === "failed" ? "failed" : "sms";
  } catch (e) {
    console.error("alertClinic failed", e instanceof Error ? e.message : e);
    return "failed";
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/db/notify.test.ts; npm test`
Expected: the 3 alert tests pass, and every unit test passes.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/push.ts src/lib/notify.ts tests/unit/push.test.ts tests/db/notify.test.ts; git commit -m "feat: add clinic alerts with push first and text fallback"
```

---

### Task 6: Public booking input and the availability loader

**Files:**
- Create: `src/lib/booking-input.ts`, `src/lib/availability.ts`
- Modify: `src/lib/slots.ts`
- Test: `tests/unit/booking-input.test.ts`, `tests/unit/slots.test.ts`, `tests/db/availability.test.ts`

**Interfaces:**
- Consumes: `openStarts`, `openDates`, `type Block`, `type Busy`, `type BookingRules` from `@/lib/slots`; `addDays`, `manilaDate`, `manilaInstant`, `monthDates`, `parseClock`, `weekday` from `@/lib/time`; `normalizeMobile`; `cleanBirthday`, `cleanText`, `LIMITS`; `adminClient()`.
- Produces:
  - From `@/lib/slots`: `mergeWeeks(weeks: Block[][][]): Block[][]` (the clinic's hours: every dentist's blocks per weekday, merged)
  - From `@/lib/booking-input` (pure, client-safe):
    - `type PublicDentist = { id: string; name: string; smsName: string; hours: Block[][] }`
    - `type PublicProcedure = { id: string; name: string; minutes: number }`
    - `type PublicClinic = { id: string; slug: string; name: string; smsName: string; mobile: string; address: string; mapsUrl: string | null; rules: BookingRules; dentists: PublicDentist[]; procedures: PublicProcedure[] }`
    - `type Selection = { dentistId: string; procedureIds: string[] }`
    - `type Details = { first: string; last: string; mobile: string; birthday: string; hmo: string; consent: boolean }`
    - `type BookingInput = Selection & Details & { startsAt: string }`
    - `type BookingPayload = { clinicId: string; slug: string; dentistId: string; startsAt: string; endsAt: string; procedureNames: string[]; first: string; last: string; mobile: string; birthday: string | null; hmo: string }` (ISO instants, `+639` mobile)
    - `type ResolvedSelection = { dentist: PublicDentist; procedures: PublicProcedure[]; duration: number }`
    - `HMO_SUGGESTIONS: string[]`
    - `resolveSelection(clinic: PublicClinic, value: unknown): ResolvedSelection | null`
    - `detailErrors(d: Details, today: string): Record<string, string>` (keys `first`, `last`, `mobile`, `birthday`, `hmo`, `consent`)
    - `parseBookingInput(clinic: PublicClinic, value: unknown, today: string): { ok: true; payload: BookingPayload } | { ok: false; errors: Record<string, string> }` (adds key `slot` when the visit or time is unusable)
  - From `@/lib/availability` (server only):
    - `loadClinic(by: { slug: string } | { id: string }): Promise<PublicClinic | null>` (active dentists and procedures only; throws on database errors)
    - `monthOpenDates(clinic: PublicClinic, dentist: PublicDentist, durationMinutes: number, month: string, now: Date): Promise<string[]>` (`month` is `"YYYY-MM"`)
    - `dayOpenStarts(clinic: PublicClinic, dentist: PublicDentist, durationMinutes: number, date: string, now: Date): Promise<Date[]>`

These are the only availability answers that leave the server: dates and start instants. Busy intervals stay inside `availability.ts`.

- [ ] **Step 1: Write the failing `mergeWeeks` test**

In `tests/unit/slots.test.ts`, replace the import line

```ts
import { fitsAnyBlock, openDates, openStarts, withinHours, type Block } from "@/lib/slots";
```

with

```ts
import { fitsAnyBlock, mergeWeeks, openDates, openStarts, withinHours, type Block } from "@/lib/slots";
```

and append at the end of the file:

```ts
describe("mergeWeeks", () => {
  const a: Block[][] = [[], [{ start: 540, end: 720 }, { start: 780, end: 1020 }], [], [], [], [], []];
  const b: Block[][] = [[], [{ start: 600, end: 800 }], [{ start: 540, end: 600 }], [], [], [], []];

  it("merges every dentist's blocks per weekday", () => {
    expect(mergeWeeks([a, b])).toEqual([[], [{ start: 540, end: 1020 }], [{ start: 540, end: 600 }], [], [], [], []]);
  });

  it("keeps a gap between blocks that do not touch", () => {
    expect(mergeWeeks([a])[1]).toEqual([{ start: 540, end: 720 }, { start: 780, end: 1020 }]);
  });

  it("returns a closed week for no dentists and leaves its inputs alone", () => {
    expect(mergeWeeks([])).toEqual([[], [], [], [], [], [], []]);
    mergeWeeks([a, b]);
    expect(a[1][0]).toEqual({ start: 540, end: 720 });
  });
});
```

Run: `npx vitest run tests/unit/slots.test.ts`
Expected: FAIL, `mergeWeeks` is not exported.

- [ ] **Step 2: Add `mergeWeeks`**

Append to `src/lib/slots.ts`:

```ts
/** The clinic's opening hours: every dentist's blocks per weekday, with overlapping or touching blocks merged. */
export function mergeWeeks(weeks: Block[][][]): Block[][] {
  return Array.from({ length: 7 }, (_, day) => {
    const merged: Block[] = [];
    for (const block of weeks.flatMap((w) => w[day] ?? []).sort((x, y) => x.start - y.start)) {
      const last = merged.at(-1);
      if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
      else merged.push({ ...block });
    }
    return merged;
  });
}
```

Run: `npx vitest run tests/unit/slots.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing booking input test**

Create `tests/unit/booking-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detailErrors, parseBookingInput, resolveSelection, type PublicClinic } from "@/lib/booking-input";
import type { Block } from "@/lib/slots";

const day: Block[] = [{ start: 540, end: 1020 }];
const week: Block[][] = [[], day, day, day, day, day, day];
const clinic: PublicClinic = {
  id: "c1",
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  dentists: [
    { id: "d1", name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: week },
    { id: "d2", name: "Dr. Marco Lim", smsName: "Dr. Lim", hours: week },
  ],
  procedures: [
    { id: "p1", name: "Consultation", minutes: 30 },
    { id: "p2", name: "Oral Prophylaxis (Cleaning)", minutes: 60 },
  ],
};

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
  it("adds up the chosen procedures, in the clinic's order", () => {
    const chosen = resolveSelection(clinic, { dentistId: "d1", procedureIds: ["p2", "p1"] });
    expect(chosen?.duration).toBe(90);
    expect(chosen?.dentist.id).toBe("d1");
    expect(chosen?.procedures.map((p) => p.name)).toEqual(["Consultation", "Oral Prophylaxis (Cleaning)"]);
  });

  it.each([
    [null],
    ["d1"],
    [{ dentistId: "nobody", procedureIds: ["p1"] }],
    [{ dentistId: "d1", procedureIds: [] }],
    [{ dentistId: "d1", procedureIds: ["p1", "p1"] }],
    [{ dentistId: "d1", procedureIds: ["p1", "archived"] }],
    [{ dentistId: "d1", procedureIds: "p1" }],
    [{ dentistId: "d1", procedureIds: Array.from({ length: 21 }, (_, i) => `p${i}`) }],
  ])("rejects %j", (value) => {
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
    const result = parseBookingInput(clinic, { ...good, clinicId: "someone-else", endsAt: "2030-01-01T00:00:00Z" }, today);
    expect(result.ok && result.payload.clinicId).toBe("c1");
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

Run: `npx vitest run tests/unit/booking-input.test.ts`
Expected: FAIL, cannot resolve `@/lib/booking-input`.

- [ ] **Step 4: Write the booking input module**

Create `src/lib/booking-input.ts`:

```ts
import { normalizeMobile } from "@/lib/phone";
import type { Block, BookingRules } from "@/lib/slots";
import { cleanBirthday, cleanText, LIMITS } from "@/lib/validate";

export type PublicDentist = { id: string; name: string; smsName: string; hours: Block[][] };
export type PublicProcedure = { id: string; name: string; minutes: number };

/** Everything the public booking page receives (spec 6): no patients and no busy intervals. */
export type PublicClinic = {
  id: string;
  slug: string;
  name: string;
  smsName: string;
  mobile: string;
  address: string;
  mapsUrl: string | null;
  rules: BookingRules;
  dentists: PublicDentist[];
  procedures: PublicProcedure[];
};

export type Selection = { dentistId: string; procedureIds: string[] };
export type Details = { first: string; last: string; mobile: string; birthday: string; hmo: string; consent: boolean };
export type BookingInput = Selection & Details & { startsAt: string };

/** The pending booking: stored in otp_requests.booking, then passed to create_booking. */
export type BookingPayload = {
  clinicId: string;
  slug: string;
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

export type ResolvedSelection = { dentist: PublicDentist; procedures: PublicProcedure[]; duration: number };

/** Common HMO providers, offered as suggestions on the booking form (spec 5.1). */
export const HMO_SUGGESTIONS = [
  "Maxicare",
  "Intellicare",
  "MediCard",
  "PhilCare",
  "Cocolife",
  "Avega",
  "ValuCare",
  "Insular Health Care",
  "EastWest Healthcare",
  "Kaiser",
];

// appointments.procedure_names holds 1 to 20 names.
const MAX_PROCEDURES = 20;

/** The dentist and procedures the client picked, checked against the clinic, or null. */
export function resolveSelection(clinic: PublicClinic, value: unknown): ResolvedSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const { dentistId, procedureIds } = value as Record<string, unknown>;
  const dentist = clinic.dentists.find((d) => d.id === dentistId);
  if (!dentist || !Array.isArray(procedureIds) || procedureIds.length === 0 || procedureIds.length > MAX_PROCEDURES) return null;
  const ids = new Set(procedureIds);
  const procedures = clinic.procedures.filter((p) => ids.has(p.id));
  if (ids.size !== procedureIds.length || procedures.length !== ids.size) return null;
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

Run: `npx vitest run tests/unit/booking-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing availability test**

Create `tests/db/availability.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayOpenStarts, loadClinic, monthOpenDates } from "@/lib/availability";
import type { PublicClinic } from "@/lib/booking-input";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

const db = adminDb();
const now = new Date();
const today = manilaDate(now);
const date = addDays(today, 3);
const fullDay = addDays(today, 4);
const at = (day: string, minutes: number) => manilaInstant(day, minutes).toISOString();
let seed: Seed;
let clinic: PublicClinic;

beforeAll(async () => {
  seed = await seedClinic();
  await db.from("procedures").insert({ clinic_id: seed.clinic.id, name: "Consultation", duration_minutes: 30 }).throwOnError();
  await db.from("procedures").insert({ clinic_id: seed.clinic.id, name: "Archived", duration_minutes: 30, active: false }).throwOnError();
  clinic = (await loadClinic({ slug: seed.clinic.slug }))!;
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("loadClinic", () => {
  it("gives the page the clinic profile, dentists, procedures, hours, and rules, and nothing else", () => {
    expect(Object.keys(clinic).sort()).toEqual([
      "address", "dentists", "id", "mapsUrl", "mobile", "name", "procedures", "rules", "slug", "smsName",
    ]);
    expect(clinic.dentists).toEqual([
      { id: seed.dentist.id, name: "Dr. Seed", smsName: "Dr. Seed", hours: Array.from({ length: 7 }, () => [{ start: 540, end: 1020 }]) },
    ]);
    expect(clinic.procedures).toEqual([{ id: expect.any(String), name: "Consultation", minutes: 30 }]);
    expect(clinic.rules).toEqual({ slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 });
  });

  it("finds the same clinic by id, and nothing for an unknown link", async () => {
    expect((await loadClinic({ id: seed.clinic.id }))?.slug).toBe(seed.clinic.slug);
    expect(await loadClinic({ slug: "no-such-clinic-zz9" })).toBeNull();
  });
});

describe("dayOpenStarts", () => {
  it("returns open start instants and nothing else, minus appointments and time off", async () => {
    const dentist = clinic.dentists[0];
    expect(await dayOpenStarts(clinic, dentist, 30, date, now)).toHaveLength(16);

    await db.from("appointments").insert(appointmentRow(seed, at(date, 600), at(date, 660), "pending")).throwOnError();
    await db
      .from("time_off")
      .insert({ clinic_id: seed.clinic.id, dentist_id: seed.dentist.id, starts_at: at(date, 780), ends_at: at(date, 840) })
      .throwOnError();

    const starts = await dayOpenStarts(clinic, dentist, 30, date, now);
    expect(starts.every((s) => s instanceof Date)).toBe(true);
    const iso = starts.map((s) => s.toISOString());
    expect(iso).toHaveLength(12);
    for (const taken of [600, 630, 780, 810]) expect(iso).not.toContain(at(date, taken));
    expect(iso).toContain(at(date, 660));
  });

  it("returns nothing outside the booking window", async () => {
    expect(await dayOpenStarts(clinic, clinic.dentists[0], 30, addDays(today, -1), now)).toEqual([]);
    expect(await dayOpenStarts(clinic, clinic.dentists[0], 30, addDays(today, 61), now)).toEqual([]);
  });
});

describe("monthOpenDates", () => {
  it("drops a fully booked day and returns only bookable dates of that month", async () => {
    await db.from("appointments").insert(appointmentRow(seed, at(fullDay, 540), at(fullDay, 1020), "confirmed")).throwOnError();
    const month = fullDay.slice(0, 7);
    const open = await monthOpenDates(clinic, clinic.dentists[0], 30, month, now);
    expect(open).not.toContain(fullDay);
    if (date.slice(0, 7) === month) expect(open).toContain(date);
    expect(open.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d.startsWith(month) && d >= today)).toBe(true);
  });

  it("returns nothing for a month outside the window", async () => {
    expect(await monthOpenDates(clinic, clinic.dentists[0], 30, "2000-01", now)).toEqual([]);
  });
});
```

Run: `npx vitest run tests/db/availability.test.ts`
Expected: FAIL, cannot resolve `@/lib/availability`.

- [ ] **Step 6: Write the availability loader**

Create `src/lib/availability.ts`:

```ts
import "server-only";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
import { openDates, openStarts, type Block, type Busy } from "@/lib/slots";
import { adminClient } from "@/lib/supabase/admin";
import { addDays, manilaDate, manilaInstant, monthDates, parseClock, weekday } from "@/lib/time";

type ClinicRow = {
  id: string;
  slug: string;
  name: string;
  sms_name: string;
  mobile: string;
  address: string;
  maps_url: string | null;
  slot_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
};
type HoursRow = { dentist_id: string; weekday: number; start_time: string; end_time: string };

/** The public booking page's clinic: active dentists with their weekly hours, active procedures, and rules. */
export async function loadClinic(by: { slug: string } | { id: string }): Promise<PublicClinic | null> {
  const db = adminClient();
  const [column, value] = "slug" in by ? ["slug", by.slug] : ["id", by.id];
  const { data, error } = await db
    .from("clinics")
    .select("id, slug, name, sms_name, mobile, address, maps_url, slot_minutes, min_notice_minutes, max_days_ahead")
    .eq(column, value)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const c = data as ClinicRow;

  const [dentists, hours, procedures] = await Promise.all([
    db.from("dentists").select("id, name, sms_name").eq("clinic_id", c.id).eq("active", true).order("created_at").order("name").throwOnError(),
    db.from("working_hours").select("dentist_id, weekday, start_time, end_time").eq("clinic_id", c.id).throwOnError(),
    db.from("procedures").select("id, name, duration_minutes").eq("clinic_id", c.id).eq("active", true).order("name").throwOnError(),
  ]);
  const hourRows = hours.data as HoursRow[];
  const week = (dentistId: string): Block[][] =>
    Array.from({ length: 7 }, (_, day) =>
      hourRows
        .filter((h) => h.dentist_id === dentistId && h.weekday === day)
        .map((h) => ({ start: parseClock(h.start_time), end: parseClock(h.end_time) }))
        .sort((a, b) => a.start - b.start),
    );

  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    smsName: c.sms_name,
    mobile: c.mobile,
    address: c.address,
    mapsUrl: c.maps_url,
    rules: { slotMinutes: c.slot_minutes, minNoticeMinutes: c.min_notice_minutes, maxDaysAhead: c.max_days_ahead },
    dentists: (dentists.data as { id: string; name: string; sms_name: string }[]).map((d) => ({
      id: d.id,
      name: d.name,
      smsName: d.sms_name,
      hours: week(d.id),
    })),
    procedures: (procedures.data as { id: string; name: string; duration_minutes: number }[]).map((p) => ({
      id: p.id,
      name: p.name,
      minutes: p.duration_minutes,
    })),
  };
}

/** Pending and confirmed appointments plus time off for one dentist, overlapping [from, to). Never leaves the server. */
async function busyBetween(dentistId: string, from: Date, to: Date): Promise<Busy[]> {
  const db = adminClient();
  const [appointments, timeOff] = await Promise.all([
    db
      .from("appointments")
      .select("starts_at, ends_at")
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
  const rows = [...appointments.data, ...timeOff.data] as { starts_at: string; ends_at: string }[];
  return rows.map((r) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) }));
}

/** Dates of a "YYYY-MM" month with at least one open start for this dentist and duration (spec 8.3). */
export async function monthOpenDates(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  month: string,
  now: Date,
): Promise<string[]> {
  const dates = monthDates(month);
  const today = manilaDate(now);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (last < today || first > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(dentist.id, manilaInstant(first, 0), manilaInstant(addDays(last, 1), 0));
  return openDates({ dates, blocksByWeekday: dentist.hours, busy, durationMinutes, rules: clinic.rules, now });
}

/** Open start instants on one Manila date for this dentist and duration (spec 8). */
export async function dayOpenStarts(
  clinic: PublicClinic,
  dentist: PublicDentist,
  durationMinutes: number,
  date: string,
  now: Date,
): Promise<Date[]> {
  const today = manilaDate(now);
  if (date < today || date > addDays(today, clinic.rules.maxDaysAhead)) return [];
  const busy = await busyBetween(dentist.id, manilaInstant(date, 0), manilaInstant(addDays(date, 1), 0));
  return openStarts({ date, blocks: dentist.hours[weekday(date)], busy, durationMinutes, rules: clinic.rules, now });
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/db/availability.test.ts; npm test`
Expected: the 6 availability tests pass, and every unit test passes.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/booking-input.ts src/lib/availability.ts src/lib/slots.ts tests/unit/booking-input.test.ts tests/unit/slots.test.ts tests/db/availability.test.ts; git commit -m "feat: add the public clinic loader and server-side availability"
```

---

### Task 7: The booking service (codes, rate limits, and the request)

**Files:**
- Create: `src/lib/request.ts`, `src/lib/booking.ts`
- Test: `tests/unit/request.test.ts`, `tests/db/booking-service.test.ts`

**Interfaces:**
- Consumes: `loadClinic`, `dayOpenStarts` from `@/lib/availability`; `parseBookingInput`, `type BookingPayload`, `type PublicClinic` from `@/lib/booking-input`; `checkCode`, `hashCode`, `isRateLimited`, `newCode`, `newToken`, `OTP` from `@/lib/codes`; `alertClinic` from `@/lib/notify`; `sendSms` from `@/lib/sms/send`; `adminClient()`; `manilaDate`; SQL `public.create_booking(...)` (17 named arguments, returns the appointment id, raises `23P01` on overlap); table `otp_requests` (`id` is generated here because the code hash binds to it).
- Produces:
  - From `@/lib/request`: `clientIp(forwardedFor: string | null): string`
  - From `@/lib/booking` (server only):
    - `type BookingOutcome = { status: "code"; requestId: string } | { status: "sent"; token: string } | { status: "taken"; starts: string[] } | { status: "invalid"; errors: Record<string, string> } | { status: "limited" } | { status: "sms_failed" } | { status: "unavailable" }`
    - `type VerifyOutcome = { status: "sent"; token: string } | { status: "taken"; starts: string[] } | { status: "wrong"; attemptsLeft: number } | { status: "expired" } | { status: "locked" } | { status: "used" } | { status: "unavailable" }`
    - `type ResendOutcome = { status: "code"; requestId: string } | { status: "wait"; seconds: number } | { status: "gone" } | { status: "limited" } | { status: "sms_failed" } | { status: "unavailable" }`
    - `requestBooking(slug: string, input: unknown, ctx: { ip: string; now: Date; verifiedMobiles: string[] }): Promise<BookingOutcome>`
    - `verifyCode(requestId: string, code: string, now: Date): Promise<{ outcome: VerifyOutcome; verifiedMobile: string | null }>` (`verifiedMobile` is set once the code checks out, so the caller can remember the device even when the time was taken meanwhile)
    - `resendCode(requestId: string, ctx: { ip: string; now: Date }): Promise<ResendOutcome>`

All three never throw: database trouble becomes `{ status: "unavailable" }` (spec 13, "Booking is temporarily unavailable"). `starts` are ISO instants for the same dentist and date.

The flow is spec 9.1 and 10.3 exactly:
1. Validate the input and build the payload from the clinic's own data (`parseBookingInput`).
2. A device that already verified this mobile goes straight to step 5.
3. Re-check that the start is still open; if not, return fresh starts.
4. Check the rolling-hour limits, store an `otp_requests` row with the payload and the code hash, and text the code.
5. On the right code: mark the row verified, then book the payload stored in that row (never one sent again by the client). `create_booking` matches or creates the patient, inserts the pending appointment, and writes the event in one transaction. The clinic is alerted, and the patient gets their link token.

- [ ] **Step 1: Write the failing IP test**

Create `tests/unit/request.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/request";

describe("clientIp", () => {
  it("takes the first address Vercel lists", () => {
    expect(clientIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientIp(" 2001:db8::1 ")).toBe("2001:db8::1");
  });

  it("falls back to one shared bucket when the header is missing", () => {
    expect(clientIp(null)).toBe("unknown");
    expect(clientIp("")).toBe("unknown");
    expect(clientIp(" , 10.0.0.1")).toBe("unknown");
  });

  it("caps the length it stores", () => {
    expect(clientIp("x".repeat(200))).toHaveLength(64);
  });
});
```

Run: `npx vitest run tests/unit/request.test.ts`
Expected: FAIL, cannot resolve `@/lib/request`.

- [ ] **Step 2: Write `clientIp`**

Create `src/lib/request.ts`:

```ts
/**
 * The client's address for rate limits: the first entry of x-forwarded-for. Vercel sets this header
 * and overwrites any value the client sent, so it can be trusted there.
 */
export function clientIp(forwardedFor: string | null): string {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "unknown";
}
```

Run: `npx vitest run tests/unit/request.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing booking service test**

Create `tests/db/booking-service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestBooking, resendCode, verifyCode } from "@/lib/booking";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, rand, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const date = addDays(manilaDate(new Date()), 3);
const at = (minutes: number) => manilaInstant(date, minutes).toISOString();
const later = (ms: number) => new Date(Date.now() + ms);
const mobiles: string[] = [];
let seed: Seed;
let procedureId: string;

function newMobile(): string {
  const mobile = `+63918${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  mobiles.push(mobile);
  return mobile;
}
const newIp = () => `test-${rand()}`;
const ctx = (verifiedMobiles: string[] = [], ip = newIp()) => ({ ip, now: new Date(), verifiedMobiles });

function input(startMinutes: number, mobile: string) {
  return {
    dentistId: seed.dentist.id,
    procedureIds: [procedureId],
    startsAt: at(startMinutes),
    first: "Maria",
    last: "Santos",
    mobile,
    birthday: "",
    hmo: "",
    consent: true,
  };
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

async function codeRequest(startMinutes: number, mobile: string, ip = newIp()): Promise<string> {
  const outcome = await requestBooking(seed.clinic.slug, input(startMinutes, mobile), ctx([], ip));
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
});

afterAll(async () => {
  await db.from("otp_requests").delete().in("mobile", mobiles);
  await deleteClinic(seed.clinic.id);
});

describe("online booking", () => {
  it("sends a code, then books the stored request once the code is right", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(540, mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verifyCode(requestId, wrong, new Date())).outcome).toEqual({ status: "wrong", attemptsLeft: 4 });

    const right = await verifyCode(requestId, code, new Date());
    expect(right.verifiedMobile).toBe(mobile);
    if (right.outcome.status !== "sent") throw new Error(`Expected sent, got ${right.outcome.status}`);

    const { data: appt } = await db
      .from("appointments")
      .select("id, status, source, starts_at, procedure_names")
      .eq("manage_token", right.outcome.token)
      .single()
      .throwOnError();
    expect(appt).toMatchObject({ status: "pending", source: "online", procedure_names: ["Consultation"] });
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

    expect((await verifyCode(requestId, code, new Date())).outcome).toEqual({ status: "used" });
  });

  it("skips the code for a mobile this device already verified", async () => {
    const mobile = newMobile();
    const outcome = await requestBooking(seed.clinic.slug, input(570, mobile), ctx([mobile]));
    expect(outcome.status).toBe("sent");
    const { count } = await db.from("otp_requests").select("id", { count: "exact", head: true }).eq("mobile", mobile);
    expect(count).toBe(0);
  });

  it("offers fresh times when the chosen one was just taken", async () => {
    const first = newMobile();
    expect((await requestBooking(seed.clinic.slug, input(600, first), ctx([first]))).status).toBe("sent");
    const second = newMobile();
    const outcome = await requestBooking(seed.clinic.slug, input(600, second), ctx([second]));
    if (outcome.status !== "taken") throw new Error(`Expected taken, got ${outcome.status}`);
    expect(outcome.starts).not.toContain(at(600));
    expect(outcome.starts).toContain(at(630));
  });

  it("re-checks the time before sending a code too", async () => {
    const outcome = await requestBooking(seed.clinic.slug, input(600, newMobile()), ctx());
    expect(outcome.status).toBe("taken");
  });

  it("names every problem with the details", async () => {
    const outcome = await requestBooking(seed.clinic.slug, { ...input(630, "123"), consent: false }, ctx());
    if (outcome.status !== "invalid") throw new Error(`Expected invalid, got ${outcome.status}`);
    expect(Object.keys(outcome.errors).sort()).toEqual(["consent", "mobile"]);
  });

  it("does not know an unknown booking link", async () => {
    const outcome = await requestBooking("no-such-clinic-zz9", input(630, newMobile()), ctx());
    expect(outcome).toEqual({ status: "invalid", errors: { slot: "This booking link doesn't exist." } });
  });

  it("never books a time that stopped being open while the code was out", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(660, mobile);
    await db.from("appointments").insert(appointmentRow(seed, at(660), at(690), "confirmed")).throwOnError();
    const result = await verifyCode(requestId, await lastCode(mobile), new Date());
    expect(result.outcome.status).toBe("taken");
    expect(result.verifiedMobile).toBe(mobile);
  });
});

describe("verification code rules", () => {
  it("locks a code after 5 wrong tries, even for the right code", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(720, mobile);
    const code = await lastCode(mobile);
    const wrong = code === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1, 0]) {
      expect((await verifyCode(requestId, wrong, new Date())).outcome).toEqual({ status: "wrong", attemptsLeft: left });
    }
    expect((await verifyCode(requestId, code, new Date())).outcome).toEqual({ status: "locked" });
  });

  it("expires a code after 5 minutes", async () => {
    const mobile = newMobile();
    const requestId = await codeRequest(750, mobile);
    const code = await lastCode(mobile);
    expect((await verifyCode(requestId, code, later(5 * 60_000 + 1_000))).outcome).toEqual({ status: "expired" });
  });

  it("treats an unknown or malformed request as expired", async () => {
    expect((await verifyCode("00000000-0000-0000-0000-000000000000", "123456", new Date())).outcome).toEqual({ status: "expired" });
    expect((await verifyCode("not-a-uuid", "123456", new Date())).outcome).toEqual({ status: "expired" });
  });

  it("resends after 60 seconds with a new code and retires the old one", async () => {
    const mobile = newMobile();
    const oldId = await codeRequest(780, mobile);
    const oldCode = await lastCode(mobile);
    expect((await resendCode(oldId, { ip: newIp(), now: new Date() })).status).toBe("wait");

    const resent = await resendCode(oldId, { ip: newIp(), now: later(61_000) });
    if (resent.status !== "code") throw new Error(`Expected code, got ${resent.status}`);
    expect(resent.requestId).not.toBe(oldId);
    expect((await verifyCode(oldId, oldCode, later(62_000))).outcome).toEqual({ status: "expired" });
    const verified = await verifyCode(resent.requestId, await lastCode(mobile), new Date());
    expect(verified.outcome.status).toBe("sent");
  });

  it("allows 3 codes per mobile in an hour", async () => {
    const mobile = newMobile();
    for (let i = 0; i < 3; i++) await codeRequest(810, mobile);
    expect((await requestBooking(seed.clinic.slug, input(810, mobile), ctx())).status).toBe("limited");
  });

  it("allows 10 codes per IP address in an hour", async () => {
    const ip = newIp();
    for (let i = 0; i < 10; i++) await codeRequest(840, newMobile(), ip);
    expect((await requestBooking(seed.clinic.slug, input(840, newMobile()), ctx([], ip))).status).toBe("limited");
  });
});
```

Run: `npx vitest run tests/db/booking-service.test.ts`
Expected: FAIL, cannot resolve `@/lib/booking`.

- [ ] **Step 4: Write the booking service**

Create `src/lib/booking.ts`:

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import { dayOpenStarts, loadClinic } from "@/lib/availability";
import { parseBookingInput, type BookingPayload, type PublicClinic } from "@/lib/booking-input";
import { checkCode, hashCode, isRateLimited, newCode, newToken, OTP } from "@/lib/codes";
import { alertClinic } from "@/lib/notify";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { manilaDate } from "@/lib/time";

type Finalized = { status: "sent"; token: string } | { status: "taken"; starts: string[] };
type CodeIssued = { status: "code"; requestId: string } | { status: "limited" } | { status: "sms_failed" };

export type BookingOutcome =
  | Finalized
  | CodeIssued
  | { status: "invalid"; errors: Record<string, string> }
  | { status: "unavailable" };

export type VerifyOutcome =
  | Finalized
  | { status: "wrong"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "locked" }
  | { status: "used" }
  | { status: "unavailable" };

export type ResendOutcome =
  | CodeIssued
  | { status: "wait"; seconds: number }
  | { status: "gone" }
  | { status: "unavailable" };

type Ctx = { ip: string; now: Date };
type OtpRow = {
  id: string;
  mobile: string;
  code_hash: string;
  booking: BookingPayload;
  attempts: number;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Logs the error message only: never codes or patient details (spec 12). */
function logFailure(where: string, e: unknown) {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}

/** Null while the payload's start is still open; otherwise that dentist's fresh open starts on that date (spec 13). */
async function takenStarts(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<string[] | null> {
  const dentist = clinic.dentists.find((d) => d.id === p.dentistId);
  const start = new Date(p.startsAt);
  const duration = (new Date(p.endsAt).getTime() - start.getTime()) / 60_000;
  const starts = dentist ? await dayOpenStarts(clinic, dentist, duration, manilaDate(start), now) : [];
  return starts.some((s) => s.getTime() === start.getTime()) ? null : starts.map((s) => s.toISOString());
}

/** Spec 9.1 steps 5 and 6: one transaction creates the request, then the clinic is alerted. */
async function finalize(clinic: PublicClinic, p: BookingPayload, now: Date): Promise<Finalized> {
  const fresh = await takenStarts(clinic, p, now);
  if (fresh) return { status: "taken", starts: fresh };

  const token = newToken();
  const { data: appointmentId, error } = await adminClient().rpc("create_booking", {
    p_clinic_id: clinic.id,
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
  if (error?.code === "23P01") return { status: "taken", starts: (await takenStarts(clinic, p, now)) ?? [] };
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

/** Spec 10.3: rolling-hour limits, then a stored request holding the payload and the code hash, then the text. */
async function issueCode(clinic: PublicClinic, booking: BookingPayload, { ip, now }: Ctx): Promise<CodeIssued> {
  const db = adminClient();
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const countSince = async (column: "mobile" | "ip", value: string) => {
    const { count, error } = await db
      .from("otp_requests")
      .select("id", { count: "exact", head: true })
      .eq(column, value)
      .gte("created_at", since);
    if (error) throw error;
    return count ?? 0;
  };
  // ponytail: count-then-insert is not atomic, so a burst of parallel requests can slip a few codes past
  // the limit. Move this into a locking SQL function if sms_log ever shows that abuse.
  if (isRateLimited(await countSince("mobile", booking.mobile), await countSince("ip", ip))) return { status: "limited" };

  const id = randomUUID();
  const code = newCode();
  await db
    .from("otp_requests")
    .insert({
      id,
      mobile: booking.mobile,
      ip,
      code_hash: hashCode(id, code),
      booking,
      expires_at: new Date(now.getTime() + OTP.ttlMs).toISOString(),
    })
    .throwOnError();
  const sent = await sendSms({ kind: "otp", to: booking.mobile, vars: { clinic: clinic.smsName, code }, clinicId: clinic.id });
  return sent === "failed" ? { status: "sms_failed" } : { status: "code", requestId: id };
}

/** Spec 9.1 step 3: validate, then book straight away for a verified device, or send a code. */
export async function requestBooking(
  slug: string,
  input: unknown,
  ctx: Ctx & { verifiedMobiles: string[] },
): Promise<BookingOutcome> {
  try {
    const clinic = await loadClinic({ slug });
    if (!clinic) return { status: "invalid", errors: { slot: "This booking link doesn't exist." } };
    const parsed = parseBookingInput(clinic, input, manilaDate(ctx.now));
    if (!parsed.ok) return { status: "invalid", errors: parsed.errors };

    if (ctx.verifiedMobiles.includes(parsed.payload.mobile)) return await finalize(clinic, parsed.payload, ctx.now);
    const starts = await takenStarts(clinic, parsed.payload, ctx.now);
    if (starts) return { status: "taken", starts };
    return await issueCode(clinic, parsed.payload, ctx);
  } catch (e) {
    logFailure("requestBooking", e);
    return { status: "unavailable" };
  }
}

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

    const clinic = await loadClinic({ id: row.booking.clinicId });
    if (!clinic) return done({ status: "unavailable" });
    return done(await finalize(clinic, row.booking, now));
  } catch (e) {
    logFailure("verifyCode", e);
    return done({ status: "unavailable" });
  }
}

/** Spec 10.3: a new code after 60 seconds, for the same stored payload. The old code stops working. */
export async function resendCode(requestId: string, ctx: Ctx): Promise<ResendOutcome> {
  if (!UUID.test(requestId)) return { status: "gone" };
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("otp_requests")
      .select("id, mobile, booking, created_at, verified_at")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throw error;
    const row = data as Pick<OtpRow, "id" | "mobile" | "booking" | "created_at" | "verified_at"> | null;
    if (!row || row.verified_at) return { status: "gone" };

    const waitMs = new Date(row.created_at).getTime() + OTP.resendMs - ctx.now.getTime();
    if (waitMs > 0) return { status: "wait", seconds: Math.ceil(waitMs / 1000) };

    const clinic = await loadClinic({ id: row.booking.clinicId });
    if (!clinic) return { status: "gone" };
    const issued = await issueCode(clinic, row.booking, ctx);
    if (issued.status === "code") {
      await db.from("otp_requests").update({ expires_at: ctx.now.toISOString() }).eq("id", row.id).throwOnError();
    }
    return issued;
  } catch (e) {
    logFailure("resendCode", e);
    return { status: "unavailable" };
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/db/booking-service.test.ts; npm test`
Expected: all 13 booking service tests pass, and every unit test passes.

- [ ] **Step 6: Run the whole database suite**

Run: `npm run test:db`
Expected: every file in `tests/db` passes, including the Plan 1 files.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/request.ts src/lib/booking.ts tests/unit/request.test.ts tests/db/booking-service.test.ts; git commit -m "feat: add the booking service with verification codes and rate limits"
```

---

### Task 8: The public booking page on real data

**Files:**
- Create: `src/app/[slug]/actions.ts`, `src/app/[slug]/not-found.tsx`, `src/app/[slug]/error.tsx`
- Modify (full rewrite): `src/app/[slug]/page.tsx`, `src/app/[slug]/BookingSheet.tsx`, `src/app/[slug]/MonthSheet.tsx`
- Delete: `src/lib/sample-clinic.ts`

**Interfaces:**
- Consumes: `loadClinic`, `monthOpenDates`, `dayOpenStarts` from `@/lib/availability`; `requestBooking`, `verifyCode`, `resendCode` and the outcome types from `@/lib/booking`; `resolveSelection`, `detailErrors`, `HMO_SUGGESTIONS`, `type PublicClinic`, `type Details` from `@/lib/booking-input`; `DEVICE_COOKIE`, `readDevice`, `signDevice` from `@/lib/codes`; `clientIp` from `@/lib/request`; `mergeWeeks`, `fitsAnyBlock`, `type Block` from `@/lib/slots`; `slugProblem`, `LIMITS` from `@/lib/validate`; `Field` from `@/components/Field`; `localMobile`, `normalizeMobile` from `@/lib/phone`.
- Produces (Server Actions in `src/app/[slug]/actions.ts`, all validate their arguments):
  - `getOpenDates(slug: string, selection: unknown, month: string): Promise<string[]>`
  - `getOpenStarts(slug: string, selection: unknown, date: string): Promise<string[]>` (ISO instants)
  - `requestBooking(slug: string, input: unknown): Promise<BookingOutcome>` (reads the device cookie and the client IP)
  - `verifyBookingCode(requestId: string, code: string): Promise<VerifyOutcome>` (sets the device cookie once the code checks out)
  - `resendBookingCode(requestId: string): Promise<ResendOutcome>`
- Produces (UI): `BookingSheet` props `{ clinic: PublicClinic; nowIso: string }` (no `busy`); `MonthSheet` props add `loading: boolean` and `closedWeekdays: number[]`.

The page keeps BookingSheet's look and classes. What changes: the sample clinic, the SAMPLE chip, and the "any 6 digits will do" note are gone; open dates and times come from the server; the code step is real; a searchable procedure list (spec 5.1); the consent text is the spec's; and the Request sent screen links to the patient's view and cancel page.

- [ ] **Step 1: Write the public Server Actions**

Create `src/app/[slug]/actions.ts`:

```ts
"use server";

import { cookies, headers } from "next/headers";
import { dayOpenStarts, loadClinic, monthOpenDates } from "@/lib/availability";
import * as booking from "@/lib/booking";
import { resolveSelection } from "@/lib/booking-input";
import { DEVICE_COOKIE, readDevice, signDevice } from "@/lib/codes";
import { clientIp } from "@/lib/request";

// Server Actions are public POST endpoints: every argument is checked here before use.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DEVICE_MAX_AGE = 180 * 86_400;

async function chosen(slug: unknown, selection: unknown) {
  const clinic = typeof slug === "string" ? await loadClinic({ slug }) : null;
  const picked = clinic ? resolveSelection(clinic, selection) : null;
  return clinic && picked ? { clinic, picked } : null;
}

/** Enabled days of a month: dates only, never busy times (spec 6). */
export async function getOpenDates(slug: string, selection: unknown, month: string): Promise<string[]> {
  if (typeof month !== "string" || !MONTH.test(month)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  return monthOpenDates(found.clinic, found.picked.dentist, found.picked.duration, month, new Date());
}

/** Open start times of one day as ISO instants. */
export async function getOpenStarts(slug: string, selection: unknown, date: string): Promise<string[]> {
  if (typeof date !== "string" || !DATE.test(date)) return [];
  const found = await chosen(slug, selection);
  if (!found) return [];
  const starts = await dayOpenStarts(found.clinic, found.picked.dentist, found.picked.duration, date, new Date());
  return starts.map((s) => s.toISOString());
}

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

export async function resendBookingCode(requestId: string): Promise<booking.ResendOutcome> {
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  return booking.resendCode(String(requestId), { ip, now: new Date() });
}
```

- [ ] **Step 2: Rewrite the page loader**

Replace `src/app/[slug]/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import BookingSheet from "./BookingSheet";
import { loadClinic } from "@/lib/availability";
import { slugProblem } from "@/lib/validate";

// Open times depend on the current minute, so this page is never prerendered.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// generateMetadata and the page share one lookup per request. Malformed links skip the database.
const clinicFor = cache(async (slug: string) => (slugProblem(slug) ? null : loadClinic({ slug })));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) return { title: "Booking link not found" };
  const title = `Book at ${clinic.name}`;
  const description = `Request a dental appointment at ${clinic.name}${clinic.address ? `, ${clinic.address}` : ""}.`;
  return { title, description, openGraph: { title, description, type: "website" } };
}

/** A clinic's public booking page and website (spec 5.1). It receives no patient data and no busy times. */
export default async function ClinicBookingPage({ params }: Params) {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) notFound();
  return <BookingSheet clinic={clinic} nowIso={new Date().toISOString()} />;
}
```

- [ ] **Step 3: Add the not-found and error pages**

Create `src/app/[slug]/not-found.tsx`:

```tsx
import Link from "next/link";

/** Spec 13: unknown or changed booking link. */
export default function BookingLinkNotFound() {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{"This booking link doesn't exist"}</h1>
        <p className="sub">Check the link with your clinic. It may have changed.</p>
        <Link href="/" className="btn btn-ghost wide-btn">
          Go to BrightSmile
        </Link>
      </div>
    </div>
  );
}
```

Create `src/app/[slug]/error.tsx`:

```tsx
"use client";

/** Spec 13: database unavailable. */
export default function BookingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Booking is temporarily unavailable</h1>
        <p className="sub">Please try again in a few minutes.</p>
        <button type="button" className="btn btn-primary wide-btn" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the month grid**

Replace `src/app/[slug]/MonthSheet.tsx` with:

```tsx
"use client";

import { addDays, monthDates, weekday } from "@/lib/time";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  month: string;
  today: string;
  lastBookable: string;
  openDates: string[];
  /** True while the server is working out this month's open days. */
  loading: boolean;
  /** Weekdays (0 Sunday) the chosen dentist doesn't work, so their days read "closed", not "fully booked". */
  closedWeekdays: number[];
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (delta: number) => void;
};

function monthLabel(month: string) {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${year}`;
}

/**
 * The month as a mini calendar: circular days, the primary colour for the one you chose, an outline
 * on today. Days with nothing open are struck through and say why in their accessible name, so the
 * mark never rests on colour. While the month loads, every day is muted and unpickable.
 */
export default function MonthSheet({ month, today, lastBookable, openDates, loading, closedWeekdays, selected, onSelect, onMonth }: Props) {
  const dates = monthDates(month);
  const open = new Set(openDates);
  const blanks = weekday(dates[0]);
  const canGoBack = month > today.slice(0, 7);
  const canGoForward = month < lastBookable.slice(0, 7);

  const cells: (string | null)[] = [...Array.from({ length: blanks }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <section aria-label="Choose a day" aria-busy={loading}>
      <div className="mini-head">
        <p className="m font-display">{monthLabel(month)}</p>
        <div className="mini-nav">
          <button type="button" onClick={() => onMonth(-1)} disabled={!canGoBack} aria-label="Previous month">
            <span aria-hidden="true">&#8249;</span>
          </button>
          <button type="button" onClick={() => onMonth(1)} disabled={!canGoForward} aria-label="Next month">
            <span aria-hidden="true">&#8250;</span>
          </button>
        </div>
      </div>

      <table className="mini-cal">
        <caption className="sr-only">{`Days in ${monthLabel(month)}. Days with no openings are struck through.`}</caption>
        <thead>
          <tr>
            {DAY_HEADS.map((head) => (
              <th key={head} scope="col">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((date, j) =>
                date === null ? (
                  <td key={`blank-${i}-${j}`} />
                ) : (
                  <td key={date}>
                    <button
                      type="button"
                      disabled={loading || !open.has(date)}
                      aria-pressed={date === selected}
                      aria-label={dayLabel(date, month, open.has(date), loading, today, lastBookable, closedWeekdays)}
                      onClick={() => onSelect(date)}
                      className={[
                        "mini-day",
                        date === selected ? "sel" : "",
                        date === today && date !== selected ? "today" : "",
                        loading ? "muted" : open.has(date) ? "" : date >= today && date <= lastBookable ? "off" : "muted",
                      ].join(" ")}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="legend">
        <span className="key">
          <span aria-hidden="true" className="dot" style={{ background: "var(--primary)" }} />
          Chosen
        </span>
        <span className="key">
          <span
            aria-hidden="true"
            className="dot"
            style={{ background: "#fff", border: "2px solid var(--primary-mid)", width: 11, height: 11 }}
          />
          Today
        </span>
        <span className="key">
          <span aria-hidden="true" style={{ width: 14, borderTop: "2px solid var(--text-3)" }} />
          Closed or full
        </span>
      </div>

      {loading ? (
        <p className="empty-note mt-3" aria-live="polite">
          Checking openings...
        </p>
      ) : (
        <p className="sr-only" aria-live="polite">{`${openDates.length} days are open in ${monthLabel(month)}.`}</p>
      )}

      {!loading && openDates.length === 0 && (
        <p className="note-box mt-3">
          Nothing open in {monthLabel(month)}.{" "}
          {canGoForward ? (
            <button type="button" onClick={() => onMonth(1)} className="link">
              Try {monthLabel(addDays(`${month}-01`, 31).slice(0, 7))}
            </button>
          ) : (
            "Try a shorter visit, or call the clinic."
          )}
        </p>
      )}
    </section>
  );
}

function dayLabel(
  date: string,
  month: string,
  isOpen: boolean,
  loading: boolean,
  today: string,
  lastBookable: string,
  closedWeekdays: number[],
) {
  const day = Number(date.slice(8));
  const monthName = monthLabel(month).split(" ")[0];
  const why =
    date < today ? "past" : date > lastBookable ? "too far ahead" : closedWeekdays.includes(weekday(date)) ? "closed" : "fully booked";
  const parts = [`${DAY_NAMES[weekday(date)]}, ${monthName} ${day}`];
  if (!isOpen && !loading) parts.push(why);
  if (date === today) parts.push("today");
  return parts.join(", ");
}
```

- [ ] **Step 5: Rewrite the booking sheet**

Replace `src/app/[slug]/BookingSheet.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Field from "@/components/Field";
import MonthSheet from "./MonthSheet";
import { getOpenDates, getOpenStarts, requestBooking, resendBookingCode, verifyBookingCode } from "./actions";
import type { BookingOutcome } from "@/lib/booking";
import { detailErrors, HMO_SUGGESTIONS, type Details, type PublicClinic } from "@/lib/booking-input";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { fitsAnyBlock, mergeWeeks, type Block } from "@/lib/slots";
import { addDays, formatDate, formatMinutes, formatTime, manilaDate } from "@/lib/time";
import { LIMITS } from "@/lib/validate";

type Props = { clinic: PublicClinic; nowIso: string };
type Step = "what" | "when" | "who" | "code" | "sent";

const STEPS: { id: Step; label: string }[] = [
  { id: "what", label: "What" },
  { id: "when", label: "When" },
  { id: "who", label: "Who" },
];
const EMPTY_FORM: Details = { first: "", last: "", mobile: "", birthday: "", hmo: "", consent: false };
const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNAVAILABLE = "Booking is temporarily unavailable. Please try again in a few minutes.";

/** The clinic's hours, read off its dentists' own working blocks so the line cannot lie. */
function hoursSummary(week: Block[][]): string {
  const describe = (blocks: Block[]) =>
    blocks.length === 0 ? "closed" : blocks.map((b) => `${formatMinutes(b.start)} to ${formatMinutes(b.end)}`).join(", ");
  const groups: { from: number; to: number; text: string }[] = [];
  for (let day = 0; day < 7; day++) {
    const text = describe(week[day]);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = day;
    else groups.push({ from: day, to: day, text });
  }
  return groups
    .map((g) => `${DAY_HEADS[g.from]}${g.to > g.from ? ` to ${DAY_HEADS[g.to]}` : ""} ${g.text}`)
    .join(" · ");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export default function BookingSheet({ clinic, nowIso }: Props) {
  const [step, setStep] = useState<Step>("what");
  const [procedureIds, setProcedureIds] = useState<string[]>([]);
  const [dentistId, setDentistId] = useState(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => manilaDate(new Date(nowIso)).slice(0, 7));
  const [monthOpen, setMonthOpen] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [starts, setStarts] = useState<string[] | null>(null);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [form, setForm] = useState<Details>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [resendIn, setResendIn] = useState(60);
  const [token, setToken] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Each availability load gets a number; a reply that is no longer the latest is dropped.
  const loads = useRef(0);

  const now = new Date(nowIso);
  const today = manilaDate(now);
  const lastBookable = addDays(today, clinic.rules.maxDaysAhead);
  const week = mergeWeeks(clinic.dentists.map((d) => d.hours));
  const phone = localMobile(clinic.mobile);
  const closed = clinic.dentists.length === 0 || clinic.procedures.length === 0;
  const showDentist = clinic.dentists.length > 1;
  const dentist = clinic.dentists.find((d) => d.id === dentistId) ?? clinic.dentists[0];
  const chosen = clinic.procedures.filter((p) => procedureIds.includes(p.id));
  const duration = chosen.reduce((sum, p) => sum + p.minutes, 0);
  const tooLong = duration > 0 && !fitsAnyBlock(duration, dentistId ? dentist.hours : week);
  const selection = { dentistId: dentist?.id ?? "", procedureIds };
  const closedWeekdays = dentist ? [0, 1, 2, 3, 4, 5, 6].filter((d) => dentist.hours[d].length === 0) : [];
  const search = query.trim().toLowerCase();
  const listed = search ? clinic.procedures.filter((p) => p.name.toLowerCase().includes(search)) : clinic.procedures;
  const start = startIso ? new Date(startIso) : null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // The countdown starts where the code was requested, so nothing sets state straight from an effect.
  useEffect(() => {
    if (step !== "code") return;
    const tick = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [step]);

  function clearTime() {
    setDate(null);
    setStarts(null);
    setStartIso(null);
  }

  function toggleProcedure(id: string) {
    setProcedureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setMonthOpen(null);
    clearTime();
  }

  function chooseDentist(id: string) {
    setDentistId(id);
    setMonthOpen(null);
    clearTime();
  }

  async function loadMonth(nextMonth: string) {
    const n = ++loads.current;
    setMonth(nextMonth);
    setMonthOpen(null);
    clearTime();
    try {
      const open = await getOpenDates(clinic.slug, selection, nextMonth);
      if (n === loads.current) setMonthOpen(open);
    } catch {
      if (n === loads.current) {
        setMonthOpen([]);
        setNotice(UNAVAILABLE);
      }
    }
  }

  async function loadDay(day: string) {
    const n = ++loads.current;
    setDate(day);
    setStarts(null);
    setStartIso(null);
    try {
      const list = await getOpenStarts(clinic.slug, selection, day);
      if (n === loads.current) setStarts(list);
    } catch {
      if (n === loads.current) {
        setStarts([]);
        setNotice(UNAVAILABLE);
      }
    }
  }

  function goToWhen() {
    setNotice("");
    setStep("when");
    if (monthOpen === null) void loadMonth(month);
  }

  function handleBooking(outcome: BookingOutcome) {
    switch (outcome.status) {
      case "code":
        setRequestId(outcome.requestId);
        setCode("");
        setResendIn(60);
        setStep("code");
        return;
      case "sent":
        setToken(outcome.token);
        setStep("sent");
        return;
      case "taken":
        setStarts(outcome.starts);
        setStartIso(null);
        setNotice("That time was just taken. Pick another one below.");
        setStep("when");
        return;
      case "invalid":
        setErrors(outcome.errors);
        if (outcome.errors.slot) {
          setNotice(outcome.errors.slot);
          setStep("when");
        }
        return;
      case "limited":
        setNotice(`Too many attempts. Try again in an hour or call ${phone}.`);
        return;
      case "sms_failed":
        setNotice(`We couldn't send the code. Try again, or call ${phone}.`);
        return;
      case "unavailable":
        setNotice(UNAVAILABLE);
        return;
    }
  }

  async function submitDetails() {
    const problems = detailErrors(form, today);
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !startIso) return;
    setWorking(true);
    setNotice("");
    try {
      handleBooking(await requestBooking(clinic.slug, { ...selection, startsAt: startIso, ...form }));
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setErrors({ code: "Enter the 6 digits from the text." });
      return;
    }
    setErrors({});
    setNotice("");
    setWorking(true);
    try {
      const outcome = await verifyBookingCode(requestId, code);
      switch (outcome.status) {
        case "sent":
          setToken(outcome.token);
          setStep("sent");
          break;
        case "wrong":
          setErrors({
            code:
              outcome.attemptsLeft > 0
                ? `That code is not right. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? "try" : "tries"} left.`
                : "Too many wrong tries. Send another code.",
          });
          break;
        case "expired":
          setErrors({ code: "That code has expired. Send another code." });
          break;
        case "locked":
          setErrors({ code: "Too many wrong tries. Send another code." });
          break;
        case "used":
          setErrors({ code: "That code was already used. Send another code." });
          break;
        case "taken":
          setStarts(outcome.starts);
          setStartIso(null);
          setNotice("That time was just taken. Your number is verified, so pick another time and send again.");
          setStep("when");
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
      }
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  async function resend() {
    setNotice("");
    setWorking(true);
    try {
      const outcome = await resendBookingCode(requestId);
      switch (outcome.status) {
        case "code":
          setRequestId(outcome.requestId);
          setCode("");
          setErrors({});
          setResendIn(60);
          break;
        case "wait":
          setResendIn(outcome.seconds);
          break;
        case "limited":
          setNotice(`Too many attempts. Try again in an hour or call ${phone}.`);
          break;
        case "sms_failed":
          setNotice(`We couldn't send the code. Try again, or call ${phone}.`);
          break;
        case "gone":
          setNotice("Please send your request again.");
          setStep("who");
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
      }
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  function startOver() {
    setProcedureIds([]);
    setDentistId(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
    setQuery("");
    setMonthOpen(null);
    clearTime();
    setForm(EMPTY_FORM);
    setErrors({});
    setNotice("");
    setCode("");
    setRequestId("");
    setToken("");
    setStep("what");
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
            <p className="meta">
              {clinic.address}
              {clinic.mapsUrl && (
                <>
                  {" "}
                  <a href={clinic.mapsUrl} className="link" target="_blank" rel="noreferrer">
                    Map
                  </a>
                </>
              )}
            </p>
            <p className="meta">{hoursSummary(week)}</p>
            <p className="meta">
              <a href={`tel:${clinic.mobile}`} className="link">
                {phone}
              </a>
            </p>
          </div>
        </div>
        <hr className="rule-gold" />

        {closed ? (
          <p className="note-box">
            {"Online booking isn't open yet. Call "}
            <a href={`tel:${clinic.mobile}`} className="font-semibold underline">
              {phone}
            </a>
            {" to book."}
          </p>
        ) : (
          <>
            {step !== "sent" && (
              <div className="step-row" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-2" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                    <span className={`step-pip ${s.id === step ? "active" : ""} ${i < stepIndex || step === "code" ? "done" : ""}`}>
                      <span className="num">{i < stepIndex || step === "code" ? "✓" : i + 1}</span>
                      {s.label}
                    </span>
                    {i < STEPS.length - 1 && <span className="step-sep" />}
                  </span>
                ))}
              </div>
            )}

            {notice && step !== "sent" && (
              <p role="alert" className="note-box warn mb-4">
                {notice}
              </p>
            )}

            {step === "what" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  What do you need?
                </h2>
                <p className="sub">Pick everything you need in one visit. The times you see will fit all of it.</p>

                {clinic.procedures.length > 6 && (
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
                        checked={procedureIds.includes(p.id)}
                        onChange={() => toggleProcedure(p.id)}
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
                      {clinic.dentists.map((d) => (
                        <label key={d.id} className="member-row">
                          <input
                            type="radio"
                            name="dentist"
                            value={d.id}
                            aria-label={d.name}
                            checked={dentistId === d.id}
                            onChange={() => chooseDentist(d.id)}
                          />
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

                {tooLong && (
                  <p className="note-box warn mt-4">
                    No single opening fits all of these. Choose fewer procedures or call{" "}
                    <a href={`tel:${clinic.mobile}`} className="font-semibold underline">
                      {phone}
                    </a>
                    .
                  </p>
                )}

                <button
                  type="button"
                  className="btn btn-primary wide-btn mt-6"
                  disabled={duration === 0 || tooLong || (showDentist && !dentistId)}
                  onClick={goToWhen}
                >
                  {duration === 0 ? "Pick what you need" : showDentist && !dentistId ? "Choose a dentist" : "Pick a day"}
                </button>
              </section>
            )}

            {step === "when" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  When suits you?
                </h2>
                <p className="sub">
                  {duration} minutes with {dentist.name}.
                </p>

                <MonthSheet
                  month={month}
                  today={today}
                  lastBookable={lastBookable}
                  openDates={monthOpen ?? []}
                  loading={monthOpen === null}
                  closedWeekdays={closedWeekdays}
                  selected={date}
                  onSelect={(d) => void loadDay(d)}
                  onMonth={(delta) => void loadMonth(addDays(`${month}-01`, delta > 0 ? 31 : -1).slice(0, 7))}
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
                          <button
                            key={iso}
                            type="button"
                            onClick={() => setStartIso(iso)}
                            aria-pressed={iso === startIso}
                            className={`slot ${iso === startIso ? "sel" : ""}`}
                          >
                            {formatTime(new Date(iso))}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 flex gap-3">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("what")}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary flex-1"
                    disabled={!startIso}
                    onClick={() => {
                      setNotice("");
                      setStep("who");
                    }}
                  >
                    {startIso ? `Take ${formatTime(new Date(startIso))}` : "Pick a time"}
                  </button>
                </div>
              </section>
            )}

            {step === "who" && start && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Who is this for?
                </h2>
                <p className="sub">The clinic texts this number to confirm.</p>

                <div className="cf-box mb-5">
                  <div className="cf-row">
                    <span className="k">When</span>
                    <span className="v">{`${formatDate(start)}, ${formatTime(start)}`}</span>
                  </div>
                  <div className="cf-row">
                    <span className="k">With</span>
                    <span className="v">{dentist.name}</span>
                  </div>
                  <div className="cf-row">
                    <span className="k">For</span>
                    <span className="v">{chosen.map((p) => p.name).join(", ")}</span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" error={errors.first}>
                    <input
                      className="f-input"
                      value={form.first}
                      autoComplete="given-name"
                      maxLength={LIMITS.personName}
                      onChange={(e) => setForm({ ...form, first: e.target.value })}
                    />
                  </Field>
                  <Field label="Last name" error={errors.last}>
                    <input
                      className="f-input"
                      value={form.last}
                      autoComplete="family-name"
                      maxLength={LIMITS.personName}
                      onChange={(e) => setForm({ ...form, last: e.target.value })}
                    />
                  </Field>
                </div>

                <Field label="Mobile number" error={errors.mobile}>
                  <span className="prefix-row">
                    <span aria-hidden="true" className="px">
                      +63
                    </span>
                    <input
                      className="f-input"
                      value={form.mobile}
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="917 123 4567"
                      onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    />
                  </span>
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Birthday" optional error={errors.birthday}>
                    <input
                      type="date"
                      className="f-input"
                      value={form.birthday}
                      max={today}
                      min="1900-01-01"
                      onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                    />
                  </Field>
                  <Field label="HMO provider" optional error={errors.hmo}>
                    <input
                      className="f-input"
                      list="hmo-list"
                      value={form.hmo}
                      maxLength={LIMITS.hmo}
                      onChange={(e) => setForm({ ...form, hmo: e.target.value })}
                    />
                    <datalist id="hmo-list">
                      {HMO_SUGGESTIONS.map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  </Field>
                </div>

                <label className="member-row mt-4 items-start">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                    aria-describedby={errors.consent ? "consent-error" : undefined}
                    style={{ marginTop: 2 }}
                  />
                  <span className="nm" style={{ fontSize: 13.5 }}>
                    I agree to {clinic.name} and BrightSmile using my details to manage this appointment, as described in the
                    Privacy Notice.
                  </span>
                </label>
                {errors.consent && (
                  <p id="consent-error" className="field-err">
                    {errors.consent}
                  </p>
                )}

                <div className="mt-6 flex gap-3">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("when")}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void submitDetails()}>
                    {working ? "Sending..." : "Send request"}
                  </button>
                </div>

                <p className="f-hint mt-4">
                  Need help? Call{" "}
                  <a href={`tel:${clinic.mobile}`} className="link">
                    {phone}
                  </a>
                  .
                </p>
              </section>
            )}

            {step === "code" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Check your texts
                </h2>
                <p className="sub">
                  We sent a 6 digit code to {localMobile(normalizeMobile(form.mobile) ?? "+63")}. It expires in 5 minutes.
                </p>

                <Field label="Code from the text" error={errors.code}>
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
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("who")}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void verify()}>
                    {working ? "Checking..." : "Confirm request"}
                  </button>
                </div>

                <p className="f-hint mt-4">
                  {resendIn > 0 ? (
                    <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
                  ) : (
                    <button type="button" onClick={() => void resend()} className="link" disabled={working}>
                      Send another code
                    </button>
                  )}
                </p>
              </section>
            )}

            {step === "sent" && start && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Request sent
                </h2>
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
                    <div className="cf-row">
                      <span className="k">With</span>
                      <span className="v">{dentist.name}</span>
                    </div>
                    <div className="cf-row">
                      <span className="k">For</span>
                      <span className="v">{chosen.map((p) => p.name).join(", ")}</span>
                    </div>
                  </div>
                </div>

                <p className="f-hint mt-4">
                  No reply within a day? Call{" "}
                  <a href={`tel:${clinic.mobile}`} className="link">
                    {phone}
                  </a>
                  .
                </p>
                {token && (
                  <p className="f-hint mt-2">
                    <Link href={`/a/${token}`} className="link">
                      View or cancel this request
                    </Link>
                  </p>
                )}

                <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={startOver}>
                  Book another time
                </button>
              </section>
            )}
          </>
        )}
      </div>

      <p className="mt-5 text-center">
        <span className="brand-lockup">
          {/* Placeholder mark in the logo's colours. Swap for /brand/logo.png when Kai adds the file. */}
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3c2.2 0 3.3 1.1 5 1.1 1.4 0 2.5.9 2.5 3.2 0 3.1-1.3 4.6-2 7.4-.6 2.6-1 4.8-2.4 4.8-1.2 0-1.4-1.6-3.1-1.6s-1.9 1.6-3.1 1.6c-1.4 0-1.8-2.2-2.4-4.8-.7-2.8-2-4.3-2-7.4 0-2.3 1.1-3.2 2.5-3.2 1.7 0 2.8-1.1 5-1.1Z"
              fill="var(--primary)"
            />
            <path d="M8.8 15.6c1.9 1.5 4.5 1.5 6.4 0" stroke="var(--gold)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </span>
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Delete the sample clinic**

Run:
```powershell
git rm src/lib/sample-clinic.ts; git grep -n "sample-clinic" -- src tests
```
Expected: `rm 'src/lib/sample-clinic.ts'`, then no matches from `git grep`.

- [ ] **Step 7: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run build
```
Expected: no lint errors, all unit tests pass, the build succeeds with `/[slug]` as a dynamic route.

- [ ] **Step 8: Book on the real page**

With the dev server running, open the clinic created in Task 3 (for example http://localhost:3600/walk-dental-clinic) at phone width, signed out or in another browser profile.

1. Expect the clinic's name, address, phone, and hours ("Sun closed · Mon to Sat 9:00 AM to 12:00 PM, 1:00 PM to 5:00 PM"), no SAMPLE chip, and a search box above the 10 procedures. Type "braces" and expect two rows.
2. Pick Consultation and press "Pick a day". Expect "Checking openings..." briefly, then Sundays struck through and labelled "closed".
3. In the browser's network panel, check that the page's HTML and the action responses contain dates and ISO times only: no `busy`, no patient names.
4. Pick a day and a time, fill in the details with a mobile you control in log mode (any valid PH mobile, since nothing is sent), tick consent, press "Send request". Expect "Check your texts".
5. Read the code from the dev server output: preview_logs with search `[sms otp]` (or the terminal running `npm run dev`). Enter a wrong code and expect "That code is not right. 4 tries left." Enter the right code and expect "Request sent" with "View or cancel this request".
6. Open http://localhost:3600/no-such-clinic-zz9 and expect "This booking link doesn't exist".

- [ ] **Step 9: Commit**

```powershell
git add "src/app/[slug]"; git commit -m "feat: serve the booking page from real clinic data with server-side availability" -m "Removes the sample clinic. Open dates and times come from Server Actions, so the page never receives busy intervals (spec section 6)."
```

---

### Task 9: The patient view and cancel link

**Files:**
- Create: `src/lib/patient-link.ts`, `src/app/a/[token]/page.tsx`, `src/app/a/[token]/CancelButton.tsx`, `src/app/a/[token]/actions.ts`, `src/app/a/[token]/not-found.tsx`
- Test: `tests/db/patient-link.test.ts`

**Interfaces:**
- Consumes: `canTransition(from, to, actor)`, `isCancellable(a, now)`, `type Status` from `@/lib/appointments`; `alertClinic` from `@/lib/notify`; `adminClient()`; SQL `public.set_appointment_status(p_id, p_from, p_to, p_actor, p_user_id, p_reason)` (returns false when the status already moved on); `formatDate`, `formatTime`; `localMobile`.
- Produces:
  - From `@/lib/patient-link` (server only): `type PatientView = { status: Status; startsAt: Date; firstName: string; dentistName: string; clinicName: string; clinicMobile: string; slug: string; cancellable: boolean }`, `loadPatientView(token: string, now: Date): Promise<PatientView | null>`, `cancelByPatient(token: string, now: Date): Promise<"cancelled" | "not_allowed" | "not_found">`
  - Route `/a/[token]` (spec 5.2), and the Server Action `cancelVisit(token: string): Promise<"cancelled" | "not_allowed" | "not_found" | "unavailable">`

The view shows status, clinic, dentist, date, time, and the patient's first name only (spec 5.2 and 12). The page is marked `noindex`.

- [ ] **Step 1: Write the failing test**

Create `tests/db/patient-link.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelByPatient, loadPatientView } from "@/lib/patient-link";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
const db = adminDb();
const today = manilaDate(new Date());
const date = addDays(today, 3);
let seed: Seed;

async function book(startMinutes: number, status: string, day = date) {
  const row = appointmentRow(
    seed,
    manilaInstant(day, startMinutes).toISOString(),
    manilaInstant(day, startMinutes + 30).toISOString(),
    status,
  );
  const { data } = await db.from("appointments").insert(row).select("id, manage_token").single().throwOnError();
  return data as { id: string; manage_token: string };
}

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

describe("loadPatientView", () => {
  it("shows the visit with the patient's first name only", async () => {
    const a = await book(540, "pending");
    expect(await loadPatientView(a.manage_token, new Date())).toEqual({
      status: "pending",
      startsAt: manilaInstant(date, 540),
      firstName: "Ana",
      dentistName: "Dr. Seed",
      clinicName: "Seed Clinic",
      clinicMobile: "+639170000000",
      slug: seed.clinic.slug,
      cancellable: true,
    });
  });

  it("knows nothing about unknown or malformed tokens", async () => {
    expect(await loadPatientView("AAAAAAAAAAAA", new Date())).toBeNull();
    expect(await loadPatientView("x", new Date())).toBeNull();
  });
});

describe("cancelByPatient", () => {
  it("cancels a pending request, records the patient as the actor, and alerts the clinic", async () => {
    const a = await book(600, "pending");
    expect(await cancelByPatient(a.manage_token, new Date())).toBe("cancelled");

    const { data: appt } = await db.from("appointments").select("status").eq("id", a.id).single().throwOnError();
    expect(appt.status).toBe("cancelled");
    const { data: events } = await db
      .from("appointment_events")
      .select("from_status, to_status, actor")
      .eq("appointment_id", a.id)
      .eq("to_status", "cancelled")
      .throwOnError();
    expect(events).toEqual([{ from_status: "pending", to_status: "cancelled", actor: "patient" }]);
    const { data: text } = await db
      .from("sms_log")
      .select("kind, to_mobile, body")
      .eq("appointment_id", a.id)
      .single()
      .throwOnError();
    expect(text.kind).toBe("patient_cancel_alert");
    expect(text.to_mobile).toBe("+639170000000");
    expect(text.body).toMatch(/^Cancelled: Ana C\., /);

    expect(await cancelByPatient(a.manage_token, new Date())).toBe("not_allowed");
    expect((await loadPatientView(a.manage_token, new Date()))?.cancellable).toBe(false);
  });

  it("cancels a confirmed visit", async () => {
    const a = await book(660, "confirmed");
    expect(await cancelByPatient(a.manage_token, new Date())).toBe("cancelled");
  });

  it("refuses a visit that already started", async () => {
    const past = await book(540, "confirmed", addDays(today, -1));
    expect(await cancelByPatient(past.manage_token, new Date())).toBe("not_allowed");
    expect((await loadPatientView(past.manage_token, new Date()))?.cancellable).toBe(false);
  });

  it("refuses statuses the patient can't change", async () => {
    const declined = await book(720, "declined");
    expect(await cancelByPatient(declined.manage_token, new Date())).toBe("not_allowed");
  });

  it("does not find unknown tokens", async () => {
    expect(await cancelByPatient("AAAAAAAAAAAA", new Date())).toBe("not_found");
    expect(await cancelByPatient("x", new Date())).toBe("not_found");
  });
});
```

Run: `npx vitest run tests/db/patient-link.test.ts`
Expected: FAIL, cannot resolve `@/lib/patient-link`.

- [ ] **Step 2: Write the patient link service**

Create `src/lib/patient-link.ts`:

```ts
import "server-only";
import { canTransition, isCancellable, type Status } from "@/lib/appointments";
import { alertClinic } from "@/lib/notify";
import { adminClient } from "@/lib/supabase/admin";

export type PatientView = {
  status: Status;
  startsAt: Date;
  firstName: string;
  dentistName: string;
  clinicName: string;
  clinicMobile: string;
  slug: string;
  cancellable: boolean;
};

type Row = {
  id: string;
  clinic_id: string;
  status: Status;
  starts_at: string;
  patient: { first_name: string; last_name: string };
  dentist: { name: string; sms_name: string };
  clinic: { name: string; slug: string; mobile: string };
};

const TOKEN = /^[A-Za-z0-9]{12}$/;

async function findByToken(token: string): Promise<Row | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await adminClient()
    .from("appointments")
    .select(
      "id, clinic_id, status, starts_at, patient:patients(first_name, last_name), dentist:dentists(name, sms_name), clinic:clinics(name, slug, mobile)",
    )
    .eq("manage_token", token)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Row | null;
}

/** Spec 5.2: status, clinic, dentist, date, time, and the patient's first name only. */
export async function loadPatientView(token: string, now: Date): Promise<PatientView | null> {
  const row = await findByToken(token);
  if (!row) return null;
  const startsAt = new Date(row.starts_at);
  return {
    status: row.status,
    startsAt,
    firstName: row.patient.first_name,
    dentistName: row.dentist.name,
    clinicName: row.clinic.name,
    clinicMobile: row.clinic.mobile,
    slug: row.clinic.slug,
    cancellable: isCancellable({ status: row.status, starts_at: startsAt }, now),
  };
}

/** Spec 9.2: the patient cancels a future pending or confirmed visit, and the clinic is alerted. */
export async function cancelByPatient(token: string, now: Date): Promise<"cancelled" | "not_allowed" | "not_found"> {
  const row = await findByToken(token);
  if (!row) return "not_found";
  const startsAt = new Date(row.starts_at);
  if (!isCancellable({ status: row.status, starts_at: startsAt }, now) || !canTransition(row.status, "cancelled", "patient")) {
    return "not_allowed";
  }

  const db = adminClient();
  // p_from makes this a compare-and-set: false when staff changed the status a moment ago.
  const { data: changed, error } = await db.rpc("set_appointment_status", {
    p_id: row.id,
    p_from: row.status,
    p_to: "cancelled",
    p_actor: "patient",
    p_user_id: null,
    p_reason: null,
  });
  if (error) throw error;
  if (!changed) return "not_allowed";

  const { count } = await db
    .from("dentists")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", row.clinic_id)
    .eq("active", true);
  await alertClinic({
    kind: "patient_cancel_alert",
    clinicId: row.clinic_id,
    appointmentId: row.id,
    first: row.patient.first_name,
    last: row.patient.last_name,
    startsAt,
    dentist: (count ?? 0) > 1 ? row.dentist.sms_name : null,
  });
  return "cancelled";
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/db/patient-link.test.ts`
Expected: PASS (7 tests).

If PostgREST answers `PGRST201` (more than one relationship found) for one of the embeds, name the foreign key in that embed, for example `patient:patients!appointments_patient_id_clinic_id_fkey(first_name, last_name)`, and run the test again.

- [ ] **Step 4: Write the cancel action**

Create `src/app/a/[token]/actions.ts`:

```ts
"use server";

import { refresh } from "next/cache";
import { cancelByPatient } from "@/lib/patient-link";

export async function cancelVisit(token: string): Promise<"cancelled" | "not_allowed" | "not_found" | "unavailable"> {
  try {
    const result = await cancelByPatient(String(token), new Date());
    // Re-render the page so it shows the new status and the Book again link.
    refresh();
    return result;
  } catch (e) {
    console.error("cancelVisit failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return "unavailable";
  }
}
```

- [ ] **Step 5: Write the cancel button**

Create `src/app/a/[token]/CancelButton.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { cancelVisit } from "./actions";

const PROBLEM = {
  not_allowed: "This visit can no longer be cancelled here. Please call the clinic.",
  not_found: "This link no longer works. Please call the clinic.",
  unavailable: "Cancelling is temporarily unavailable. Please try again in a few minutes.",
};

/** Spec 5.2: Cancel with a confirm step. */
export default function CancelButton({ token }: { token: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={() => setConfirming(true)}>
        Cancel this visit
      </button>
    );
  }

  return (
    <div className="note-box warn mt-6" role="group" aria-label="Confirm cancelling">
      <p>Cancel this visit? The clinic will be told, and the time goes back to other patients.</p>
      <div className="mt-3 flex gap-3">
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelVisit(token);
              if (result !== "cancelled") setError(PROBLEM[result]);
            })
          }
        >
          {pending ? "Cancelling..." : "Yes, cancel"}
        </button>
      </div>
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Write the page and its not-found**

Create `src/app/a/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import CancelButton from "./CancelButton";
import type { Status } from "@/lib/appointments";
import { loadPatientView } from "@/lib/patient-link";
import { localMobile } from "@/lib/phone";
import { formatDate, formatTime } from "@/lib/time";

// The status changes over time, so this page is never prerendered.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your appointment", robots: { index: false, follow: false } };

// Every status carries a word, never colour alone.
const STATUS: Record<Status, { word: string; chip: string }> = {
  pending: { word: "Waiting for the clinic", chip: "chip-amber" },
  confirmed: { word: "Confirmed", chip: "chip-green" },
  cancelled: { word: "Cancelled", chip: "chip-red" },
  declined: { word: "Declined", chip: "chip-red" },
  completed: { word: "Completed", chip: "chip-blue" },
  no_show: { word: "Missed", chip: "chip-red" },
  expired: { word: "Expired", chip: "chip-gold" },
};

type Params = { params: Promise<{ token: string }> };

/** Spec 5.2: the patient's view and cancel link. No login. */
export default async function PatientLinkPage({ params }: Params) {
  const { token } = await params;
  const view = await loadPatientView(token, new Date());
  if (!view) notFound();
  const status = STATUS[view.status];
  const phone = localMobile(view.clinicMobile);
  const rebook = view.status === "cancelled" || view.status === "declined" || view.status === "expired";

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Hi {view.firstName}</h1>
        <p className="sub">Your visit at {view.clinicName}</p>

        <div className="cf-box">
          <p className="big-time">{formatTime(view.startsAt)}</p>
          <p className="font-display text-[15px] font-semibold">{formatDate(view.startsAt)}</p>
          <p className="mt-3">
            <span className={`chip ${status.chip}`}>{status.word}</span>
          </p>
          <div className="mt-4">
            <div className="cf-row">
              <span className="k">With</span>
              <span className="v">{view.dentistName}</span>
            </div>
            <div className="cf-row">
              <span className="k">Clinic</span>
              <span className="v">{view.clinicName}</span>
            </div>
          </div>
        </div>

        {view.cancellable && <CancelButton token={token} />}
        {rebook && (
          <Link href={`/${view.slug}`} className="btn btn-primary wide-btn mt-6">
            Book again
          </Link>
        )}

        <p className="f-hint mt-4">
          Questions? Call{" "}
          <a href={`tel:${view.clinicMobile}`} className="link">
            {phone}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
```

Create `src/app/a/[token]/not-found.tsx`:

```tsx
/** An unknown or mistyped patient link. */
export default function PatientLinkNotFound() {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{"This link doesn't work"}</h1>
        <p className="sub">Check the text from your clinic, or call them.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Check lint, tests, and build**

Run:
```powershell
npm run lint; npm test; npm run build
```
Expected: no lint errors, all unit tests pass, the build lists `/a/[token]`.

- [ ] **Step 8: Cancel from the link**

With the dev server running, open the "View or cancel this request" link from Task 8 at phone width. Expect "Hi" and the patient's first name (no last name, no mobile), the date and time, "Waiting for the clinic", and the dentist. Press "Cancel this visit", then "Keep it", and expect nothing to change. Press "Cancel this visit", then "Yes, cancel": expect the chip to read "Cancelled", the Cancel button to disappear, and a "Book again" link to the clinic's page. The dev server output shows `[sms patient_cancel_alert] to +63...: Cancelled: ...`.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/patient-link.ts "src/app/a" tests/db/patient-link.test.ts; git commit -m "feat: add the patient view and cancel link"
```

---

### Task 10: Verify the deliverable end to end

**Files:** none changed unless a check fails. `.superpowers/` is gitignored scratch space.

**Interfaces:**
- Consumes: everything above.
- Produces: the Plan 2 deliverable, proven: a clinic signs up and receives a verified online request in development.

- [ ] **Step 1: Run every check**

Run:
```powershell
npm run lint; npm test; npm run test:db; npm run build
```
Expected: no lint errors, all unit tests pass, all database tests pass (Plan 1 files plus `clients`, `onboarding`, `sms`, `notify`, `availability`, `booking-service`, `patient-link`), and the build succeeds.

- [ ] **Step 2: Prepare a confirm helper (only when email confirmation is on)**

If Task 2 Step 1 said "Confirm email" is on and Kai can't open the email during the walk, create `.superpowers/confirm-user.mjs`:

```js
// Marks a development-project signup as confirmed, so the browser walk can continue without the email.
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("fmvqwojzsklinbdmfjkn")) throw new Error("Development project only.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;
const user = data.users.find((u) => u.email === email);
if (!user) throw new Error(`No user ${email}`);
await db.auth.admin.updateUserById(user.id, { email_confirm: true });
console.log(`confirmed ${email}`);
```

Use it with: `node --env-file=.env.local .superpowers/confirm-user.mjs <email>`

- [ ] **Step 3: Walk the whole flow in the browser at phone width**

1. preview_start with the `brightsmile` launch entry (port 3600), then resize_window with preset `mobile` (375 by 812).
2. **Sign up:** http://localhost:3600/signup with a fresh address (ask Kai for one) and a password of 8 or more characters. If "We sent a confirmation link" shows, open the link from the email, or run the Step 2 helper and then log in at `/login`. Expect `/onboarding`.
3. **Onboarding:** clinic "Plan Two Dental" (short name and link fill in), mobile `0917 000 0001`, any address; dentist "Dr. Ana Reyes" (short name "Dr. Reyes"), default hours; default procedures; "Create my booking link". Expect "Your link is ready" with `http://localhost:3600/plan-two-dental`.
4. **Book as a patient:** in a new tab with no staff session, open http://localhost:3600/plan-two-dental. Pick "Consultation", a day, and a time. Enter a name, a mobile such as `0918 555 0101`, tick consent, and send. Expect "Check your texts".
5. **Code:** read it with preview_logs, search `[sms otp]` (it is also in `sms_log`: `select body from sms_log where kind = 'otp' order by id desc limit 1` in the Supabase SQL Editor). Enter it. Expect "Request sent".
6. **Clinic receives it:** preview_logs shows `[sms request_alert] to +639170000001: New request: ...` (push reaches nobody until Plan 4, so the alert falls back to a text). In the staff tab, open http://localhost:3600/app and expect the request under "Waiting for you".
7. **Remembered device:** in the patient tab press "Book another time" and book another slot with the same mobile. Expect "Request sent" straight away, with no code step.
8. **Patient cancel:** press "View or cancel this request", then "Cancel this visit" and "Yes, cancel". Expect "Cancelled" and "Book again", and `[sms patient_cancel_alert]` in the logs. Reload `/app` in the staff tab and expect that request gone from "Waiting for you".
9. Take a screenshot of each screen at phone width. Check each against light and dark system themes (resize_window `colorScheme`).
10. Reset the viewport with resize_window preset `desktop`.

- [ ] **Step 4: Fix anything that failed, then commit**

If a check or a walk step failed, use superpowers:systematic-debugging to find the root cause, fix it, re-run Steps 1 and 3, and commit the fix with a message describing it. If everything passed, there is nothing to commit.

- [ ] **Step 5: Report**

Tell Kai: the test counts from Step 1, the screenshots from Step 3, anything that failed and how it was fixed, the Supabase Auth settings Task 2 needed, and that Plan 3 (the clinic dashboard) is next. Mention that the walk left a "Plan Two Dental" clinic and its test user in the development project.
