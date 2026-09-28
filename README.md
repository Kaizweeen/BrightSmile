# BrightSmile

Online booking for dental clinics in the Philippines. Patients request a time from the clinic's booking link, the clinic approves it, and patients get text confirmations and reminders.

BrightSmile is free for clinics, with no billing anywhere in the app, and web-only: there is no Play Store app.

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
| `npm test` | Unit tests and the offline database tests (`tests/sql`, PGlite), no network needed |
| `npm run test:db` | Database tests against a development Supabase project (they refuse production) |
| `npm run test:e2e` | The Playwright booking test (starts the dev server if needed) |
| `npm run test:e2e:install` | Download Chromium for Playwright (once) |
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## End-to-end test

One Playwright test walks the whole booking loop: a patient verifies their number on a clinic's page (the code is read from `sms_log`), fills in the patient form, and books; the clinic approves in the dashboard; and the visit shows on the schedule.

1. Once: put `PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers` (or any folder on a drive with space) in `.env.local`, then run `npm run test:e2e:install`.
2. Run `npm run test:e2e`. It uses the dev server on port 3600, starting it if needed, with `SMS_MODE=log`. If a dev server is already running, it must be in log mode too (the test reads the code from `sms_log`).

The test creates its own clinic and staff login in the development Supabase project named in `.env.local` and deletes them afterwards. Like `npm run test:db`, it refuses to run against production, because it uses the secret key.

## Deploy to production

Do these in order. Kai creates the accounts; nothing here can be done from code. Merge a release branch to `main` only after steps 2 to 4 are done: every merge to `main` deploys production straight away.

### 1. Accounts

- Vercel Pro (the free plan is for non-commercial use) and Supabase Pro (daily backups), both before real patient data.
- Semaphore: apply for the sender name `BrightSmile` early (2 to 4 weeks). Real texts can't go out without it.
- The domain. Its host must be at most 17 characters (`brightsmile.ph` is 14), because every text is sized for that. A longer host means the SMS field limits (the text templates) have to shrink instead.

### 2. Supabase production project

Production is the project with ref `fmvqwojzsklinbdmfjkn` (first created as `brightsmile-dev`, and empty at launch). Migrations 1 to 6 are already applied there, so for it start at step 3; migrations 7 and 8 are pasted as described under "Teams and reports" and "Branches and the booking engine" below. Steps 1 and 2 set up any new project, such as the separate development project that the database and e2e tests need.

1. Create a new project, region Singapore. From **Project Settings > API Keys** copy the project URL, the publishable key, and the secret key.
2. Apply the migrations in filename order: open each file in `supabase/migrations`, paste it into the **SQL Editor**, and run it before opening the next.

   | Order | File |
   |---|---|
   | 1 | `20260922000100_schema.sql` |
   | 2 | `20260922000200_access.sql` |
   | 3 | `20260922000300_booking_functions.sql` |
   | 4 | `20260924000100_hardening.sql` |
   | 5 | `20260924000200_default_function_privileges.sql` |
   | 6 | `20260925000100_otp_issue_lock.sql` |
   | 7 | `20260926000100_teams.sql` |
   | 8 | `20260928000100_branches_booking.sql` |

   Migrations run by hand are not recorded in the project's migration history. Before you ever use `npm run db:push` against this project, link it and mark them as applied, or the CLI will try to run them again:

   ```powershell
   npx supabase link --project-ref <production-project-ref>
   npx supabase migration repair --status applied 20260922000100 20260922000200 20260922000300 20260924000100 20260924000200 20260925000100 20260926000100 20260928000100
   ```

3. **Authentication > URL Configuration:** Site URL = your `APP_URL` (for example `https://brightsmile.ph`); add `https://brightsmile.ph/**` under Redirect URLs.
4. **Authentication > Email Templates:**
   - Confirm signup: link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - Reset password: link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
5. **Authentication > Emails > SMTP Settings:** set up custom SMTP; it is required. Supabase's built-in sender only delivers to members of your Supabase team, at most 2 emails an hour, so clinics would never get their sign-up email. Without a domain of your own, a Gmail account works: host `smtp.gmail.com`, port `465`, username and sender email = the Gmail address, password = a Google App Password (needs 2-Step Verification).

