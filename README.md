# DentaSync

**Bright Smile Dental Clinic management system.**

DentaSync is a full-stack web app that runs a dental clinic with three branches in Makati, Philippines. It handles scheduling, dental charts, online booking, patient QR forms, billing with official receipts, and supplies. It also keeps a privacy audit log to support the Data Privacy Act (RA 10173).

Live site: <https://www.brightsmile.pro>

## Why we built it

Paper and spreadsheet scheduling across three branches leads to double bookings and lost records. DentaSync puts scheduling, patient charts, billing and supplies in one place. The database itself enforces the important rules, so they hold even if two people work at the same moment.

## Features

### For patients (no login needed)
- Public landing page with the clinic's services in English and Tagalog
- Online booking: choose a branch, a service and a time, then enter details (`/book`)
- QR welcome page and patient information form (`/welcome/{branch}`)
- Privacy notice and consent
- Anti-spam protection: honeypot field and per-connection rate limits

### For front desk and managers
- Chair calendar with day and week views and a branch switcher
- Confirm online booking requests, check patients in, and book walk-ins
- No double booking of a dentist, chair or patient, including chair cleaning (turnover) time
- Warnings for overtime or outside clinic hours, with a "Book anyway" option
- Patient list and patient forms turned into charts
- Billing: cash (change computed) or QR payment (confirmed by staff), printable receipts, voiding, and end-of-day reconcile
- Supplies with reorder levels, with every change audited

### For dentists
- "My Day" schedule
- PDA dental chart (FDI numbering, 5 surfaces per tooth, full PDA legend)
- Exams (periodontal, occlusion, appliances, TMD, X-rays), treatment notes and visit history
- Records are never edited or deleted, only voided with a reason

### For the owner
- All-branches overview
- Staff approval by QR join request, password reset links, and per-person visits
- Settings for the practice, branches, chairs, procedures, schedules, time off and billing
- Access log for sign-ins, patient record views and changes

## Visit lifecycle

```
Requested → Confirmed → Checked-In → In-Treatment → Completed
                                   ↘ No-Show / Cancelled
```

A database trigger enforces the allowed changes. Completed and Cancelled are final.

## Roles

| Role | What they can do |
|---|---|
| **Owner** | Everything, across all branches, including Settings and the access log |
| **Manager / Front desk** | Book, confirm, check in, bill, close the day, and approve staff for their branches. Can read charts but never write them |
| **Dentist** | Own calendar and "My Day", treat and complete own visits, write charts, exams and notes |
| **Patient** | No login. Public booking page and patient form only |

Every permission is decided by one function, `can(user, action, target)`, checked on the server for every request.

## Tech stack

| Area | Technology |
|---|---|
| Language | TypeScript (front end and back end) |
| Framework | Next.js 16 (App Router), full stack |
| UI | React 19, Tailwind CSS 4, shadcn/ui, Lucide icons, light and dark mode |
| Client data | TanStack Query 5 (caching, 30 second auto-refresh) |
| Validation | Zod 4 on every input |
| Database | PostgreSQL 17. PGlite (Postgres in WASM) for development and tests, Supabase (Singapore) in production |
| ORM | Drizzle ORM and drizzle-kit migrations, plus hand-written SQL for constraints and triggers |
| Auth | Better Auth: username login, Postgres sessions, rate-limited sign-in |
| QR codes | `qrcode` (SVG) |
| Testing | Vitest (unit, database and API tests) and Playwright (end-to-end) |
| Hosting | Vercel (Singapore) and Supabase |

DentaSync has its own REST API at `/api/v1/...` and uses no third-party APIs (no SMS, email or payment gateway).

## Security and privacy

- Audit log of sign-ins, every patient record view, and every change
- Server-side permission check on every request
- Row-level security on every table
- Content Security Policy with a per-request nonce, HSTS, frame-deny and nosniff
- Hashed passwords, 12-hour httpOnly sessions, and cross-origin writes refused
- Patient data stored in Singapore, nightly encrypted backups, and no patient details in logs

## Getting started

You need Node.js 20 or newer. No database install is needed for development, because the app uses PGlite.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env.local
# Open .env.local and set BETTER_AUTH_SECRET and SETUP_TOKEN
# (32+ random characters). To generate one:
# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 3. (Optional) Fill the dev database with sample data
npm run seed

# 4. Start the dev server
npm run dev
```

Then open <http://localhost:3700>. The database migrates itself on first run.

- `npm run seed` creates 3 branches, staff, 40 patients, two weeks of visits, and sample charts, exams and notes. It prints the sign-in usernames and password once. Run it while the dev server is stopped.
- Without the seed, open `/setup` to create the owner account.
- Try online booking at <http://localhost:3700/book>.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm run build` | Production build |
| `npm run start` | Start the production build |
| `npm run seed` | Sample development data (PGlite only) |
| `npm test` | Unit and database tests (PGlite, no network) |
| `npm run test:e2e` | End-to-end test of a full visit (Playwright) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate a new migration from schema changes |
| `npm run db:migrate` | Apply migrations to the production Postgres |

## Project structure

```
src/
  app/          Pages and API routes (Next.js App Router)
  components/   UI components (shadcn/ui and app components)
  db/           Database schema and connection (Drizzle)
  lib/          Shared logic: permissions, scheduling, billing, validation
  server/       Service functions used by both pages and the API
drizzle/        SQL migrations (tables, rules, row-level security, billing)
scripts/        Seed, migrate and end-to-end server scripts
tests/          Vitest and Playwright tests
docs/           Design specs and the deployment guide
```

## Main pages

| Page | URL |
|---|---|
| Landing page | `/` |
| Online booking | `/book` |
| Patient QR welcome page | `/welcome/{branch}` |
| Staff login | `/login` |
| Calendar | `/{branch}/calendar` |
| My Day (dentist) | `/{branch}/my-day` |
| Patients | `/{branch}/patients` |
| Billing | `/{branch}/billing` |
| Supplies | `/{branch}/supplies` |
| Staff | `/{branch}/staff` |
| Settings | `/{branch}/settings` |
| All-branches overview (owner) | `/all` |

`{branch}` is the branch code.

## Testing

```bash
npm test            # unit, database and API tests
npm run test:e2e    # one full visit, from setup to receipt
```

The end-to-end run needs a browser once: `npx playwright install chromium`. Stop `npm run dev` before running it.

## Deployment and documentation

- Full setup, testing and go-live steps (Supabase, Vercel, backups): [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Design specs and plans: [docs/superpowers/](docs/superpowers/)
- Product notes: [PRODUCT.md](PRODUCT.md)

## Out of scope for now

SMS and email reminders, patient accounts, analytics, payment gateway, VAT and discounts, full lot-based inventory with expiry dates, and two-factor sign-in.

## Team

<!-- Replace with your names and roles -->
| Name | Role |
|---|---|
| Member 1 | |
| Member 2 | |
| Member 3 | |
| Member 4 | |
| Member 5 | |
| Member 6 | |
| Member 7 | |

## License

<!-- Add a license if your team or school requires one -->
