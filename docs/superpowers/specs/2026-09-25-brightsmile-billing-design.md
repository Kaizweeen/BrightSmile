# BrightSmile piece 2: Billing

- **Date:** 2026-09-25
- **Status:** Draft for Kai's review
- **Scope:** Piece 2 of 4 (roadmap in `2026-09-22-brightsmile-core-booking-design.md`, section 3). Builds on piece 1 as deployed.

Clinics get a free trial at signup, then pay months ahead. Until the business is registered they pay by GCash transfer and Kai records the payment; once PayMongo keys exist, clinics can also pay online and the payment records itself.

---

## 1. Decisions

| Question | Decision |
|---|---|
| Prices | By active dentists at the time of payment: 1 to 2 dentists ₱399 a month, 3 to 6 ₱1,299, 7 or more ₱1,799. Kai had no preference, so these follow the recommendation (they match Odonto). They live in one constant and can change without a migration. |
| Trial | 14 days from signup. Kai had no preference; this follows the recommendation. |
| Texts | Unlimited: no monthly allowance (Kai's decision). The admin page shows each clinic's credits this month so heavy use is visible. If a cap is ever added, Kai's chosen behavior is to pause day-before reminders only, never codes, confirmations, or cancellations. |
| How clinics pay | GCash transfer to Kai, recorded by Kai on an admin page. PayMongo checkout (GCash, Maya, card) turns on when its two keys are set. No automatic renewal: e-wallets cannot be charged automatically, so clinics prepay 1 to 12 months. |
| When a plan ends | A heads-up 3 days before (dashboard banner, plus one push or text). Then 3 days of grace. After that the public booking page pauses and reminder texts stop. The dashboard keeps working, so a clinic never loses access to its own data. |
| Gateway | PayMongo (Xendit's card subscriptions skip GCash, which most clinics use). Live PayMongo keys need a registered business (piece 1 launch checklist). |

## 2. Goals and success criteria

1. A new clinic gets its 14 day trial automatically at signup, with nothing to set up.
2. The Billing page tells a clinic, on one screen, when its plan ends, what it owes for how many months, and how to pay.
3. A PayMongo payment extends the plan exactly once, even when the webhook is delivered twice. Proven by a test.
4. Kai records a GCash payment in under a minute.
5. After the grace period a lapsed clinic's booking page takes no new requests, and nothing else in the dashboard breaks.
6. Clinic staff can read their own billing state and can never change it, or see another clinic's. Proven by a test.

## 3. Scope

**In:** trial rows, the status rules, the Billing page, the admin page, GCash payment recording, PayMongo checkout and its webhook, the heads-up alert, pausing a lapsed clinic's booking page and reminders, the dashboard banner, an offline database test harness (section 9).

**Out:** automatic renewal, official receipts and invoices (BIR; Kai issues them outside the app for now, and PayMongo emails its own payment receipts), discounts and coupons, refunds and proration, a text allowance, Xendit, charging for staff seats (piece 3 decides).

## 4. Prices and amounts

- `src/lib/billing.ts` holds the tier table: `{ maxDentists: 2, pesos: 399 }`, `{ maxDentists: 6, pesos: 1299 }`, `{ maxDentists: Infinity, pesos: 1799 }`, with names Solo, Team, and Group.
- The tier comes from the clinic's active dentists when the amount is shown or charged. A clinic with no active dentists pays the Solo price.
- Amount due = tier price x months, months from 1 to 12. Amounts are stored in centavos.
- Each payment row stores what was actually paid, so a price change never rewrites history.

## 5. Status rules

Each clinic has `trial_ends_at` and `paid_through` (null until the first payment). Let `ends_at` be the later of the two.

| Status | When | Booking page |
|---|---|---|
| `active` | `paid_through` is after now | open |
| `trial` | not active, and `trial_ends_at` is after now | open |
| `grace` | not active or trial, and now is less than 3 days after `ends_at` | open |
| `lapsed` | otherwise | paused |

One pure function, `billingStatus(billing, now)`, returns the status, `ends_at`, and whether booking is open. Every caller (booking page, booking actions, daily job, banner, Billing page, admin page) uses it, so the rule lives in one place.

A payment extends from the latest of `paid_through`, `trial_ends_at`, and now, so paying during the trial never loses trial days and paying after a lapse starts today.

## 6. Data model

One migration.

**`clinic_billing`:** `clinic_id` (primary key, references `clinics` on delete cascade), `trial_ends_at` (not null), `paid_through` (nullable), `renewal_notice_for` (nullable; the `ends_at` a heads-up was already sent for), `created_at`.

**`payments`:** `id`, `clinic_id` (references `clinics` on delete cascade), `method` (`gcash` or `paymongo`), `amount_centavos` (above 0), `months` (1 to 12), `reference` (the GCash reference number or the PayMongo checkout session id, up to 100), `provider_session_id` (unique, null for GCash), `recorded_by` (the admin's user id for GCash, null for PayMongo), `paid_through_after`, `paid_at` (default now).

**RLS:** both tables have RLS on. Members of the clinic may select their rows (through the existing `is_clinic_member`). `authenticated` and `anon` get no insert, update, or delete, so only the server's secret key writes billing. The clinic's own settings policy does not reach these tables.

**`create_clinic`** also inserts the clinic's `clinic_billing` row with `trial_ends_at = now() + 14 days`. The migration backfills a row for every clinic that has none (production has none at the time of writing).

**`record_payment(clinic, method, amount_centavos, months, reference, session_id, recorded_by)`**, executable by `service_role` only, in one transaction:

1. Lock the clinic's `clinic_billing` row.
2. If `session_id` is given and a payment with it exists, return `duplicate` and change nothing.
3. Set `paid_through` to the latest of `paid_through`, `trial_ends_at`, and now, plus `months`; clear `renewal_notice_for`.
4. Insert the payment with `paid_through_after` and return `ok` with the new `paid_through`.

The unique `provider_session_id` backs up step 2 if two deliveries race.

## 7. Flows

### 7.1 Billing page (`/app/billing`, linked from Settings and from the banner)

- Status line: "Free trial until Oct 9", "Paid until Mar 3", "Your plan ended Sep 30. Online booking reopens when you pay." (grace and lapsed say how many days are left or that booking is paused).
- The tier, its price, and the active dentist count it is based on.
- A months picker (1, 3, 6, 12) and the amount due.
- **Pay by GCash:** Kai's GCash name and number (`BILLING_GCASH_NAME`, `BILLING_GCASH_NUMBER`), the amount, and the reference to type in the GCash note: the clinic's booking link name (its slug). "Your plan is extended once we see the payment, usually the same day."
- **Pay online** (only when PayMongo is configured): opens PayMongo checkout for the chosen months.
- Payment history: date, months, amount, method.

### 7.2 GCash payment

The clinic sends the amount with its slug as the note. Kai sees it in the GCash app, opens `/admin`, finds the clinic, and records it: months, amount, and the GCash reference number. That calls `record_payment` with method `gcash` and `recorded_by` set to Kai's user id.

### 7.3 PayMongo payment

1. "Pay online" posts a server action that computes the amount on the server and creates a checkout session: `POST https://api.paymongo.com/v1/checkout_sessions`, basic auth with the secret key, one line item ("BrightSmile {tier} plan, {n} months", amount in centavos, `PHP`, quantity 1), `payment_method_types` `gcash`, `paymaya`, `card`, `success_url` `{APP_URL}/app/billing?paid=1`, `cancel_url` `{APP_URL}/app/billing`, `reference_number` the slug, `metadata` with the clinic id and months, `send_email_receipt` true. It redirects to the returned `checkout_url`.
2. PayMongo calls `POST /api/paymongo/webhook`. The route reads the raw body and verifies the `Paymongo-Signature` header (`t=...,te=...,li=...`): HMAC-SHA256 of `{t}.{raw body}` with `PAYMONGO_WEBHOOK_SECRET`, compared in constant time against `li` for live events and `te` for test events, rejecting timestamps more than 3 days from now in either direction (PayMongo does not document whether its retries are signed again, and `record_payment` makes a replayed delivery harmless). A bad signature gets 401.
3. For `checkout_session.payment.paid` it takes the session id, the metadata, and the amount paid, and calls `record_payment` with method `paymongo`. `ok` and `duplicate` both answer 200. Any other event answers 200 and is ignored. A database failure answers 500 so PayMongo retries, which is safe because the payment records once.
4. `?paid=1` on the Billing page says "Payment received. Your plan updates within a minute." The page never trusts the query string for the plan itself.

### 7.4 Heads-up before the end

A new daily job step: for each clinic whose `ends_at` is after now and at most 3 days away, and whose `renewal_notice_for` differs from `ends_at`, first set `renewal_notice_for = ends_at` where it still differs (compare and set, like reminders), then alert the clinic by the same channel rule as spec 10.4: a push to its members when the clinic chose push, a text to the clinic mobile when no push was delivered or it chose texts. Text template `renewal`: "BrightSmile: your plan for {clinic} ends {date}. Pay in the app to keep online booking open: {APP_URL}/app/billing". It fits 160 GSM-7 characters with a 20 character clinic name and a 17 character host. The push says "Your BrightSmile plan ends {date}" and, like every push, opens `/app/requests`, where the banner links to Billing.

### 7.5 Lapsed clinics

- The public booking page shows "{clinic} is not taking online requests right now. Call {mobile} to book." and no booking form.
- The booking server actions check the status too and refuse with the same message, so an open tab cannot slip a request in.
- The daily job sends no reminders for a lapsed clinic's appointments.
- The manage link (`/a/...`) keeps working, so patients can still see and cancel.
- Everything under `/app` keeps working. A banner on every dashboard page reads "Online booking is paused. Pay to reopen it." (lapsed), "Your plan ended. Online booking pauses on {date}." (grace), or "Your plan ends on {date}." (3 days or less before the end), each linking to Billing.

### 7.6 Admin page (`/admin`)

- Allowed only for a signed-in user whose confirmed email is in `OPERATOR_EMAILS` (comma separated). Everyone else gets a 404. Checked on the page and in every admin action.
- Lists every clinic: name, slug, status, `ends_at`, active dentists, credits of texts sent this month (status `sent`, Manila calendar month, from `sms_log`), and the last payment.
- Actions: record a GCash payment (months, amount prefilled from the tier, reference); extend a trial by a number of days (from the later of `trial_ends_at` and now).
- Admin reads and writes use the secret-key client after the operator check, because they cross clinics. This is the one addition to where the secret key is used, and it sits behind that check.
- `/admin` sends `X-Robots-Tag: noindex, nofollow`. `admin` is already a reserved slug.

## 8. Security and privacy

- Billing state is written only by the server: `record_payment`, the admin actions, and `create_clinic`. RLS tests prove staff cannot write it.
- The webhook trusts nothing it cannot verify: signature, timestamp tolerance, and months from our own metadata on a session our server created with the secret key.
- PayMongo keys and the webhook secret are server only and never logged. Webhook errors log where and the error message only (`logError`).
- The admin page shows no patient data: counts and billing only.
- No card or e-wallet data ever touches BrightSmile; PayMongo's hosted checkout collects it.

## 9. Testing

- **Unit:** `billingStatus` at every boundary (trial end, paid through, 3 day grace, payment during trial), tier and amount for 0, 2, 3, 6, 7 dentists and 1 to 12 months, PayMongo signature verification (valid live, valid test, wrong secret, altered body, stale timestamp, malformed header), the `renewal` template at 160 characters worst case.
- **Database, offline:** a new PGlite harness (`@electric-sql/pglite`, dev dependency) applies every migration in order on an in-process Postgres with a small stand-in for Supabase's roles and `auth.uid()`, then runs SQL tests as `authenticated` users. There is no development Supabase project any more (the original one is production), and no Docker, so this is the only safe place to prove a migration before Kai pastes it into production. A spike on 2026-09-25 applied all six existing migrations and showed RLS isolation working. Tests: `create_clinic` makes a trial row; members read only their own billing and payments; members cannot insert, update, or delete either table; `record_payment` extends from the right base in all three cases; a repeated session id changes nothing; the harness also re-checks the existing isolation and double booking guards so every future migration runs against them.
- **Not possible locally:** the dashboard UI against a real database, because no development project exists. The pages are checked by typecheck, build, and review, then walked on production after deploy. The existing `test:db` and Playwright suites keep their production guard and run again once a development project exists.

## 10. Environment

| Variable | Needed |
|---|---|
| `OPERATOR_EMAILS` | Production (the startup check requires it) |
| `BILLING_GCASH_NAME`, `BILLING_GCASH_NUMBER` | Production (the startup check requires them) |
| `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` | Optional, both or neither (the startup check refuses one without the other). PayMongo's webhook is created in its dashboard for `checkout_session.payment.paid`, pointing at `{APP_URL}/api/paymongo/webhook`. |

## 11. Error handling

- PayMongo checkout creation fails: the Billing page says "Online payment is not available right now. You can pay by GCash." and logs the error.
- The webhook's database call fails: 500, so PayMongo retries; `record_payment` makes the retry safe.
- A missing `clinic_billing` row (should not happen after the backfill) is treated as a trial that ended at the clinic's creation, so the clinic lands in grace or lapsed and the banner points to Billing instead of a crash.

## Revisions

2026-09-26, from review of the implementation:

- Webhook timestamp tolerance is 3 days either way, not 5 minutes, so PayMongo's retries of an old delivery still verify (7.3).
- The migration gives existing clinics a fresh 14 day trial from the moment it runs, so none pauses at deploy (6).
- Two more service-role functions: `extend_trial` (the admin page's trial extension, 1 to 365 days) and `admin_overview` (the admin page's clinic list in one call) (6, 7.6).
- GCash reference numbers are unique, so the same transfer cannot be recorded twice (6, 7.2).
- A PayMongo payment must carry its checkout session id, and a GCash payment must not (6).
- Production refuses a PayMongo test secret key at start, and the webhook ignores test events in production (7.3, 10).
- `record_payment` adds months on the Manila calendar, whatever the session time zone (6).
- The offline harness pins PGlite to 0.4.6, which is Postgres 17 like production (9).
- The amount recorded for a PayMongo payment counts only the checkout's paid attempts, never failed ones (7.3).
- A paid webhook for a clinic that no longer exists answers 200 and logs a refund reminder instead of 500, so PayMongo stops retrying (7.3, 11).
- A paused clinic's booking actions refuse before a verification code is checked or spent, not only before one is sent (7.5).
