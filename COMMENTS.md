# Review Comments: BrightSmile / DentaSync

Repository: Kaizweeen/BrightSmile (README title: DentaSync)
Scope: README, repository structure, and the deployment and operations notes.
Format: each comment has a type (Strength, Suggestion, Risk, Question) and a suggested action.

---

## 1. Strengths

| # | Area | Comment |
|---|------|---------|
| S1 | Documentation | The README covers setup, scripts, the end-to-end run, going live, backups, and post-launch checks. A new contributor can run the project without asking anyone. |
| S2 | Specs and plans | Specs and plans live in `docs/superpowers/`, and the README links to them. Decisions are traceable. |
| S3 | Testing | There are unit and database tests (PGlite, no network) plus a Playwright end-to-end run that walks a full patient visit. This is strong coverage for a project of this size. |
| S4 | Security | Row level security on every table, the Supabase Data API turned off, Enforce SSL, certificate checking in `src/db/ssl.ts`, and a hashed visitor address instead of the raw IP. These are sound privacy-by-design choices. |
| S5 | Backups | Nightly dumps are encrypted to the owner's public key, and the job holds no decryption key. The README also requires a restore test before go-live. |
| S6 | Seed data | `npm run seed` creates 3 branches, staff, 40 patients, and two weeks of visits, so the app is usable immediately in development. |

---

## 2. Suggestions

**G1. Naming consistency**
The repo is `BrightSmile`, the README title is `DentaSync`, and the About link points to `brightsmile.pro`.
Action: pick one product name, or add one line in the README explaining the relationship (e.g. "DentaSync is the system; BrightSmile is the clinic").

**G2. Move the "Going live" section out of the README**
It is much longer than the rest of the file.
Action: move it to `docs/DEPLOYMENT.md` and leave a short summary and link in the README.

**G3. Add a CI workflow**
GitHub is suggesting generic workflows, which suggests no workflow exists yet.
Action: add `.github/workflows/ci.yml` that runs `npm ci`, `npm run lint`, `npm run typecheck`, and `npm test` on every pull request. Add a status badge to the README.

**G4. Make the end-to-end test independent of the clock**
The README says the test must run before 23:00 Manila time because the visit must end the same day.
Action: inject or mock the current time in the test, or book the visit at a fixed time, so the test passes at any hour and can run in CI.

**G5. Add a license**
No license is mentioned.
Action: add a `LICENSE` file, or state that the code is proprietary or for coursework only.

**G6. Add a troubleshooting section**
The README covers the happy path but not common failures (port 3700 or 3701 in use, a stale `.next` folder, a Playwright browser not installed, `db:migrate` refusing to connect).
Action: add a short table of symptom and fix.

**G7. Add a "Contributing" note**
There are 6 contributors, including bots, and `AGENTS.md` and `CLAUDE.md` exist.
Action: add a short note on branch naming, pull request expectations, and which checks must pass before merging.

---

## 3. Risks

**R1. Irreversible migration 0004 (online booking release)**
Migration 0004 drops the old procedure length columns. The running release still reads them, and the change cannot be undone. The README acknowledges this and gives a procedure, but it still means downtime and manual coordination.
Action: rehearse it on a copy of the production data first. For future releases, keep the expand/contract pattern the README already promises ("later releases add before they drop").

**R2. Deletion of patient forms depends on someone listing or sending them**
Forms older than 30 days are deleted "the next time forms are listed or sent". If nobody opens that page, old forms stay in the database longer than the privacy notice may state.
Action: add a scheduled job (e.g. Vercel Cron) that deletes expired forms, and make the notice match the actual behaviour.

**R3. Shared connections and the 5-per-hour limit**
Patients on the clinic Wi-Fi share one address, so a busy waiting room can hit the limit of five forms an hour.
Action: consider a higher per-connection limit for forms, or a staff-assisted fallback that is clearly signposted. Monitor how often the "ask at the front desk" message appears after launch.

**R4. Minors and the patient form**
The README says the form has no guardian field and leaves the question of who may agree for a child to the lawyer.
Action: get that answer before go-live, and consider adding a guardian field and a date-of-birth check.

**R5. Backup retention**
Encrypted dumps keep deleted forms for as long as the files are kept.
Action: set the retention period (e.g. 30 days), add the `find ... -mtime +30 -delete` line to the job, and state the period in the privacy notice. Test the restore, and record how long it took.

**R6. Hosting plan**
Vercel Hobby is for non-commercial use only, so a real practice needs Pro ($20 per member per month), and Supabase Free pauses after a week without use.
Action: budget for these costs in the project plan, and decide whether the Supabase paid tier (which includes daily backups) is worth it.

---

## 4. Questions for the team

1. Which branch name is the source of truth for the product: BrightSmile or DentaSync?
2. Who is the owner who will hold the private backup key, and where is the offline copy kept?
3. Has the privacy notice been reviewed by a lawyer yet (RA 10173)?
4. Which dentists are checking the PDA legend, surfaces, and exam items, and by when?
5. Will `APP_URL` be a custom domain or the `.vercel.app` address? It must be settled before the QR posters are printed.

---

## 5. Summary

The project is well documented and carefully tested, with good security defaults. The main follow-ups are:

1. Add CI.
2. Remove the clock dependency from the end-to-end test.
3. Rehearse migration 0004.
4. Automate deletion of expired patient forms.
5. Resolve the minors question before enabling patient forms.
