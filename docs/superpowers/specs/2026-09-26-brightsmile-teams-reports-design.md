# BrightSmile piece 3: Teams and reports

- **Date:** 2026-09-26
- **Status:** Draft for Kai's review
- **Scope:** Piece 3 of 4 (roadmap in `2026-09-22-brightsmile-core-booking-design.md`, section 3). Builds on pieces 1 and 2 (billing, plan 5).

A clinic's owner can invite staff with a join link. Staff run the day (requests, schedule, patients); only the owner changes the clinic's setup, pays, and manages the team. Every clinic gets a Reports page with visits, no-shows, and cancellations by week and by dentist, and a free Monday push that sums up the week before.

---

## 1. Decisions

| Question | Decision (Kai, 2026-09-26) |
|---|---|
| Roles | Owner and staff. Staff handle requests, the schedule, new appointments, patients, and dentists' time off. Only the owner changes the clinic profile and rules, dentists, working hours, procedures, billing, and the team. |
| Staff seats | Free. Prices stay by active dentists (piece 2). |
| Invites | The owner copies a join link, valid 7 days, and sends it by Messenger or text. No invite emails. |
| Weekly report | A Reports page, plus a Monday 9:00 AM push summary to the clinic's devices. No text (it would cost a credit per clinic per week). |
| Owners per clinic | Exactly one, the person who signed the clinic up. No ownership transfer in this piece. |
| Clinics per login | Still one. A login that already belongs to a clinic cannot join another. |

## 2. Goals and success criteria

1. An owner can invite a staff member in under a minute, and the staff member is working in the dashboard within 5 minutes of opening the link.
2. Staff can never change the clinic's setup, billing, or team, enforced by RLS and proven by tests, even when a server action is called directly.
3. Nobody outside a clinic can read its team, invites, or reports. Proven by tests.
4. A join link works once, for 7 days, and stops working the moment the owner revokes it.
5. The no-show rate on the Reports page and in the Monday push matches `no_show / (completed + no_show)` for appointments in that Manila week. Proven by tests.
6. Removing a staff member ends their access on their next request.

## 3. Scope

**In:** the owner and staff roles and their RLS, join links, the Team page, removing staff, the Reports page, the Monday push, the service worker opening Reports for that push, staff-aware copy on the billing banner.

**Out:** several owners, ownership transfer, dentist logins with their own calendar, email invites, custom roles, CSV export, charts beyond simple CSS bars, audit log screens, multi-clinic logins.

## 4. Roles and permissions

| Area | Owner | Staff |
|---|---|---|
| Requests, schedule, new appointment, move, attendance, patients | yes | yes |
| Dentists' time off | yes | yes |
| Clinic profile, booking rules, alert channel | yes | no |
| Dentists (add, edit, deactivate), working hours, procedures | yes | no |
| Billing page and payments | yes | sees the status only |
| Team page (invite, revoke, remove) | yes | no |
| Reports | yes | yes |
| Own password and push on own devices | yes | yes |

RLS enforces every "no". The server actions also check the role first (`requireOwner`), so a staff member gets a clear message instead of a silent failure.

## 5. Data model

One migration.

- **`clinic_members`:** the `role` check widens from `owner` only to `owner` or `staff` (existing rows stay owners; the default stays `owner`). New `email` (text, up to 254), copied from `auth.users` when the membership is created (`create_clinic`, `accept_invite`) and backfilled for existing rows, so the Team page can show who is who without reading `auth.users`. Its existing `created_at` is the Team page's joined date.
- **`clinic_invites`:** `id`, `clinic_id` (references `clinics` on delete cascade), `token_hash` (unique; SHA-256 of the token, so a database leak does not leak working links), `created_by`, `created_at`, `expires_at` (7 days later), `accepted_by`, `accepted_at`, `revoked_at`.
- **`clinics.weekly_report_for`** (date, nullable): the Monday a weekly push was last claimed for, so the daily job sends it once.

**Helpers:** `is_clinic_owner(clinic_id)`, security definer like `is_clinic_member`, true when the caller's membership in that clinic has role `owner`.

**Policies (replacing the "members manage" ones where noted):**

- `clinics`: members select; owner update. (No insert or delete for anyone; `create_clinic` inserts.)
- `dentists`, `working_hours`, `procedures`: members select; owner insert, update, delete.
- `time_off`, `patients`, `appointments`, `appointment_events`, `sms_log`, `push_subscriptions`, `clinic_billing`, `payments`: unchanged.
- `clinic_members`: members select every membership of their own clinic (today they see only their own row); no insert, update, or delete for anyone (only `create_clinic` and `accept_invite` insert, and only `remove_member` deletes).
- `clinic_invites`: owner selects, inserts, and updates (revokes) rows of their clinic; nobody else.

Because members can now see each other's membership rows, `signedInStaff()` in `src/lib/supabase/server.ts` and the membership lookup in `src/proxy.ts` must filter by the signed-in user's id instead of relying on RLS to return one row. Without that change the dashboard breaks as soon as a clinic has two members.

**`accept_invite(token)`**, security definer, executable by `authenticated`: hashes the token, locks the invite, and refuses (with distinct error codes) when it does not exist, was revoked, was used, or expired, or when the caller already belongs to a clinic. Otherwise it inserts the caller as `staff` with their email, marks the invite accepted, and returns the clinic id.

