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
| `npm run db:push` | Apply new migrations to the linked Supabase project |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
