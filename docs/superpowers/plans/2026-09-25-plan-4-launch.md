# BrightSmile Plan 4: Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BrightSmile can go live: clinics get push alerts on an installed app, the daily job sends reminders and keeps the data tidy, visitors land on a real home page with a Privacy Notice and Terms, one browser test proves the whole booking loop, and the production build is hardened (security headers, noindex on private pages, a startup check of the environment) with a written deploy procedure.

**Architecture:** Push is two halves. The browser half is `public/sw.js` (shows the notification, opens `/app/requests` on tap), the manifest from `src/app/manifest.ts` (start URL `/app/requests`, standalone), and a `PushSetup` Client Component in Settings that registers the service worker, subscribes with the VAPID public key, and hands the subscription to a Server Action. The server half is `src/lib/push.ts`: subscriptions are validated (only real push services, so the server never posts to an arbitrary host), written through the staff member's RLS client, and read by `sendPush` through the secret-key client, because a patient's booking triggers the alert. `sendPush` never throws and returns how many devices got the alert, so `alertClinic` still falls back to a text. The daily job is a pure module (`src/lib/daily.ts`: bearer check, reminder window and selection, credit threshold) plus a server-only runner (`src/lib/daily-job.ts`) whose four steps are each idempotent and isolated, called by one Route Handler that Vercel Cron hits at 01:00 UTC. Reminders claim `reminder_sent_at` with a compare-and-set before texting, so a rerun never texts twice. Security headers live in a pure module imported by `next.config.ts` so a unit test can read them; the environment is checked once at server start in `src/instrumentation.ts`.

**Tech Stack:** Next.js 16.3 (App Router, Route Handlers, metadata file conventions, `instrumentation.ts`), React 19.2, TypeScript, Tailwind CSS 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Vitest 5, `web-push` 3.6 (new), `@playwright/test` (new, dev only).

**Spec:** `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md` (sections 5.4 step 4, 5.5, 10.4, 11, 12, 14, 15, and 16 drive this plan).

**Read before writing Next.js code** (this is Next.js 16 with breaking changes; the docs ship in `node_modules/next/dist/docs/`):

| Topic | File |
|---|---|
| PWA guide: manifest, web push with `web-push`, service worker, VAPID keys, `/sw.js` headers | `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md` |
| `manifest.ts` file convention (`MetadataRoute.Manifest`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md` |
| `robots.ts` file convention | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/robots.md` |
| Route Handlers (`GET` is dynamic by default since 15, `Response.json`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` |
| `maxDuration` segment config | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md` |
| Content Security Policy without nonces (`next.config` headers; `'unsafe-eval'` only in development) | `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` (section "Without Nonces") |
| `headers` in `next.config` | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` |
| `serverExternalPackages` | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` |
| `instrumentation.ts` `register` (runs once per server start; goes in `src/` with a `src` folder; `NEXT_RUNTIME`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` |
| Metadata `appleWebApp` and the `viewport` export (`themeColor`) | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`, `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` |
| Playwright with Next.js (`webServer`, `baseURL`) | `node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md` |
| Proxy matcher (unchanged here: it must keep skipping `/api/cron`, `/sw.js`, and `/manifest.webmanifest`) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` |

## Global Constraints

- No em dashes or en dashes anywhere: UI copy, docs, code comments, commit messages. Use commas, colons, periods, or parentheses.
- The shell is Windows PowerShell 5.1. Chain commands with `;` (there is no `&&`). Write multi-paragraph commit messages as repeated `-m` flags. Quote paths that contain parentheses or brackets, like `"src/app/(auth)"` and `"src/app/[slug]/BookingSheet.tsx"`.
- Commits written with Claude keep the `Co-Authored-By:` trailer the session adds (CONTRIBUTING.md). The commit commands in this plan leave it out; add your own. The repo's local git config already uses the GitHub no-reply email. Do not change it.
- Work on branch `plan-2-accounts-booking` (Plans 3 and 4 continue on it after Plan 2), one commit per task.
- Manila time is UTC+8 with no daylight saving. Never rely on the server's time zone (Vercel runs in UTC). Store `timestamptz`. Pass calendar dates as `"YYYY-MM-DD"` strings and clock times as minutes after midnight. The cron schedule `0 1 * * *` is 01:00 UTC, which is 9:00 AM Manila.
- Mobile numbers are stored as `+639XXXXXXXXX`. Semaphore gets `09XXXXXXXXX` (`localMobile`).
- Texts are printable ASCII, at most 160 characters with worst-case inputs (`renderSms` guarantees this for the field limits). **The limits assume an `APP_URL` host of at most 17 characters** (spec 10.1; `brightsmile.ph` is 14). `tests/unit/sms-templates.test.ts` already renders every template with a 17 character host and with the configured `APP_URL`; Task 7 adds a startup check that refuses to run with a longer host, so a long production domain can never silently turn texts into 2-part messages.
- `APP_URL` is the only source of the site's address (the production domain is not decided yet). It is an origin with no path and no trailing slash, like `https://brightsmile.ph`. Code builds links as `${APP_URL}/a/${token}`.
- `SMS_MODE=log` writes texts to `sms_log` with status `logged` and prints them to the server console (on Vercel it prints only the kind and length, already in place since commit f7841f8). Tests, local development, and the Playwright test always use `log`.
- Never log full patient details, codes, secrets, or environment values. Error logs carry where it failed and the error message only (`logError` in `src/lib/log.ts`).
- Staff reads and writes go through `requireStaff().db` (cookie-bound, RLS applies), including push subscriptions. The secret-key client (`adminClient`) is used only where no staff session exists: `sendSms`, the public booking flow, `sendPush` (a patient's booking triggers it), and the daily job. Nothing else.
- A text or a push that fails never fails the action that caused it (spec 13). `sendPush` never throws; `alertClinic` falls back to a text when no device got the push.
- Push payloads carry date, time, and dentist only, never a patient's name (spec 10.4). Tapping any notification opens `/app/requests`, whatever the payload says.
- The daily job's steps are idempotent (spec 11): reminders claim `reminder_sent_at` before texting; expiry is `expire_pending` (its own compare-and-set); cleanup deletes and nulls by age; the low credit text goes out at most once per 20 hours.
- Private pages send `X-Robots-Tag: noindex, nofollow`: `/app`, `/a/`, `/onboarding`, `/login`, `/signup`, `/forgot`, `/reset-password`, `/auth/`, `/api/`.
- UI: targets at least 44px, status never rests on colour alone, reuse the classes in `src/app/globals.css` (light only, cream canvas, white cards, teal primary). One primary button per screen.
- No database migrations in this plan. The applied schema already has `push_subscriptions` (with `clinic_id`, unique `endpoint`, and the policy "users manage their push subscriptions": own `user_id` and a member of `clinic_id`), `expire_pending()` (service_role only), `appointments.reminder_sent_at`, and `created_at` on `otp_requests` and `sms_log`.
- Database tests run only against the development project (`tests/db/helpers.ts` refuses anything else), and each test creates and removes its own clinics, users, and rows. The Playwright test imports the same helpers, so it has the same guard.
- Dev server port: 3600 (`.claude/launch.json` entry `brightsmile`).
- Dependencies added (each named in the PR with its reason): `web-push` (the spec names web-push with VAPID; it does the VAPID JWT signing and the RFC 8291 payload encryption, which is not a few lines of our own code), `@types/web-push` (dev; `web-push` ships no types), `@playwright/test` (dev; spec 14 asks for one Playwright test). Playwright browsers install to `D:\playwright-browsers` through `PLAYWRIGHT_BROWSERS_PATH`, because drive C: is nearly full.

## Plan map

1. Foundation (done).
2. Accounts and public booking (done).
3. Clinic dashboard (done).
4. **Launch readiness (this plan):** web push end to end, the daily job with Vercel Cron, landing and legal pages, the Playwright happy path, security headers and robots rules, the environment check, and the deploy procedure. Deliverable: the app is ready to deploy to production once Kai has the accounts, keys, and domain listed at the end.

## File map for this plan

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | `web-push`, `@types/web-push`, `@playwright/test`; scripts `test:e2e` and `test:e2e:install` |
| `src/lib/log.ts` | `logError(where, e)`: message only |
| `src/lib/push.ts` | Pure `pushPayload`, `parseSubscription` (push service allowlist); server `vapidSender`, `sendPush` (deletes 404 and 410), `saveSubscription`, `deleteSubscription` (RLS client) |
| `src/lib/notify.ts` | Uses `logError` |
| `public/sw.js` | Service worker: `push` shows the alert, `notificationclick` opens `/app/requests` |
| `src/app/manifest.ts` | Web app manifest: start URL `/app/requests`, standalone, icons |
| `public/brand/icon-192.png`, `public/brand/icon-512.png` | Manifest icons, resized from `public/brand/logo.png` |
| `src/app/layout.tsx` | `appleWebApp` metadata and `viewport.themeColor` |
| `src/components/PushSetup.tsx` | "Enable push on this device", state per device, iPhone home screen note |
| `src/app/app/settings/actions.ts` | `enablePush`, `disablePush` Server Actions |
| `src/app/app/settings/page.tsx`, `ClinicForms.tsx` | Push section (`#alerts`), updated alerts hint |
| `src/app/onboarding/Onboarding.tsx` | "Your link is ready" prompt that links to Settings alerts (a Server Action posted from `/onboarding` after the clinic exists would be redirected by the proxy, so the button lives in Settings) |
| `src/lib/sms/prepare.ts`, `src/lib/sms/send.ts` | Pure `readBalance`; `semaphoreBalance` (send.ts stays the one place that talks to Semaphore) |
| `src/lib/daily.ts` | Pure: `isCronAuthorized`, `reminderWindow`, `reminders`, `lowCreditThreshold`, `LOW_CREDIT_GAP_MS` |
| `src/lib/daily-job.ts` | Server: `sendReminders`, `expirePending`, `cleanup`, `checkCredit`, `runDailyJob` |
| `src/app/api/cron/daily/route.ts` | `GET`: bearer check, runs the job, JSON summary |
| `vercel.json` | Cron `0 1 * * *` on `/api/cron/daily` |
| `src/app/page.tsx` | Landing page (replaces the create-next-app default) |
| `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` | Draft Privacy Notice and Terms |
| `src/app/globals.css` | `.legal` class (the landing page reuses `.flow-wrap` and `.flow-card`) |
| `src/app/[slug]/BookingSheet.tsx` | Consent text links the Privacy Notice |
| `src/lib/security-headers.ts` | Pure: CSP and security headers, noindex rules, `/sw.js` headers |
| `next.config.ts` | `headers()`, `poweredByHeader: false`, `serverExternalPackages: ["web-push"]` |
| `src/app/robots.ts` | robots.txt |
| `src/lib/env.ts`, `src/instrumentation.ts` | Environment check at server start, names only |
| `.env.example`, `README.md` | Updated variables; Deploy and end-to-end sections |
| `playwright.config.ts`, `tests/e2e/booking.spec.ts` | The one Playwright test (spec 14) |
| `.gitignore`, `eslint.config.mjs` | Playwright output folders ignored |
| `tests/unit/push.test.ts`, `tests/unit/daily.test.ts`, `tests/unit/cron-route.test.ts`, `tests/unit/sms-prepare.test.ts`, `tests/unit/security-headers.test.ts`, `tests/unit/env.test.ts`, `tests/unit/routes.test.ts` | Unit tests |
| `tests/db/helpers.ts` | `signedInUser` and `staffClinic` also return the login |
| `tests/db/push.test.ts`, `tests/db/daily-job.test.ts` | Database tests |

## Tasks

1. Web push sender and subscriptions
2. Service worker, manifest, and "Enable push on this device"
3. Daily job services
4. Cron route and schedule
5. Landing, Privacy Notice, and Terms
6. Security headers and robots rules
7. Environment check, `.env.example`, and the deploy guide
8. Playwright happy path
9. Verify the deliverable end to end

---

### Task 1: Web push sender and subscriptions

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/lib/push.ts`, `src/lib/notify.ts`, `src/lib/supabase/admin.ts`, `tests/unit/push.test.ts`
- Create: `src/lib/log.ts`, `tests/db/push.test.ts`

**Interfaces:**
- Consumes: `adminClient` from `@/lib/supabase/admin`; `type Staff` from `@/lib/supabase/server`; `type Saved` from `@/lib/staff-input`; `formatDate`, `formatTime` from `@/lib/time`; `sendNotification` from `web-push`; table `push_subscriptions (id, clinic_id, user_id, endpoint unique, p256dh, auth, created_at)` with the RLS policy "users manage their push subscriptions".
- Produces:
  - `logError(where: string, e: unknown): void` from `@/lib/log`
  - From `@/lib/push` (server only): `type AlertKind`, `type PushPayload`, `pushPayload(kind, startsAt, dentist)` (unchanged), `type StoredSubscription = { endpoint: string; p256dh: string; auth: string }`, `type PushSend = (sub: StoredSubscription, body: string) => Promise<unknown>`, `parseSubscription(input: unknown): StoredSubscription | null`, `vapidSender(env?): PushSend | null`, `sendPush(clinicId: string, payload: PushPayload, send?: PushSend | null): Promise<number>`, `saveSubscription(staff: Staff, input: unknown): Promise<Saved>`, `deleteSubscription(staff: Staff, endpoint: unknown): Promise<Saved>`

Rules (spec 10.4, 13): a push goes to every subscription of the clinic; a 404 or 410 from the push service deletes that subscription; any other failure is logged and the subscription stays. `sendPush` never throws and returns how many devices accepted the push, so `alertClinic` texts the clinic when it returns 0. Without VAPID keys `sendPush` returns 0 before touching the database. A subscription is accepted only when its endpoint is an `https` URL on a known push service (Google FCM, Mozilla, Apple, Windows), so the server never posts to a host a browser made up.

- [ ] **Step 1: Install web-push**

Run: `npm install web-push@^3.6.7; npm install -D @types/web-push@^3.6.4`
Expected: both finish with `added N packages` and no `ERR!` lines. `package.json` now lists `"web-push"` under `dependencies` and `"@types/web-push"` under `devDependencies`.

- [ ] **Step 2: Add the shared error logger**

Create `src/lib/log.ts`:

```ts
/** Where it failed and the error message only: never patient details, codes, secrets, or push addresses (spec 12). */
export function logError(where: string, e: unknown): void {
  console.error(`${where} failed:`, String((e as { message?: unknown } | null)?.message ?? e));
}
```

- [ ] **Step 3: Write the failing unit tests**

Replace the whole of `tests/unit/push.test.ts` with:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { parseSubscription, pushPayload, sendPush, vapidSender } from "@/lib/push";
import { manilaInstant } from "@/lib/time";

const start = manilaInstant("2026-09-24", 600);
const keys = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };

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

describe("parseSubscription", () => {
  it("accepts the push services browsers use", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGx7",
      "https://wns2-sg2p.notify.windows.com/w/?token=BQYAAA",
    ]) {
      expect(parseSubscription({ endpoint, keys, expirationTime: null })).toEqual({ endpoint, ...keys });
    }
  });

  it("refuses endpoints that are not a known push service over https", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/fcm/send/abc",
      "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x",
      "https://notify.windows.com.evil.example/x",
      "not a url",
      `https://fcm.googleapis.com/${"a".repeat(1000)}`,
    ]) {
      expect(parseSubscription({ endpoint, keys })).toBeNull();
    }
  });

  it("refuses missing or malformed keys", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(parseSubscription({ endpoint })).toBeNull();
    expect(parseSubscription({ endpoint, keys: { ...keys, auth: "short" } })).toBeNull();
    expect(parseSubscription({ endpoint, keys: { ...keys, p256dh: "has spaces and is not base64url at all, sorry" } })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription("https://fcm.googleapis.com/fcm/send/abc")).toBeNull();
  });
});

