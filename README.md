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
- The visit is booked for the next quarter hour, so run it before 23:30 Manila time.

## Going live

Spec section 16 holds the decisions. The steps:

1. **Database.** Create a Postgres 17 database in Singapore (Neon Free to start). From a trusted computer, apply the migrations: `$env:DATABASE_URL = "postgres://..."; npm run db:migrate; Remove-Item Env:DATABASE_URL` in PowerShell, or `DATABASE_URL="postgres://..." npm run db:migrate`, which sets it for that one command. Never leave `DATABASE_URL` set in a window where you then run `npm run dev` (it refuses a remote database for that reason). Run it again after any release that adds a file under `drizzle/`, before that release goes out.
2. **App.** Deploy the repository to Netlify (the free plan allows commercial use; it pauses the site when the month's credits run out, so batch releases about weekly) or to Vercel Pro. The build command is `npm run build`. Set four environment variables: `DATABASE_URL`; `BETTER_AUTH_SECRET` and `SETUP_TOKEN`, each 32 or more random characters, the setup code kept private; and `APP_URL`, the site's https origin with no trailing slash. The server refuses to start if any is missing or if `DATABASE_URL` points at PGlite. The sign-in and join limits count per visitor, by the address in a header the host sets and never takes from the visitor: Netlify's `x-nf-client-connection-ip`, or `x-real-ip` on Vercel (found on its own there). On any other host, set `CLIENT_IP_HEADER` to that host's header.
3. **First run.** Open `/setup` with the setup code to create the practice and the owner. If the owner sees patients, open Staff, edit their own row, and tick "I see patients" before booking or charting their visits. In Settings, add the real branches, hours, chairs, and procedures, then each dentist's weekly schedule, and print each branch's QR poster for its staff room.
4. **Backups.** Neon Free keeps only 6 hours of restore history, so these nightly files are the practice's real backups. Each dump is encrypted to the owner's public key: the computer that runs the job holds no secret, and only the owner can decrypt.
   - Once, on the owner's computer: make a key pair (`gpg --full-generate-key`), keep the private key there and on an offline copy, and export the public key (`gpg --export --armor OWNER_KEY_ID > owner.pub`).
   - On a trusted computer that stays on at night: install pg_dump 17 (it must match the server) and import the public key (`gpg --import owner.pub`). Use Neon's direct connection string, not the pooled one (whose host has `-pooler` in it).
   - Schedule this every night, with Windows Task Scheduler running Git Bash, or with cron elsewhere, and keep the files away from the database host:

   ```bash
   pg_dump --format=custom "$DIRECT_DATABASE_URL" | gpg --encrypt --recipient OWNER_KEY_ID --output "dentasync-$(date +%F).dump.gpg"
   ```

   Before going live, restore one backup into a scratch database on the owner's computer (`gpg --decrypt dentasync-DATE.dump.gpg | pg_restore --dbname "$SCRATCH_DATABASE_URL"`) and note how long it took.
5. **Before go-live.** The practice's real branch names, addresses, phones, hours, and chair labels; the procedure list with durations and turnover; the dentists' check of the PDA legend, surfaces, and exam items; the privacy notice and consent form, reviewed by a lawyer, saying the data is kept in Singapore (RA 10173); and the printed QR posters.
6. **After go-live.** The owner reads the access log in Settings. When someone leaves, disable them on the Staff page: it signs them out at once and lists their upcoming visits to move.
