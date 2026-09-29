# DentaSync

Appointments, chairs, and dental charts for a dental practice with three branches in the Philippines.

- Spec: `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`
- Plans: `docs/superpowers/plans/`

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `BETTER_AUTH_SECRET` and `SETUP_TOKEN`.
3. `npm run seed` fills `.data/dev` with 3 branches, staff, 40 patients, two weeks of visits, and chart entries, exams, and notes on past visits, and prints the sign-in usernames and password once. Run it while the dev server is stopped. To start over, delete `.data/dev` and run it again.
4. `npm run dev`, then open http://localhost:3700. The database migrates itself. Without the seed, open `/setup` to create the owner.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm run seed` | Development data (PGlite only) |
| `npm test` | Unit and database tests (PGlite, no network) |
| `npm run test:e2e` | The end-to-end run, below |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm run db:migrate` | Applies `drizzle/` to the Postgres in `DATABASE_URL` (production) |

## The end-to-end run

`npm run test:e2e` starts its own dev server on port 3701 with a fresh database in `.data/e2e` and walks one visit through setup, a QR join, approval, booking, check-in, start of treatment, charting a tooth, the exam, a note, and completion.

- Stop `npm run dev` first; both would share `.next`.
- Playwright needs a browser once: `npx playwright install chromium`. Or use an installed Chrome or Edge: `$env:PLAYWRIGHT_CHANNEL = "chrome"` in PowerShell, `PLAYWRIGHT_CHANNEL=chrome` elsewhere.
- The visit is booked for the next quarter hour and must end the same day, so run it before 23:00 Manila time.

## Going live

Spec section 16 holds the decisions. The steps:

1. **Database: Supabase.** Create a Supabase project in Southeast Asia (Singapore) and keep its database password in a password manager. Then, in the project:
   - Turn off the Data API (the Enable Data API switch on its page in the dashboard). DentaSync never uses that web API. Every table has row level security, so it would find nothing anyway, but off is safer.
   - Turn on Enforce SSL (Database settings, SSL Configuration).
   - Open Connect and copy two addresses, each with the password filled in: the session pooler (port 5432), for migrations and backups, and the transaction pooler (port 6543), for the app. Use them as shown, without adding `sslmode`: DentaSync checks Supabase's certificate itself (`src/db/ssl.ts`).

   From a trusted computer, apply the migrations with the session pooler address: `$env:DATABASE_URL = "postgresql://..."; npm run db:migrate; Remove-Item Env:DATABASE_URL` in PowerShell, or `DATABASE_URL="postgresql://..." npm run db:migrate`, which sets it for that one command. It prints "The database is up to date." or the database's reason for refusing. Never leave `DATABASE_URL` set in a window where you then run `npm run dev` (it refuses a remote database for that reason). Run it again after any release that adds a file under `drizzle/`, before that release goes out.

   Supabase Free holds 500 MB (years of a 3-branch practice's records), keeps no backups of its own (step 4 makes them), and pauses a project after a week without use. Daily use keeps it awake; after a longer closure, the owner clicks Resume project in the dashboard and the data is all there.
2. **App: Vercel.** Vercel's free Hobby plan is for personal, non-commercial use only, so a practice's app belongs on Pro ($20 a month per member). Import the GitHub repository as a new project and add no variables yet: that first deployment builds but will not start. `vercel.json` runs the server in Singapore, next to the database. Then open Settings, Environment Variables, and add four, each for Production only (untick Preview and Development, so preview builds of unmerged branches never reach the practice's data):
   - `DATABASE_URL`: the transaction pooler address.
   - `BETTER_AUTH_SECRET` and `SETUP_TOKEN`: each 32 or more random characters, the setup code kept private. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` prints one.
   - `APP_URL`: the site's https origin with no trailing slash, the project's `.vercel.app` address or the practice's own domain. Settle it before printing the QR posters, which carry it.

   Then redeploy. The server refuses to start if any is missing or if `DATABASE_URL` points at PGlite. The sign-in and join limits count per visitor, by the address in a header the host sets and never takes from the visitor: `x-real-ip` on Vercel (found on its own there). On any other host, set `CLIENT_IP_HEADER` to that host's header (Netlify's `x-nf-client-connection-ip` is also found on its own).
3. **First run.** Open `/setup` with the setup code to create the practice and the owner. If the owner sees patients, open Staff, edit their own row, and tick "I see patients" before booking or charting their visits. In Settings, add the real branches, hours, chairs, and procedures, then each dentist's weekly schedule, and print each branch's QR poster for its staff room.
4. **Backups.** Supabase Free keeps no backups (its paid plans keep daily ones), so these nightly files are the practice's real backups. Each dump is encrypted to the owner's public key: the computer that runs the job holds no decryption key, only the database address (give it a read-only database role for the dumps), and only the owner can decrypt.
   - Once, on the owner's computer: make a key pair (`gpg --full-generate-key`), keep the private key there and on an offline copy, and export the public key (`gpg --export --armor OWNER_KEY_ID > owner.pub`).
   - On a trusted computer that stays on at night: install the pg_dump of the server's Postgres major version (`select version();` in Supabase's SQL editor shows it) and import the public key (`gpg --import owner.pub`). Download Supabase's certificate (Database settings, SSL Configuration), and set `BACKUP_DATABASE_URL` to the session pooler address with `?sslmode=verify-full&sslrootcert=` and the downloaded file's full path added (for example `C:/backups/prod-ca-2021.crt`), so pg_dump checks that it is talking to Supabase.
   - Schedule this every night, with Windows Task Scheduler running Git Bash, or with cron elsewhere, and keep the files away from the database host:

   ```bash
   pg_dump --format=custom "$BACKUP_DATABASE_URL" | gpg --encrypt --recipient OWNER_KEY_ID --output "dentasync-$(date +%F).dump.gpg"
   ```

   Before going live, restore one backup into a scratch database on the owner's computer (`gpg --decrypt dentasync-DATE.dump.gpg | pg_restore --dbname "$SCRATCH_DATABASE_URL"`) and note how long it took.
5. **Before go-live.** The practice's real branch names, addresses, phones, hours, and chair labels; the procedure list with durations and turnover; the dentists' check of the PDA legend, surfaces, and exam items; the privacy notice and consent form, reviewed by a lawyer, saying the data is kept in Singapore (RA 10173); and the printed QR posters.
6. **After go-live.** The owner reads the access log in Settings. When someone leaves, disable them on the Staff page: it signs them out at once and lists their upcoming visits to move.