describe("vapidSender and sendPush without keys", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("has no sender until all three VAPID values are set", () => {
    expect(vapidSender({})).toBeNull();
    expect(vapidSender({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k" })).toBeNull();
    expect(vapidSender({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k", VAPID_SUBJECT: "mailto:a@b.c" })).toBeTypeOf("function");
  });

  it("delivers to nobody without VAPID keys, so the alert falls back to a text", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await sendPush("any-clinic", pushPayload("request_alert", start, null))).toBe(0);
  });
});
```

Run: `npx vitest run tests/unit/push.test.ts`
Expected: FAIL, `parseSubscription` and `vapidSender` are not exported.

- [ ] **Step 4: Write the push module**

Replace the whole of `src/lib/push.ts` with:

```ts
import "server-only";
import * as webpush from "web-push";
import { logError } from "@/lib/log";
import type { Saved } from "@/lib/staff-input";
import { adminClient } from "@/lib/supabase/admin";
import type { Staff } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/time";

export type AlertKind = "request_alert" | "patient_cancel_alert";
export type PushPayload = { title: string; body: string; url: string };
export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };
export type PushSend = (sub: StoredSubscription, body: string) => Promise<unknown>;

/** Spec 10.4: date, time, and dentist only, never a patient's name. Tapping opens the requests page. */
export function pushPayload(kind: AlertKind, startsAt: Date, dentist: string | null): PushPayload {
  const when = `${formatDate(startsAt)}, ${formatTime(startsAt)}${dentist ? ` with ${dentist}` : ""}`;
  return { title: kind === "request_alert" ? "New booking request" : "Request cancelled", body: when, url: "/app/requests" };
}

// The push services of Chrome and Android (FCM), Firefox, Safari and iOS, and Edge on Windows.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * A browser's PushSubscription (as JSON) reduced to what we store, or null. Only https endpoints on a known
 * push service pass, so sendPush can never be pointed at an arbitrary host. p256dh is a 65 byte key (87
 * base64url characters) and auth is 16 bytes (22 characters), padding allowed.
 */
export function parseSubscription(input: unknown): StoredSubscription | null {
  if (typeof input !== "object" || input === null) return null;
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof endpoint !== "string" || endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (!PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (typeof p256dh !== "string" || !BASE64URL.test(p256dh) || p256dh.length < 86 || p256dh.length > 88) return null;
  if (typeof auth !== "string" || !BASE64URL.test(auth) || auth.length < 22 || auth.length > 24) return null;
  return { endpoint, p256dh, auth };
}

/** web-push with the VAPID keys, or null when they are not all set (every alert then falls back to a text). */
export function vapidSender(env: Record<string, string | undefined> = process.env): PushSend | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return (sub, body) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
      vapidDetails: { subject, publicKey, privateKey },
      TTL: 60 * 60,
      urgency: "high",
      timeout: 10_000,
    });
}

/** 404 and 410 mean the browser dropped the subscription (spec 10.4): delete it. */
function gone(e: unknown): boolean {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
}

/**
 * Sends a push to every subscription of the clinic and returns how many push services accepted it.
 * Uses the secret-key client because a patient's booking triggers it. Never throws (spec 13).
 */
export async function sendPush(clinicId: string, payload: PushPayload, send: PushSend | null = vapidSender()): Promise<number> {
  if (!send) return 0;
  try {
    const db = adminClient();
    const { data, error } = await db.from("push_subscriptions").select("endpoint, p256dh, auth").eq("clinic_id", clinicId);
    if (error) throw error;
    const subs = (data ?? []) as StoredSubscription[];
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map((sub) => send(sub, body)));
    const dropped: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") return;
      if (gone(r.reason)) dropped.push(subs[i].endpoint);
      else logError("sendPush", r.reason);
    });
    if (dropped.length > 0) {
      const { error: deleteError } = await db.from("push_subscriptions").delete().in("endpoint", dropped);
      if (deleteError) logError("sendPush cleanup", deleteError);
    }
    return results.filter((r) => r.status === "fulfilled").length;
  } catch (e) {
    logError("sendPush", e);
    return 0;
  }
}

const FAILED = "Something went wrong. Please try again.";

/**
 * Stores this device's subscription for the signed-in staff member, through their RLS client. The same
 * endpoint again (the browser re-subscribed) updates the keys in place.
 * ponytail: an endpoint already saved by another login on this browser fails RLS and shows FAILED; v1 has one login per clinic.
 */
export async function saveSubscription(staff: Staff, input: unknown): Promise<Saved> {
  const sub = parseSubscription(input);
  if (!sub) return { ok: false, error: "This browser gave an alert address BrightSmile can't use. Try Chrome or Safari." };
  const { error } = await staff.db
    .from("push_subscriptions")
    .upsert({ clinic_id: staff.clinicId, user_id: staff.userId, ...sub }, { onConflict: "endpoint" });
  if (error) {
    logError("saveSubscription", error);
    return { ok: false, error: FAILED };
  }
  return { ok: true };
}

/** Removes this device's subscription. RLS limits it to the staff member's own rows. */
export async function deleteSubscription(staff: Staff, endpoint: unknown): Promise<Saved> {
  if (typeof endpoint !== "string" || endpoint === "" || endpoint.length > 1000) return { ok: false, error: FAILED };
  const { error } = await staff.db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", staff.userId);
  if (error) {
    logError("deleteSubscription", error);
    return { ok: false, error: FAILED };
  }
  return { ok: true };
}
```

`import * as webpush` is the form `@types/web-push` types (named exports, no default). Task 6 adds `web-push` to `serverExternalPackages`, so Next loads it with `require` and the namespace is the CommonJS exports object. If `tsc` rejects an option name in `sendNotification`'s third argument, check `node_modules/@types/web-push/index.d.ts` (`RequestOptions`) and keep the same meaning: VAPID details per call, a one hour TTL, high urgency, a 10 second timeout.

Run: `npx vitest run tests/unit/push.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Use the shared logger in alertClinic and document the new admin client callers**

In `src/lib/notify.ts`, replace:

```ts
import { appUrl } from "@/lib/app-url";
```

with:

```ts
import { appUrl } from "@/lib/app-url";
import { logError } from "@/lib/log";
```

and replace:

```ts
    console.error("alertClinic failed", e instanceof Error ? e.message : e);
```

with:

```ts
    logError("alertClinic", e);
```

In `src/lib/supabase/admin.ts`, replace:

```ts
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes,
 * sms_log, and patient links. Staff pages use serverClient() so RLS applies.
```

with:

```ts
 * Secret-key client: bypasses RLS. Only for the public booking flow, verification codes,
 * sms_log, patient links, sendPush, and the daily job. Staff pages use serverClient() so RLS applies.
```

- [ ] **Step 6: Write the database test**

Create `tests/db/push.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteSubscription, pushPayload, saveSubscription, sendPush, type PushSend } from "@/lib/push";
import { adminDb, dropStaffClinic, rand, staffClinic, type StaffSeed } from "./helpers";

const db = adminDb();
const keys = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };
const endpoint = () => `https://fcm.googleapis.com/fcm/send/test-${rand()}${rand()}`;
const payload = pushPayload("request_alert", new Date(), null);
let a: StaffSeed;
let b: StaffSeed;

beforeAll(async () => {
  [a, b] = await Promise.all([staffClinic(), staffClinic()]);
});

afterAll(async () => {
  await Promise.all([dropStaffClinic(a), dropStaffClinic(b)]);
});

async function rowsFor(end: string) {
  const { data } = await db.from("push_subscriptions").select("clinic_id, user_id, p256dh").eq("endpoint", end).throwOnError();
  return data;
}

describe("saveSubscription and deleteSubscription", () => {
  it("stores this device for the signed-in staff member, once per endpoint", async () => {
    const end = endpoint();
    expect(await saveSubscription(a.staff, { endpoint: end, keys })).toEqual({ ok: true });
    const newKeys = { ...keys, p256dh: `B${"C".repeat(86)}` };
    expect(await saveSubscription(a.staff, { endpoint: end, keys: newKeys })).toEqual({ ok: true });
    expect(await rowsFor(end)).toEqual([{ clinic_id: a.staff.clinicId, user_id: a.staff.userId, p256dh: newKeys.p256dh }]);
  });

  it("refuses an endpoint that is not a push service", async () => {
    const result = await saveSubscription(a.staff, { endpoint: "https://evil.example/push", keys });
    expect(result.ok).toBe(false);
    expect(await rowsFor("https://evil.example/push")).toEqual([]);
  });

  it("keeps each clinic's subscriptions to itself (RLS)", async () => {
    const end = endpoint();
    await saveSubscription(a.staff, { endpoint: end, keys });
    const { error } = await a.staff.db
      .from("push_subscriptions")
      .insert({ clinic_id: b.staff.clinicId, user_id: a.staff.userId, endpoint: endpoint(), ...keys });
    expect(error).not.toBeNull();
    const { data: seen } = await b.staff.db.from("push_subscriptions").select("id").eq("endpoint", end);
    expect(seen).toEqual([]);
    expect(await deleteSubscription(b.staff, end)).toEqual({ ok: true });
    expect(await rowsFor(end)).toHaveLength(1);
    expect(await deleteSubscription(a.staff, end)).toEqual({ ok: true });
    expect(await rowsFor(end)).toEqual([]);
  });
});

describe("sendPush", () => {
  it("counts accepted pushes, deletes 404 and 410 subscriptions, and keeps the rest", async () => {
    const [ok, gone, missing, down] = [endpoint(), endpoint(), endpoint(), endpoint()];
    await db
      .from("push_subscriptions")
      .insert([ok, gone, missing, down].map((e) => ({ clinic_id: b.staff.clinicId, user_id: b.staff.userId, endpoint: e, ...keys })))
      .throwOnError();
    const bodies: string[] = [];
    const send: PushSend = async (sub, body) => {
      bodies.push(body);
      if (sub.endpoint === gone) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint === missing) throw Object.assign(new Error("Not found"), { statusCode: 404 });
      if (sub.endpoint === down) throw Object.assign(new Error("Server error"), { statusCode: 500 });
      return { statusCode: 201 };
    };
    expect(await sendPush(b.staff.clinicId, payload, send)).toBe(1);
    expect(bodies).toEqual(Array(4).fill(JSON.stringify(payload)));
    expect(await rowsFor(ok)).toHaveLength(1);
    expect(await rowsFor(down)).toHaveLength(1);
    expect(await rowsFor(gone)).toEqual([]);
    expect(await rowsFor(missing)).toEqual([]);
  });

  it("delivers to nobody without a sender or without subscriptions", async () => {
    expect(await sendPush(a.staff.clinicId, payload, null)).toBe(0);
    expect(await sendPush(a.staff.clinicId, payload, async () => ({}))).toBe(0);
  });
});
```

Run: `npx vitest run tests/db/push.test.ts`
Expected: PASS (5 tests). The "delivers to nobody" test runs after the RLS test removed clinic A's last row, so clinic A has no subscriptions.

- [ ] **Step 7: Check the rest still passes**

Run: `npx tsc --noEmit; npm test; npx vitest run tests/db/notify.test.ts`
Expected: `tsc` prints nothing; unit tests PASS; `notify.test.ts` PASS (its clinic has no subscriptions, so alerts still fall back to a text).

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json src/lib/log.ts src/lib/push.ts src/lib/notify.ts src/lib/supabase/admin.ts tests/unit/push.test.ts tests/db/push.test.ts
git commit -m "feat: send web push alerts to every clinic device" -m "Adds web-push with VAPID keys. Subscriptions are saved through the staff RLS client and only for known push services; 404 and 410 answers delete the subscription, and sendPush returns the delivered count so alerts still fall back to a text."
```

### Task 2: Service worker, manifest, and "Enable push on this device"

**Files:**
- Create: `public/sw.js`, `src/app/manifest.ts`, `public/brand/icon-192.png`, `public/brand/icon-512.png`, `src/components/PushSetup.tsx`
- Modify: `src/app/layout.tsx`, `src/app/app/settings/actions.ts`, `src/app/app/settings/page.tsx`, `src/app/app/settings/ClinicForms.tsx`, `src/app/onboarding/Onboarding.tsx`, `tests/unit/routes.test.ts`

**Interfaces:**
- Consumes: `saveSubscription`, `deleteSubscription` from `@/lib/push` (Task 1); `requireStaff` from `@/lib/supabase/server`; `type Saved` from `@/lib/staff-input`; `guardRedirect` from `@/lib/routes`.
- Produces: `enablePush(subscription: unknown): Promise<Saved>` and `disablePush(endpoint: unknown): Promise<Saved>` Server Actions in `src/app/app/settings/actions.ts`; default export `PushSetup` (no props) from `src/components/PushSetup.tsx`, rendering `<section id="alerts">`; `/sw.js`; `/manifest.webmanifest`.

Rules (spec 10.4, 5.4 step 4): the service worker shows every push (browsers require it) and a tap always opens `/app/requests`. The manifest starts at `/app/requests` in standalone mode. Settings explains that iPhone needs the app on the home screen (iOS 16.4 or later). The onboarding "Your link is ready" screen prompts for push with a link to Settings, because the permission prompt needs a tap and a Server Action posted from `/onboarding` after the clinic exists is redirected to `/app` by the proxy. The enable and disable actions do not call `refresh()`: nothing on the page reads subscriptions from the server.

- [ ] **Step 1: Pin that the proxy never guards the push and cron paths**

In `tests/unit/routes.test.ts`, add inside `describe("guardRedirect", ...)`, after the `/apple-icon.png` test:

```ts
  it("never guards the cron route, the service worker, or the manifest", () => {
    for (const path of ["/api/cron/daily", "/sw.js", "/manifest.webmanifest"]) {
      for (const visitor of [out, noClinic, staff]) expect(guardRedirect(path, visitor)).toBeNull();
    }
  });
```

Run: `npx vitest run tests/unit/routes.test.ts`
Expected: PASS (the proxy matcher in `src/proxy.ts` does not cover these paths either; leave it unchanged).

- [ ] **Step 2: Write the service worker**

Create `public/sw.js`:

```js
// BrightSmile service worker (spec 10.4): shows clinic alerts and opens the requests page on tap.
// It caches nothing: the dashboard always needs live data.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON: show the defaults below.
  }
  event.waitUntil(
    self.registration.showNotification(typeof data.title === "string" ? data.title : "BrightSmile", {
      body: typeof data.body === "string" ? data.body : "Open BrightSmile to see what changed.",
      icon: "/brand/icon-192.png",
      lang: "en",
    }),
  );
});

// Always the requests page, whatever the payload says, so a push can never open another site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/app/requests", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === target);
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
```

- [ ] **Step 3: Make the manifest icons**