### 3. Keys

```powershell
npx web-push generate-vapid-keys
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The first prints the VAPID public and private keys. Run the second twice, once for `APP_SECRET` and once for `CRON_SECRET`. Never reuse development values in production.

### 4. Vercel project

The Vercel project `bright-smile` already exists and is Git-connected: pushes to `main` deploy to production automatically. There is no import step.

1. The framework is set to Next.js in `vercel.json` (`"framework": "nextjs"`), which overrides the project's Framework Preset; without it Vercel served every page as a 404. No build settings change. Functions run in Singapore (`regions` in `vercel.json`), next to the database.
2. **Settings > Environment Variables**, for the **Production** environment. Production refuses to start until `APP_URL` has a host of at most 17 characters (the default `bright-smile.vercel.app` is 23, too long for the texts; a short one like `bsmile.vercel.app` or a bought domain works), so attach it (step 4) before the first production deploy. If the site shows errors, check **Logs** for "BrightSmile environment check failed"; it names each missing or wrong variable.

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

   For **Preview**, use the development Supabase keys (until a development project exists, leave Preview unset: previews then fail to start, which is harmless), `SMS_MODE=log`, and set `APP_URL` to any fixed preview URL of the project (for example the `main` branch alias shown on a preview deployment); previews only log texts, so the exact value matters little, but it must be set or previews fail to start. Previews never text anyone and never run the cron job.

   The server checks these at start and refuses to run, listing the variable names, when one is missing or malformed (`src/lib/env.ts`). Redeploy after changing any of them: `NEXT_PUBLIC_` values are built into the pages.
3. **Settings > Deployment Protection:** must be off for the production domain, or patients can't open booking links. Use a custom domain (Deployment Protection only ever applies to the `*.vercel.app` deployment URL, never to an attached custom domain) or turn Vercel Authentication off entirely; never leave "All Deployments" protection on the domain patients use. Check with `curl.exe -s -o NUL -w "%{http_code}" https://brightsmile.ph/`, which must print `200`.
4. **Settings > Domains:** add the domain and follow the DNS instructions. Remember the 17-character host limit from step 1.
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
6. Check the daily job weekly under **Settings > Cron Jobs** (a failed run shows as an error there), or add a Vercel alert or log drain.
7. Before launch: check whether NPC registration applies (likely once sensitive data on 1,000 or more people is held), run a trademark check on BrightSmile, and register the business.

## Teams and reports

A clinic's owner invites staff with a join link (spec: `docs/superpowers/specs/2026-09-26-brightsmile-teams-reports-design.md`). Staff handle requests, the schedule, new appointments, patients, and dentists' time off; only the owner changes the clinic profile and booking rules, dentists, working hours, procedures, and the team. The database enforces this, not only the pages. Staff cannot see their colleagues' emails either: a staff member reads only their own membership row, and the owner reads every membership (RA 10173 data minimization); the Team page itself is owner only. Staff seats are free. Every clinic also gets a Reports page and a Monday 9:00 AM push that sums up the week before.

### Apply the teams migration (once, before merging the teams branch)

Every merge to `main` deploys, and the new code reads the new columns and functions, so the migration goes first. The OTP locking migration must already be in production: the teams migration checks this itself and refuses to run (it fails on its first statement) if `issue_otp` does not exist yet, so pasting it out of order fails fast instead of leaving `clinic_members` half migrated.

1. Make sure production's `create_clinic` is still the one in `supabase/migrations/20260922000200_access.sql`, because this migration replaces it and a fix made there by hand would be lost. Run `select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure);` in the production **SQL Editor** and compare the body (between the `$function$` markers) with `create_clinic` there. If they differ, stop and fold the difference into the teams migration first.
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

**Reports**, in the dashboard nav, shows a Manila week's (Monday to Sunday) visits, no-shows, no-show rate, cancellations, declined and expired requests, visits nobody marked yet, and online versus staff bookings, per dentist when 2 or more had appointments, and an 8 week table. Every Monday the daily job pushes "Last week at {clinic}" with the week's visits, no-shows, and no-show rate to each clinic that had appointments; tapping it opens Reports. There is no text fallback (it would cost a credit per clinic per week). The daily job's JSON reports how many clinics the push reached as `"weekly"`.

