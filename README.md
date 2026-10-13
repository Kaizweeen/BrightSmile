<div align="center">

# DentaSync

**Practice management for Bright Smile Dental Clinic, a three-branch dental practice in Makati, Philippines.**

Scheduling with database-guaranteed no double booking · PDA dental charts · online booking · patient QR forms · billing with official receipts · supplies · privacy audit log (RA 10173)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)

</div>

---

## Contents

- [Overview](#overview)
- [Features](#features)
- [Roles](#roles)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Testing](#testing)
- [Project structure](#project-structure)
- [API](#api)
- [Security and privacy](#security-and-privacy)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Roadmap](#roadmap)

## Overview

DentaSync runs the day-to-day work of a multi-branch dental practice: the front desk books and checks in patients across chairs and branches, dentists chart and treat, managers bill and close the day, and patients book online or fill in their forms from a QR code in the waiting room. It is a single full-stack Next.js application backed by PostgreSQL, where the database itself enforces the rules that matter most, such as no double booking.

## Features

### Scheduling
- Chair calendar (day and week), branch switcher, a dentist's **My day**, and an all-branches overview
- **No double booking** of dentist, chair, or patient, including chair cleaning (turnover) time, enforced by PostgreSQL exclusion constraints
- Cross-branch rule: a dentist scheduled at one branch can't be booked at another at the same time
- Hard stops vs. warnings ("Book anyway" for overtime or outside clinic hours)
- Visit lifecycle **Requested → Confirmed → Checked in → In treatment → Completed**, plus No-show and Cancelled, enforced by a database trigger
- Dentist weekly schedules (including days split across branches) and time off

### Clinical records
- PDA dental chart: FDI numbering, five surfaces per tooth, the full PDA legend
- Exams: periodontal, occlusion, appliances, TMD, X-rays
- Treatment notes and visit history
- Records are never edited or deleted, only voided with a reason

### Patient-facing
- Public clinic landing page, with services in English and Tagalog (*Bunot*, *Pasta*, *Pustiso*)
- Online booking at `/book`: branch → service → time → details. DentaSync assigns a dentist and chair; the front desk confirms
- Patient form via QR at `/welcome/{branch}`, which the front desk turns into a chart
- Anti-spam: honeypot field, five requests per connection per hour, and a firewall rate limit

### Billing
- Checkout from a completed visit, or as a walk-in sale
- Cash (change computed) or QR payment (confirmed by staff)
- Gap-free official receipt numbers, such as `OR-MAKATI-20261013-000001`, with printable receipts
- Void with a reason; end-of-day reconciliation shows over/short, and closed days lock
- Money stored as integer centavos

### Supplies
- Per-branch stock with reorder levels
- Each service's supplies are taken out of stock when a visit is completed
- Every change is audited

### Accounts
- Staff sign up by scanning a branch QR poster; the owner or a manager approves them
- Password reset by one-time QR link (15 minutes, stored hashed)
- First-run setup at `/setup`

## Roles

| Role | Can do |
|---|---|
| **Owner** | Everything, at every branch. Settings and the access log. Charts, if they see patients. |
| **Manager / front desk** | Book, confirm, check in, bill, close the day, and approve staff for their branches. Reads charts, never writes them. |
| **Dentist** | Own calendar and My day; treat and complete own visits; write charts, exams, and notes. |
| **Patient** | No account. The public booking page and patient form only. |

## Tech stack

| Layer | Technology |
|---|---|
| Language | TypeScript, front end and back end |
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, shadcn/ui, Lucide icons, light and dark mode |
| Client data | TanStack Query 5 (caching, 30-second refresh) |
| Validation | Zod 4 on every input |
| Database | PostgreSQL 17 — [PGlite](https://pglite.dev) (Postgres in WASM) for development and tests, Supabase (Singapore) in production |
| ORM | Drizzle ORM and drizzle-kit migrations, with hand-written SQL for constraints, triggers, and row-level security |
| Auth | Better Auth: username sign-in, Postgres sessions, rate-limited sign-in |
| QR codes | `qrcode` (SVG) |
| Testing | Vitest (unit, database, and API) and Playwright (end-to-end) |
| Hosting | Vercel (`sin1`, Singapore) and Supabase |

## Getting started

### Prerequisites
- Node.js 24 (or a recent LTS) and npm
- No database install: development runs Postgres inside the app with PGlite

### Run it locally

```bash
npm install
cp .env.example .env.local   # then set BETTER_AUTH_SECRET and SETUP_TOKEN
npm run seed                 # optional demo data (run while the dev server is stopped)
npm run dev                  # http://localhost:3700
```

Generate a secret for `BETTER_AUTH_SECRET` and `SETUP_TOKEN` (32 or more characters each) with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- **The database migrates itself** on start-up.
- **`npm run seed`** fills `.data/dev` with 3 branches, staff, 40 patients, two weeks of visits, and chart entries, exams, and notes on past visits, then prints the sign-in usernames and password once. To start over, delete `.data/dev` and seed again.
- The seeded practice has online booking on: try it at http://localhost:3700/book.
- Without the seed, open `/setup` and enter the setup code to create the practice and its owner.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Production | `pglite:.data/dev` (the default) in development; a Postgres 17 connection string in production |
| `BETTER_AUTH_SECRET` | Yes | 32 or more random characters |
| `SETUP_TOKEN` | Yes | 32 or more random characters. `/setup` asks for it once; the owner also uses it to reset their own password |
| `APP_URL` | Production | The site's origin, no trailing slash (default `http://localhost:3700`). Printed on QR posters |
| `CLIENT_IP_HEADER` | No | The header the host sets to each visitor's address, for rate limits. Detected automatically on Vercel and Netlify |

In production the server refuses to start if any required variable is missing, or if `DATABASE_URL` points at PGlite.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm run seed` | Development data (PGlite only) |
| `npm test` | Unit, database, and API tests (PGlite, no network) |
| `npm run test:e2e` | The end-to-end run (see [Testing](#testing)) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
| `npm start` | Serve the production build on port 3700 |
| `npm run db:generate` | Generate a Drizzle migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply `drizzle/` to the production database, asking for its address (or reading `DATABASE_URL`) |

## Testing

`npm test` runs 300+ Vitest tests against a throwaway PGlite database: no network or Postgres install needed.

`npm run test:e2e` starts its own dev server on port 3701 with a fresh database in `.data/e2e` and walks the whole practice through one day:

1. Setup, a staff QR join and approval
2. A visit: booking, check-in, start of treatment, charting a tooth, the exam, a note, and completion
3. Online booking: the owner turns it on, a patient books at `/book` (including a "just taken" refusal), and the front desk confirms it from Online requests
4. Patient forms: a patient opens the branch's welcome page from its poster, sends the form, and the front desk makes a chart from it

Notes:
- Stop `npm run dev` first; both share `.next`.
- Playwright needs a browser once: `npx playwright install chromium`, or use an installed Chrome or Edge with `PLAYWRIGHT_CHANNEL=chrome` (`$env:PLAYWRIGHT_CHANNEL = "chrome"` in PowerShell).
- The visit is booked for the next quarter hour and must end the same day, so run it before 23:00 Manila time.

### Try it by hand

Book a visit → check in → start treatment → chart a tooth → exam and note → complete → bill (cash) → print the receipt. Then try a double booking to see the `409` refusal, open `/book` on a phone, and check the access log in Settings.

## Project structure

```
src/
├── app/                 Next.js routes
│   ├── [branch]/        Staff app: calendar, my-day, patients, billing, supplies, staff, settings
│   ├── api/v1/          REST API route handlers (incl. the public portal)
│   ├── clinic/          Public clinic landing page
│   ├── book/            Online booking
│   ├── welcome/         Patient form, opened from the branch's QR poster
│   └── setup/ join/ login/ reset/ poster/ waiting/
├── components/          UI components (shadcn/ui in components/ui)
├── db/                  Drizzle schema, connection, and Supabase SSL check
├── lib/                 Shared rules: permissions, booking rules, lifecycle, billing, time
└── server/              Server-side logic behind each API resource
drizzle/                 SQL migrations (tables, rules, row-level security, …)
scripts/                 Seed, migrate, and the end-to-end server
tests/                   unit/ db/ api/ e2e/
docs/                    Deployment guide, design specs, and implementation plans
```

## API

DentaSync exposes its own REST API at `/api/v1/` (about 55 route handlers).

- **Resources:** appointments, availability, patients, chart entries, exams, notes, bills, billing close, branches, chairs, dentists, schedules, time off, staff, join requests, online requests, patient forms, supplies, procedures, audit log, overview
- **Public portal:** `/api/v1/portal/bookings`, `/api/v1/portal/times`, `/api/v1/portal/forms`
- **Auth:** Better Auth at `/api/auth/[...all]`
- **No third-party services:** no SMS, email, or payment gateway

Every error has the same shape:

```json
{ "error": { "code": "...", "message": "...", "fields": {}, "conflicts": [], "warnings": [] } }
```

| Status | Meaning |
|---|---|
| `400` | Invalid input |
| `401` | Signed out |
| `403` | Forbidden |
| `404` | Not found |
| `409` | Clash, such as a double booking |
| `422` | A rule was broken |
| `429` | Rate limited |

## Security and privacy

DentaSync is built for the Philippine Data Privacy Act of 2012 (RA 10173).

- **Access log:** sign-ins, every view of a patient record, and every change
- **One permission check,** `can(user, action, target)`, run on the server for every request
- **Row-level security** on every table
- **Headers:** CSP with a per-request nonce, HSTS, frame-deny, nosniff
- **Sessions:** hashed passwords, 12-hour httpOnly sessions; cross-origin writes refused
- **Data residency:** data stays in Singapore; nightly GPG-encrypted backups
- **Logs:** patient details are never written to logs; rate limits store a keyed hash of the visitor's address, never the address itself

## Deployment

Production runs on **Supabase** (Postgres, Singapore) and **Vercel** (Singapore). The step-by-step guide — database setup, migrations, environment variables, first run, firewall rule, encrypted nightly backups, and go-live checks — is in **[docs/deployment.md](docs/deployment.md)**.

## Documentation

| Document | Contents |
|---|---|
| [docs/deployment.md](docs/deployment.md) | Going live, backups, and operations |
| [Scheduling spec](docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md) | Part 1: scheduling, charts, accounts, and the deployment decisions |
| [Online booking spec](docs/superpowers/specs/2026-09-29-dentasync-online-booking-design.md) | Online booking; overrides part 1 on visit lengths |
| [Patient forms spec](docs/superpowers/specs/2026-09-29-dentasync-patient-forms-design.md) | QR patient forms |
| [Billing spec](docs/superpowers/specs/2026-10-01-billing-design.md) | Billing, receipts, and day close |
| [Plans](docs/superpowers/plans/) | Implementation plans |
| [PRODUCT.md](PRODUCT.md) | Brief for the public clinic landing page |

## Roadmap

Not yet built: SMS and email reminders, patient accounts, analytics, VAT and discounts, lot-based inventory with expiry dates, a payment gateway, and two-factor sign-in.

## License

Proprietary. All rights reserved.
