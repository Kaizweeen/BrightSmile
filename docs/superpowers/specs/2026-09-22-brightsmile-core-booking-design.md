# BrightSmile v1: Core Booking Loop

- **Date:** 2026-09-22
- **Status:** Approved 2026-09-22, with corrections found while planning (see Revisions at the end)
- **Scope:** Piece 1 of 4 (see Roadmap)
- **Name:** BrightSmile. Repo: [Kaizweeen/BrightSmile](https://github.com/Kaizweeen/BrightSmile). Placeholder domain in examples: `brightsmile.ph`.

BrightSmile is an appointment booking product for dental clinics in the Philippines, sold as a subscription. This spec covers the core booking loop only. BrightSmile uses its own brand, copy, and code. Nothing is copied from Odonto.

---

## 1. Background: what Odonto does

Odonto ([odonto.ph](https://www.odonto.ph/)) is a Philippine SaaS positioned as the top booking app for dentists. Android app `ph.odonto.dashboard` (100+ installs), built by a solo developer. Findings below come from its public site, its public demo booking page, and its Play Store listing. Its dentist dashboard sits behind a login and was not inspected, so dashboard details are from marketing copy only.

**Core loop:** the dentist shares a personal booking link. A patient requests a slot (a request, not a confirmed booking). The dentist gets a push notification and approves or declines. Automated SMS reminders go to patient and dentist. Weekly analytics.

**Patient flow (observed on the demo):**

| Step | Screen |
|---|---|
| 1 | "Request an appointment at {clinic}", dentist shown |
| 2 | Multi-select procedures from a searchable list, estimated duration shown, clinic phone for help |
| 3 | Month calendar, past days disabled |
| 4 | Time buttons on a 30 minute grid |
| 5 | First and last name, mobile (+63), birthday, gender, optional HMO provider, then SMS OTP |

**Dentist side (marketing copy):** request approval, calendar view, manual booking for seniors and PWDs, multi-dentist clinics, a booking website per clinic, weekly analytics.

**Stack (from public assets):** Ionic React + Capacitor (one codebase for web and Android), Vite, Supabase, PostHog, react-calendar.

**Pricing:** Solo ₱399/month (1 to 2 dentists), Team ₱1,299 (3 to 6), Enterprise ₱1,799 (7+), 1 week free trial, no lock-in. Pitch: fewer no-shows, less back-and-forth on Messenger, a free booking website.

## 2. Decisions made in brainstorming

| Question | Decision |
|---|---|
| What is it for? | A real product sold to PH clinics. Production quality, hardened. |
| What is the edge over Odonto? | None yet. Ship the core loop done well, launch to a few clinics, let their feedback pick the differentiator. The real competitor is Messenger plus a notebook. |
| Stack | Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres, Auth, RLS), Vercel, installable web app (PWA). |
| SMS provider | Semaphore (PH gateway). |

## 3. Roadmap (each piece gets its own spec, plan, and build)

1. **Core booking loop (this spec).**
2. **Billing:** trial, paid plans, a monthly text allowance, PayMongo or Xendit. Until then, early clinics pay by GCash transfer.
3. **Teams and analytics:** staff invites and roles, weekly reports, no-show rates.
4. **Mobile:** Play Store listing as a thin wrapper around the PWA.

## 4. Goals and success criteria

1. A new clinic goes from signup to a working booking link in under 5 minutes.
2. A patient on a phone completes a booking request in 3 steps plus a code.
3. Double booking a dentist is impossible, enforced by the database and proven by a test.
4. Staff of one clinic can never read another clinic's data, enforced by RLS and proven by a test.
5. Every text template fits in one 160 character GSM-7 text with worst-case inputs, proven by a test.
6. Each confirmed appointment gets at most one reminder for its current time, sent the day before at 9:00 AM Manila time.
7. Completed and No-show are recorded from day one, so no-show rates can be computed in piece 3.

## 5. Scope

### 5.1 Patient booking (public page, no account)

URL: `/{clinic-slug}`. The page doubles as the clinic's booking website: name, address, map link, hours, phone.

1. **What:** choose one or more procedures (searchable list, at least one). The estimated duration is the sum of their durations and is shown. Choose a dentist only if the clinic has 2 or more active dentists. If the total duration fits in no working block, show "No single opening fits all of these. Choose fewer procedures or call {clinic phone}."
2. **When:** a month grid where closed and fully booked days are disabled. Open start times for the selected day are listed directly below the grid.
3. **Who:** first name (required, up to 50 characters), last name (required, up to 50), mobile (required), birthday (optional, not in the future, not before 1900), HMO provider (optional, free text with suggestions: Maxicare, Intellicare, MediCard, PhilCare, Cocolife, Avega, ValuCare, Insular Health Care, EastWest Healthcare, Kaiser), and a required consent checkbox: "I agree to {clinic} and BrightSmile using my details to manage this appointment, as described in the Privacy Notice."
4. **Code:** a 6 digit code by SMS (see 10.3), skipped when this device already verified this mobile.
5. **Request sent:** summary, "The clinic will confirm by text," and "No reply within a day? Call {clinic phone}."

Gender is not collected (not needed to book, less sensitive data held).

### 5.2 Patient self-service link

URL: `/a/{token}`, sent in confirmation, moved, and reminder texts. Shows status, clinic, dentist, date, time, and the patient's first name only. A Cancel button (with a confirm step) is available while the appointment is pending or confirmed and its start time is in the future. After cancelling: "Cancelled" plus a "Book again" link. No login.

### 5.3 Clinic dashboard (installable PWA, under `/app`)

- **Requests** (`/app/requests`): pending requests, soonest first. Each shows patient name, mobile (tap to call or text), procedures, dentist, time, when requested, and a New or Returning badge. Approve, or Decline with an optional reason (up to 36 characters, quick picks "Dentist unavailable" and "Please call the clinic").
- **Schedule** (`/app/schedule`): day view, dentist filter when there are 2 or more, previous and next day, native date input to jump. Each appointment shows time range, patient, procedures, status, and flags ("outside hours", "text not delivered"). Actions: Move, Cancel (optional reason up to 36 characters, patient is texted), and Completed or No-show once the start time has passed. Pending requests also appear here, marked Pending, with Approve and Decline, because they hold their time.
- **New appointment** (`/app/new`): for walk-ins, phone and Messenger bookings, seniors and PWDs. Find or create the patient (mobile optional here; no mobile means no texts). Choose dentist and procedures, then an open time or a custom time. Custom times may fall outside working hours (flagged) but can never overlap. Confirmed immediately. "Send confirmation text" is on by default when a mobile is present.
- **Patients** (`/app/patients`): search by name or mobile. Detail page: editable details, appointment history, no-show count, and Delete (anonymizes, see 12).
- **Settings** (`/app/settings`): clinic profile (name, short name for texts, booking link, mobile, address, map link), dentists (add, edit, deactivate, weekly hours with multiple blocks per day, time off), procedures (add, edit, archive), booking rules (slot spacing 15, 30, or 60 minutes; minimum notice; booking window), alerts (push or text, enable push on this device), account (change password, sign out). Changing the booking link warns that the old link stops working.

### 5.4 Onboarding (4 screens)

1. **Account:** email and password (Supabase Auth, email confirmation required). The log in page has "Forgot password", which emails a reset link.
2. **Clinic:** name, short name for texts (prefilled, up to 20 characters), booking link (prefilled from name), clinic mobile (shown to patients and used for text alerts), address.
3. **Dentist and hours:** first dentist's display name (for example "Dr. Ana Reyes") and short name for texts ("Dr. Reyes", up to 16 characters). Hours preset Monday to Saturday, 9:00 AM to 12:00 PM and 1:00 PM to 5:00 PM, editable.
4. **Procedures:** prefilled list, editable, then "Your link is ready" with copy and share buttons and a prompt to enable push notifications.

Default procedures (clinic edits durations):

| Procedure | Minutes |
|---|---|
| Consultation | 30 |
| Oral Prophylaxis (Cleaning) | 60 |
| Tooth Restoration (Pasta) | 60 |
| Tooth Extraction (Bunot) | 60 |
| Braces Consultation | 30 |
| Braces Adjustment | 30 |
| Root Canal Treatment | 90 |
| Teeth Whitening | 90 |
| Dentures Consultation | 30 |
| Others | 30 |

### 5.5 Other pages

- `/` : one screen landing page. What BrightSmile does, a link to the demo clinic at `/demo` (a real clinic Kai creates through normal onboarding), Sign up, Log in.
- `/privacy`, `/terms`.

### 5.6 Out of scope for v1

Billing, staff invites and roles (v1 is one login per clinic), analytics dashboards, Play Store app, patient accounts, online payments, dental charts and treatment notes, Filipino language UI, email notifications, a week view, "any available dentist", patient rescheduling (patients cancel and rebook).

## 6. Architecture

- **Next.js App Router** on Vercel. Public pages are Server Components so they load fast on mobile data and produce link previews when shared on Facebook. Mutations are Server Actions. Route Handlers exist only where Next.js requires them: the cron endpoint and the `/auth/confirm` email link callback (pages can't set cookies).
- **Supabase:** Postgres, Auth (email and password), RLS. Migrations live in `supabase/migrations` and are applied with the Supabase CLI via `npx`.
- **Semaphore** for SMS, **web-push** (VAPID) for push notifications, **Vercel Cron** for the daily job.
- No calendar library: the month grid is a small custom component. Native inputs where they fit (`type="date"`, `datalist`, `autocomplete="one-time-code"`).

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `slots` | Pure functions: open start times for a dentist on a date; which dates in a month have any | nothing |
| `phone` | Normalize and validate PH mobiles to `+639XXXXXXXXX`; accept `09…`, `9…`, `639…`, `+639…` | nothing |
| `sms` | Render templates, replace non GSM-7 characters, enforce 160 characters, send via Semaphore (or log in development), write `sms_log` | `phone`, db |
| `otp` | Issue and verify codes, rate limits, verified device cookie | `sms`, db |
| `appointments` | Create, approve, decline, move, cancel, mark completed or no-show; enforce allowed status changes; write events; trigger texts and alerts | `slots`, `sms`, `notify`, db |
| `notify` | Clinic alerts: push to all subscriptions, SMS fallback | web-push, `sms`, db |
| daily job | Reminders, expiry, cleanup, credit check | `appointments`, `sms`, db |

Public pages never receive patient data or busy intervals. The server computes open times and returns only those.

## 7. Data model

All times are `timestamptz`. Every clinic-owned table carries `clinic_id` so one RLS rule covers all of them. Composite foreign keys (for example `appointments (dentist_id, clinic_id)` to `dentists (id, clinic_id)`) make it impossible to attach a row to another clinic's dentist or patient.

| Table | Key columns |
|---|---|
| `clinics` | `name` (up to 80), `sms_name` (up to 20, must not start with "test" in any case), `slug` (unique, 3 to 24 of `[a-z0-9-]`, not reserved; capped so rebooking links fit in texts), `mobile`, `address`, `maps_url`, `slot_minutes` (15, 30, 60; default 30), `min_notice_minutes` (default 120), `max_days_ahead` (default 60), `alert_channel` (`push` or `sms`, default `push`) |
| `clinic_members` | `clinic_id`, `user_id`, `role` (default `owner`); primary key on both ids |
| `dentists` | `name`, `sms_name` (up to 16), `active` |
| `working_hours` | `dentist_id`, `weekday` (0 Sunday to 6 Saturday), `start_time`, `end_time`; several blocks per weekday; blocks may not overlap (validated on save) |
| `time_off` | `dentist_id`, `starts_at`, `ends_at`, `note` |
| `procedures` | `name` (up to 60), `duration_minutes` (5 to 480), `active` |
| `patients` | `first_name`, `last_name`, `mobile` (nullable for manual bookings), `birthday`, `hmo`, `consent_at`, `anonymized_at`; unique on (`clinic_id`, `mobile`, lower first name, lower last name) while not anonymized, so a parent can book several children with one number |
| `appointments` | `dentist_id`, `patient_id`, `starts_at`, `ends_at`, `status`, `procedure_names` (text array copied at booking), `source` (`online` or `manual`), `status_reason` (up to 36), `manage_token` (unique, 12 random base62 characters), `confirmed_at`, `reminder_sent_at` |
| `appointment_events` | `appointment_id`, `from_status`, `to_status`, `actor` (`patient`, `staff`, `system`), `user_id`, `reason` |
| `sms_log` | `clinic_id` (null for texts to the operator), `appointment_id`, `to_mobile`, `kind`, `body` (wiped after 90 days), `credits`, `status` (`logged`, `sent`, `failed`), `provider_message_id`, `error` |
| `otp_requests` | `mobile`, `ip`, `code_hash`, `booking` (jsonb: the pending booking), `attempts`, `expires_at`, `verified_at` |
| `push_subscriptions` | `user_id`, `endpoint` (unique), `p256dh`, `auth` |

Reserved slugs: `a`, `app`, `api`, `auth`, `login`, `signup`, `onboarding`, `forgot`, `reset-password`, `privacy`, `terms`, `admin`, `static`, `_next`.

**Double booking guard:**

```sql
create extension if not exists btree_gist;

alter table appointments add constraint no_overlap
  exclude using gist (dentist_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('pending', 'confirmed'));
```

**RLS:** enabled on every table. Clinic-owned tables allow authenticated users whose `clinic_members` row matches `clinic_id` (the `clinics` row itself matches on `id`), through a `security definer` helper `is_clinic_member(clinic_id)` to avoid policy recursion. No `anon` policies, and `anon` has no table privileges at all. `otp_requests` has RLS enabled and no policies, so only the server (secret key) touches it. The secret key exists only on the server.

## 8. Scheduling rules

Inputs for one dentist and one date (Manila calendar date): that weekday's working blocks, busy intervals (pending and confirmed appointments plus time off), duration (sum of chosen procedures), slot spacing, minimum notice, booking window, and the current instant.

1. Candidate starts are every `slot_minutes` from the start of each working block.
2. A candidate is open when the whole interval `[start, start + duration)` lies inside one working block, overlaps no busy interval, starts at least `min_notice_minutes` after now, and falls on a date no more than `max_days_ahead` days after today.
3. A date is enabled on the month grid when it has at least one open start.
4. When moving an appointment, its own interval is excluded from the busy list.

**Time zone:** Manila is UTC+8 with no daylight saving. Wall-clock times are converted with an explicit `+08:00` offset and never depend on the server's zone (Vercel runs in UTC). Tests cover late-evening bookings, midnight, and month boundaries.

## 9. Flows

### 9.1 Online booking

1. `/{slug}` renders clinic profile, dentists, and procedures.
2. After step 1, the client asks the server for a month's availability (enabled dates) and, per selected date, the open starts.
3. On submit of step 3 the server validates input and re-checks that the start is still open.
   - If the device cookie lists this mobile as verified, go to 5.
   - Otherwise check rate limits, store an `otp_requests` row holding the booking payload and the code hash, send the code, and show the code screen.
4. On code entry the server checks expiry, attempts, and hash, marks the request verified, sets the device cookie, and continues with the stored payload (never a payload resent by the client).
5. One Postgres function, in one transaction, matches or creates the patient, inserts the appointment as `pending`, and writes the event. If the overlap constraint rejects the insert, the patient sees "That time was just taken" and fresh open starts.
6. The clinic is alerted (see 10.4) and the patient sees "Request sent."

Patient matching: same clinic, same normalized mobile, same first and last name ignoring case. Birthday and HMO update to the latest non-empty values.

### 9.2 Status changes

| From | To | Who | Text |
|---|---|---|---|
| none | pending | patient, online, after code or verified device | clinic alert |
| none | confirmed | staff, manual booking | confirmation, if chosen |
| pending | confirmed | staff | confirmation |
| pending | declined | staff | decline |
| pending | cancelled | patient via link | clinic alert |
| pending | expired | daily job, once start time has passed | none |
| confirmed | confirmed (moved) | staff | moved |
| confirmed | cancelled | staff | cancellation |
| confirmed | cancelled | patient via link | clinic alert |
| confirmed | completed or no_show | staff, after start time | none |
| completed | no_show, and back | staff, to fix mistakes | none |

Any other change is rejected. Confirming or moving sets `confirmed_at` to now; moving also clears `reminder_sent_at`. Every change writes an `appointment_events` row.

## 10. Texts and alerts

### 10.1 Templates

Texts use the clinic's `sms_name`, the dentist's `sms_name` only when the clinic has 2 or more active dentists, and the patient's first name cut to 12 characters. Links are full URLs, never shorteners (Smart blocks shorteners): `{link}` is `https://{domain}/a/{token}` and `{bookLink}` is `https://{domain}/{slug}`. The wording below is a draft; the final strings must pass the length test. The field limits (20 character clinic names, 16 character dentist names, 12 character first names, 36 character reasons, 24 character slugs) fit domains up to 17 characters, like `brightsmile.ph` (14); a longer final domain fails the test and the limits shrink to match.

| Kind | To | Route | Draft |
|---|---|---|---|
| `otp` | patient | OTP (2 credits) | "Your code for {clinic} is {code}. It expires in 5 minutes. Don't share it with anyone." |
| `request_alert` | clinic | standard | "New request: {first} {last initial}., {date} {time}. Approve at https://{domain}/app/requests" |
| `confirmed` | patient | standard | "{clinic}: {first}'s visit on {date}, {time} is confirmed. View or cancel: {link}" |
| `declined` | patient | standard | "{clinic} can't take {date}, {time}. {reason} Rebook: {bookLink}" |
| `moved` | patient | standard | "{clinic}: {first}'s visit moved to {date}, {time}. View or cancel: {link}" |
| `cancelled` | patient | standard | "{clinic} cancelled the {date}, {time} visit. {reason} Rebook: {bookLink}" |
| `reminder` | patient | standard | "{clinic}: Reminder, {first}'s visit is tomorrow at {time}. Can't come? Cancel: {link}" |
| `patient_cancel_alert` | clinic | standard | "Cancelled: {first} {last initial}., {date}, {time}." |
| `low_credit` | operator | standard | "BrightSmile: Semaphore balance is {credits} credits. Top up before reminders fail." |

When the dentist is shown (clinics with 2 or more active dentists), "with {dentist}" goes right after the time in `request_alert`, `confirmed`, `moved`, `reminder`, and `patient_cancel_alert`. `declined` and `cancelled` never include it. Dates render as "Thu Sep 24", times as "10:00 AM".

### 10.2 Encoding and length

- Texts are reduced to printable ASCII before sending, minus the GSM-7 extension characters (square brackets, backslash, caret, backtick, curly braces, pipe, tilde), which cost double: accents are stripped (`ñ` becomes `n`), curly quotes become straight, `₱` becomes `PHP`. `ñ` is technically in the GSM-7 alphabet, but gateways differ in how they encode accented letters, and a switch to UCS-2 cuts a part to 70 characters and doubles or triples the cost. Plain ASCII is safe on every gateway. Reasons get a trailing period when they lack one.
- A unit test renders every template with worst-case values (20 character clinic name, 16 character dentist name included, 12 character first name, 36 character reason, 24 character slug, longest date and time, the configured domain) and asserts at most 160 GSM-7 characters. Worked worst cases with `brightsmile.ph`: reminder 157, confirmed 156, cancelled 156, moved 149, declined 147.
- Messages must not start with "TEST" (Semaphore silently drops them). Guaranteed by construction: clinic short names can't start with "test", and no template starts with a patient's name.

### 10.3 Verification codes

- Philippine mobiles only (`+639XXXXXXXXX`).
- 6 digits from a cryptographic random source, generated by BrightSmile and sent through Semaphore's OTP route with the `code` parameter and the `{otp}` placeholder (without the placeholder Semaphore appends the code to the end). Stored as an HMAC hash. In live mode the code never reaches a log (see 10.6).
- Valid 5 minutes, 5 wrong attempts per code, resend allowed after 60 seconds.
- At most 3 codes per mobile and 10 per IP address in any rolling hour. This protects against bots draining SMS credits (each code costs ₱1.12).
- On success, a signed, httpOnly, Secure, SameSite=Lax cookie remembers up to 5 verified mobiles on that device for 180 days. A booking for a remembered mobile skips the code.

### 10.4 Clinic alerts

Events: new request, patient cancelled. If `alert_channel` is `push`, send a push to every subscription of the clinic's members; delete subscriptions that return 404 or 410. If no push was delivered (no subscriptions, or all failed), or `alert_channel` is `sms`, text the clinic mobile instead. Push payloads carry date, time, and dentist only, never patient names. Tapping a push opens `/app/requests`.

The service worker handles `push` and `notificationclick`. The web app manifest makes the dashboard installable (start URL `/app/requests`, standalone display). On iPhone, push works only after adding the app to the home screen (iOS 16.4 or later); Settings explains this.

### 10.5 Cost per booking

At ₱0.56 per credit before VAT:

| Case | Credits | Cost |
|---|---|---|
| New patient: code + confirmation + reminder | 4 | ₱2.24 |
| Returning patient on a remembered device | 2 | ₱1.12 |
| Text alert to the clinic instead of push | +1 | +₱0.56 |
| Reminder skipped (confirmed or moved the same Manila day) | -1 | -₱0.56 |

A clinic with 100 online bookings a month costs roughly ₱150 to ₱300 in texts. Piece 2 should set a monthly text allowance per plan. `sms_log` records real credits per clinic from day one.

### 10.6 Development mode

`SMS_MODE=log` writes texts to `sms_log` with status `logged` and prints them to the server console instead of calling Semaphore. `SMS_MODE=live` sends. Tests and local development always use `log`. In log mode the verification code is stored in the body so the end-to-end test can read it; in live mode the stored body shows `******` in its place.

## 11. Daily job

Vercel Cron, `0 1 * * *` (01:00 UTC = 9:00 AM Manila), calling `/api/cron/daily` with `Authorization: Bearer {CRON_SECRET}`. Every step is idempotent, so a rerun is harmless.

1. **Reminders:** confirmed appointments whose Manila date is tomorrow, `reminder_sent_at` is null, and `confirmed_at` is before today 00:00 Manila. Send, then set `reminder_sent_at`.
2. **Expiry:** pending appointments whose start has passed become `expired`, with an event.
3. **Cleanup:** delete `otp_requests` older than 24 hours; set `sms_log.body` to null after 90 days.
4. **Credit check:** read the Semaphore account balance; below `SMS_LOW_CREDIT_THRESHOLD` (default 500), text `OPERATOR_MOBILE`.

## 12. Privacy and security

- **Roles under the Data Privacy Act (RA 10173):** the clinic is the personal information controller; BrightSmile is its processor. Health details are sensitive personal information.
- **Consent:** required checkbox at booking; `consent_at` stored on the patient.
- **Minimization:** no gender; birthday and HMO optional; push payloads carry no names; the self-service link shows the first name only.
- **Isolation:** RLS as in section 7; tested.
- **Deletion:** "Delete patient" anonymizes: names become "Deleted patient", mobile, birthday, and HMO are cleared, `anonymized_at` is set, appointments stay for counts.
- **Retention:** codes deleted after 24 hours, text bodies wiped after 90 days, cost records kept. Clinic account deletion is a manual, documented procedure in v1.
- **Backups:** Supabase Pro daily backups before real patient data.
- **Secrets:** one `APP_SECRET` for HMAC (code hashes, device cookie); Supabase secret key server-only; `CRON_SECRET` on the cron route.
- **Tokens:** manage tokens are 12 base62 characters from a cryptographic source (about 71 bits).
- **Validation:** every input is validated on the server, whatever the client did.
- **Logs:** never log codes or full patient details.

## 13. Error handling

| Situation | Behavior |
|---|---|
| Slot taken while booking | "That time was just taken" plus fresh open starts |
| Code fails to send | Retry option plus the clinic's phone number |
| Any other text fails | The action still succeeds; `sms_log` records the error; the appointment shows "text not delivered" so staff can call |
| Too many codes requested | "Too many attempts. Try again in an hour or call {clinic phone}." |
| Wrong or expired code | Clear message; after 5 wrong tries a new code is required |
| Semaphore credits low | Daily job texts the operator (section 11) |
| Clinic never answers | Request sent screen tells the patient to call if there's no reply within a day; the request expires when its time passes |
| Hours or time off changed over existing appointments | Nothing is cancelled; affected appointments are flagged "outside hours" |
| Procedure removed | Archived (`active = false`); past appointments keep their copied names |
| Unknown or changed booking link | 404 page: "This booking link doesn't exist" |
| Database unavailable | "Booking is temporarily unavailable. Please try again in a few minutes." |
| Push subscription expired | Deleted on 404 or 410; the alert falls back to a text |

## 14. Testing

- **Vitest unit tests:** `slots` (blocks and breaks, time off, overlaps, minimum notice, booking window, UTC server against Manila dates, month boundaries, moving excludes itself), `phone` (all accepted formats, rejects landlines and foreign numbers), `sms` (worst-case length, GSM-7 replacement), `otp` rules (expiry, attempts, rolling hour limits), status change table, reminder selection, slug validation.
- **Database tests** (Vitest against the development Supabase project, each test creating and removing its own clinics): overlapping pending or confirmed appointments are rejected; a member of clinic A reads nothing from clinic B; `anon` reads nothing.
- **Playwright, one test:** book on the public page, read the code from `sms_log`, verify, approve in the dashboard, see it on the schedule.
- Before any "done" claim: run the app and walk the flows in a browser.

## 15. Project setup

- The project lives in its own folder on a drive with room to spare, with npm's cache pointed at the same drive through a gitignored `.npmrc` (the system drive ran out of space). Remote: [Kaizweeen/BrightSmile](https://github.com/Kaizweeen/BrightSmile). Commits use the GitHub no-reply email.
- Next.js App Router, TypeScript, Tailwind. Dev server on port **3600**, recorded in `.claude/launch.json`.
- First implementation step: `/impeccable init` to write `PRODUCT.md` and `DESIGN.md`, giving the booking page and dashboard their own identity.
- Docker isn't installed, so there is no local Supabase. Development and database tests use one free Supabase project; production gets its own Pro project.
- **Accounts Kai creates** (Claude can't create accounts): Supabase, Semaphore (API key and sender name application), Vercel.
- **Environment variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_CONTACT_EMAIL`, `APP_URL`, `APP_SECRET`, `CRON_SECRET`, `SMS_MODE`, `SEMAPHORE_API_KEY`, `SEMAPHORE_SENDER_NAME`, `SMS_LOW_CREDIT_THRESHOLD`, `OPERATOR_MOBILE`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

## 16. Launch checklist (outside the code)

- [ ] Apply for the Semaphore sender name `BrightSmile` early (free, 2 to 4 weeks; 11 characters, the maximum for a sender name). Real texts can't be sent without it.
- [ ] Vercel Pro (the free plan is non-commercial only) and Supabase Pro (daily backups).
- [ ] Custom SMTP for auth emails (Supabase's built-in email is rate-limited and meant for testing).
- [ ] Terms of Service including a data processing agreement with clinics, and a Privacy Notice.
- [ ] Check whether NPC registration applies (likely once sensitive data on 1,000+ individuals is held).
- [ ] Domain, plus a trademark check on BrightSmile ("Bright Smile" is a common clinic name, so check for conflicts and for patients mistaking the sender for a clinic).
- [ ] Business registration before charging clinics (needed for receipts and payment gateways in piece 2).

## 17. Deferred decisions

| Decision | Deferred to |
|---|---|
| Domain | Before launch |
| Prices and monthly text allowance | Piece 2 |
| Staff invites and roles | Piece 3 |
| Play Store listing | Piece 4 |

## Revisions

2026-09-22, while writing Plan 1:

- Supabase renamed its API keys: the environment uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
- Next.js requires a Route Handler for the auth email link callback, so there are two Route Handlers, not one. Forgot password was added to log in.
- The SMS encoding rule is now plain ASCII. The earlier text said `ñ` is outside GSM-7; it is inside it, but gateways differ, so ASCII is the safe rule.
- The patient-cancel alert starts with "Cancelled:" and clinic short names can't start with "test", so no text can start with "TEST".
- `demo` is no longer reserved (the demo clinic lives at `/demo`); `forgot` and `reset-password` are.
- Composite foreign keys keep rows inside their clinic, and `anon` has no table privileges.

## Sources

- Odonto: [odonto.ph](https://www.odonto.ph/), [Google Play listing](https://play.google.com/store/apps/details?id=ph.odonto.dashboard&hl=en_US)
- Semaphore: [API docs](https://www.semaphore.co/docs), [advisories](https://semaphore.co/advisories)
- [Philippines SMS pricing comparison](https://www.sent.dm/en/resources/sms-pricing/philippines-sms-pricing)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
