# DentaSync

Appointments, chairs, and dental charts for a dental practice with three branches in the Philippines.

- Spec: `docs/superpowers/specs/2026-09-29-dentasync-part-1-scheduling-design.md`
- Plans: `docs/superpowers/plans/`

## Run it

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `BETTER_AUTH_SECRET` and `SETUP_TOKEN`.
3. `npm run dev`, then open http://localhost:3700. The database lives in `.data/dev` and migrates itself.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3700 |
| `npm test` | Unit and database tests (PGlite, no network) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run build` | Production build |
