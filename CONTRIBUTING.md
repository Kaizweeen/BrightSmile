# Working on pull requests

Every change reaches `main` through a pull request, and `main` always builds and passes its tests. Kai reviews and merges every PR.

1. Branch from an up-to-date `main`.
2. Commit in small steps.
3. Run the checks.
4. Push and open a PR with the description filled in.
5. Answer the review. Kai merges, and the branch is deleted.

## 1. Branch

```powershell
git switch main; git pull; git switch -c feat/booking-page
```

| Work | Branch name |
|---|---|
| A plan in `docs/superpowers/plans` | `plan-<n>-<name>`, for example `plan-2-accounts` |
| Anything else | `<type>/<topic>`, for example `fix/reminder-length` |

The types are the commit prefixes below.

**One folder per branch.** Two sessions (people or Claude) working in the same folder share one checkout, so a branch switch or a `git add -A` in one lands in the other. For a second branch, make a worktree next to the repo:

```powershell
git worktree add ..\brightsmile-reminder-length -b fix/reminder-length main
```

Run `npm install` in the new folder and copy `.env.local` into it. After the merge, remove it with `git worktree remove ..\brightsmile-reminder-length`.

## 2. Commit

- Start the subject with `feat:`, `fix:`, `docs:`, `chore:`, `test:`, or `refactor:`, then say what the commit does in the imperative: `feat: add slot engine for open times and dates`.
- Add a body when the reason isn't obvious. It says why, not what.
- Commits written with Claude keep the `Co-Authored-By:` trailer it adds.
- PowerShell 5.1: write each paragraph as its own `-m`.
  ```powershell
  git commit -m "fix: keep reminders to one text" -m "Long clinic names pushed the reminder past 160 characters."
  ```
- No em dashes or en dashes anywhere: code, UI copy, docs, commit messages, PR text.
- Keep refactors and behavior changes in separate commits, ideally separate PRs.

## 3. Check

There is no CI yet, so the checks run on your machine before you push:

```powershell
npm run lint; npm test; npm run build
```

`;` keeps going after a failure, so read all three results.

Also run:

- Nothing extra for a migration: `npm test` runs the offline database tests in `tests/sql`.
- `npm run test:db` and `npm run test:e2e` only once a development Supabase project exists; both refuse production.
- The app (`npm run dev`, then http://localhost:3600) when you touched UI. Look at it at phone width, in light and dark.

## 4. Open the PR

```powershell
git push -u origin HEAD
gh pr create --base main
```

Add `--draft` when you want early eyes on unfinished work.

The title follows the commit subject style. Use this description:

```markdown
## What
One or two sentences.

## Why
The problem it solves, or the plan and task it implements.

## How to test
Steps the reviewer can follow.

## Checks
- [ ] `npm run lint`, `npm test`, `npm run build` pass
- [ ] The migration has a test in `tests/sql` (migrations changed)
- [ ] Screenshots at phone width, light and dark (UI changed)
- [ ] Each new dependency is named with its reason (or none added)
```

### Size

- One concern per PR, small enough to review in one sitting (roughly 400 changed lines, not counting the lockfile or generated files).
- A plan is the exception: it runs on one branch and merges as one PR once its deliverable passes. Each task is its own commit, so it can be reviewed commit by commit.
- A new dependency needs a reason in the PR. A few lines of our own code beat a package.

## Database changes

There is no development Supabase project (the first one became production) and no Docker, so migrations are proven offline: `tests/sql/harness.ts` applies every file in `supabase/migrations`, in order, to an in-process Postgres (PGlite) with a stand-in for Supabase's roles, `auth.uid()`, and default privileges, and the tests in `tests/sql` run SQL as signed-in users and as visitors. `npm test` runs them.

- Never edit a migration that production already has. Add a new one.
- Name migrations `YYYYMMDDHHMMSS_what.sql` in `supabase/migrations`.
- A new table gets RLS, explicit grants, and its per-clinic access rules in the same PR, with a test in `tests/sql`. Supabase grants new tables to `anon` and `authenticated` by default, and so does the harness, so a forgotten revoke fails a test. The tests also list exactly which functions visitors and signed-in staff may run, so a new function must be granted on purpose.
- The harness runs Postgres 17 (PGlite pinned to 0.4.6), the major version production runs. Do not use Postgres 18 features, and keep migrations to what Supabase's `postgres` role may do: it is not a superuser, although PGlite runs as one.
- Kai pastes a reviewed migration into the production SQL Editor just before merging the PR that needs it, because every merge to `main` deploys. Never run `npm run db:push`: the only project is production.
- When two open PRs both change the database, merge them one at a time.

## Review

Before asking for review, read your own diff on GitHub. With Claude, run `/code-review` on the branch first and fix what it finds.

The reviewer checks that:

- The PR does what the description says, and nothing else.
- Tests cover the new rules and would fail without the change.
- The [Global Constraints](docs/superpowers/plans/2026-09-22-plan-1-foundation.md#global-constraints) still hold: Manila time never depends on the server's time zone, texts stay plain ASCII and fit one SMS, field limits match.
- No secrets are committed. `.env.local` stays local, and new variables are listed in `.env.example`.

Prefix comments that don't block the merge with `nit:`. Every other comment blocks until it's resolved.

The author answers every comment, with a fix or a reply. Push fixes as new commits so the reviewer sees exactly what changed.

## Merge

- Merge once the PR is approved and the checks pass. Kai merges. Claude never merges a PR or pushes to `main`.
- If `main` has moved and GitHub reports a conflict, run `git pull origin main`, fix the conflicts, rerun the checks, and push.
- Use **Squash and merge**. Plan PRs use **Create a merge commit** instead, so each task's commit survives.
- Delete the branch after the merge (the button on GitHub, or `gh pr merge --delete-branch`).
