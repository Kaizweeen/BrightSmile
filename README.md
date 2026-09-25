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
| `npm run test:e2e` | The Playwright booking test (starts the dev server if needed) |
| `npm run test:e2e:install` | Download Chromium for Playwright (once) |
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## End-to-end test

One Playwright test walks the whole booking loop: a patient books on a clinic's page, the code is read from `sms_log`, the clinic approves in the dashboard, and the visit shows on the schedule.

1. Once: put `PLAYWRIGHT_BROWSERS_PATH=D:\playwright-browsers` (or any folder on a drive with space) in `.env.local`, then run `npm run test:e2e:install`.
2. Run `npm run test:e2e`. It uses the dev server on port 3600, starting it if needed, with `SMS_MODE=log`. If a dev server is already running, it must be in log mode too (the test reads the code from `sms_log`).

The test creates its own clinic and staff login in the development Supabase project and deletes them afterwards. Like `npm run test:db`, it refuses to run against any other project, because it uses the secret key.

## Deploy to production

Do these in order. Kai creates the accounts; nothing here can be done from code. Merge a release branch to `main` only after steps 2 to 4 are done: every merge to `main` deploys production straight away.

### 1. Accounts

- Vercel Pro (the free plan is for non-commercial use) and Supabase Pro (daily backups), both before real patient data.
- Semaphore: apply for the sender name `BrightSmile` early (2 to 4 weeks). Real texts can't go out without it.
- The domain. Its host must be at most 17 characters (`brightsmile.ph` is 14), because every text is sized for that. A longer host means the SMS field limits (the text templates) have to shrink instead.

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
5. **Authentication > Emails > SMTP Settings:** set up custom SMTP; it is required. Supabase's built-in sender only delivers to members of your Supabase team, at most 2 emails an hour, so clinics would never get their sign-up email. Without a domain of your own, a Gmail account works: host `smtp.gmail.com`, port `465`, username and sender email = the Gmail address, password = a Google App Password (needs 2-Step Verification).
6. Keep email confirmation on (**Authentication > Sign In / Providers > Email**).

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

   For **Preview**, use the development Supabase keys, `SMS_MODE=log`, and set `APP_URL` to any fixed preview URL of the project (for example the `main` branch alias shown on a preview deployment); previews only log texts, so the exact value matters little, but it must be set or previews fail to start. Previews never text anyone and never run the cron job.

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
7. Before charging clinics: check whether NPC registration applies (likely once sensitive data on 1,000 or more people is held), run a trademark check on BrightSmile, and register the business.