## Branches and the booking engine

A clinic can have several branches, each with its own address and calendar (spec: `docs/superpowers/specs/2026-09-26-brightsmile-booking-flow-branches-design.md`). The booking page opens on three choices: book an appointment, reschedule or edit a booking, or cancel one. Every path starts with the patient's mobile number and a 6 digit code by text (a phone that verified the number before goes straight on). Then the patient books for one of the number's patients or for someone new with the clinic's patient form and waiver, changes a booking (it goes back to the clinic for approval, and the clinic gets a "Changed request" alert), or cancels one. Every clinic starts with one branch, "Main". Once it has 2 or more active branches, patients choose a branch when they book, the dashboard names each visit's branch and filters by it, New appointment and each dentist's working hours ask for the branch, and patients' texts name the branch after the clinic (for example "Bright Dental Makati").

Answers on the patient form are health information, sensitive personal information under RA 10173: only the clinic's members read them (read only, in a "Patient form" section on the patient page), they never appear in texts, pushes, logs, reports, or URLs, and deleting a patient clears all of them. The form's fields (`src/lib/intake.ts`) and the waiver's wording (`src/lib/waiver.ts`) are our draft: they still need Kai's corrections and legal review, and changing the waiver's words means a new `WAIVER_VERSION`.

### Apply the branches migration (once, before merging the branches branch)

Every merge to `main` deploys, and the new code reads the new table, columns, and functions, so the migration goes first. The teams migration must already be in production: this migration checks it and refuses to run (it fails on its first statement) if `clinic_invites` does not exist yet.

1. Make sure production's `create_clinic` is still the one in the teams migration and `create_booking` still the one in the hardening migration, because this migration replaces both and a fix made there by hand would be lost. In the production **SQL Editor**, run `select pg_get_functiondef('public.create_clinic(jsonb)'::regprocedure);` and compare the body (between the `$function$` markers) with `create_clinic` in `supabase/migrations/20260926000100_teams.sql`; then run `select pg_get_functiondef(p.oid) from pg_proc p where p.proname = 'create_booking';` and compare it with `create_booking` in `supabase/migrations/20260924000100_hardening.sql`. If either differs, stop and fold the difference into the branches migration first.
2. Open `supabase/migrations/20260928000100_branches_booking.sql`, paste it into the production **SQL Editor**, and run it. Every clinic gets one branch, "Main", with the clinic's address and map link, holding all its working hours and appointments. `npm test` has already applied it to an offline copy of the schema (`tests/sql`).
3. Run `notify pgrst, 'reload schema';` so the API sees the new `create_booking` and `change_booking` at once.
4. Check it: `select count(*) from public.clinics c where (select count(*) from public.branches b where b.clinic_id = c.id and b.active) <> 1;` must return `0`.
5. Merge the branch right away. Until the deploy finishes, saving a dentist's working hours in Settings fails (the old code names no branch); saving again after the deploy works. Everything else keeps working in between.
6. If you ever link the project for `npm run db:push`, mark it applied first: `npx supabase migration repair --status applied 20260928000100`.

The booking pages need no migration of their own: they use the branches migration above.

### Add a branch

1. As the owner, open **Settings**. Under **Branches**, press **Edit** on "Main" and give it its real name, address, and map link: patients see them on the booking page and on the page linked from every text. The clinic profile's address stays the clinic's own.
2. Press **Add a branch**. Its short name for texts goes after the clinic's name for texts, and the two must fit in 20 characters together (for example "Bright Dental" leaves 6, enough for "Makati"). Settings says how many characters are left, checks every active branch when a second becomes active, and refuses a clinic name for texts that leaves no room.
3. Open each dentist in **Settings**: with 2 or more active branches, every block of working hours has a **Branch**. One dentist's blocks may not overlap, even at two branches.
4. **Move up** and **Move down** set the order patients see. **Deactivate** takes a branch off the booking page; its visits stay on the schedule, and the last active branch cannot be deactivated.