Run: `node -e "const sharp = require('sharp'); Promise.all([192, 512].map((s) => sharp('public/brand/logo.png').resize(s, s).png().toFile('public/brand/icon-' + s + '.png'))).then(() => console.log('icons ok'))"`
Expected: `icons ok`, and `public/brand/icon-192.png` and `public/brand/icon-512.png` exist. (`sharp` is already installed as Next's image optimizer dependency; this is a one-off, not a new dependency.)

- [ ] **Step 4: Add the manifest and the home screen metadata**

Create `src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

/** Spec 10.4: the dashboard installs as an app that opens on the requests page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app/requests",
    name: "BrightSmile",
    short_name: "BrightSmile",
    description: "Booking requests and schedule for your dental clinic.",
    start_url: "/app/requests",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#12727e",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

In `src/app/layout.tsx`, replace:

```ts
import type { Metadata } from "next";
```

with:

```ts
import type { Metadata, Viewport } from "next";
```

and replace:

```ts
export const metadata: Metadata = {
  title: { default: "BrightSmile", template: "%s | BrightSmile" },
  description: "Online booking for dental clinics in the Philippines.",
};
```

with:

```ts
export const metadata: Metadata = {
  title: { default: "BrightSmile", template: "%s | BrightSmile" },
  description: "Online booking for dental clinics in the Philippines.",
  // iPhone: Add to Home Screen opens full screen, which iOS 16.4+ needs for web push (spec 10.4).
  appleWebApp: { capable: true, title: "BrightSmile", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#12727e" };
```

Next adds `<link rel="manifest" href="/manifest.webmanifest">` itself because `src/app/manifest.ts` exists, and `src/app/apple-icon.png` already gives the home screen icon.

- [ ] **Step 5: Add the push Server Actions**

In `src/app/app/settings/actions.ts`, replace:

```ts
import * as settings from "@/lib/clinic-settings";
```

with:

```ts
import * as settings from "@/lib/clinic-settings";
import { deleteSubscription, saveSubscription } from "@/lib/push";
```

and append to the end of the file:

```ts
/** This device's push subscription (spec 10.4). No refresh: nothing on the page reads it from the server. */
export async function enablePush(subscription: unknown): Promise<Saved> {
  const staff = await requireStaff();
  return saveSubscription(staff, subscription);
}

export async function disablePush(endpoint: unknown): Promise<Saved> {
  const staff = await requireStaff();
  return deleteSubscription(staff, endpoint);
}
```

- [ ] **Step 6: Write the push setup component**

Create `src/components/PushSetup.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush } from "@/app/app/settings/actions";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const FAILED = "This device could not turn on push. Try again, or keep text alerts.";

/** The VAPID public key as bytes, as pushManager.subscribe wants it (from the Next.js PWA guide). */
function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Where this device stands. A subscription the browser already has is saved again, so a row deleted
 * after a 410 (or never saved) heals itself when Settings opens.
 */
async function currentState(): Promise<State> {
  if (!KEY || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return "off";
  return (await enablePush(sub.toJSON())).ok ? "on" : "off";
}

/** Spec 10.4: "Enable push on this device", per device, with the iPhone home screen note. */
export default function PushSetup() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    currentState().then(
      (s) => {
        if (live) setState(s);
      },
      () => {
        if (live) setState("unsupported");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setWorking(true);
    setError("");
    try {
      // First, straight from the tap: iPhone only shows the prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }));
      const result = await enablePush(sub.toJSON());
      if (result.ok) setState("on");
      else setError(result.error);
    } catch {
      setError(FAILED);
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setWorking(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        const result = await disablePush(sub.endpoint);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section id="alerts" className="card card-pad settings-section">
      <h2 className="font-display">Alerts on this device</h2>
      {state === "checking" && <p className="f-hint">Checking this device...</p>}
      {state === "on" && (
        <>
          <p className="f-hint" role="status">
            <span className="chip chip-green">Push on</span> This device gets a push for each new request and cancellation.
          </p>
          <button type="button" className="btn btn-ghost mt-3" disabled={working} onClick={() => void turnOff()}>
            {working ? "Turning off..." : "Turn off push on this device"}
          </button>
        </>
      )}
      {state === "off" && (
        <>
          <p className="f-hint">Get a push on this phone or computer for each new request, even when BrightSmile is closed.</p>
          <button type="button" className="btn btn-soft mt-3" disabled={working} onClick={() => void turnOn()}>
            {working ? "Turning on..." : "Enable push on this device"}
          </button>
        </>
      )}
      {state === "blocked" && (
        <p className="note-box warn mt-3">
          Notifications are blocked for BrightSmile on this device. Allow them in your browser&apos;s site settings, then open this page again.
        </p>
      )}
      {state === "unsupported" && (
        <p className="note-box mt-3">Push isn&apos;t available in this browser, so alerts arrive by text.</p>
      )}
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
      <p className="f-hint mt-3">
        On iPhone or iPad (iOS 16.4 or later), push works only from the home screen app: open this page in Safari, tap Share, then Add to
        Home Screen, open BrightSmile from the new icon, and turn push on there.
      </p>
    </section>
  );
}
```

The effect sets state only in the promise callbacks, never synchronously, which keeps `react-hooks/set-state-in-effect` quiet.

- [ ] **Step 7: Put it in Settings and update the alerts hint**

In `src/app/app/settings/page.tsx`, replace:

```ts
import { appUrl } from "@/lib/app-url";
```

with:

```ts
import PushSetup from "@/components/PushSetup";
import { appUrl } from "@/lib/app-url";
```

and replace:

```tsx
      <RulesForm clinic={settings.clinic} />
```

with:

```tsx
      <RulesForm clinic={settings.clinic} />
      <PushSetup />
```

In `src/app/app/settings/ClinicForms.tsx`, replace:

```tsx
        <p className="f-hint">Push needs the installable app, which comes in a later update. Until a device turns push on, alerts arrive by text.</p>
```

with:

```tsx
        <p className="f-hint">
          Turn push on for each phone or computer under{" "}
          <a href="#alerts" className="link">
            Alerts on this device
          </a>
          . Until a device has it on, or when no device gets the push, alerts arrive by text.
        </p>
```

- [ ] **Step 8: Prompt for push on "Your link is ready"**

In `src/app/onboarding/Onboarding.tsx`, replace:

```tsx
            <p className="f-hint mt-4">
              <Link href={`/${input.slug}`} className="link">
                Open your booking page
              </Link>
            </p>
            <Link href="/app" className="btn btn-soft wide-btn mt-6">
```

with:

```tsx
            <p className="f-hint mt-4">
              <Link href={`/${input.slug}`} className="link">
                Open your booking page
              </Link>
            </p>
            <div className="note-box mt-6">
              <p className="font-semibold">Get new requests on this phone</p>
              <p className="mt-1">
                Turn on push alerts to see a request the moment a patient sends it.{" "}
                <Link href="/app/settings#alerts" className="link">
                  Turn on alerts
                </Link>
              </p>
            </div>
            <Link href="/app" className="btn btn-soft wide-btn mt-6">
```

- [ ] **Step 9: Check it builds and works in the browser**

Run: `npx tsc --noEmit; npm run lint; npm test`
Expected: `tsc` prints nothing, lint reports no errors, unit tests PASS.

Start the dev server (`.claude/launch.json` entry `brightsmile`, or `npm run dev`), then:

Run: `curl.exe -s http://localhost:3600/manifest.webmanifest; curl.exe -s -o NUL -w "%{http_code}" http://localhost:3600/sw.js`
Expected: the manifest JSON with `"start_url":"/app/requests"` and `"display":"standalone"`, then `200`.

In the browser at http://localhost:3600 (localhost counts as a secure context): log in as a development clinic, open Settings. The "Alerts on this device" section shows "Enable push on this device" when `.env.local` has the VAPID keys (otherwise "Push isn't available in this browser", which is correct). Click it, allow notifications, and see "Push on". In the Supabase dashboard (development project), `push_subscriptions` has one row for that clinic. Click "Turn off push on this device"; the row is gone. At phone width (375px) the section fits with no sideways scroll. Finish onboarding with a new account and see the "Get new requests on this phone" box; its link opens Settings at the alerts section.

- [ ] **Step 10: Commit**

```powershell
git add public/sw.js public/brand/icon-192.png public/brand/icon-512.png src/app/manifest.ts src/app/layout.tsx src/components/PushSetup.tsx src/app/app/settings/actions.ts src/app/app/settings/page.tsx src/app/app/settings/ClinicForms.tsx src/app/onboarding/Onboarding.tsx tests/unit/routes.test.ts
git commit -m "feat: let clinics turn on push per device and install the dashboard" -m "Adds the service worker (shows the alert, opens the requests page on tap), the web app manifest starting at /app/requests, the Settings section with the iPhone home screen note, and a push prompt on the onboarding finish screen."
```

### Task 3: Daily job services

**Files:**
- Create: `src/lib/daily.ts`, `src/lib/daily-job.ts`, `tests/unit/daily.test.ts`, `tests/db/daily-job.test.ts`
- Modify: `src/lib/sms/prepare.ts`, `src/lib/sms/send.ts`, `tests/unit/sms-prepare.test.ts`

**Interfaces:**
- Consumes: `needsReminder`, `type Status` from `@/lib/appointments`; `addDays`, `formatTime`, `manilaDate`, `manilaInstant` from `@/lib/time`; `appUrl` from `@/lib/app-url`; `logError` from `@/lib/log` (Task 1); `normalizeMobile` from `@/lib/phone`; `smsMode` from `@/lib/sms/prepare`; `sendSms` from `@/lib/sms/send`; `adminClient` from `@/lib/supabase/admin`; SQL `expire_pending() returns integer` (service_role only); the `reminder` and `low_credit` templates.
- Produces:
  - From `@/lib/daily` (pure): `isCronAuthorized(header: string | null, secret: string | undefined): boolean`, `reminderWindow(now: Date): { from: Date; to: Date }`, `type ReminderRow`, `type Reminder`, `reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date): Reminder[]`, `lowCreditThreshold(value?: string): number`, `LOW_CREDIT_GAP_MS`
  - `readBalance(body: unknown): number | null` from `@/lib/sms/prepare`; `semaphoreBalance(): Promise<number | null>` from `@/lib/sms/send`
  - From `@/lib/daily-job` (server only): `sendReminders(now: Date): Promise<number>`, `expirePending(): Promise<number>`, `cleanup(now: Date): Promise<{ codes: number; bodies: number }>`, `type CreditCheck`, `checkCredit(now: Date, balance?: () => Promise<number | null>, mode?: SmsMode): Promise<{ status: CreditCheck; balance: number | null }>`, `type DailySummary`, `runDailyJob(now: Date): Promise<DailySummary>`

Rules (spec 11): every step is idempotent and runs even when an earlier one failed.
1. Reminders: confirmed visits on tomorrow's Manila date, `reminder_sent_at` null, confirmed before today 00:00 Manila (`needsReminder`), with a patient mobile (deleted patients have none). The dentist is named only when the clinic has 2 or more active dentists. Each reminder first sets `reminder_sent_at` with a compare-and-set (`where reminder_sent_at is null and status = 'confirmed'`); only the run that wins the update sends the text. A text that then fails stays failed (`sms_log` records it and the schedule shows "Text not delivered"); it is never retried, because a retry could double text.
2. Expiry: `expire_pending()`.
3. Cleanup: delete `otp_requests` created more than 24 hours ago; set `sms_log.body` to null on rows older than 90 days (credits and status stay, spec 12).
4. Credit check, live mode only: read the Semaphore balance; below `SMS_LOW_CREDIT_THRESHOLD` (default 500) text `OPERATOR_MOBILE`, at most once per 20 hours (a non-failed `low_credit` row to that mobile in the last 20 hours means skip). An unreadable balance counts as a failed step, so the cron run shows red in Vercel.

- [ ] **Step 1: Write the failing unit tests for the pure rules**

Create `tests/unit/daily.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isCronAuthorized, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
import { manilaInstant } from "@/lib/time";

const SECRET = "s3cret-s3cret-s3cret-s3cret";

describe("isCronAuthorized", () => {
  it("accepts exactly the bearer header Vercel Cron sends", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
  });

  it("refuses a secret too short to be a real one", () => {
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
  });
});

describe("reminderWindow", () => {
  it("is tomorrow's Manila day, whatever the UTC date", () => {
    const window = { from: manilaInstant("2026-09-26", 0), to: manilaInstant("2026-09-27", 0) };
    expect(reminderWindow(manilaInstant("2026-09-25", 9 * 60))).toEqual(window); // the cron time, 01:00 UTC
    expect(reminderWindow(manilaInstant("2026-09-25", 30))).toEqual(window); // 00:30 Manila is still Sep 24 in UTC
    expect(reminderWindow(manilaInstant("2026-09-25", 23 * 60 + 59))).toEqual(window);
  });
});

describe("reminders", () => {
  const now = manilaInstant("2026-09-25", 9 * 60);
  const row: ReminderRow = {
    id: "a1",
    clinic_id: "c1",
    status: "confirmed",
    starts_at: manilaInstant("2026-09-26", 10 * 60).toISOString(),
    confirmed_at: manilaInstant("2026-09-24", 15 * 60).toISOString(),
    reminder_sent_at: null,
    manage_token: "AbCdEfGhIjKl",
    patient: { first_name: "Ana", mobile: "+639171112222", anonymized_at: null },
    dentist: { sms_name: "Dr. Reyes" },
    clinic: { sms_name: "Bright Dental" },
  };
  const one = new Map([["c1", 1]]);

  it("reminds tomorrow's confirmed visits, naming the dentist only for clinics with 2 or more", () => {
    const base = { appointmentId: "a1", clinicId: "c1", to: "+639171112222", token: "AbCdEfGhIjKl", clinic: "Bright Dental", first: "Ana", time: "10:00 AM" };
    expect(reminders([row], one, now)).toEqual([{ ...base, dentist: null }]);
    expect(reminders([row], new Map([["c1", 2]]), now)).toEqual([{ ...base, dentist: "Dr. Reyes" }]);
  });

  it("skips visits that are not due or have no one to text", () => {
    const skipped: ReminderRow[] = [
      { ...row, status: "pending" },
      { ...row, reminder_sent_at: manilaInstant("2026-09-25", 9 * 60).toISOString() },
      { ...row, confirmed_at: manilaInstant("2026-09-25", 8 * 60).toISOString() },
      { ...row, confirmed_at: null },
      { ...row, starts_at: manilaInstant("2026-09-27", 10 * 60).toISOString() },
      { ...row, patient: { first_name: "Ana", mobile: null, anonymized_at: null } },
      { ...row, patient: { first_name: "Deleted patient", mobile: "+639171112222", anonymized_at: "2026-09-20T00:00:00Z" } },
      { ...row, patient: null },
    ];
    expect(reminders(skipped, one, now)).toEqual([]);
  });
});

describe("lowCreditThreshold", () => {
  it("reads SMS_LOW_CREDIT_THRESHOLD and falls back to 500", () => {
    expect(lowCreditThreshold(undefined)).toBe(500);
    expect(lowCreditThreshold("")).toBe(500);
    expect(lowCreditThreshold("200")).toBe(200);
    expect(lowCreditThreshold(" 300 ")).toBe(300);
    expect(lowCreditThreshold("0")).toBe(0);
    expect(lowCreditThreshold("abc")).toBe(500);
    expect(lowCreditThreshold("-5")).toBe(500);
    expect(lowCreditThreshold("1.5")).toBe(500);
  });
});
```

In `tests/unit/sms-prepare.test.ts`, replace:

```ts
import { prepareSms, productionModeError, readSemaphoreReply, smsMode } from "@/lib/sms/prepare";
```

with:

```ts
import { prepareSms, productionModeError, readBalance, readSemaphoreReply, smsMode } from "@/lib/sms/prepare";
```

and append to the end of the file:

```ts
describe("readBalance", () => {
  it("reads credit_balance from Semaphore's account reply, as a number or a numeric string", () => {
    expect(readBalance({ account_id: 1, account_name: "BrightSmile", status: "Active", credit_balance: 1234 })).toBe(1234);
    expect(readBalance({ credit_balance: "99" })).toBe(99);
    expect(readBalance({ credit_balance: 0 })).toBe(0);
  });

  it("gives null for anything it can't read", () => {
    expect(readBalance({})).toBeNull();
    expect(readBalance({ credit_balance: "" })).toBeNull();
    expect(readBalance({ credit_balance: "lots" })).toBeNull();
    expect(readBalance("Unauthorized")).toBeNull();
    expect(readBalance(null)).toBeNull();
    expect(readBalance([{ credit_balance: 5 }])).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/daily.test.ts tests/unit/sms-prepare.test.ts`
Expected: FAIL, `@/lib/daily` does not exist and `readBalance` is not exported.

- [ ] **Step 2: Write the pure module and the balance reader**

Create `src/lib/daily.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";
import { needsReminder, type Status } from "@/lib/appointments";
import { addDays, formatTime, manilaDate, manilaInstant } from "@/lib/time";

/**
 * Spec 11: Vercel Cron sends `Authorization: Bearer {CRON_SECRET}`. Both sides are hashed first, so the
 * timing-safe compare works on equal lengths and leaks nothing about the secret's length.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || secret.length < 16) return false;
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

/** Tomorrow in Manila as instants, from its 00:00 up to (not including) the next day's 00:00. */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  const tomorrow = addDays(manilaDate(now), 1);
  return { from: manilaInstant(tomorrow, 0), to: manilaInstant(addDays(tomorrow, 1), 0) };
}

/** An appointments row as the daily job reads it, with the patient, dentist, and clinic joined. */
export type ReminderRow = {
  id: string;
  clinic_id: string;
  status: Status;
  starts_at: string;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
  manage_token: string;
  patient: { first_name: string; mobile: string | null; anonymized_at: string | null } | null;
  dentist: { sms_name: string } | null;
  clinic: { sms_name: string } | null;
};

export type Reminder = {
  appointmentId: string;
  clinicId: string;
  to: string;
  token: string;
  clinic: string;
  first: string;
  time: string;
  dentist: string | null;
};

const date = (value: string | null) => (value ? new Date(value) : null);

/**
 * Spec 11 step 1: needsReminder decides which visits are due; a patient without a mobile (or deleted)
 * gets nothing. Texts name the dentist only when the clinic has 2 or more active dentists (spec 10.1).
 */
export function reminders(rows: ReminderRow[], activeDentists: Map<string, number>, now: Date): Reminder[] {
  return rows.flatMap((r) => {
    const startsAt = new Date(r.starts_at);
    const due = needsReminder(
      { status: r.status, starts_at: startsAt, confirmed_at: date(r.confirmed_at), reminder_sent_at: date(r.reminder_sent_at) },
      now,
    );
    const patient = r.patient;
    if (!due || !patient || patient.anonymized_at || !patient.mobile || !r.clinic) return [];
    const named = (activeDentists.get(r.clinic_id) ?? 0) > 1 && r.dentist;
    return [
      {
        appointmentId: r.id,
        clinicId: r.clinic_id,
        to: patient.mobile,
        token: r.manage_token,
        clinic: r.clinic.sms_name,
        first: patient.first_name,
        time: formatTime(startsAt),
        dentist: named ? r.dentist!.sms_name : null,
      },
    ];
  });
}

/** The operator gets at most one low credit text per 20 hours, so a rerun of the job stays quiet. */
export const LOW_CREDIT_GAP_MS = 20 * 60 * 60 * 1000;

/** SMS_LOW_CREDIT_THRESHOLD as a whole number of credits, 500 when unset or not a whole number (spec 11). */
export function lowCreditThreshold(value: string | undefined = process.env.SMS_LOW_CREDIT_THRESHOLD): number {
  const text = value?.trim() ?? "";
  return /^\d+$/.test(text) ? Number(text) : 500;
}
```

In `src/lib/sms/prepare.ts`, append to the end of the file:

```ts
/** Semaphore's GET /account reply: credit_balance as a number or a numeric string, or null for anything else. */
export function readBalance(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const value = (body as { credit_balance?: unknown }).credit_balance;
  const credits = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(credits) ? credits : null;
}
```

In `src/lib/sms/send.ts`, replace:

```ts
import { prepareSms, productionModeError, readSemaphoreReply, smsMode, type SemaphoreReply } from "@/lib/sms/prepare";
```

with:

```ts
import { prepareSms, productionModeError, readBalance, readSemaphoreReply, smsMode, type SemaphoreReply } from "@/lib/sms/prepare";
```

and insert after the closing `}` of the `semaphore` function (before the `sendSms` doc comment):

```ts
/** The Semaphore credit balance (spec 11 credit check), or null when it can't be read. Never throws. */
export async function semaphoreBalance(): Promise<number | null> {
  const key = process.env.SEMAPHORE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${SEMAPHORE}/account?${new URLSearchParams({ apikey: key })}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return readBalance(await res.json());
  } catch {
    return null;
  }
}
```

The key travels in the query string because that is how Semaphore's account endpoint takes it; this URL is never logged.

Run: `npx vitest run tests/unit/daily.test.ts tests/unit/sms-prepare.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test for the four steps**

Create `tests/db/daily-job.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkCredit, cleanup, expirePending, sendReminders } from "@/lib/daily-job";
import { addDays, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { adminDb, appointmentRow, deleteClinic, seedClinic, type Seed } from "./helpers";

process.env.SMS_MODE = "log";
process.env.SMS_LOW_CREDIT_THRESHOLD = "500";
const db = adminDb();
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const today = manilaDate(now);
const yesterday = manilaInstant(addDays(today, -1), 600).toISOString();
const randomMobile = (prefix: string) => `+63${prefix}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
let seed: Seed;

beforeAll(async () => {
  seed = await seedClinic();
});

afterAll(async () => {
  await deleteClinic(seed.clinic.id);
});

/** A 30 minute visit for the seed clinic's patient and dentist. */
async function visit(start: Date, status: string, extra: Record<string, unknown> = {}) {
  const end = new Date(start.getTime() + 30 * 60_000);
  const { data } = await db
    .from("appointments")
    .insert({ ...appointmentRow(seed, start.toISOString(), end.toISOString(), status), ...extra })
    .select("id, manage_token")
    .single()
    .throwOnError();
  return data as { id: string; manage_token: string };
}

async function textsFor(appointmentId: string) {
  const { data } = await db.from("sms_log").select("kind, to_mobile, body").eq("appointment_id", appointmentId).throwOnError();
  return data;
}

describe("sendReminders", () => {
  it("texts tomorrow's confirmed visits once, even when the job runs twice", async () => {
    const start = manilaInstant(addDays(today, 1), 600);
    const due = await visit(start, "confirmed", { confirmed_at: yesterday });
    const confirmedToday = await visit(manilaInstant(addDays(today, 1), 720), "confirmed", { confirmed_at: now.toISOString() });

    await sendReminders(now);
    await sendReminders(now);

    expect(await textsFor(due.id)).toEqual([
      {
        kind: "reminder",
        to_mobile: seed.patient.mobile,
        body: `Seed Clinic: Reminder, Ana's visit is tomorrow at ${formatTime(start)}. Can't come? Cancel: ${process.env.APP_URL}/a/${due.manage_token}`,
      },
    ]);
    expect(await textsFor(confirmedToday.id)).toEqual([]);
    const { data } = await db.from("appointments").select("reminder_sent_at").eq("id", due.id).single().throwOnError();
    expect(data.reminder_sent_at).not.toBeNull();
  });

  it("names the dentist once the clinic has 2 active dentists", async () => {
    const { data: second } = await db
      .from("dentists")
      .insert({ clinic_id: seed.clinic.id, name: "Dr. Two", sms_name: "Dr. Two" })
      .select("id")
      .single()
      .throwOnError();
    const start = manilaInstant(addDays(today, 1), 840);
    const due = await visit(start, "confirmed", { confirmed_at: yesterday });

    await sendReminders(now);

    const [text] = await textsFor(due.id);
    expect(text.body).toContain(`tomorrow at ${formatTime(start)} with Dr. Seed. Can't come?`);
    await db.from("dentists").update({ active: false }).eq("id", second.id).throwOnError();
  });
});

describe("expirePending", () => {
  it("expires pending requests whose time has passed, with an event", async () => {
    const past = await visit(manilaInstant(addDays(today, -1), 600), "pending");
    expect(await expirePending()).toBeGreaterThanOrEqual(1);
    const { data: row } = await db.from("appointments").select("status").eq("id", past.id).single().throwOnError();
    expect(row.status).toBe("expired");
    const { data: events } = await db.from("appointment_events").select("from_status, to_status, actor").eq("appointment_id", past.id).throwOnError();
    expect(events).toEqual([{ from_status: "pending", to_status: "expired", actor: "system" }]);
    expect(await expirePending()).toBeGreaterThanOrEqual(0);
    const { data: again } = await db.from("appointment_events").select("id").eq("appointment_id", past.id).throwOnError();
    expect(again).toHaveLength(1);
  });
});

describe("cleanup", () => {
  it("deletes codes after 24 hours and wipes text bodies after 90 days", async () => {
    const mobile = randomMobile("917");
    const code = (created: Date) => ({
      id: randomUUID(),
      mobile,
      ip: "203.0.113.9",
      code_hash: "test",
      booking: {},
      created_at: created.toISOString(),
      expires_at: created.toISOString(),
    });
    await db.from("otp_requests").insert([code(new Date(now.getTime() - 25 * 60 * 60 * 1000)), code(now)]).throwOnError();
    const text = (created: Date) => ({
      clinic_id: seed.clinic.id,
      to_mobile: mobile,
      kind: "confirmed",
      body: "old text",
      credits: 1,
      status: "logged",
      created_at: created.toISOString(),
    });
    await db.from("sms_log").insert([text(new Date(now.getTime() - 91 * DAY)), text(now)]).throwOnError();

    const result = await cleanup(now);

    expect(result.codes).toBeGreaterThanOrEqual(1);
    expect(result.bodies).toBeGreaterThanOrEqual(1);
    const { data: codes } = await db.from("otp_requests").select("id").eq("mobile", mobile).throwOnError();
    expect(codes).toHaveLength(1);
    const { data: texts } = await db.from("sms_log").select("body, credits").eq("to_mobile", mobile).order("created_at").throwOnError();
    expect(texts).toEqual([
      { body: null, credits: 1 },
      { body: "old text", credits: 1 },
    ]);
    await db.from("otp_requests").delete().eq("mobile", mobile).throwOnError();
  });
});

describe("checkCredit", () => {
  const operator = randomMobile("918");
  const saved = process.env.OPERATOR_MOBILE;

  afterAll(async () => {
    if (saved === undefined) delete process.env.OPERATOR_MOBILE;
    else process.env.OPERATOR_MOBILE = saved;
    await db.from("sms_log").delete().eq("to_mobile", operator).throwOnError();
  });

  it("does nothing in log mode", async () => {
    expect(await checkCredit(now, async () => 0, "log")).toEqual({ status: "skipped", balance: null });
  });

  it("texts the operator once per 20 hours when credits run low", async () => {
    process.env.OPERATOR_MOBILE = operator;
    const low = async () => 12;
    expect(await checkCredit(now, low, "live")).toEqual({ status: "texted", balance: 12 });
    expect(await checkCredit(now, low, "live")).toEqual({ status: "recent", balance: 12 });
    const { data } = await db.from("sms_log").select("kind, status, body").eq("to_mobile", operator).throwOnError();
    expect(data).toEqual([
      { kind: "low_credit", status: "logged", body: "BrightSmile: Semaphore balance is 12 credits. Top up before reminders fail." },
    ]);
  });

  it("stays quiet above the threshold and reports a balance it can't read", async () => {
    expect(await checkCredit(now, async () => 5000, "live")).toEqual({ status: "ok", balance: 5000 });
    expect(await checkCredit(now, async () => null, "live")).toEqual({ status: "unknown", balance: null });
  });
});
```

`SMS_MODE=log` keeps `sendSms` from calling Semaphore even when `checkCredit` is told the mode is `live`: the test exercises the decision, the text is only logged.

Run: `npx vitest run tests/db/daily-job.test.ts`
Expected: FAIL, `@/lib/daily-job` does not exist.

- [ ] **Step 4: Write the job**

Create `src/lib/daily-job.ts`:

```ts
import "server-only";
import { appUrl } from "@/lib/app-url";
import { LOW_CREDIT_GAP_MS, lowCreditThreshold, reminders, reminderWindow, type ReminderRow } from "@/lib/daily";
import { logError } from "@/lib/log";
import { normalizeMobile } from "@/lib/phone";
import { smsMode, type SmsMode } from "@/lib/sms/prepare";
import { semaphoreBalance, sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_ROW =
  "id, clinic_id, status, starts_at, confirmed_at, reminder_sent_at, manage_token, patient:patients(first_name, mobile, anonymized_at), dentist:dentists(sms_name), clinic:clinics(sms_name)";

/**
 * Spec 11 step 1. Each reminder claims reminder_sent_at with a compare-and-set before its text goes out,
 * so a rerun or an overlapping run never texts twice. Returns how many reminders this run sent.
 * ponytail: one text at a time; batch with limited concurrency if a run nears maxDuration.
 */
export async function sendReminders(now: Date): Promise<number> {
  const db = adminClient();
  const { from, to } = reminderWindow(now);
  const { data, error } = await db
    .from("appointments")
    .select(REMINDER_ROW)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString());
  if (error) throw error;
  const rows = (data ?? []) as unknown as ReminderRow[];
  if (rows.length === 0) return 0;

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
    const { data: claimed, error: claimError } = await db
      .from("appointments")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", r.appointmentId)
      .eq("status", "confirmed")
      .is("reminder_sent_at", null)
      .select("id");
    if (claimError) {
      logError("sendReminders claim", claimError);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;
    await sendSms({
      kind: "reminder",
      to: r.to,
      clinicId: r.clinicId,
      appointmentId: r.appointmentId,
      vars: { clinic: r.clinic, first: r.first, time: r.time, dentist: r.dentist ?? undefined, link: `${app}/a/${r.token}` },
    });
    sent++;
  }
  return sent;
}

/** Spec 11 step 2: pending requests whose start has passed become expired, with an event (its own compare-and-set). */
export async function expirePending(): Promise<number> {
  const { data, error } = await adminClient().rpc("expire_pending");
  if (error) throw error;
  return data as number;
}

/** Spec 11 step 3 and spec 12 retention: codes go after 24 hours, text bodies after 90 days (cost records stay). */
export async function cleanup(now: Date): Promise<{ codes: number; bodies: number }> {
  const db = adminClient();
  const { count: codes, error: codeError } = await db
    .from("otp_requests")
    .delete({ count: "exact" })
    .lt("created_at", new Date(now.getTime() - DAY_MS).toISOString());
  if (codeError) throw codeError;
  const { count: bodies, error: bodyError } = await db
    .from("sms_log")
    .update({ body: null }, { count: "exact" })
    .lt("created_at", new Date(now.getTime() - 90 * DAY_MS).toISOString())
    .not("body", "is", null);
  if (bodyError) throw bodyError;
  return { codes: codes ?? 0, bodies: bodies ?? 0 };
}

export type CreditCheck = "skipped" | "ok" | "texted" | "recent" | "unknown";

/**
 * Spec 11 step 4, live mode only: below SMS_LOW_CREDIT_THRESHOLD, text OPERATOR_MOBILE, at most once per
 * 20 hours. "unknown" (balance unreadable or no valid operator mobile) makes the run report a failure.
 */
export async function checkCredit(
  now: Date,
  balance: () => Promise<number | null> = semaphoreBalance,
  mode: SmsMode = smsMode(),
): Promise<{ status: CreditCheck; balance: number | null }> {
  if (mode !== "live") return { status: "skipped", balance: null };
  const credits = await balance();
  if (credits === null) {
    logError("checkCredit", "the Semaphore balance could not be read");
    return { status: "unknown", balance: null };
  }
  if (credits >= lowCreditThreshold()) return { status: "ok", balance: credits };
  const operator = normalizeMobile(process.env.OPERATOR_MOBILE ?? "");
  if (!operator) {
    logError("checkCredit", "OPERATOR_MOBILE is not a Philippine mobile number");
    return { status: "unknown", balance: credits };
  }
  const { data, error } = await adminClient()
    .from("sms_log")
    .select("id")
    .eq("kind", "low_credit")
    .eq("to_mobile", operator)
    .neq("status", "failed")
    .gte("created_at", new Date(now.getTime() - LOW_CREDIT_GAP_MS).toISOString())
    .limit(1);
  if (error) throw error;
  if ((data ?? []).length > 0) return { status: "recent", balance: credits };
  await sendSms({ kind: "low_credit", to: operator, clinicId: null, vars: { credits } });
  return { status: "texted", balance: credits };
}

type Failed = "failed";
export type DailySummary = {
  ok: boolean;
  reminders: number | Failed;
  expired: number | Failed;
  cleaned: { codes: number; bodies: number } | Failed;
  credit: { status: CreditCheck; balance: number | null } | Failed;
};

/** One step's result, or "failed" after logging where and why. A failed step never stops the next one. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T | Failed> {
  try {
    return await run();
  } catch (e) {
    logError(`daily job ${name}`, e);
    return "failed";
  }
}

/** Spec 11, in order. Counts only: the summary carries no patient details. */
export async function runDailyJob(now: Date): Promise<DailySummary> {
  const sent = await step("reminders", () => sendReminders(now));
  const expired = await step("expiry", () => expirePending());
  const cleaned = await step("cleanup", () => cleanup(now));
  const credit = await step("credit check", () => checkCredit(now));
  const failed = [sent, expired, cleaned, credit].includes("failed") || (credit !== "failed" && credit.status === "unknown");
  return { ok: !failed, reminders: sent, expired, cleaned, credit };
}
```

Run: `npx vitest run tests/db/daily-job.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Check the rest still passes**

Run: `npx tsc --noEmit; npm test`
Expected: `tsc` prints nothing; unit tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/daily.ts src/lib/daily-job.ts src/lib/sms/prepare.ts src/lib/sms/send.ts tests/unit/daily.test.ts tests/unit/sms-prepare.test.ts tests/db/daily-job.test.ts
git commit -m "feat: add the daily job steps for reminders, expiry, cleanup, and credits" -m "Reminders claim reminder_sent_at before texting so a rerun never texts twice. Cleanup follows the retention rules (codes after 24 hours, text bodies after 90 days), and the credit check texts the operator at most once per 20 hours."
```

### Task 4: Cron route and schedule

**Files:**
- Create: `src/app/api/cron/daily/route.ts`, `vercel.json`, `tests/unit/cron-route.test.ts`

**Interfaces:**
- Consumes: `isCronAuthorized` from `@/lib/daily`, `runDailyJob`, `type DailySummary` from `@/lib/daily-job` (Task 3).
- Produces: `GET /api/cron/daily`: 401 `{"error":"Unauthorized"}` without the right bearer header; otherwise the `DailySummary` JSON with status 200 when every step succeeded and 500 when any failed (so Vercel's cron log shows the failure). Vercel Cron calls it at `0 1 * * *` (01:00 UTC, 9:00 AM Manila) and sends `Authorization: Bearer {CRON_SECRET}` on its own once `CRON_SECRET` is set in the project.

The handler reads the request's headers, so it is dynamic (and `GET` handlers are not cached by default since Next 15, see `route.md`). `maxDuration = 300` gives the reminder loop room; Vercel's limit with Fluid compute allows it on both Hobby and Pro.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cron-route.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/daily/route";

const saved = process.env.CRON_SECRET;

afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("GET /api/cron/daily", () => {
  it("refuses a request without the cron secret, before touching anything", async () => {
    process.env.CRON_SECRET = "a-long-enough-cron-secret";
    const res = await GET(new Request("http://localhost/api/cron/daily"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    const wrong = await GET(new Request("http://localhost/api/cron/daily", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });

  it("refuses everyone when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request("http://localhost/api/cron/daily", { headers: { authorization: "Bearer undefined" } }));
    expect(res.status).toBe(401);
  });
});
```

Run: `npx vitest run tests/unit/cron-route.test.ts`
Expected: FAIL, the route module does not exist.

- [ ] **Step 2: Write the route handler**

Create `src/app/api/cron/daily/route.ts`:

```ts
import { isCronAuthorized } from "@/lib/daily";
import { runDailyJob } from "@/lib/daily-job";

// Room for a day's reminders, one text at a time (see sendReminders).
export const maxDuration = 300;

/** Spec 11: Vercel Cron at 01:00 UTC (9:00 AM Manila) with Authorization: Bearer {CRON_SECRET}. */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runDailyJob(new Date());
  return Response.json(summary, { status: summary.ok ? 200 : 500 });
}
```

Run: `npx vitest run tests/unit/cron-route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Schedule it**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/daily", "schedule": "0 1 * * *" }]
}
```

Vercel runs cron jobs on production deployments only, so previews never send reminders.

- [ ] **Step 4: Call it on the dev server**

Start the dev server if it is not running. Then, in PowerShell:

Run: `curl.exe -s -i http://localhost:3600/api/cron/daily`
Expected: `HTTP/1.1 401 Unauthorized` and `{"error":"Unauthorized"}`.

Run: `$s = (Select-String -Path .env.local -Pattern '^CRON_SECRET=(.+)$').Matches[0].Groups[1].Value; curl.exe -s -H "Authorization: Bearer $s" http://localhost:3600/api/cron/daily`
Expected: JSON like `{"ok":true,"reminders":0,"expired":0,"cleaned":{"codes":3,"bodies":0},"credit":{"status":"skipped","balance":null}}` (numbers vary; `credit` is `skipped` because development uses `SMS_MODE=log`). Run it again: `reminders` is `0` the second time. If `.env.local` has no `CRON_SECRET` of at least 16 characters, both calls return 401: generate one with the command in `.env.example`, restart the dev server, and repeat.

- [ ] **Step 5: Commit**

```powershell
git add src/app/api/cron/daily/route.ts vercel.json tests/unit/cron-route.test.ts
git commit -m "feat: run the daily job from Vercel Cron at 9:00 AM Manila" -m "The route checks the cron bearer token with a timing-safe compare and answers 500 when any step failed, so a bad run shows in the Vercel cron log."
```

### Task 5: Landing, Privacy Notice, and Terms

**Files:**
- Modify: `src/app/page.tsx` (replace the create-next-app default), `src/app/globals.css`, `src/app/[slug]/BookingSheet.tsx`
- Create: `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_CONTACT_EMAIL` (inlined at build); existing classes `.flow-wrap`, `.flow-card`, `.sub`, `.btn`, `.btn-primary`, `.btn-soft`, `.wide-btn`, `.link`, `.note-box`, `.brand-lockup`, `.f-hint`.
- Produces: pages `/`, `/privacy`, `/terms`; CSS class `.legal`.

Rules (spec 5.5, 12, 16): the landing page is one screen: what BrightSmile does, a link to the demo clinic at `/demo` (a real clinic Kai creates through onboarding before launch), Sign up (the one primary button), Log in. `/privacy` and `/terms` are drafts, and each says so at the top in a warning box, because a lawyer must review them before real patient data arrives (spec 16). They state that the clinic is the personal information controller and BrightSmile its processor (RA 10173), the retention periods the code enforces (codes 24 hours, text bodies 90 days, cost records kept, deleted patients anonymized), and the contact address from `NEXT_PUBLIC_CONTACT_EMAIL`. Anything a lawyer or Kai must decide is written in square brackets, so it can't pass for final text. The booking consent line links to the Privacy Notice in a new tab, so a patient mid-booking keeps their place.

- [ ] **Step 1: Write the landing page**

Replace the whole of `src/app/page.tsx` with:

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "BrightSmile: online booking for dental clinics" },
  description: "One booking link for your clinic's Facebook page. Patients request open times, you approve, and BrightSmile texts the confirmation and a reminder.",
};