**`remove_member(user_id)`**, security definer, executable by `authenticated`: allowed only for the owner of the clinic the member belongs to, never for an owner row. It deletes the membership and that person's push subscriptions for the clinic in one transaction, because the push sender reads subscriptions with the secret key and would otherwise keep alerting a removed person's phone.

**`clinic_week_stats(clinic, from_date, weeks)`**, security invoker (so RLS limits it to the caller's clinic), returns one row per Manila week (Monday to Sunday, by the appointment's start time) and dentist: counts of completed, no-show, cancelled, declined, expired, confirmed-but-past ("not marked yet"), and upcoming, plus online and manual bookings. The daily job calls it with the secret key for the push.

## 6. Flows

### 6.1 Inviting

1. The Team page (`/app/settings/team`, owner only, linked from Settings) lists members (email, role, joined date) and open invites (created, expires).
2. "Create join link" makes a random token (the existing `newToken` helper), stores its hash, and shows `{APP_URL}/join/{token}` once with a Copy button and "Send it by Messenger or text. It works once, for 7 days." The token itself is never stored or shown again.
3. The owner can revoke an open invite and remove a staff member (with a confirm step). The owner row has no remove button.

### 6.2 Joining (`/join/{token}`)

- Signed out: the page says "{clinic} invited you to BrightSmile" (the clinic name comes from a server-side lookup by token hash, through the secret key, showing nothing else), stores the token in an HttpOnly, SameSite=Lax cookie for 7 days, and offers "Create an account" and "I already have an account".
- After signing up and confirming the email, or after logging in, the account has no clinic, so today's flow sends it to `/onboarding`. Onboarding checks the join cookie first and redirects to `/join/{token}` instead of showing the clinic setup.
- Signed in without a clinic: "Join {clinic}" calls `accept_invite`, clears the cookie, and opens `/app/requests`.
- Signed in with a clinic already: "This account already belongs to a clinic. Log out and use another email to join {clinic}."
- Expired, revoked, used, or unknown tokens: "This join link no longer works. Ask the clinic for a new one." The cookie is cleared.
- `join` joins the reserved slugs so no clinic can take `/join`.
- `/join` is noindex and never cached.

### 6.3 Reports (`/app/reports`, owner and staff, in the dashboard nav)

- A week picker (this week and the previous 7 weeks, Monday to Sunday, Manila), defaulting to last week.
- For the chosen week: visits (completed), no-shows, no-show rate, cancellations, declined and expired requests, not marked yet (past confirmed visits nobody marked, with a link to the schedule), online versus manual bookings.
- The same numbers per dentist when the clinic has 2 or more dentists with appointments that week.
- An 8 week table of visits, no-shows, and the no-show rate, with a CSS bar for visits.
- Every number carries its label; nothing relies on colour. Empty weeks say "No appointments this week."

### 6.4 Monday push

A new daily job step. On Mondays (Manila), for each clinic that is not lapsed (piece 2 billing status), had at least one appointment last week, and whose `weekly_report_for` is empty or before this Monday: claim `weekly_report_for = this Monday` with a compare and set, then push to the clinic's devices: title "Last week at {clinic}", body "{n} visits, {m} no-shows ({r}%). Tap to see Reports." No text fallback. The payload carries `type: "weekly"` and counts only, never a patient's name. The service worker opens `/app/reports` for `type: "weekly"` and `/app/requests` for everything else; it still never follows a URL from the payload.

### 6.5 Staff and billing

- The billing banner stays on every dashboard page. For staff it says "Ask your clinic's owner to renew." in place of the payment prompt, and links nowhere.
- `/app/billing` shows staff the status line only, without prices, payment options, or history.

## 7. Security and privacy

- Owner-only writes are enforced in the database; the UI hides what staff cannot use, and server actions check the role for clear messages.
- Join tokens are 12+ random characters from the existing generator, stored hashed, single use, expiring, revocable, and looked up by hash.
- The public `/join` page reveals only the clinic's name, and only for a valid open invite.
- A removed staff member's next request finds no membership, so `requireStaff` sends them to onboarding; `remove_member` deletes their push subscriptions for the clinic in the same transaction, so their phone stops getting alerts.
- Reports show counts only. The Monday push carries counts only.

## 8. Testing

- **Database, offline (tests/sql, PGlite):** staff can read but not insert, update, or delete clinics, dentists, working hours, and procedures; staff can manage appointments, patients, and time off; owners can do both; members see all of their clinic's memberships and nobody else's; staff cannot delete memberships; `remove_member` works only for the clinic's owner, never removes an owner, and deletes the person's push subscriptions too; invites are owner only; `accept_invite` succeeds once and refuses expired, revoked, used, unknown, and already-a-member cases; `clinic_week_stats` counts each status in the right Manila week (a visit at 11:30 PM Sunday Manila time belongs to that week) and respects RLS; the existing isolation tests keep passing.
- **Unit:** week math (Monday start in Manila across month and year ends), the no-show rate (zero visits gives no rate, not a division by zero), the push text, the join page states, the Monday selector.
- **Not possible locally:** the dashboard against a real database (no development project). Pages are checked by typecheck, build, and review, then walked on production after deploy.

## 9. Error handling

- `accept_invite` errors map to the join page messages above; unexpected errors log where and why and show "Something went wrong. Try the link again."
- A failed push for one clinic never stops the others or the other daily steps.
- If `clinic_week_stats` fails, the Reports page shows "Reports are not available right now." and logs the error; the rest of the dashboard is unaffected.

## Revisions

None yet.
