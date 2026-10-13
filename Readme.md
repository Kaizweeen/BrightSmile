DentaSync

A full-stack web system that runs Bright Smile Dental Clinic, a 3-branch dental clinic in Makati, Philippines. It handles scheduling with database-guaranteed no double booking, PDA dental charts, online booking, patient QR forms, billing with official receipts, supplies, and a privacy audit log (RA 10173).

Features

Scheduling

	•	Chair calendar (day/week), branch switcher, dentist "My day", and an all-branches overview
	•	No double booking of dentist, chair, or patient, including chair cleaning (turnover) time, enforced by PostgreSQL exclusion constraints
	•	Cross-branch rule: a dentist scheduled at Branch A can't be booked at Branch B at the same time
	•	Hard stops vs. warnings ("Book anyway" for overtime or outside clinic hours)
	•	Visit lifecycle: Requested → Confirmed → Checked-In → In-Treatment → Completed, plus No-Show and Cancelled (enforced by a database trigger)
	•	Dentist weekly schedules (split days across branches) and time off

Clinical records

	•	PDA dental chart: FDI numbering, 5 surfaces per tooth, full PDA legend
	•	Exams: periodontal, occlusion, appliances, TMD, X-rays
	•	Treatment notes and visit history
	•	Records are never edited or deleted, only voided with a reason

Patient-facing

	•	Public landing page with services in English and Tagalog (Bunot, Pasta, Pustiso)
	•	Online booking at /book: branch → service → time → details. The system assigns a dentist and chair, and the front desk confirms
	•	Patient form via QR at /welcome/{branch}, which the front desk turns into a chart
	•	Anti-spam: honeypot field, 5 requests per connection per hour, firewall rate limit

Billing

	•	Checkout from a completed visit or as a walk-in sale
	•	Cash (change computed) or QR (manually confirmed by staff)
	•	Gap-free receipt numbers, e.g. OR-BRANCH-YYYYMMDD-000001, with printable receipts
	•	Void with a reason; end-of-day reconcile shows over/short, and closed days lock
	•	Money stored as integer centavos

Supplies

	•	Per-branch stock with reorder levels
	•	Every change is audited

Accounts

	•	Staff sign up by scanning a branch QR poster; the owner or a manager approves
	•	Password reset by one-time QR link (15 minutes, stored hashed)
	•	First-run setup at /setup

Roles

Role	Can do
Owner	Everything, all branches. Settings and access log. Charts if they see patients.
Manager / front desk	Book, confirm, check in, bill, close the day, approve staff (for their branches). Reads charts, never writes them.
Dentist	Own calendar and "My day"; treat and complete own visits; write charts, exams, and notes.
Patient	No login. Public booking page and patient form only.

Tech stack

Layer	Technology
Language	TypeScript (front end and back end)
Framework	Next.js 16 (App Router), full stack
UI	React 19, Tailwind CSS 4, shadcn/ui, Lucide icons, light/dark mode
Client data	TanStack Query 5 (caching, 30 s auto-refresh)
Validation	Zod 4 on every input
Database	PostgreSQL 17. Dev/tests: PGlite (Postgres in WASM). Prod: Supabase (Singapore)
ORM	Drizzle ORM + drizzle-kit migrations, plus hand-written SQL for constraints and triggers
Auth	Better Auth 1.7: username login, Postgres sessions, rate-limited sign-in
QR codes	qrcode (SVG)
Testing	Vitest (~360 unit/DB/API tests) and Playwright (end-to-end)
Hosting	Vercel (Singapore, sin1) + Supabase

API

DentaSync exposes its own REST API at /api/v1/... (about 55 route handlers).

	•	Resources: appointments, availability, patients, chart entries, exams, notes, bills, billing close, branches, chairs, dentists, schedules, time off, staff, join requests, supplies, procedures, audit log, overview
	•	Public portal: /portal/bookings, /portal/times, /portal/forms
	•	Auth: Better Auth at /api/auth/[...all]
	•	No third-party APIs: no SMS, email, or payment gateway

All errors share one shape:

{ "error": { "code": "...", "message": "...", "fields": {}, "conflicts": [], "warnings": [] } }

Status	Meaning
400	Invalid input
401	Signed out
403	Forbidden
404	Not found
409	Clash (e.g. double booking)
422	Rule broken
429	Rate limited

Security and privacy (RA 10173)

	•	Audit/access log: sign-ins, every patient record view, and every change
	•	One permission function, can(user, action, target), checked on the server for every request
	•	Row-level security on every table
	•	CSP with per-request nonce, HSTS, frame-deny, nosniff
	•	Hashed passwords, 12-hour httpOnly sessions, cross-origin writes refused
	•	Data stays in Singapore; nightly GPG-encrypted backups
	•	Patient details are never written to logs

Getting started

# Install dependencies
npm install

# Run the dev server (uses PGlite, so no database install needed)
npm run dev

# Run unit, database, and API tests
npm test

# Run end-to-end tests
npx playwright test

Scripts shown above are the standard defaults. Adjust them to match your package.json.

Demo flow

Book visit → Check in → Start treatment → Chart a tooth → Exam + note → Complete → Bill (cash) → Print receipt

Then try a double booking to see the 409 refusal, open /book on a phone, and check the access log in Settings.

Out of scope (planned)

SMS/email reminders, patient accounts, analytics, VAT/discounts, full lot-based inventory with expiry dates, payment gateway, two-factor sign-in.

License

Add a license of your choice (e.g. MIT) before publishing.