const POINTS = [
  "Patients pick a time that is really open, from their phone, with no app or account.",
  "You approve or decline each request in one tap, with a push or a text when one arrives.",
  "BrightSmile texts the confirmation and a reminder the day before, so fewer patients forget.",
];

/** Spec 5.5: one screen. What BrightSmile does, the demo clinic, Sign up, Log in. */
export default function Home() {
  return (
    <main className="flow-wrap">
      <div className="flow-card screen-in">
        <p className="brand-lockup">
          <Image src="/brand/logo.png" alt="" width={28} height={28} priority />
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </p>
        <h1 className="font-display mt-5">Online booking for your dental clinic</h1>
        <p className="sub">Share one link on your Facebook page and in Messenger. Patients request a time, and you stay in charge of the schedule.</p>
        <ul className="grid gap-3">
          {POINTS.map((point) => (
            <li key={point} className="flex gap-3">
              <span aria-hidden="true" className="font-bold text-primary">
                ✓
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <Link href="/signup" className="btn btn-primary wide-btn mt-6">
          Sign up your clinic
        </Link>
        <Link href="/demo" className="btn btn-soft wide-btn mt-3">
          Try the demo booking page
        </Link>
        <p className="f-hint mt-4 text-center">
          Already using BrightSmile?{" "}
          <Link href="/login" className="link">
            Log in
          </Link>
        </p>
      </div>
      <p className="f-hint mt-5 text-center">
        <Link href="/privacy" className="link">
          Privacy Notice
        </Link>
        {" · "}
        <Link href="/terms" className="link">
          Terms of Service
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Add the legal page styles**

In `src/app/globals.css`, insert before the line `.screen-in {`:

```css
.legal h2 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  margin: 26px 0 8px;
}
.legal p,
.legal li {
  line-height: 1.6;
}
.legal p + p {
  margin-top: 10px;
}
.legal ul {
  list-style: disc;
  padding-left: 20px;
  display: grid;
  gap: 6px;
  margin-top: 8px;
}
```

- [ ] **Step 3: Write the Privacy Notice draft**

Create `src/app/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Notice" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Spec 12 and 16: draft Privacy Notice. A lawyer reviews it before real patient data arrives. */
export default function PrivacyPage() {
  const contact = CONTACT ? (
    <a href={`mailto:${CONTACT}`} className="link">
      {CONTACT}
    </a>
  ) : (
    "[contact email]"
  );
  return (
    <main className="flow-wrap">
      <article className="flow-card legal">
        <p className="note-box warn" role="note">
          Draft for legal review. This notice is not final and may change before BrightSmile opens to the public.
        </p>
        <h1 className="font-display mt-5">Privacy Notice</h1>
        <p className="f-hint">Last updated: [date of final version]</p>

        <h2>Who is responsible for your data</h2>
        <p>
          BrightSmile is online booking software for dental clinics in the Philippines. When you book with a clinic through
          BrightSmile, that clinic is the personal information controller for your details under the Data Privacy Act of 2012 (Republic
          Act No. 10173). BrightSmile processes your details on the clinic&apos;s behalf, as its personal information processor, and only
          to run the booking service for that clinic.
        </p>

        <h2>What we collect</h2>
        <p>From patients who book online:</p>
        <ul>
          <li>First and last name, and mobile number.</li>
          <li>The procedures you choose and the time you ask for. These can say something about your health, so we treat them as sensitive personal information.</li>
          <li>Your birthday and HMO provider, only if you give them.</li>
          <li>When you agreed to this notice.</li>
          <li>
            A one-time verification code (we keep only a scrambled form of it), your internet address to stop repeated code requests,
            and a cookie that remembers a verified mobile number on your device for 180 days.
          </li>
        </ul>
        <p>From clinic staff: email address, password (stored scrambled by our login provider), the clinic&apos;s details, and a push notification address for each device that turns on alerts.</p>

        <h2>Why we use it</h2>
        <ul>
          <li>To send your request to the clinic and let the clinic confirm, move, or cancel it.</li>
          <li>To text you the verification code, the clinic&apos;s answer, changes, and a reminder the day before your visit.</li>
          <li>To give you a private link where you can view or cancel your visit.</li>
          <li>To keep the service safe, for example by limiting how many codes one number can request.</li>
        </ul>
        <p>We do not sell your data, show ads, or send marketing texts.</p>

        <h2>Who else handles it</h2>
        <p>BrightSmile uses these service providers, each only for the job described:</p>
        <ul>
          <li>Supabase: database and staff logins. [Confirm the server region of the production project.]</li>
          <li>Vercel: hosting of the website.</li>
          <li>Semaphore: delivery of text messages in the Philippines.</li>
          <li>
            Google, Apple, Mozilla, or Microsoft, when clinic staff turn on push alerts: they deliver the alert to the staff member&apos;s
            device. Alerts carry the date, time, and dentist only, never a patient&apos;s name.
          </li>
        </ul>
        <p>Some of these providers may store data outside the Philippines. [Legal review: cross-border transfer wording.]</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Verification codes: deleted after 24 hours.</li>
          <li>The words of text messages: erased after 90 days. A record that a text was sent, and its cost, is kept for billing.</li>
          <li>
            Patient records and appointments: kept while the clinic uses BrightSmile. When the clinic deletes a patient, the name becomes
            &quot;Deleted patient&quot; and the mobile number, birthday, and HMO are erased; the visits stay only as counts.
          </li>
          <li>A clinic&apos;s whole account: deleted when the clinic asks us to.</li>
        </ul>

        <h2>How we protect it</h2>
        <p>
          All traffic is encrypted. Each clinic sees only its own patients, which our database enforces. Codes are stored scrambled,
          and the database is backed up daily. [Legal review: list of organizational measures.]
        </p>

        <h2>Your rights</h2>
        <p>
          Under the Data Privacy Act you have the right to be informed, to access your data, to object, to have it corrected, erased,
          or blocked, to data portability, and to damages, and you may complain to the National Privacy Commission. Because the clinic
          controls your data, please contact the clinic first; BrightSmile helps the clinic answer. You can also write to us at {contact}.
        </p>

        <h2>Changes</h2>
        <p>If this notice changes, we update this page and its date.</p>

        <p className="mt-6">
          <Link href="/" className="link">
            Back to BrightSmile
          </Link>
        </p>
      </article>
    </main>
  );
}
```

- [ ] **Step 4: Write the Terms of Service draft**

Create `src/app/terms/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Spec 16: draft Terms of Service with the data processing terms for clinics. A lawyer reviews it before launch. */
export default function TermsPage() {
  const contact = CONTACT ? (
    <a href={`mailto:${CONTACT}`} className="link">
      {CONTACT}
    </a>
  ) : (
    "[contact email]"
  );
  return (
    <main className="flow-wrap">
      <article className="flow-card legal">
        <p className="note-box warn" role="note">
          Draft for legal review. These terms are not final and may change before BrightSmile opens to the public.
        </p>
        <h1 className="font-display mt-5">Terms of Service</h1>
        <p className="f-hint">Last updated: [date of final version]</p>

        <h2>The service</h2>
        <p>
          BrightSmile gives a dental clinic a public booking page, a dashboard to approve and manage visits, and text messages and
          alerts about those visits. These terms are between BrightSmile [legal name and address of the business] and the clinic that
          signs up.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>Each clinic has one login in this version. Keep the password private; you are responsible for what happens under it.</li>
          <li>Give accurate clinic details, hours, and mobile number. Patients rely on them.</li>
          <li>Use BrightSmile only to take and manage appointments for your clinic.</li>
        </ul>

        <h2>Patient data: our data processing terms</h2>
        <p>
          You are the personal information controller for your patients&apos; data, and BrightSmile is your personal information
          processor under the Data Privacy Act of 2012. BrightSmile:
        </p>
        <ul>
          <li>Processes patient data only to run the booking service for you, and only as these terms and your use of the dashboard instruct.</li>
          <li>Keeps it confidential and limits access to people and systems that need it to run the service.</li>
          <li>Protects it with the measures described in the Privacy Notice.</li>
          <li>Uses only the service providers listed in the Privacy Notice, and tells you before adding a new one.</li>
          <li>Tells you without undue delay, and within 72 hours of finding out, about a personal data breach affecting your patients.</li>
          <li>Helps you answer patients who use their rights (access, correction, erasure, and the others in the Privacy Notice).</li>
          <li>Deletes your patients&apos; data, or gives you a copy first, when you close your account.</li>
          <li>Keeps codes for 24 hours and the words of text messages for 90 days, as the Privacy Notice says.</li>
        </ul>
        <p>
          You are responsible for having a lawful basis for the data you collect, for asking patients for consent where the law needs it
          (the booking page asks every patient), and for answering your patients&apos; requests. [Legal review: full data processing
          agreement wording and NPC registration.]
        </p>

        <h2>Texts and alerts</h2>
        <p>
          BrightSmile sends texts through a Philippine text gateway and push alerts through the device maker&apos;s service. We work
          to deliver every message, but delivery is not guaranteed. The dashboard shows when a text was not delivered so you can call
          the patient. Check your dashboard for new requests.
        </p>

        <h2>Fees</h2>
        <p>[To be decided before launch: price, text allowance, billing, and notice before any change.]</p>

        <h2>Availability</h2>
        <p>
          We aim to keep BrightSmile running at all times but cannot promise it will never be interrupted, for example during
          maintenance or a provider outage.
        </p>

        <h2>Ending</h2>
        <p>
          You can stop using BrightSmile at any time and ask us to delete your clinic&apos;s account. We may suspend an account that
          misuses the service, for example by sending texts that are not about appointments or by booking on behalf of people without
          their consent.
        </p>

        <h2>Liability</h2>
        <p>[Legal review: limitation of liability and warranties.]</p>

        <h2>Law and contact</h2>
        <p>These terms are governed by the laws of the Philippines. Questions: {contact}.</p>

        <p className="mt-6">
          <Link href="/" className="link">
            Back to BrightSmile
          </Link>
        </p>
      </article>
    </main>
  );
}
```

- [ ] **Step 5: Link the Privacy Notice from the booking consent**

In `src/app/[slug]/BookingSheet.tsx`, replace:

```tsx
                    I agree to {clinic.name} and BrightSmile using my details to manage this appointment, as described in the
                    Privacy Notice.
```

with:

```tsx
                    I agree to {clinic.name} and BrightSmile using my details to manage this appointment, as described in the{" "}
                    <a href="/privacy" target="_blank" rel="noopener" className="link">
                      Privacy Notice
                    </a>
                    .
```

A plain `<a>` with `target="_blank"` opens the notice in a new tab and leaves the booking in progress untouched. Clicking a link inside a `<label>` follows the link and does not tick the box.

- [ ] **Step 6: Check it**

Run: `npx tsc --noEmit; npm run lint`
Expected: `tsc` prints nothing, lint reports no errors.

With the dev server running, open http://localhost:3600: one card with the BrightSmile mark, the headline, three points, "Sign up your clinic" (teal), "Try the demo booking page", and "Log in"; the footer links open `/privacy` and `/terms`, each with the yellow draft box on top and "Back to BrightSmile" at the bottom. `/demo` shows the "This booking link doesn't exist" page until Kai creates the demo clinic; that is expected. On a clinic's booking page, go to the Who step: "Privacy Notice" in the consent line is a link that opens in a new tab and the checkbox stays as it was. Check all four pages at 375px width: no sideways scroll, text readable.

- [ ] **Step 7: Commit**

```powershell
git add src/app/page.tsx src/app/globals.css src/app/privacy/page.tsx src/app/terms/page.tsx "src/app/[slug]/BookingSheet.tsx"
git commit -m "feat: add the landing page and draft Privacy Notice and Terms" -m "The legal pages are marked as drafts for legal review. They name the clinic as controller and BrightSmile as processor, and state the retention periods the code enforces. The booking consent now links the Privacy Notice."
```

### Task 6: Security headers and robots rules

**Files:**
- Create: `src/lib/security-headers.ts`, `src/app/robots.ts`, `tests/unit/security-headers.test.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Produces: from `@/lib/security-headers` (pure, imported by `next.config.ts` with a relative path): `type HeaderRule = { source: string; headers: { key: string; value: string }[] }`, `contentSecurityPolicy(dev: boolean, https: boolean): string`, `securityHeaders(opts: { dev: boolean; https: boolean }): HeaderRule[]`, `NOINDEX_SOURCES: string[]`, `ROBOTS_DISALLOW: string[]`; `/robots.txt`.

Rules:
- Every response: a Content-Security-Policy without nonces as in the Next CSP guide ("Without Nonces"): `'unsafe-inline'` scripts because Next's own bootstrap scripts are inline and nonces would force every page to render dynamically; `'unsafe-eval'` only under `next dev`; `worker-src 'self'` and `manifest-src 'self'` for the service worker and manifest; `frame-ancestors 'none'`. Plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (older browsers), `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment, and USB.
- Only on Vercel (`VERCEL=1` at build time, always HTTPS): `Strict-Transport-Security: max-age=63072000; includeSubDomains` and `upgrade-insecure-requests`. A local `npm start` over plain http would break with either, so they stay off there. No `preload`: the production domain is not chosen yet.
- `X-Robots-Tag: noindex, nofollow` on the private paths in Global Constraints. robots.txt disallows the same areas, written so no prefix can catch a clinic's booking link (for example `/app/` and `/a/` with the slash, so `/apple-dental` and `/apple-icon.png` stay crawlable).
- `/sw.js`: JavaScript content type, never cached, and its own strict CSP (the PWA guide's headers). It is the last rule, so its CSP wins over the site-wide one (in `next.config` headers, a later rule overrides an earlier one with the same key).
- `poweredByHeader: false`; `serverExternalPackages: ["web-push"]` so Next loads web-push with Node's `require` instead of bundling it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/security-headers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, NOINDEX_SOURCES, ROBOTS_DISALLOW, securityHeaders, type HeaderRule } from "@/lib/security-headers";

const header = (rule: HeaderRule | undefined, key: string) => rule?.headers.find((h) => h.key === key)?.value;

describe("contentSecurityPolicy", () => {
  it("is strict in production and forbids framing", () => {
    const csp = contentSecurityPolicy(false, true);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline';");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows eval only for next dev, and upgrades requests only over https", () => {
    expect(contentSecurityPolicy(true, false)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false, false)).not.toContain("upgrade-insecure-requests");
  });
});

describe("securityHeaders", () => {
  it("sends the security headers on every path, with HSTS only on Vercel", () => {
    const [all] = securityHeaders({ dev: false, https: true });
    expect(all.source).toBe("/:path*");
    expect(header(all, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(all, "X-Frame-Options")).toBe("DENY");
    expect(header(all, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(all, "Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    expect(header(all, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    const [local] = securityHeaders({ dev: false, https: false });
    expect(header(local, "Strict-Transport-Security")).toBeUndefined();
  });

  it("marks every private area noindex", () => {
    const rules = securityHeaders({ dev: false, https: true });
    for (const source of NOINDEX_SOURCES) {
      expect(header(rules.find((r) => r.source === source), "X-Robots-Tag")).toBe("noindex, nofollow");
    }
    expect(NOINDEX_SOURCES).toEqual([
      "/app/:path*",
      "/a/:path*",
      "/onboarding/:path*",
      "/login",
      "/signup",
      "/forgot",
      "/reset-password",
      "/auth/:path*",
      "/api/:path*",
    ]);
  });

  it("serves the service worker uncached with its own CSP, as the last rule", () => {
    const rules = securityHeaders({ dev: false, https: true });
    const sw = rules.at(-1);
    expect(sw?.source).toBe("/sw.js");
    expect(header(sw, "Content-Type")).toBe("application/javascript; charset=utf-8");
    expect(header(sw, "Cache-Control")).toBe("no-cache, no-store, must-revalidate");
    expect(header(sw, "Content-Security-Policy")).toBe("default-src 'self'; script-src 'self'");
  });
});

describe("ROBOTS_DISALLOW", () => {
  const blocked = (path: string) => ROBOTS_DISALLOW.some((prefix) => path.startsWith(prefix));

  it("keeps crawlers out of the private areas", () => {
    for (const path of ["/app/requests", "/a/AbCdEfGhIjKl", "/onboarding", "/login", "/signup", "/forgot", "/reset-password", "/auth/confirm", "/api/cron/daily"]) {
      expect(blocked(path)).toBe(true);
    }
  });

  it("never catches a booking link or a public page", () => {
    for (const path of ["/", "/demo", "/apple-dental", "/apple-icon.png", "/aura-smile", "/privacy", "/terms", "/manifest.webmanifest"]) {
      expect(blocked(path)).toBe(false);
    }
  });
});
```

Run: `npx vitest run tests/unit/security-headers.test.ts`
Expected: FAIL, `@/lib/security-headers` does not exist.

- [ ] **Step 2: Write the headers module**

Create `src/lib/security-headers.ts`:

```ts
type Header = { key: string; value: string };
export type HeaderRule = { source: string; headers: Header[] };

/**
 * Next's CSP guide, "Without Nonces": inline scripts stay allowed because Next's bootstrap scripts are
 * inline and nonces would make every page dynamic. 'unsafe-eval' is only for next dev (React's debugging).
 * upgrade-insecure-requests only where the site is served over https.
 */
export function contentSecurityPolicy(dev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/** Pages no search engine should list (Global Constraints): X-Robots-Tag on each. */
export const NOINDEX_SOURCES = [
  "/app/:path*",
  "/a/:path*",
  "/onboarding/:path*",
  "/login",
  "/signup",
  "/forgot",
  "/reset-password",
  "/auth/:path*",
  "/api/:path*",
];

/**
 * The same areas for robots.txt, which matches by prefix: the trailing slashes on /app/, /a/, /auth/, and
 * /api/ keep booking links like /apple-dental crawlable. /app itself is covered by its noindex header.
 */
export const ROBOTS_DISALLOW = ["/app/", "/a/", "/onboarding", "/login", "/signup", "/forgot", "/reset-password", "/auth/", "/api/"];

/** Everything next.config.ts sends. Later rules override earlier ones with the same key, so /sw.js goes last. */
export function securityHeaders({ dev, https }: { dev: boolean; https: boolean }): HeaderRule[] {
  const everywhere: Header[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev, https) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
  return [
    { source: "/:path*", headers: everywhere },
    ...NOINDEX_SOURCES.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    },
  ];
}
```

Run: `npx vitest run tests/unit/security-headers.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Wire it into next.config.ts and add robots.txt**

Replace the whole of `next.config.ts` with:

```ts
import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // web-push signs VAPID tokens and encrypts payloads with Node's crypto; load it with require, unbundled.
  serverExternalPackages: ["web-push"],
  async headers() {
    // VERCEL is "1" during Vercel builds, where the site is always served over https.
    return securityHeaders({ dev: process.env.NODE_ENV === "development", https: process.env.VERCEL === "1" });
  },
};

export default nextConfig;
```

Create `src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW } from "@/lib/security-headers";

/** Booking pages, the landing page, and the legal pages are public; the private areas are not. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW } };
}
```

- [ ] **Step 4: Check the headers on a production build**

Stop the dev server first (it holds port 3600).

Run: `npm run build`
Expected: the build finishes; the route list includes `/robots.txt`, `/manifest.webmanifest`, and `/api/cron/daily` (dynamic).

Run `npm start` in a second terminal (or as a background process), then:

Run: `curl.exe -s -I http://localhost:3600/; curl.exe -s -I http://localhost:3600/login; curl.exe -s -I http://localhost:3600/sw.js; curl.exe -s http://localhost:3600/robots.txt`
Expected:
- `/`: `Content-Security-Policy` with `frame-ancestors 'none'` and without `unsafe-eval` or `upgrade-insecure-requests`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`; no `X-Powered-By`, no `X-Robots-Tag`, no `Strict-Transport-Security`.
- `/login`: the same plus `X-Robots-Tag: noindex, nofollow`.
- `/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Security-Policy: default-src 'self'; script-src 'self'`.
- robots.txt: `User-Agent: *`, `Allow: /`, and one `Disallow:` line per entry of `ROBOTS_DISALLOW`.

In the browser on the `npm start` server, open `/`, a clinic's booking page (go through to the code step), `/app/requests`, and Settings (turn push on and off), with the developer console open. Expected: no "Refused to ..." Content Security Policy errors. Stop `npm start` afterwards.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/security-headers.ts src/app/robots.ts next.config.ts tests/unit/security-headers.test.ts
git commit -m "feat: send security headers and keep private pages out of search" -m "CSP without nonces per the Next guide, frame-ancestors none, HSTS on Vercel only, noindex on the dashboard, patient links, onboarding, auth pages, and API, and robots rules that never catch a booking link."
```

### Task 7: Environment check, `.env.example`, and the deploy guide

**Files:**
- Create: `src/lib/env.ts`, `src/instrumentation.ts`, `tests/unit/env.test.ts`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: `normalizeMobile` from `@/lib/phone`; `productionModeError`, `smsMode` from `@/lib/sms/prepare`.
- Produces: from `@/lib/env` (pure): `MAX_APP_HOST = 17`, `envProblems(env: Record<string, string | undefined>): string[]`, `assertEnv(env): void` (throws one `Error` listing every problem); `register()` in `src/instrumentation.ts`.

Rules:
- Always required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `APP_SECRET` (nothing works without them). Any production build (`NODE_ENV=production`, previews included) also needs `APP_URL` (`appUrl()` throws without it). `VERCEL_ENV=production` needs everything in spec 15 that a live launch uses: `APP_URL`, `CRON_SECRET`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`, `OPERATOR_MOBILE`, the three VAPID values, `NEXT_PUBLIC_CONTACT_EMAIL`, and `SMS_MODE=live`.
- `APP_URL` must be an origin (no path, no trailing slash), `https` in production, and its host at most 17 characters (the SMS length budget in Global Constraints). The host check is skipped only on Vercel previews (`VERCEL_ENV=preview`), whose `*.vercel.app` hosts are always longer and whose texts are only logged.
- Formats, when set: `CRON_SECRET` at least 16 characters (`isCronAuthorized` refuses shorter), `APP_SECRET` at least 32 in production, `OPERATOR_MOBILE` a PH mobile, `SMS_LOW_CREDIT_THRESHOLD` a whole number, `SEMAPHORE_SENDER_NAME` at most 11 characters (Semaphore's limit).
- Messages name the variable and the rule, never the value, not even part of it.
- `register()` runs once per server start (Next's instrumentation file; with a `src` folder it lives in `src/`). It checks only in the Node.js runtime (`NEXT_RUNTIME === "nodejs"`). A failed check throws, so the server refuses to start instead of sending broken texts; if Next also runs `register` during `next build`, a missing variable fails the build, which is the same fail-fast result.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertEnv, envProblems, MAX_APP_HOST } from "@/lib/env";

const dev = {
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://dev.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  APP_SECRET: "a".repeat(43),
};
const production = {
  ...dev,
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  APP_URL: "https://brightsmile.ph",
  CRON_SECRET: "c".repeat(43),
  SMS_MODE: "live",
  SEMAPHORE_API_KEY: "semaphore-key",
  SEMAPHORE_SENDER_NAME: "BrightSmile",
  SMS_LOW_CREDIT_THRESHOLD: "500",
  OPERATOR_MOBILE: "0917 123 4567",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "vapid-public",
  VAPID_PRIVATE_KEY: "vapid-private",
  VAPID_SUBJECT: "mailto:hello@brightsmile.ph",
  NEXT_PUBLIC_CONTACT_EMAIL: "hello@brightsmile.ph",
};

describe("envProblems", () => {
  it("accepts a complete development and a complete production environment", () => {
    expect(envProblems(dev)).toEqual([]);
    expect(envProblems({ ...dev, APP_URL: "http://localhost:3600" })).toEqual([]);
    expect(envProblems(production)).toEqual([]);
  });

  it("names every missing variable", () => {
    expect(envProblems({})).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL is not set",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set",
      "SUPABASE_SECRET_KEY is not set",
      "APP_SECRET is not set",
    ]);
    const { VAPID_PRIVATE_KEY, OPERATOR_MOBILE, ...missing } = production;
    void VAPID_PRIVATE_KEY;
    void OPERATOR_MOBILE;
    expect(envProblems(missing)).toEqual(["OPERATOR_MOBILE is not set", "VAPID_PRIVATE_KEY is not set"]);
    expect(envProblems({ ...production, APP_SECRET: "   " })).toEqual(["APP_SECRET is not set"]);
  });

  it("needs APP_URL on every production build, previews included", () => {
    expect(envProblems({ ...dev, NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual(["APP_URL is not set"]);
  });

  it(`refuses an APP_URL host longer than ${MAX_APP_HOST} characters, except on previews`, () => {
    expect(envProblems({ ...production, APP_URL: "https://brightsmileapp.ph" })).toEqual([]); // 17
    const long = "https://brightsmile-clinic.ph"; // 21
    expect(envProblems({ ...production, APP_URL: long })).toEqual([
      "APP_URL's host is longer than 17 characters, which would split texts into 2 parts",
    ]);
    expect(envProblems({ ...dev, APP_URL: long })).toHaveLength(1);
    expect(envProblems({ ...dev, NODE_ENV: "production", VERCEL_ENV: "preview", APP_URL: "https://brightsmile-git-main-kai.vercel.app" })).toEqual([]);
  });

  it("refuses an APP_URL that is not a bare origin, or not https in production", () => {
    const origin = "APP_URL must be an origin like https://brightsmile.ph, with no path and no trailing slash";
    expect(envProblems({ ...production, APP_URL: "https://brightsmile.ph/" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "https://brightsmile.ph/app" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "brightsmile.ph" })).toEqual([origin]);
    expect(envProblems({ ...production, APP_URL: "http://brightsmile.ph" })).toEqual(["APP_URL must use https in production"]);
  });

  it("refuses log mode in production", () => {
    expect(envProblems({ ...production, SMS_MODE: "log" })).toEqual(["SMS_MODE is not live in production"]);
    expect(envProblems({ ...dev, SMS_MODE: "log" })).toEqual([]);
  });

  it("checks formats without repeating the values", () => {
    const bad = {
      ...production,
      CRON_SECRET: "short-secret",
      APP_SECRET: "tiny-app-secret",
      OPERATOR_MOBILE: "028123456",
      SMS_LOW_CREDIT_THRESHOLD: "lots",
      SEMAPHORE_SENDER_NAME: "BrightSmileClinic",
    };
    const problems = envProblems(bad);
    expect(problems).toEqual([
      "CRON_SECRET must be at least 16 characters",
      "APP_SECRET must be at least 32 characters in production",
      "OPERATOR_MOBILE must be a Philippine mobile number",
      "SMS_LOW_CREDIT_THRESHOLD must be a whole number",
      "SEMAPHORE_SENDER_NAME must be at most 11 characters",
    ]);
    for (const value of ["short-secret", "tiny-app-secret", "028123456", "lots", "BrightSmileClinic"]) {
      expect(problems.join("\n")).not.toContain(value);
    }
  });
});

describe("assertEnv", () => {
  it("throws one error listing every problem, and passes a good environment", () => {
    expect(() => assertEnv({})).toThrow(/^BrightSmile environment check failed:\n- NEXT_PUBLIC_SUPABASE_URL is not set\n- /);
    expect(() => assertEnv(production)).not.toThrow();
  });
});
```

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL, `@/lib/env` does not exist.

- [ ] **Step 2: Write the check**

Create `src/lib/env.ts`:

```ts
import { normalizeMobile } from "@/lib/phone";
import { productionModeError, smsMode } from "@/lib/sms/prepare";

type Env = Record<string, string | undefined>;

/** Every text template fits 160 characters with an APP_URL host of at most this many characters (spec 10.1). */
export const MAX_APP_HOST = 17;

const ALWAYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "APP_SECRET"];
const LIVE = [
  "APP_URL",
  "CRON_SECRET",
  "SEMAPHORE_API_KEY",
  "SEMAPHORE_SENDER_NAME",
  "OPERATOR_MOBILE",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "NEXT_PUBLIC_CONTACT_EMAIL",
];

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** What is wrong with the environment, by variable name and rule only: a value never appears, not even in part. */
export function envProblems(env: Env): string[] {
  const production = env.VERCEL_ENV === "production";
  const required = [...ALWAYS, ...(env.NODE_ENV === "production" ? ["APP_URL"] : []), ...(production ? LIVE : [])];
  const problems = [...new Set(required)].filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`);

  if (env.APP_URL) {
    const url = parseUrl(env.APP_URL);
    if (!url || url.origin !== env.APP_URL) {
      problems.push("APP_URL must be an origin like https://brightsmile.ph, with no path and no trailing slash");
    } else {
      if (url.host.length > MAX_APP_HOST && env.VERCEL_ENV !== "preview") {
        problems.push(`APP_URL's host is longer than ${MAX_APP_HOST} characters, which would split texts into 2 parts`);
      }
      if (production && url.protocol !== "https:") problems.push("APP_URL must use https in production");
    }
  }
  const smsError = productionModeError(env.VERCEL_ENV, smsMode(env.SMS_MODE));
  if (smsError) problems.push(smsError);
  if (env.CRON_SECRET && env.CRON_SECRET.length < 16) problems.push("CRON_SECRET must be at least 16 characters");
  if (production && env.APP_SECRET?.trim() && env.APP_SECRET.length < 32) problems.push("APP_SECRET must be at least 32 characters in production");
  if (env.OPERATOR_MOBILE && !normalizeMobile(env.OPERATOR_MOBILE)) problems.push("OPERATOR_MOBILE must be a Philippine mobile number");
  if (env.SMS_LOW_CREDIT_THRESHOLD && !/^\d+$/.test(env.SMS_LOW_CREDIT_THRESHOLD.trim())) {
    problems.push("SMS_LOW_CREDIT_THRESHOLD must be a whole number");
  }
  if (env.SEMAPHORE_SENDER_NAME && env.SEMAPHORE_SENDER_NAME.length > 11) problems.push("SEMAPHORE_SENDER_NAME must be at most 11 characters");
  return problems;
}

/** Called once at server start (src/instrumentation.ts), so a misconfigured deployment fails loudly instead of misbehaving. */
export function assertEnv(env: Env): void {
  const problems = envProblems(env);
  if (problems.length > 0) throw new Error(`BrightSmile environment check failed:\n- ${problems.join("\n- ")}`);
}
```

Create `src/instrumentation.ts`:

```ts
/** Next calls register once when a server instance starts. A bad environment stops it there, naming variables only. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertEnv } = await import("@/lib/env");
  assertEnv(process.env);
}
```

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: See it stop a bad server**

Run: `npm run build`
Expected: the build finishes (`.env.local` has the development values).

Run: `$env:APP_URL = "https://brightsmile-clinic.ph"; npm start`
Expected: the server output shows `BrightSmile environment check failed:` and `- APP_URL's host is longer than 17 characters, which would split texts into 2 parts`, with no secret values, and the site does not serve pages (the process exits, or `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3600/` answers `500`). Stop it with Ctrl+C if it is still running.

Run: `Remove-Item Env:APP_URL; npm start`
Expected: `Ready` and http://localhost:3600/ answers 200. Stop it.

- [ ] **Step 4: Update `.env.example`**

Replace the whole of `.env.example` with:

```
# Supabase: Project Settings > API Keys. Development and production are separate projects.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# Where the app runs: an origin with no path and no trailing slash, https in production.
# Links in texts use it. The host must be at most 17 characters (texts are sized for it), or the server refuses to start.
APP_URL=http://localhost:3600

# Random secrets, different in every environment. Generate each one with:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
APP_SECRET=
# At least 16 characters. Vercel Cron sends it as a bearer token to /api/cron/daily.
CRON_SECRET=

# log: write texts to the sms_log table and the console. live: send through Semaphore (required in production).
SMS_MODE=log
SEMAPHORE_API_KEY=
# The approved Semaphore sender name, at most 11 characters.
SEMAPHORE_SENDER_NAME=BrightSmile
# The daily job texts OPERATOR_MOBILE when the Semaphore balance drops below this many credits.
SMS_LOW_CREDIT_THRESHOLD=500
OPERATOR_MOBILE=

# Web push keys. Generate with: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:hello@example.com

# Contact address shown on the privacy and terms pages.
NEXT_PUBLIC_CONTACT_EMAIL=
```

- [ ] **Step 5: Write the deploy guide**

In `README.md`, append after the Scripts table:

````markdown
## Deploy to production

Do these in order. Kai creates the accounts; nothing here can be done from code.

### 1. Accounts

- Vercel Pro (the free plan is for non-commercial use) and Supabase Pro (daily backups), both before real patient data.
- Semaphore: apply for the sender name `BrightSmile` early (2 to 4 weeks). Real texts can't go out without it.
- The domain. Its host must be at most 17 characters (`brightsmile.ph` is 14), because every text is sized for that.

### 2. Supabase production project

1. Create a new project (not the development one), region Singapore. From **Project Settings > API Keys** copy the project URL, the publishable key, and the secret key.
2. Apply the migrations in filename order: open each file in `supabase/migrations`, paste it into the **SQL Editor**, and run it before opening the next.

   | Order | File |
   |---|---|
   | 1 | `20260922000100_schema.sql` |
   | 2 | `20260922000200_access.sql` |
   | 3 | `20260922000300_booking_functions.sql` |
   | 4 | `20260924000100_hardening.sql` |
   | 5 | `20260924000200_default_function_privileges.sql` |
   | 6 | `20260925000100_otp_issue_lock.sql` |

   Migrations run by hand are not recorded in the project's migration history. Before you ever use `npm run db:push` against this project, link it and mark them as applied, or the CLI will try to run them again:

   ```powershell
   npx supabase link --project-ref <production-project-ref>
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100
   ```

3. **Authentication > URL Configuration:** Site URL = your `APP_URL` (for example `https://brightsmile.ph`); add `https://brightsmile.ph/**` under Redirect URLs.
4. **Authentication > Email Templates:**
   - Confirm signup: link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - Reset password: link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
5. **Authentication > Emails > SMTP Settings:** set up custom SMTP. Supabase's built-in sender is rate limited and meant for testing.
6. Keep email confirmation on (**Authentication > Sign In / Providers > Email**).

### 3. Keys

```powershell
npx web-push generate-vapid-keys
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The first prints the VAPID public and private keys. Run the second twice, once for `APP_SECRET` and once for `CRON_SECRET`. Never reuse development values in production.

### 4. Vercel project

1. Import the GitHub repository. The framework preset is Next.js; no build settings change.
2. **Settings > Environment Variables**, for the **Production** environment:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | From the production Supabase project |
   | `APP_URL` | `https://` plus your domain, no trailing slash |
   | `APP_SECRET`, `CRON_SECRET` | The random values from step 3 |
   | `SMS_MODE` | `live` |
   | `SEMAPHORE_API_KEY` | From Semaphore |
   | `SEMAPHORE_SENDER_NAME` | `BrightSmile` (exactly as approved) |
   | `SMS_LOW_CREDIT_THRESHOLD` | `500` |
   | `OPERATOR_MOBILE` | The mobile that gets low credit texts |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | From step 3 |
   | `VAPID_SUBJECT` | `mailto:` plus a monitored address |
   | `NEXT_PUBLIC_CONTACT_EMAIL` | The address on the Privacy Notice and Terms |

   For **Preview**, use the development Supabase keys, `SMS_MODE=log`, and set `APP_URL` to the project's preview branch alias (shown on any preview deployment). Previews never text anyone and never run the cron job.

   The server checks these at start and refuses to run, listing the variable names, when one is missing or malformed (`src/lib/env.ts`). Redeploy after changing any of them: `NEXT_PUBLIC_` values are built into the pages.
3. **Settings > Deployment Protection:** the production domain must be public. Use Standard Protection (previews only) or turn Vercel Authentication off; never "All Deployments". Check with `curl.exe -s -o NUL -w "%{http_code}" https://brightsmile.ph/`, which must print `200`.
4. **Settings > Domains:** add the domain and follow the DNS instructions.
5. **Firewall > Rules > New Rule**, a rate limit for the public booking actions (Server Actions are POST requests with a `Next-Action` header):
   - Name: `Booking actions`
   - If: Request Method equals `POST`, and Request Header `next-action` exists, and Request Path does not start with `/app`, and Request Path does not start with `/onboarding`
   - Then: Rate Limit, fixed window 60 seconds, 20 requests, keyed by IP, action Too Many Requests
   The app also limits codes per mobile and per IP (spec 10.3); this rule stops floods before they reach it.
6. **Cron:** `vercel.json` schedules `/api/cron/daily` at `0 1 * * *` (9:00 AM Manila). Vercel sends `CRON_SECRET` as the bearer token on its own. After the first production deploy, open **Settings > Cron Jobs**, press **Run**, and check the function log: the response is JSON with `"ok":true`.

### 5. After the first deploy

1. Open the site: the landing page loads; `curl.exe -s -I https://brightsmile.ph/` shows `Strict-Transport-Security` and `Content-Security-Policy`.
2. Create the demo clinic: sign up with a demo email and use the booking link `demo`, so the landing page's demo link works.
3. Book a visit on `/demo` with your own mobile: the code text arrives from `BrightSmile`. Approve it in the dashboard: the confirmation text arrives.
4. On a phone, add the dashboard to the home screen (iPhone: Safari, Share, Add to Home Screen), open it, and in Settings press "Enable push on this device". Book another visit: the push arrives and opens Requests.
5. Have a lawyer review `/privacy` and `/terms` and replace every `[bracketed]` placeholder before real clinics sign up.
````

- [ ] **Step 6: Check and commit**

Run: `npx tsc --noEmit; npm test`
Expected: `tsc` prints nothing; unit tests PASS.

```powershell
git add src/lib/env.ts src/instrumentation.ts tests/unit/env.test.ts .env.example README.md
git commit -m "feat: check the environment at server start and document the deploy" -m "The server refuses to start with a missing or malformed variable, naming it without its value, and with an APP_URL host longer than the 17 characters the texts are sized for. The README gains the production deploy procedure."
```

### Task 8: Playwright happy path

**Files:**
- Modify: `package.json`, `package-lock.json`, `tests/db/helpers.ts`, `.gitignore`, `eslint.config.mjs`, `.env.example`, `README.md`
- Create: `playwright.config.ts`, `tests/e2e/booking.spec.ts`

**Interfaces:**
- Consumes: `adminDb`, `staffClinic`, `dropStaffClinic`, `type StaffSeed` from `tests/db/helpers.ts` (and with them its guard that refuses any Supabase project but development); `addDays`, `manilaDate`, `weekday` from `@/lib/time`; `createServerClient` from `@supabase/ssr`; the UI text of the booking page, Requests, and Schedule as built in Plans 2 and 3.
- Produces: `signedInUser()` and `staffClinic()` now also return the login (`email`, `password`; `staffClinic` as `login: { email, password }`); npm scripts `test:e2e` and `test:e2e:install`.

Spec 14: one test. It books on the public page, reads the code from `sms_log`, verifies, approves in the dashboard, and sees the visit on the schedule. It seeds its own clinic and staff user through the admin API (`staffClinic`), signs the staff user in programmatically (the Supabase SSR client writes the session cookies into a jar that goes into the browser context, so the test does not depend on the login form), and removes the clinic, the user, and its code requests afterwards. It runs on a phone-sized Chromium (Pixel 7), because the booking page is used on phones.

Browsers go to `PLAYWRIGHT_BROWSERS_PATH`, set in the gitignored `.env.local` (on Kai's machine `D:\playwright-browsers`, because drive C: is nearly full). `playwright.config.ts` loads `.env.local` before anything launches, and `test:e2e:install` passes it to the installer with Node's `--env-file-if-exists` (Node 24 is installed). A machine without the variable uses Playwright's default folder.

- [ ] **Step 1: Install Playwright and Chromium**

Run: `npm install -D @playwright/test@^1.63.0`
Expected: `added N packages`, no `ERR!`.

In `package.json`, replace:

```json
    "test:db": "vitest run tests/db",
```

with:

```json
    "test:db": "vitest run tests/db",
    "test:e2e": "playwright test",
    "test:e2e:install": "node --env-file-if-exists=.env.local node_modules/@playwright/test/cli.js install chromium",
```

Add this line to `.env.local` (not committed): `PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers`

Append to `.env.example`:

```
# Where Playwright keeps its browsers (npm run test:e2e:install). Optional; on a nearly full C: drive use another drive.
# PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers
```

Run: `npm run test:e2e:install`
Expected: Chromium downloads and the output names a folder under `D:\playwright-browsers`. Nothing new appears under `C:\Users\User\AppData\Local\ms-playwright`.

- [ ] **Step 2: Ignore Playwright's output**

Append to `.gitignore`:

```
# Playwright output
/test-results/
/playwright-report/
/blob-report/
```

In `eslint.config.mjs`, replace:

```js
    ".superpowers/**",
  ]),
```

with:

```js
    ".superpowers/**",
    // Playwright output.
    "test-results/**",
    "playwright-report/**",
  ]),
```

- [ ] **Step 3: Return the login from the test helpers**

In `tests/db/helpers.ts`, replace:

```ts
export async function signedInUser(): Promise<{ db: SupabaseClient; userId: string }> {
```

with:

```ts
export async function signedInUser(): Promise<{ db: SupabaseClient; userId: string; email: string; password: string }> {
```

replace:

```ts
  return { db, userId: data.user.id };
```

with:

```ts
  return { db, userId: data.user.id, email, password };
```

and in `staffClinic`, replace:

```ts
    staff: { db: user.db, userId: user.userId, clinicId: clinicId as string },
```

with:

```ts
    staff: { db: user.db, userId: user.userId, clinicId: clinicId as string },
    login: { email: user.email, password: user.password },
```

Run: `npx tsc --noEmit`
Expected: no output (the extra fields break no caller).

- [ ] **Step 4: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

// The test seeds data with the Supabase keys, and PLAYWRIGHT_BROWSERS_PATH may live here too. Earlier files win.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Optional file.
  }
}
// The test reads the verification code from sms_log, which only log mode stores (spec 10.6).
process.env.SMS_MODE = "log";

/** Spec 14: one end-to-end test against the dev server on port 3600 (started if it isn't running). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3600", trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3600",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
```

`reuseExistingServer` uses a dev server that is already running; that server must also run with `SMS_MODE=log` (the development default). The test says so if the code is missing.

- [ ] **Step 5: Write the test**

Create `tests/e2e/booking.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { addDays, manilaDate, weekday } from "@/lib/time";
import { adminDb, dropStaffClinic, staffClinic, type StaffSeed } from "../db/helpers";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const mobile = `0917${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
let seed: StaffSeed | undefined;

test.beforeAll(async () => {
  seed = await staffClinic();
});

test.afterAll(async () => {
  if (seed) await dropStaffClinic(seed);
  await adminDb().from("otp_requests").delete().eq("mobile", `+63${mobile.slice(1)}`);
});

/** Session cookies for the staff login, written by the same SSR client the app uses, so the format always matches. */
async function sessionCookies(login: { email: string; password: string }) {
  const jar: { name: string; value: string }[] = [];
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          const at = jar.findIndex((c) => c.name === name);
          if (at >= 0) jar.splice(at, 1);
          if (value) jar.push({ name, value });
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword(login);
  expect(error).toBeNull();
  expect(jar.length, "signing in wrote no session cookie").toBeGreaterThan(0);
  return jar;
}

test("a patient books, the clinic approves, and the visit is on the schedule", async ({ page, context, baseURL }) => {
  const s = seed!;
  const today = manilaDate(new Date());
  const day = addDays(today, 1);
  const [, month, date] = day.split("-").map(Number);

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

  // The code comes from sms_log, where log mode keeps it (spec 10.6).
  const { data: text } = await adminDb()
    .from("sms_log")
    .select("body")
    .eq("clinic_id", s.staff.clinicId)
    .eq("kind", "otp")
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  const code = (text.body as string | null)?.match(/ is (\d{6})\./)?.[1];
  expect(code, "sms_log has no code: the dev server must run with SMS_MODE=log").toBeTruthy();
  await page.getByLabel("Code from the text").fill(code!);
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();

  // The clinic approves it in the dashboard.
  const cookies = await sessionCookies(s.login);
  await context.addCookies(cookies.map((c) => ({ ...c, url: baseURL!, httpOnly: true, sameSite: "Lax" as const })));
  await page.goto("/app/requests");
  const request = page.locator("article", { hasText: "Playwright Tester" });
  await expect(request.getByText("Pending", { exact: true })).toBeVisible();
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(request).toHaveCount(0);

  // And sees it on tomorrow's schedule.
  await page.goto(`/app/schedule?date=${day}`);
  const visit = page.locator("article", { hasText: "Playwright Tester" });
  await expect(visit.getByText("Confirmed", { exact: true })).toBeVisible();
});
```

- [ ] **Step 6: Run it**

Run: `npm run test:e2e`
Expected: `1 passed` (the first run can take a minute while the dev server compiles each page). Afterwards, in the development project, no clinic named "Staff Clinic" is left from this run and `otp_requests` has no row for the test mobile.

If the test fails, open the trace it names (`npx playwright show-trace test-results/.../trace.zip`) to see the step. Then run `npm run lint; npx tsc --noEmit` and expect no errors.

- [ ] **Step 7: Document it**

In `README.md`, replace:

```markdown
| `npm run test:db` | Database tests against the development Supabase project |
```

with:

```markdown
| `npm run test:db` | Database tests against the development Supabase project |
| `npm run test:e2e` | The Playwright booking test (starts the dev server if needed) |
| `npm run test:e2e:install` | Download Chromium for Playwright (once) |
```

and insert before the `## Deploy to production` heading:

```markdown
## End-to-end test

One Playwright test walks the whole booking loop: a patient books on a clinic's page, the code is read from `sms_log`, the clinic approves in the dashboard, and the visit shows on the schedule.

1. Once: put `PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers` (or any folder on a drive with space) in `.env.local`, then run `npm run test:e2e:install`.
2. Run `npm run test:e2e`. It uses the dev server on port 3600, starting it if needed, with `SMS_MODE=log`.

The test creates its own clinic and staff login in the development Supabase project and deletes them afterwards. Like `npm run test:db`, it refuses to run against any other project, because it uses the secret key.

```

- [ ] **Step 8: Commit**

```powershell
git add package.json package-lock.json playwright.config.ts tests/e2e/booking.spec.ts tests/db/helpers.ts .gitignore eslint.config.mjs .env.example README.md
git commit -m "test: add the Playwright booking happy path" -m "One test per spec 14: book on the public page, read the code from sms_log, verify, approve in the dashboard, and find the visit on the schedule. It seeds and removes its own clinic and staff user in the development project and signs in through the Supabase SSR client."
```

### Task 9: Verify the deliverable end to end

The controller runs this task after Tasks 1 to 8 are committed. It changes no code unless a check fails; a fix gets its own `fix:` commit.

- [ ] **Step 1: Run every automated check**

Run: `npm run lint; npx tsc --noEmit; npm test; npm run test:db; npm run test:e2e; npm run build`
Expected: lint clean, `tsc` silent, unit tests PASS, database tests PASS (including `push.test.ts` and `daily-job.test.ts`), `1 passed` from Playwright, and a finished build whose route list shows `/`, `/privacy`, `/terms`, `/robots.txt`, `/manifest.webmanifest`, and `/api/cron/daily`. `;` keeps going after a failure, so read every result.

- [ ] **Step 2: No dashes slipped in**

Run: `git grep -n -P "[\x{2013}\x{2014}]" -- src tests public README.md .env.example playwright.config.ts next.config.ts vercel.json`
Expected: no output.

- [ ] **Step 3: Walk the flows in the browser (dev server, phone width 375px and desktop)**

1. **Landing:** http://localhost:3600 shows one card: headline, three points, "Sign up your clinic", "Try the demo booking page", "Log in", and the Privacy Notice and Terms links. Both legal pages open with the yellow draft box and the contact address from `.env.local`.
2. **Onboarding:** sign up a new account, confirm the email, finish onboarding. "Your link is ready" shows the "Get new requests on this phone" box; "Turn on alerts" opens Settings at "Alerts on this device".
3. **Push on:** with the VAPID keys in `.env.local`, press "Enable push on this device" in Chrome and allow notifications: "Push on" shows, and `push_subscriptions` has the row.
4. **Push arrives:** in a second browser profile (or a private window), book a visit on that clinic's page. A notification "New booking request" with the date and time (no patient name) appears on the first profile. Click it: `/app/requests` opens. In the SQL Editor, `select kind from sms_log where clinic_id = '<clinic id>' order by id desc limit 3` shows `otp` for that booking and no `request_alert` (the push was delivered, so no text).
5. **Fallback:** press "Turn off push on this device". Book again: `sms_log` now has a `request_alert` for the clinic mobile.
6. **Consent link:** on the booking page's Who step, "Privacy Notice" opens in a new tab and the booking stays where it was.
7. **Cron:** `curl.exe -s -i http://localhost:3600/api/cron/daily` answers 401; with the bearer header from Task 4 Step 4 it answers JSON with `"ok":true`, twice in a row, and the second run reports `"reminders":0`.
8. **Settings copy:** the Booking rules alerts hint links to "Alerts on this device", and the iPhone home screen note is under it.

- [ ] **Step 4: Production build headers and CSP**

Stop the dev server. Run `npm start`, then repeat Task 6 Step 4's `curl.exe` checks and open `/`, a booking page (through the code step), `/app/requests`, and Settings (push on and off) with the developer console open. Expected: the headers as listed there, and no Content Security Policy errors in the console. Stop `npm start`.

- [ ] **Step 5: Report to Kai**

Write the summary for Kai: what shipped, the test counts, the dependencies added (`web-push`, `@types/web-push`, `@playwright/test`) with their reasons, that no migrations were added, and the list in "What Kai must do" below.

## What Kai must do (outside the code)

- Nothing to paste in the SQL Editor for this plan: it adds no migrations.
- Add to the development `.env.local`: VAPID keys (`npx web-push generate-vapid-keys`), a `CRON_SECRET` of at least 16 characters, and `PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers`.
- Everything in the README's "Deploy to production" section: Vercel Pro and Supabase Pro, the production Supabase project with the six migrations pasted in order (and the `migration repair` note), Auth URL configuration, email templates and custom SMTP, the Vercel environment variables, Deployment Protection off for the production domain, the Firewall rate limit rule, and the domain (host at most 17 characters).
- Apply for the Semaphore sender name `BrightSmile` now (2 to 4 weeks).
- Create the demo clinic with the booking link `demo` on production.
- Have a lawyer review `/privacy` and `/terms` (including the data processing terms) and fill every `[bracketed]` placeholder; check whether NPC registration applies; trademark check on BrightSmile; business registration before charging clinics (spec 16).

## Self-review

**Spec coverage.**

| Spec | Where |
|---|---|
| 5.4 step 4: "Your link is ready" prompts to enable push | Task 2 Step 8 (links to Settings, see the File map note on the proxy) |
| 5.5: landing at `/` with demo link, Sign up, Log in; `/privacy`, `/terms` | Task 5 |
| 10.4: push to every subscription, delete on 404 or 410, text fallback, payload without names, tap opens `/app/requests` | Task 1 (`sendPush`, `alertClinic` unchanged), Task 2 (`sw.js`) |
| 10.4: manifest start URL `/app/requests`, standalone; iPhone home screen note in Settings | Task 2 Steps 4 and 6 |
| 11: Vercel Cron `0 1 * * *`, bearer `CRON_SECRET`, reminders, expiry, cleanup, credit check, idempotent | Tasks 3 and 4 |
| 12: controller and processor, retention, `CRON_SECRET` on the cron route, no codes or patient details in logs | Task 5 (legal text), Task 3 (cleanup), Task 4, `logError` (Task 1) |
| 14: one Playwright test | Task 8 |
| 15: environment variables | Task 7 (`.env.example`, startup check, README) |
| 16: launch checklist | README deploy section (Task 7) and "What Kai must do" |

**Decisions worth a second look.**
- The onboarding prompt links to Settings instead of subscribing in place, because the proxy redirects `/onboarding` requests (Server Action posts included) to `/app` once the clinic exists.
- A reminder whose text fails after the claim is not retried (no double texts); the schedule's "Text not delivered" chip already tells staff to call.
- The APP_URL host check skips Vercel previews only; everywhere else a host over 17 characters stops the server.
- HSTS and `upgrade-insecure-requests` are sent only on Vercel builds, so `npm start` over http keeps working locally.
- `sendReminders` texts one at a time (marked `ponytail:`); fine for early volumes within `maxDuration = 300`.

**Deferred.** A fetch handler or offline cache in the service worker (the dashboard needs live data); nonce-based CSP (would make every page dynamic); per-login push cleanup on sign out (v1 has one login per clinic); automated retry of failed reminder texts; clinic account deletion tooling (manual in v1, spec 12).

**Placeholder scan.** Every step has complete code or exact text. The only bracketed placeholders are inside the draft legal pages, on purpose, for the lawyer.

**Type consistency.** `sendPush(clinicId, payload, send?)` keeps the signature `notify.ts` calls. `Saved` (from `@/lib/staff-input`) is the result of `saveSubscription`, `deleteSubscription`, `enablePush`, and `disablePush`. `DailySummary.ok` drives the route's 200 or 500. `StaffSeed` gains `login`, used only by the Playwright test.
