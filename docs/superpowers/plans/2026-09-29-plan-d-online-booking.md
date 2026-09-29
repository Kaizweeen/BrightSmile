# DentaSync Plan D: Online Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Patients book at `/book` without an account; each booking enters as Requested with a dentist and chair DentaSync assigns; services lose their lengths in favour of a practice standard; the front desk confirms online requests from the calendar.

**Architecture:** Built into the existing Next.js 16 app. Visit length moves from procedures to the visit (practice standard, changeable per visit). A new server module, `src/server/portal.ts`, reuses the open-times engine (`src/lib/slots.ts`) through a shared `findOpenTimes` in `src/server/availability.ts`, and writes visits with the same database rules as staff bookings. Two public routes (`/api/v1/portal/times`, `/api/v1/portal/bookings`) and two public pages (`/book`, `/book/privacy`); one staff route (`/api/v1/online-requests`).

**Tech Stack:** Next.js 16.3.6 (App Router, `proxy.ts`), React 19.2, TanStack Query 5, Zod 4.6, Drizzle ORM 0.45 with drizzle-kit 0.31, PGlite (tests), node-postgres (production), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-dentasync-online-booking-design.md`

## Global Constraints

- Work only in `D:\dentasync` (a separate repository from the BrightSmile worktree subagents start in). Branch `online-booking`.
- No em dashes or en dashes in any copy, doc, comment, or commit message.
- Every table has row level security: a new table ends with `.enableRLS()` (the test in `tests/db/rules.test.ts` fails otherwise).
- Visit lengths: staff pick 15 to 480 minutes in 15-minute steps; the practice standard is 15 to 240 in 15-minute steps (60 to start); the cleaning time is 0 to 60 in 5-minute steps (10 to start).
- Online: starts at least 2 hours from now, days from today to 30 days ahead (Manila dates); at most 5 online bookings per client address per hour; at most 2 Requested online visits from now on per patient.
- Public routes reveal only branch names and codes, online service names, open start times, and the privacy notice. Never dentist names, lengths, or anything about patients.
- Patient-facing messages, exactly: "Online booking isn't available right now.", "That branch doesn't take online bookings.", "That service isn't offered online.", "That time was just taken. Please pick another.", "Too many bookings from this connection. Please call the clinic.", "You already have 2 requests waiting. The clinic will call you.", "Agree to the privacy notice to book.", "Your request is in."
- Tests run on PGlite only (`npm test`); nothing may connect to Supabase.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before using a Next.js API you have not seen in this codebase, read its guide under `node_modules/next/dist/docs/` (AGENTS.md).

---

### Task 1: Visits take the practice's standard length

**Files:**
- Modify: `src/db/schema.ts` (the `practice`, `procedures`, `appointmentProcedures` tables; new `procedureDentists`)
- Create (generated): `drizzle/0003_online_booking.sql`, `drizzle/0004_no_lengths.sql`, and their `drizzle/meta` snapshots
- Modify: `src/server/practice.ts`, `src/app/api/v1/practice/route.ts`
- Modify: `src/server/procedures.ts`
- Modify: `src/server/booking.ts`, `src/server/appointments.ts`, `src/server/availability.ts`
- Modify: `src/server/seed.ts`, `src/lib/access-log.ts`
- Test: `tests/db/appointments.test.ts`, `tests/db/availability.test.ts`, `tests/db/patients.test.ts`, `tests/db/settings.test.ts`

**Interfaces:**
- Produces: `practiceSettings(tx?: Db): Promise<PracticeSettings>` and `type PracticeSettings = { name: string; visitMinutes: number; cleaningMinutes: number; onlineBooking: boolean; privacyNotice: string }` in `src/server/practice.ts`.
- Produces: `findOpenTimes(q: OpenTimesQuery, tx?: Db): Promise<OpenTime[]>` in `src/server/availability.ts`, with `type OpenTimesQuery = { branch: { id: string; active: boolean; operatingHours: OperatingHours }; date: string; minutes: number; turnover: number; notBefore: Date; dentistIds?: readonly string[] | null; patientId?: string }`.
- Produces: `procedureDentists` table (`procedureId`, `dentistId`) and `procedures.online` in `src/db/schema.ts`; `ProcedureView = typeof procedures.$inferSelect & { dentistIds: string[] }` from `listProcedures`.
- Produces: `POST /api/v1/appointments` and `POST /api/v1/appointments/validate` accept `minutes`; `PATCH /api/v1/appointments/[id]` accepts `minutes`; `GET /api/v1/availability` takes `minutes` instead of `procedures`; `GET /api/v1/practice`.

- [ ] **Step 1: Add the new columns and table (first migration, additions only)**

In `src/db/schema.ts`, replace the `practice` table with:

```ts
export const practice = pgTable(
  "practice",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name").notNull(),
    visitMinutes: integer("visit_minutes").notNull().default(60),
    cleaningMinutes: integer("cleaning_minutes").notNull().default(10),
    onlineBooking: boolean("online_booking").notNull().default(false),
    privacyNotice: text("privacy_notice").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    check("practice_one_row", sql`${t.id}`),
    check("practice_name", sql`char_length(${t.name}) between 1 and 80`),
    check("practice_visit_minutes", sql`${t.visitMinutes} between 15 and 240 and ${t.visitMinutes} % 15 = 0`),
    check("practice_cleaning_minutes", sql`${t.cleaningMinutes} between 0 and 60 and ${t.cleaningMinutes} % 5 = 0`),
    check("practice_privacy_notice", sql`char_length(${t.privacyNotice}) <= 5000`),
  ],
).enableRLS();
```

In the `procedures` table, add this column after `bufferMinutes` (leave `durationMinutes` and `bufferMinutes` for now; Step 2 removes them):

```ts
    online: boolean("online").notNull().default(true),
```

Directly after the `procedures` table, add:

```ts
/** The dentists who may be assigned a service online (online booking spec, section 5). None means every dentist. */
export const procedureDentists = pgTable(
  "procedure_dentists",
  {
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.procedureId, t.dentistId] })],
).enableRLS();
```

Run: `npx drizzle-kit generate --name online_booking`
Expected: `drizzle/0003_online_booking.sql` with `ALTER TABLE "practice" ADD COLUMN` (four), `ALTER TABLE "procedures" ADD COLUMN "online"`, `CREATE TABLE "procedure_dentists"`, `ENABLE ROW LEVEL SECURITY`, two foreign keys, and the three new checks. It must not ask a question; if it does, stop and report.

- [ ] **Step 2: Drop the lengths (second migration, drops only)**

In `src/db/schema.ts`, the `procedures` table becomes:

```ts
export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    online: boolean("online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [check("procedures_name", sql`char_length(${t.name}) between 1 and 60`)],
).enableRLS();
```

In `appointmentProcedures`, delete the two lines `durationMinutes: integer("duration_minutes").notNull(),` and `bufferMinutes: integer("buffer_minutes").notNull(),`.

Run: `npx drizzle-kit generate --name no_lengths`
Expected: `drizzle/0004_no_lengths.sql` with `ALTER TABLE "procedures" DROP CONSTRAINT "procedures_duration"`, `DROP CONSTRAINT "procedures_buffer"`, and `DROP COLUMN` for `duration_minutes` and `buffer_minutes` on both tables. No question asked.

- [ ] **Step 3: Update the tests for lengths, and write the new ones**

`tests/db/appointments.test.ts`:

1. Add `practice` to the schema import: `import { appointmentProcedures, appointments, auditLog, chairs, dentistSchedules, patients, practice, procedures } from "@/db/schema";`
2. First line of `build()`: `await db.insert(practice).values({ name: "Test Dental", cleaningMinutes: 15 });`
3. The two procedure inserts become `db.insert(procedures).values({ name: "Oral prophylaxis" })` and `db.insert(procedures).values({ name: "Tooth filling" })`.
4. Give every request its old length: run
   `sed -i 's/procedureIds: \[w\.cleaning\.id\]/procedureIds: [w.cleaning.id], minutes: 45/g; s/procedureIds: \[w\.filling\.id\]/procedureIds: [w.filling.id], minutes: 60/g' tests/db/appointments.test.ts`
   (This leaves `expect(detail.procedureIds).toEqual([w.cleaning.id]);` alone.)
5. The snapshot check becomes `expect(snapshot).toMatchObject([{ position: 0, name: "Oral prophylaxis" }]);`
6. Append at the end of the file:

```ts
describe("lengths", () => {
  it("takes the practice's standard length when none is given", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.ana.id, start: at("09:00", TUESDAY).toISOString(), procedureIds: [w.cleaning.id] });
    expect(res.status).toBe(201);
    const row = await visitRow((await res.json()).id);
    expect(row.endTime.toISOString()).toBe(at("10:00", TUESDAY).toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("10:15", TUESDAY).toISOString());
  });

  it("changes a visit's length when moving, and keeps its cleaning time", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.cyd.id, start: at("13:00", TUESDAY).toISOString(), procedureIds: [w.cleaning.id], minutes: 30 });
    expect(res.status).toBe(201);
    const id = (await res.json()).id;
    expect((await move(w.deskDt, id, { minutes: 90 })).status).toBe(200);
    let row = await visitRow(id);
    expect(row.endTime.toISOString()).toBe(at("14:30", TUESDAY).toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("14:45", TUESDAY).toISOString());
    // A new cleaning time is for new bookings; and changing the services does not change the length.
    await db.update(practice).set({ cleaningMinutes: 5 });
    expect((await move(w.deskDt, id, { start: at("15:00", TUESDAY).toISOString(), procedureIds: [w.filling.id] })).status).toBe(200);
    row = await visitRow(id);
    expect(row.endTime.toISOString()).toBe(at("16:30", TUESDAY).toISOString());
    expect(row.chairFreeAt.toISOString()).toBe(at("16:45", TUESDAY).toISOString());
    await db.update(practice).set({ cleaningMinutes: 15 });
  });

  it("refuses a length off the 15-minute steps", async () => {
    const w = await world();
    const res = await book(w.deskDt, { branch: "downtown", chairNumber: 2, dentistId: w.lim.id, patientId: w.ben.id, start: at("16:00", TUESDAY).toISOString(), procedureIds: [w.cleaning.id], minutes: 50 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.minutes).toBe("Use 15-minute steps");
  });
});
```

`tests/db/availability.test.ts`:

1. Add `practice` to the schema import.
2. First line of `build()`: `await db.insert(practice).values({ name: "Test Dental", cleaningMinutes: 15 });`
3. The procedure insert becomes `db.insert(procedures).values({ name: "Oral prophylaxis" })`.
4. Run `sed -i 's/&procedures=\${w\.cleaning\.id}/\&minutes=45/g' tests/db/availability.test.ts`
5. Inside `describe("open times", ...)`, after the `it("is for people who book", ...)` test, add:

```ts
  it("uses the practice's standard length when none is given", async () => {
    const w = await world();
    const res = await call(availabilityRoute.GET, request(`/api/v1/availability?branch=downtown&date=${MONDAY}&dentist=${w.lim.id}`, { cookie: w.desk }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { minutes: number }).minutes).toBe(60);
  });
```

`tests/db/patients.test.ts`: the procedure insert becomes `db.insert(procedures).values({ name: \`Cleaning ${Date.now()}\` })` and the snapshot insert becomes `db.insert(appointmentProcedures).values({ appointmentId: row.id, position: 0, procedureId: proc.id, name: "Cleaning" })`.

`tests/db/settings.test.ts`: inside `describe("practice", ...)`, after the rename test, add:

```ts
  it("keeps online booking off until there is a privacy notice", async () => {
    const { cookie } = await ownerCookie();
    const patch = (body: object) => call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body }));
    const refused = await patch({ onlineBooking: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.fields.privacyNotice).toBe("Add the privacy notice first.");
    const ok = await patch({ onlineBooking: true, privacyNotice: "We keep your details to run your visits.", visitMinutes: 45, cleaningMinutes: 5 });
    expect(ok.status).toBe(200);
    const read = await (await call(practiceRoute.GET, request("/api/v1/practice", { cookie }))).json();
    expect(read).toMatchObject({ onlineBooking: true, visitMinutes: 45, cleaningMinutes: 5 });
    const odd = await patch({ visitMinutes: 50 });
    expect(odd.status).toBe(400);
    expect((await odd.json()).error.fields.visitMinutes).toBe("Use 15-minute steps");
    expect((await patch({ privacyNotice: "" })).status).toBe(422);
  });
```

and replace the whole `describe("procedures", ...)` block's first test (`"adds, validates, and updates procedures"`) with these two tests:

```ts
  it("adds, validates, and updates services", async () => {
    const { cookie } = await ownerCookie();
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis" } }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: "Oral prophylaxis", online: true, dentistIds: [] });
    const { id } = created;
    const dup = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Oral prophylaxis" } }));
    expect(dup.status).toBe(409);
    const stranger = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Braces", dentistIds: [crypto.randomUUID()] } }));
    expect(stranger.status).toBe(400);
    expect((await stranger.json()).error.fields.dentistIds).toBe("Pick dentists who see patients.");
    const off = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { active: false, online: false } }), { id });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ active: false, online: false });
    const active = await (await call(proceduresRoute.GET, request("/api/v1/procedures?active=1", { cookie }))).json();
    expect(active).toEqual([]);
  });

  it("limits a service to chosen dentists", async () => {
    const { cookie } = await ownerCookie();
    const ortho = await makeUser({ role: "dentist", name: "Dr. Ortho" });
    const res = await call(proceduresRoute.POST, request("/api/v1/procedures", { method: "POST", cookie, body: { name: "Braces and Retainers", dentistIds: [ortho.id] } }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const list = await (await call(proceduresRoute.GET, request("/api/v1/procedures", { cookie }))).json();
    expect(list.find((p: { id: string }) => p.id === id).dentistIds).toEqual([ortho.id]);
    const cleared = await call(procedureRoute.PATCH, request(`/api/v1/procedures/${id}`, { method: "PATCH", cookie, body: { dentistIds: [] } }), { id });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).dentistIds).toEqual([]);
  });
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run tests/db/appointments.test.ts tests/db/availability.test.ts tests/db/settings.test.ts`
Expected: FAIL (type errors and old behaviour: `minutes` ignored, lengths from the procedures that no longer have them).

- [ ] **Step 5: Practice settings**

Replace `src/server/practice.ts` with:

```ts
import { z } from "zod";
import { db, type Db } from "@/db";
import { practice } from "@/db/schema";
import { practiceNameSchema } from "@/lib/validation";
import { audit } from "./audit";
import { ApiError } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const practiceSchema = z
  .object({
    name: practiceNameSchema,
    visitMinutes: z.number().int().min(15, "At least 15 minutes").max(240, "At most 240 minutes").multipleOf(15, "Use 15-minute steps"),
    cleaningMinutes: z.number().int().min(0, "0 or more minutes").max(60, "At most 60 minutes").multipleOf(5, "Use 5-minute steps"),
    onlineBooking: z.boolean(),
    privacyNotice: z.string().trim().max(5000, "Use at most 5000 characters"),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export type PracticeSettings = {
  name: string;
  visitMinutes: number;
  cleaningMinutes: number;
  onlineBooking: boolean;
  privacyNotice: string;
};

/** Before /setup there is no practice row; these match the database's defaults. */
const DEFAULTS: PracticeSettings = { name: "DentaSync", visitMinutes: 60, cleaningMinutes: 10, onlineBooking: false, privacyNotice: "" };

/** The practice's settings (online booking spec, section 6.1), read inside `tx` when given. */
export async function practiceSettings(tx: Db = db): Promise<PracticeSettings> {
  const [row] = await tx.select().from(practice);
  if (!row) return DEFAULTS;
  const { name, visitMinutes, cleaningMinutes, onlineBooking, privacyNotice } = row;
  return { name, visitMinutes, cleaningMinutes, onlineBooking, privacyNotice };
}

export async function practiceName(): Promise<string> {
  return (await practiceSettings()).name;
}

/** Online booking spec 10: only the owner changes these, and online booking cannot go on without a privacy notice. */
export async function updatePractice(actor: Staff, patch: z.infer<typeof practiceSchema>): Promise<PracticeSettings> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const next = { ...(await practiceSettings(tx)), ...patch };
    if (next.onlineBooking && next.privacyNotice === "") {
      throw new ApiError(422, "notice_needed", "Add the privacy notice first.", { fields: { privacyNotice: "Add the privacy notice first." } });
    }
    await tx.insert(practice).values(next).onConflictDoUpdate({ target: practice.id, set: next });
    // The notice can be long: the log says only that it changed.
    const { privacyNotice, ...rest } = patch;
    await audit(
      { userId: actor.id, action: "practice.updated", entity: "practice", details: { ...rest, ...(privacyNotice === undefined ? {} : { privacyNotice: "changed" }) } },
      tx,
    );
    return next;
  });
}
```

Replace `src/app/api/v1/practice/route.ts` with:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { practiceSchema, practiceSettings, updatePractice } from "@/server/practice";

/** Every signed-in staff member reads the settings: the booking panel needs the standard length. */
export const GET = staffRoute(async () => json(await practiceSettings()));

export const PATCH = staffRoute(async (req, staff) => json(await updatePractice(staff, await readJson(req, practiceSchema))));
```

In `src/lib/access-log.ts`, change the procedure labels and add the practice one:

```ts
  "procedure.created": "Added a service",
  "procedure.updated": "Changed a service",
  "practice.renamed": "Renamed the practice",
  "practice.updated": "Changed the practice's settings",
```

- [ ] **Step 6: Services**

Replace `src/server/procedures.ts` with:

```ts
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { procedureDentists, procedures, users } from "@/db/schema";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const nameSchema = z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters");
const dentistIdsSchema = z.array(z.uuid()).max(50);

export const procedureSchema = z.object({
  name: nameSchema,
  online: z.boolean().optional().default(true),
  dentistIds: dentistIdsSchema.optional().default([]),
});

export const procedurePatchSchema = z
  .object({ name: nameSchema, online: z.boolean(), dentistIds: dentistIdsSchema, active: z.boolean(), sort: z.number().int().min(0).max(999) })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

/** A service (online booking spec, section 5): no length, and the dentists it may be assigned to online (none means all). */
export type ProcedureView = typeof procedures.$inferSelect & { dentistIds: string[] };

const nameTaken = () =>
  new ApiError(409, "name_taken", "Another service has that name.", { fields: { name: "Another service has that name." } });

export async function listProcedures(opts: { activeOnly?: boolean } = {}): Promise<ProcedureView[]> {
  const rows = await db
    .select()
    .from(procedures)
    .where(opts.activeOnly ? eq(procedures.active, true) : undefined)
    .orderBy(asc(procedures.sort), asc(procedures.name));
  const links = await db.select().from(procedureDentists);
  return rows.map((row) => ({ ...row, dentistIds: links.filter((l) => l.procedureId === row.id).map((l) => l.dentistId) }));
}

/** Replaces a service's dentists; only dentists who see patients can be chosen. */
async function setDentists(tx: Db, procedureId: string, dentistIds: string[]): Promise<string[]> {
  const unique = [...new Set(dentistIds)];
  if (unique.length > 0) {
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, unique), eq(users.seesPatients, true)));
    if (found.length !== unique.length) {
      throw new ApiError(400, "invalid", "Pick dentists who see patients.", { fields: { dentistIds: "Pick dentists who see patients." } });
    }
  }
  await tx.delete(procedureDentists).where(eq(procedureDentists.procedureId, procedureId));
  if (unique.length > 0) await tx.insert(procedureDentists).values(unique.map((dentistId) => ({ procedureId, dentistId })));
  return unique;
}

export async function createProcedure(actor: Staff, input: z.infer<typeof procedureSchema>): Promise<ProcedureView> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, input.name));
    if (taken) throw nameTaken();
    const [row] = await tx.insert(procedures).values({ name: input.name, online: input.online }).returning();
    const dentistIds = await setDentists(tx, row.id, input.dentistIds);
    await audit({ userId: actor.id, action: "procedure.created", entity: "procedure", entityId: row.id, details: input }, tx);
    return { ...row, dentistIds };
  });
}

export async function updateProcedure(actor: Staff, id: string, patch: z.infer<typeof procedurePatchSchema>): Promise<ProcedureView> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    if (patch.name) {
      const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, patch.name));
      if (taken && taken.id !== id) throw nameTaken();
    }
    const { dentistIds, ...fields } = patch;
    const [row] = Object.values(fields).some((value) => value !== undefined)
      ? await tx.update(procedures).set(fields).where(eq(procedures.id, id)).returning()
      : await tx.select().from(procedures).where(eq(procedures.id, id));
    if (!row) throw notFound("That service");
    if (dentistIds) await setDentists(tx, id, dentistIds);
    const links = await tx.select({ dentistId: procedureDentists.dentistId }).from(procedureDentists).where(eq(procedureDentists.procedureId, id));
    await audit({ userId: actor.id, action: "procedure.updated", entity: "procedure", entityId: id, details: patch }, tx);
    return { ...row, dentistIds: links.map((l) => l.dentistId) };
  });
}
```

- [ ] **Step 7: A visit's length in the booking rules**

In `src/server/booking.ts`:

1. `procedures` stays imported: the facts still check that each service is active.
2. `BookingRequest` gains two fields after `procedureIds: string[];`:

```ts
  /** The visit's length; online booking spec 6.2. */
  minutes: number;
  /** How long the chair stays blocked after the visit. */
  cleaningMinutes: number;
```

3. `export type ProcedureSnapshot = { id: string; name: string };`
4. In `bookingFacts`, replace the four lines from `const minutes = ordered.reduce(...)` through `const chairFreeAt = ...` with:

```ts
  const end = new Date(req.start.getTime() + req.minutes * 60_000);
  const chairFreeAt = new Date(end.getTime() + req.cleaningMinutes * 60_000);
```

5. The returned `procedures:` becomes `ordered.map(({ id, name }) => ({ id, name })),`.

In `src/server/appointments.ts`:

1. Add the import `import { practiceSettings } from "./practice";`
2. After `const instant = ...;` add:

```ts
const minutesSchema = z.number().int().min(15, "At least 15 minutes").max(480, "At most 480 minutes").multipleOf(15, "Use 15-minute steps");
const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);
```

3. In `bookingSchema`, replace the `procedureIds` line and add `minutes` after it:

```ts
  procedureIds: z.array(z.uuid()).min(1, "Pick at least one service").max(10, "Pick at most 10 services"),
  minutes: minutesSchema.optional(),
```

4. In `moveSchema`, after `procedureIds: ...optional(),` add `minutes: minutesSchema.optional(),`.
5. `saveProcedures` inserts `list.map((p, position) => ({ appointmentId, position, procedureId: p.id, name: p.name }))`.
6. After `saveProcedures`, add:

```ts
/**
 * Online booking spec 6.2: a new visit takes the practice's standard length unless given one, and today's cleaning time.
 * A visit being moved keeps its own length and cleaning time unless given a new length.
 */
async function lengthsFor(minutes: number | undefined, visitId?: string | null): Promise<{ minutes: number; cleaningMinutes: number }> {
  if (visitId) {
    const [visit] = await db.select().from(appointments).where(eq(appointments.id, visitId));
    if (visit) return { minutes: minutes ?? minutesBetween(visit.startTime, visit.endTime), cleaningMinutes: minutesBetween(visit.endTime, visit.chairFreeAt) };
  }
  const settings = await practiceSettings();
  return { minutes: minutes ?? settings.visitMinutes, cleaningMinutes: settings.cleaningMinutes };
}
```

7. In `validateBooking`, before `const { result } = await check(`, add `const lengths = await lengthsFor(input.minutes, input.excludeAppointmentId);` and in the request object after `procedureIds: input.procedureIds,` add `...lengths,`.
8. In `createAppointment`, before `const req: BookingRequest = {`, add `const lengths = await lengthsFor(input.minutes);` and after `procedureIds: input.procedureIds,` add `...lengths,`.
9. In `moveAppointment`, the checked-in refusal condition becomes:

```ts
    if ((input.dentistId && input.dentistId !== visit.dentistId) || input.start || input.procedureIds || input.minutes !== undefined) {
```

and in the requested/confirmed `req`, after `procedureIds: input.procedureIds ?? current.map((p) => p.id),` add:

```ts
    minutes: input.minutes ?? minutesBetween(visit.startTime, visit.endTime),
    cleaningMinutes: minutesBetween(visit.endTime, visit.chairFreeAt),
```

- [ ] **Step 8: Open times take a length, through one shared finder**

Replace `src/server/availability.ts` with:

```ts
import { and, asc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointments, chairs, dentistSchedules, dentistTimeOff, type OperatingHours, userBranches, users } from "@/db/schema";
import type { WeeklyBlock } from "@/lib/booking-rules";
import { openTimes, type OpenTime } from "@/lib/slots";
import { addDays, manilaInstant } from "@/lib/time";
import { activeVisits } from "./booking";
import { requireBranch } from "./branches";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

export const availabilitySchema = z.object({
  branch: z.string().min(1),
  date: z.iso.date(),
  minutes: z.coerce.number().int().min(15).max(480).multipleOf(15).optional(),
  dentist: z.uuid().optional(),
  patient: z.uuid().optional(),
});

export type OpenTimesQuery = {
  branch: { id: string; active: boolean; operatingHours: OperatingHours };
  date: string;
  minutes: number;
  turnover: number;
  /** Starts before this are left out: now for staff, two hours from now online. */
  notBefore: Date;
  /** Only these dentists; every dentist who works at the branch when missing. */
  dentistIds?: readonly string[] | null;
  patientId?: string;
};

/** Spec 8.5 with the online booking spec's 6.3: the open times for a visit of `minutes` plus `turnover` at a branch on a day. */
export async function findOpenTimes(q: OpenTimesQuery, tx: Db = db): Promise<OpenTime[]> {
  // A closed branch takes no bookings (spec 8.3), so it has no open times.
  if (!q.branch.active) return [];
  const chairNumbers = (
    await tx
      .select({ number: chairs.number })
      .from(chairs)
      .where(and(eq(chairs.branchId, q.branch.id), eq(chairs.active, true)))
      .orderBy(asc(chairs.number))
  ).map((c) => c.number);
  const links = await tx.select({ userId: userBranches.userId }).from(userBranches).where(eq(userBranches.branchId, q.branch.id));
  const dentists = (
    await tx
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
  ).filter((d) => (d.role === "owner" || links.some((l) => l.userId === d.id)) && (!q.dentistIds || q.dentistIds.includes(d.id)));
  if (chairNumbers.length === 0 || dentists.length === 0) return [];

  const ids = dentists.map((d) => d.id);
  const dayStart = manilaInstant(q.date, 0);
  const dayEnd = manilaInstant(addDays(q.date, 1), 0);
  const blockRows = await tx.select().from(dentistSchedules).where(inArray(dentistSchedules.dentistId, ids));
  const offRows = await tx
    .select()
    .from(dentistTimeOff)
    .where(and(inArray(dentistTimeOff.dentistId, ids), lt(dentistTimeOff.startsAt, dayEnd), gt(dentistTimeOff.endsAt, dayStart)));
  const visits = await activeVisits(
    tx,
    dayStart,
    dayEnd,
    or(inArray(appointments.dentistId, ids), eq(appointments.branchId, q.branch.id), q.patientId ? eq(appointments.patientId, q.patientId) : undefined),
  );

  const blocks = new Map<string, WeeklyBlock[]>();
  for (const b of blockRows) {
    blocks.set(b.dentistId, [
      ...(blocks.get(b.dentistId) ?? []),
      { branchId: b.branchId, dayOfWeek: b.dayOfWeek, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) },
    ]);
  }
  const timeOff = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const t of offRows) timeOff.set(t.dentistId, [...(timeOff.get(t.dentistId) ?? []), { startsAt: t.startsAt, endsAt: t.endsAt }]);

  return openTimes({
    date: q.date,
    now: q.notBefore,
    minutes: q.minutes,
    turnover: q.turnover,
    branch: { id: q.branch.id, hours: q.branch.operatingHours },
    chairs: chairNumbers,
    dentists: dentists.map(({ id, name }) => ({ id, name })),
    blocks,
    timeOff,
    visits,
    patientId: q.patientId,
  });
}

/** GET /availability: open times for staff, for a visit of `minutes` (the practice's standard length when missing). */
export async function availability(
  actor: Staff,
  q: z.infer<typeof availabilitySchema>,
): Promise<{ date: string; minutes: number; turnover: number; times: OpenTime[] }> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const settings = await practiceSettings();
  const minutes = q.minutes ?? settings.visitMinutes;
  const turnover = settings.cleaningMinutes;
  const times = await findOpenTimes({ branch, date: q.date, minutes, turnover, notBefore: new Date(), dentistIds: q.dentist ? [q.dentist] : null, patientId: q.patient });
  return { date: q.date, minutes, turnover, times };
}
```

If `OperatingHours` is not exported from `@/db/schema` as a type the import can reach, import it with `import type { OperatingHours } from "@/db/schema";` on its own line.

- [ ] **Step 9: Development data**

In `src/server/seed.ts`:

1. Replace the `PROCEDURES` comment and type line with:

```ts
/** Services, each with the length and cleaning time the sample visits use (services themselves have no length). */
const PROCEDURES: [string, number, number][] = [
```

(keep the seven rows as they are).

2. In the `Planned` type, `procedure` becomes `procedure: { id: string; name: string; minutes: number; cleaning: number };`
3. The practice insert becomes:

```ts
    await tx.insert(practice).values({
      name: "Sample Dental Group",
      onlineBooking: true,
      privacyNotice: "Sample privacy notice for development. The practice's real notice, reviewed by a lawyer, replaces it before going live.",
    });
```

4. The procedure insert becomes:

```ts
    const procedureRows = (
      await tx
        .insert(procedures)
        .values(PROCEDURES.map(([name], sort) => ({ name, sort })))
        .returning({ id: procedures.id, name: procedures.name })
    ).map((row) => {
      const [, minutes, cleaning] = PROCEDURES.find(([name]) => name === row.name)!;
      return { ...row, minutes, cleaning };
    });
```

5. In the visit loop, replace every `procedure.durationMinutes` with `procedure.minutes` and every `procedure.bufferMinutes` with `procedure.cleaning`.
6. In the `appointmentProcedures` insert, delete the `durationMinutes:` and `bufferMinutes:` lines.

- [ ] **Step 10: Run the whole suite, the types, and the linter**

Run: `npm test`
Expected: all test files pass (the earlier count plus the new tests).
Run: `npm run typecheck` then `npm run lint`
Expected: no errors. (The UI still sends and shows lengths; Task 2 changes it. Its local types keep it compiling.)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: give visits the practice's standard length instead of procedure lengths

Services lose their length and turnover; the practice gets a standard visit length (60 minutes) and a chair cleaning time (10 minutes), staff may pick a visit's length, and a moved visit keeps its own length and cleaning time. Services can be offered online and limited to chosen dentists (procedure_dentists), and online booking needs a privacy notice before it can be switched on. Open times now come from one finder that the online booking will share.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings, Services, and the booking panel without lengths

**Files:**
- Modify: `src/lib/time.ts` (add `durationText`)
- Test: `tests/unit/duration.test.ts`
- Modify: `src/app/[branch]/settings/practice-panel.tsx`, `src/app/[branch]/settings/procedures-panel.tsx`, `src/app/[branch]/settings/settings-screen.tsx`, `src/app/[branch]/settings/page.tsx`
- Modify: `src/components/calendar/booking-panel.tsx`
- Modify: `src/components/status-badge.tsx`, `src/components/calendar/day-grid.tsx`, `src/components/calendar/week-grid.tsx`, `src/components/calendar/visit-panel.tsx`, `src/app/[branch]/calendar/calendar-screen.tsx`, `src/app/[branch]/my-day/my-day-screen.tsx`
- Modify: `tests/e2e/visit.spec.ts`

**Interfaces:**
- Consumes: `GET/PATCH /api/v1/practice` returning `PracticeSettings`; `GET /api/v1/procedures` returning `{ id, name, online, active, dentistIds }[]`; `minutes` on booking, validating, moving, and availability (Task 1).
- Produces: `durationText(minutes: number): string` in `src/lib/time.ts`; `StatusBadge` takes `online?: boolean`; `SettingsScreen` takes `bookingUrl: string` instead of `practice: string`.

- [ ] **Step 1: Write the failing test for durations in words**

Create `tests/unit/duration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { durationText } from "@/lib/time";

describe("a length in words", () => {
  it("says minutes and hours the way a person would", () => {
    expect(durationText(5)).toBe("5 minutes");
    expect(durationText(45)).toBe("45 minutes");
    expect(durationText(60)).toBe("1 hour");
    expect(durationText(90)).toBe("1 hour 30 minutes");
    expect(durationText(120)).toBe("2 hours");
    expect(durationText(0)).toBe("0 minutes");
  });
});
```

Run: `npx vitest run tests/unit/duration.test.ts`
Expected: FAIL ("durationText" is not exported).

- [ ] **Step 2: Add `durationText`**

Append to `src/lib/time.ts`:

```ts
/** A length in words: "45 minutes", "1 hour", "1 hour 30 minutes". */
export function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`, rest === 0 ? "" : `${rest} minutes`].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 minutes";
}
```

Run: `npx vitest run tests/unit/duration.test.ts`
Expected: PASS.

- [ ] **Step 3: The Practice tab**

Replace `src/app/[branch]/settings/practice-panel.tsx` with:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { durationText } from "@/lib/time";

type PracticeSettings = { name: string; visitMinutes: number; cleaningMinutes: number; onlineBooking: boolean; privacyNotice: string };

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15); // 15 minutes to 4 hours
const CLEANING = Array.from({ length: 13 }, (_, i) => i * 5); // none to 60 minutes

/** Online booking spec 11: the practice's name, standard visit length, cleaning time, and online booking. */
export function PracticePanel({ bookingUrl }: { bookingUrl: string }) {
  const settings = useQuery({ queryKey: ["practice"], queryFn: () => api<PracticeSettings>("/practice") });
  if (settings.isPending) return <p className="text-muted-foreground">Loading the practice settings...</p>;
  if (settings.isError) return <FormAlert message={errorMessage(settings.error)} />;
  return <PracticeForm initial={settings.data} bookingUrl={bookingUrl} />;
}

function PracticeForm({ initial, bookingUrl }: { initial: PracticeSettings; bookingUrl: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<PracticeSettings>("/practice", { method: "PATCH", body: form }),
    onSuccess: async () => {
      toast.success("Practice settings saved.");
      setErrors({});
      await client.invalidateQueries({ queryKey: ["practice"] });
      router.refresh();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <form
      className="grid max-w-xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <TextField label="Practice name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} error={errors.name} />
      <label className="grid gap-1.5 text-sm font-medium">
        Standard visit length
        <NativeSelect value={String(form.visitMinutes)} onChange={(event) => setForm({ ...form, visitMinutes: Number(event.target.value) })}>
          {LENGTHS.map((m) => (
            <NativeSelectOption key={m} value={String(m)}>
              {durationText(m)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="font-normal text-muted-foreground">New visits and online bookings start at this length; staff can change a visit's length.</span>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Chair cleaning time
        <NativeSelect value={String(form.cleaningMinutes)} onChange={(event) => setForm({ ...form, cleaningMinutes: Number(event.target.value) })}>
          {CLEANING.map((m) => (
            <NativeSelectOption key={m} value={String(m)}>
              {m === 0 ? "None" : durationText(m)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="font-normal text-muted-foreground">The chair stays blocked this long after each visit.</span>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Privacy notice
        <Textarea value={form.privacyNotice} maxLength={5000} rows={8} onChange={(event) => setForm({ ...form, privacyNotice: event.target.value })} aria-invalid={errors.privacyNotice ? true : undefined} />
        <span className="font-normal text-muted-foreground">Patients agree to it when they book online. Have a lawyer review it (RA 10173).</span>
        {errors.privacyNotice && <span className="font-normal text-destructive">{errors.privacyNotice}</span>}
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={form.onlineBooking} onChange={(event) => setForm({ ...form, onlineBooking: event.target.checked })} />
        Take online bookings
      </label>
      <p className="text-sm text-muted-foreground">
        {`Patients book at ${bookingUrl}. Their requests come in as Requested, marked Online, for the front desk to confirm.`}
      </p>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
```

In `src/app/[branch]/settings/settings-screen.tsx`: the prop `practice: string` becomes `bookingUrl: string` (in the destructuring and the type), `<PracticePanel initialName={practice} />` becomes `<PracticePanel bookingUrl={bookingUrl} />`, and the tab label `Procedures` becomes `Services` (keep `value="procedures"`).

In `src/app/[branch]/settings/page.tsx`: replace `practice={owner ? await practiceName() : ""}` with `` bookingUrl={`${appUrl()}/book`} ``, remove the `practiceName` import, and add `import { appUrl } from "@/lib/env";`.

- [ ] **Step 4: The Services tab**

Replace `src/app/[branch]/settings/procedures-panel.tsx` with:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { StateBadge } from "@/components/state-badge";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";

type Service = { id: string; name: string; online: boolean; active: boolean; dentistIds: string[] };

/** Online booking spec 11: services have no length; each can be offered online and limited to chosen dentists. */
export function ProceduresPanel() {
  const services = useQuery({ queryKey: ["procedures"], queryFn: () => api<Service[]>("/procedures") });
  const dentists = useDentists();
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  if (services.isPending) return <p className="text-muted-foreground">Loading services...</p>;
  if (services.isError) return <FormAlert message={errorMessage(services.error)} />;
  const names = new Map((dentists.data ?? []).map((d) => [d.id, d.name]));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Visits start at the standard length on the Practice tab. Online, a service goes only to its dentists.</p>
        <Button onClick={() => setEditing("new")}>Add service</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Online</TableHead>
              <TableHead>Dentists</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.data.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  No services yet.
                </TableCell>
              </TableRow>
            )}
            {services.data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.online ? "Yes" : "No"}</TableCell>
                <TableCell>{s.dentistIds.length === 0 ? "All" : s.dentistIds.map((id) => names.get(id) ?? "A former dentist").join(", ")}</TableCell>
                <TableCell>
                  <StateBadge on={s.active} yes="Offered" no="Retired" />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && <ServiceDialog service={editing === "new" ? null : editing} dentists={dentists.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ServiceDialog({ service, dentists, onClose }: { service: Service | null; dentists: { id: string; name: string }[]; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: service?.name ?? "",
    online: service?.online ?? true,
    active: service?.active ?? true,
    dentistIds: service?.dentistIds ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, online: form.online, dentistIds: form.dentistIds };
      return service ? api(`/procedures/${service.id}`, { method: "PATCH", body: { ...body, active: form.active } }) : api("/procedures", { method: "POST", body });
    },
    onSuccess: async () => {
      toast.success(`Saved ${form.name}.`);
      onClose();
      await client.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  const toggle = (id: string, on: boolean) =>
    setForm({ ...form, dentistIds: on ? [...form.dentistIds, id] : form.dentistIds.filter((d) => d !== id) });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "Add a service"}</DialogTitle>
          <DialogDescription>Online bookings for this service go only to the dentists ticked here, or to any dentist when none is ticked.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <TextField label="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={60} error={errors.name} />
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={form.online} onChange={(event) => setForm({ ...form, online: event.target.checked })} className="size-4 accent-primary" />
            Offer online
          </label>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Dentists</legend>
            {dentists.length === 0 && <p className="text-sm text-muted-foreground">No dentists yet.</p>}
            {dentists.map((d) => (
              <label key={d.id} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" checked={form.dentistIds.includes(d.id)} onChange={(event) => toggle(d.id, event.target.checked)} className="size-4 accent-primary" />
                {d.name}
              </label>
            ))}
            {errors.dentistIds && <p className="text-sm text-destructive">{errors.dentistIds}</p>}
          </fieldset>
          {service && (
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="size-4 accent-primary" />
              Offered (retired services cannot be booked)
            </label>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: The booking panel's Length**

In `src/components/calendar/booking-panel.tsx`:

1. Import `durationText` with the other time helpers: `import { durationText, formatDay, formatTime, fromMinutes, manilaDate, manilaInstant, manilaMinutes, toMinutes } from "@/lib/time";`
2. `type Procedure = { id: string; name: string };`
3. After `const lowest = ...;` add:

```ts
const LENGTHS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15); // 15 minutes to 8 hours
const minutesBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
```

4. After `const [note, setNote] = useState("");` add `const [length, setLength] = useState<number | null>(null);`
5. Replace the three lines `const picked = ...`, `const minutes = ...`, `const turnover = ...` with:

```ts
  const practice = useQuery({ queryKey: ["practice"], queryFn: () => api<{ visitMinutes: number; cleaningMinutes: number }>("/practice") });
  // Online booking spec 6.2: a new visit starts at the standard length, a moved one keeps its own; staff can change either.
  const minutes = length ?? (moving ? minutesBetween(moving.start, moving.end) : practice.data?.visitMinutes);
  const turnover = moving ? minutesBetween(moving.end, moving.chairFreeAt) : practice.data?.cleaningMinutes;
  const lengthOptions = minutes !== undefined && !LENGTHS.includes(minutes) ? [...LENGTHS, minutes].sort((a, b) => a - b) : LENGTHS;
  // A moved visit's own length is sent only when staff change it.
  const sentMinutes = moving && length === null ? undefined : minutes;
```

6. The `open` query becomes:

```ts
  const open = useQuery({
    queryKey: ["availability", branch.code, date, minutes, patient?.id ?? ""],
    queryFn: () =>
      api<{ times: OpenTime[] }>(`/availability?branch=${branch.code}&date=${date}&minutes=${minutes}${patient ? `&patient=${patient.id}` : ""}`),
    enabled: minutes !== undefined && !walkIn && !anyTime && !chairOnly,
  });
```

7. `const request = { branch: branch.code, chairNumber, dentistId, patientId: patient?.id, start, procedureIds, minutes: sentMinutes, walkIn };`
8. In the move `PATCH` body (not the chair-only one), add `minutes: sentMinutes,` after `procedureIds,`.
9. Replace the whole `{!chairOnly && ( <fieldset ...> ... Procedures ... </fieldset> )}` block with:

```tsx
          {!chairOnly && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Services</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(procedures.data ?? []).map((p) => (
                  <label key={p.id} className={toggleClass}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={procedureIds.includes(p.id)}
                      onChange={(event) => setProcedureIds(event.target.checked ? [...procedureIds, p.id] : procedureIds.filter((id) => id !== p.id))}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
              <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
                Length
                <NativeSelect
                  value={minutes === undefined ? "" : String(minutes)}
                  onChange={(event) => {
                    setLength(Number(event.target.value));
                    if (!anyTime) setTime("");
                  }}
                >
                  {lengthOptions.map((m) => (
                    <NativeSelectOption key={m} value={String(m)}>
                      {durationText(m)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              {minutes !== undefined && turnover !== undefined && (
                <p className="text-sm text-muted-foreground">{`${durationText(minutes)}, then ${turnover === 0 ? "no chair cleaning" : `${durationText(turnover)} of chair cleaning`}.`}</p>
              )}
            </fieldset>
          )}
```

10. In the open-times section, replace `(procedureIds.length === 0 ? ( <p className="text-sm text-muted-foreground">Pick procedures to see the open times.</p> ) : open.isPending ? (` with `(open.isPending ? (`.

Run: `npm run typecheck`
Expected: no errors. If `VisitDetailJson` lacks `end` or `chairFreeAt`, read `src/lib/visits.ts`: `VisitJson` has `start`, `end`, and `chairFreeAt` as ISO strings.

- [ ] **Step 6: The Online marker**

Replace the body of `StatusBadge` in `src/components/status-badge.tsx` (keep `LOOK` and the imports):

```tsx
/** A visit's status as a word and an icon (spec section 10: never colour alone), and "Online" for an online booking. */
export function StatusBadge({ status, online = false, className }: { status: Status; online?: boolean; className?: string }) {
  const { icon: Icon, tone } = LOOK[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone, className)}>
      <Icon aria-hidden className="size-3.5" />
      <span>{STATUS_LABEL[status]}</span>
      {online && <span>· Online</span>}
    </span>
  );
}
```

Then pass `online={v.source === "portal"}` where the badge shows a visit that has `source`:
- `src/components/calendar/day-grid.tsx`: `<StatusBadge status={v.status} online={v.source === "portal"} />`
- `src/components/calendar/week-grid.tsx`: `<StatusBadge status={v.status} online={v.source === "portal"} className="justify-self-start" />`
- `src/components/calendar/visit-panel.tsx`: `<StatusBadge status={v.status} online={v.source === "portal"} />`
- `src/app/[branch]/calendar/calendar-screen.tsx`: `<StatusBadge status={v.status} online={v.source === "portal"} />`
- `src/app/[branch]/my-day/my-day-screen.tsx`: `<StatusBadge status={v.status} online={v.source === "portal"} />`

Leave the overview and patient screens alone (their rows have no `source`).

- [ ] **Step 7: The end-to-end run's service and length**

In `tests/e2e/visit.spec.ts`:
- `post("/procedures", { name: "Consultation", durationMinutes: 30, bufferMinutes: 10 })` becomes `post("/procedures", { name: "Consultation" })`.
- `await booking.getByLabel("Consultation, 30 min").check();` becomes two lines:

```ts
  await booking.getByLabel("Consultation", { exact: true }).check();
  await booking.getByLabel("Length").selectOption({ label: "30 minutes" });
```

(The run is executed in Task 5.)

- [ ] **Step 8: Check the screens in a browser**

Run `npm run typecheck`, `npm run lint`, `npm test`; expected: all pass. Then with the development data (`npm run seed` on an empty `.data/dev` if needed) start `npm run dev` and, signed in as the seeded owner: Settings shows the Practice tab with the four settings and the booking address; the Services tab lists services with Online and Dentists; editing a service shows Offer online and the dentist ticks; New booking shows Services (names only) and Length (1 hour selected) and the open times; moving a visit keeps its length. Stop the dev server afterwards.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: settings for the standard length and online booking, services without lengths, and a Length on the booking panel

The Practice tab sets the standard visit length, the chair cleaning time, the privacy notice, and online booking; Procedures becomes Services, each with Offer online and its dentists; the booking panel picks a length instead of summing procedure lengths; and online bookings wear an Online marker next to their status.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The online booking service and its API

**Files:**
- Create: `src/lib/portal.ts`
- Create: `src/server/portal.ts`
- Create: `src/app/api/v1/portal/times/route.ts`, `src/app/api/v1/portal/bookings/route.ts`, `src/app/api/v1/online-requests/route.ts`
- Modify: `src/server/appointments.ts` (history text and name), `src/lib/access-log.ts`, `src/app/[branch]/settings/access-log-panel.tsx`
- Test: `tests/unit/portal.test.ts`, `tests/db/portal.test.ts`

**Interfaces:**
- Consumes: `findOpenTimes`, `practiceSettings`, `procedureDentists`, `procedures.online` (Task 1); `mobileSchema` from `src/lib/validation.ts`; `clientIp`, `publicRoute`, `staffRoute`, `readJson`, `json` from `src/server/api.ts`.
- Produces: `BOOKING_DAYS = 30`, `NOTICE_MS`, `chooseDentist` in `src/lib/portal.ts`; `portalInfo(): Promise<PortalInfo>`, `portalTimes`, `bookOnline`, `onlineRequests`, `type OnlineRequest` in `src/server/portal.ts`; `GET /api/v1/portal/times`, `POST /api/v1/portal/bookings`, `GET /api/v1/online-requests?branch=`.
- `type PortalInfo = { open: false; practiceName: string } | { open: true; practiceName: string; branches: { code: string; name: string }[]; services: { id: string; name: string }[] }`
- `type OnlineRequest = { id: string; start: Date; createdAt: Date; note: string; mobile: string | null; dentistName: string; patientName: string; services: string[] }`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/portal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chooseDentist } from "@/lib/portal";

const reyes = { id: "b", name: "Dr. Reyes" };
const lim = { id: "c", name: "Dr. Lim" };
const otherLim = { id: "a", name: "Dr. Lim" };

describe("choosing a dentist online", () => {
  it("picks the dentist with the fewest visits that day", () => {
    expect(chooseDentist([reyes, lim], new Map([["c", 3], ["b", 1]]))).toBe(reyes);
  });

  it("breaks a tie by name, then by id", () => {
    expect(chooseDentist([reyes, lim], new Map())).toBe(lim);
    expect(chooseDentist([lim, otherLim], new Map())).toBe(otherLim);
  });

  it("has no one to pick from an empty list", () => {
    expect(chooseDentist([], new Map())).toBeUndefined();
  });
});
```

Run: `npx vitest run tests/unit/portal.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: The pure rules**

Create `src/lib/portal.ts`:

```ts
/** How far ahead patients can book online, in days after today (online booking spec, section 3). */
export const BOOKING_DAYS = 30;

/** How soon an online booking can start (online booking spec, section 6.3). */
export const NOTICE_MS = 2 * 3_600_000;

/**
 * Online booking spec 6.4: among the dentists free at a start, the one with the fewest visits that day; a tie goes to the
 * name that sorts first, then the lower id.
 */
export function chooseDentist<D extends { id: string; name: string }>(free: readonly D[], visitsThatDay: ReadonlyMap<string, number>): D | undefined {
  return [...free].sort(
    (a, b) =>
      (visitsThatDay.get(a.id) ?? 0) - (visitsThatDay.get(b.id) ?? 0) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}
```

Run: `npx vitest run tests/unit/portal.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing database test**

Create `tests/db/portal.test.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as onlineRequestsRoute from "@/app/api/v1/online-requests/route";
import * as bookingsRoute from "@/app/api/v1/portal/bookings/route";
import * as timesRoute from "@/app/api/v1/portal/times/route";
import { db } from "@/db";
import { appointmentProcedures, appointments, auditLog, chairs, dentistSchedules, patients, practice, procedureDentists, procedures } from "@/db/schema";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const at = (clock: string, date = MONDAY) => new Date(`${date}T${clock}:00+08:00`);
// 08:00 on Monday in Manila: with two hours' notice, the first online start is 10:00.
vi.useFakeTimers({ toFake: ["Date"], now: at("08:00") });

async function build() {
  await db.insert(practice).values({ name: "Smile Dental", visitMinutes: 60, cleaningMinutes: 10, onlineBooking: true, privacyNotice: "We keep your details to run your visits." });
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  await db.insert(chairs).values([
    { branchId: dt.id, number: 1 },
    { branchId: dt.id, number: 2 },
  ]);
  const reyes = await makeUser({ role: "dentist", name: "Dr. Reyes", branchIds: [dt.id] });
  const lim = await makeUser({ role: "dentist", name: "Dr. Lim", branchIds: [dt.id] });
  await db.insert(dentistSchedules).values(
    [reyes, lim].flatMap((d) => [1, 2].map((dayOfWeek) => ({ dentistId: d.id, branchId: dt.id, dayOfWeek, startTime: "09:00", endTime: "17:00" }))),
  );
  const [cleaning] = await db.insert(procedures).values({ name: "Oral Prophylaxis (Cleaning)" }).returning();
  const [braces] = await db.insert(procedures).values({ name: "Braces and Retainers" }).returning();
  await db.insert(procedureDentists).values({ procedureId: braces.id, dentistId: lim.id });
  const [hidden] = await db.insert(procedures).values({ name: "Odontectomy (Impacted Wisdom Tooth Extraction)", online: false }).returning();
  // Dr. Lim is busy 10:00 to 11:00 on Monday, on chair 2.
  const [seen] = await db.insert(patients).values({ lastName: "Tan", firstName: "Gio" }).returning();
  await db.insert(appointments).values({ patientId: seen.id, dentistId: lim.id, branchId: dt.id, chairNumber: 2, startTime: at("10:00"), endTime: at("11:00"), chairFreeAt: at("11:10"), status: "confirmed", source: "staff" });
  const desk = await makeUser({ role: "manager", branchIds: [dt.id] });
  return { dt, reyes, lim, cleaning, braces, hidden, desk: await signIn(desk.username), reyesCookie: await signIn(reyes.username) };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const ip = (n: number) => ({ "x-nf-client-connection-ip": `203.0.113.${n}` });
const times = async (service: string, date = MONDAY) =>
  call(timesRoute.GET, request(`/api/v1/portal/times?branch=downtown&service=${service}&date=${date}`));
const bookOnline = (body: Record<string, unknown>, from = 1) =>
  call(bookingsRoute.POST, request("/api/v1/portal/bookings", { method: "POST", body, headers: ip(from) }));
const details = (firstName: string, lastName: string, mobile: string) => ({ firstName, lastName, mobile, consent: true });

describe("open times online", () => {
  it("offers the open starts two hours away at the earliest, and nothing more", async () => {
    const w = await world();
    const res = await times(w.cleaning.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["times"]);
    expect(body.times[0]).toBe(at("10:00").toISOString());
    expect(body.times.at(-1)).toBe(at("16:00").toISOString());
    expect(body.times).toHaveLength(25);
  });

  it("offers a limited service only when its dentists are free", async () => {
    const w = await world();
    const body = await (await times(w.braces.id)).json();
    expect(body.times[0]).toBe(at("11:00").toISOString());
  });

  it("refuses a service that isn't offered online, and days out of range", async () => {
    const w = await world();
    const res = await times(w.hidden.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("That service isn't offered online.");
    expect((await (await times(w.cleaning.id, "2026-12-31")).json()).times).toEqual([]);
  });
});

describe("booking online", () => {
  it("books a Requested online visit with a dentist and chair DentaSync picks", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:00").toISOString(), note: "Tooth pain", ...details("Ana", "Santos", "0917 123 4567") });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ branch: "Downtown", service: "Oral Prophylaxis (Cleaning)", start: at("10:00").toISOString() });
    const [patient] = await db.select().from(patients).where(eq(patients.mobile, "+639171234567"));
    expect(patient).toMatchObject({ firstName: "Ana", lastName: "Santos", homeBranchId: w.dt.id, createdBy: null });
    const [visit] = await db.select().from(appointments).where(eq(appointments.patientId, patient.id));
    // Dr. Lim is busy at 10:00, so Dr. Reyes gets it, on the free chair 1.
    expect(visit).toMatchObject({ status: "requested", source: "portal", dentistId: w.reyes.id, chairNumber: 1, note: "Tooth pain", createdBy: null });
    expect(visit.endTime.toISOString()).toBe(at("11:00").toISOString());
    expect(visit.chairFreeAt.toISOString()).toBe(at("11:10").toISOString());
    const services = await db.select().from(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, visit.id));
    expect(services).toMatchObject([{ position: 0, procedureId: w.cleaning.id, name: "Oral Prophylaxis (Cleaning)" }]);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, visit.id), eq(auditLog.action, "appointment.requested_online")));
    expect(log).toMatchObject({ userId: null, details: { ip: "203.0.113.1", privacyNoticeAccepted: true, online: true } });
  });

  it("gives the free dentist with the fewest visits that day, then the first by name", async () => {
    const w = await world();
    // Both are free at 13:00 and each has one visit today: Dr. Lim comes first by name.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("13:00").toISOString(), ...details("Ben", "Cruz", "0918 000 0001") });
    // Now Dr. Lim has two and Dr. Reyes one: 14:00 goes to Dr. Reyes.
    await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("14:00").toISOString(), ...details("Cyd", "Uy", "0918 000 0002") });
    const rows = await db.select().from(appointments).where(eq(appointments.source, "portal"));
    const dentistAt = (clock: string) => rows.find((r) => r.startTime.getTime() === at(clock).getTime())?.dentistId;
    expect(dentistAt("13:00")).toBe(w.lim.id);
    expect(dentistAt("14:00")).toBe(w.reyes.id);
  });

  it("puts a returning patient's booking on their record", async () => {
    const w = await world();
    const [dee] = await db.insert(patients).values({ lastName: "Reyes", firstName: "Dee", mobile: "+639181112222" }).returning();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00").toISOString(), ...details("Dee", " reyes ", "09181112222") }, 2);
    expect(res.status).toBe(201);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639181112222"))).toHaveLength(1);
    const [visit] = await db.select().from(appointments).where(eq(appointments.patientId, dee.id));
    expect(visit.startTime.toISOString()).toBe(at("15:00").toISOString());
  });

  it("refuses a time that was just taken", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("10:00").toISOString(), ...details("Eli", "Go", "0918 000 0003") }, 2);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe("That time was just taken. Please pick another.");
  });

  it("lets each patient have at most two requests waiting", async () => {
    const w = await world();
    expect((await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00").toISOString(), ...details("Ana", "Santos", "09171234567") }, 3)).status).toBe(201);
    const third = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("09:00", TUESDAY).toISOString(), ...details("Ana", "Santos", "09171234567") }, 3);
    expect(third.status).toBe(429);
    expect((await third.json()).error.message).toBe("You already have 2 requests waiting. The clinic will call you.");
  });

  it("allows five bookings an hour from one connection", async () => {
    const w = await world();
    for (let i = 0; i < 5; i += 1) {
      const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at(`${10 + i}:00`, TUESDAY).toISOString(), ...details("Guest", `Five${i}`, `0919000000${i}`) }, 4);
      expect(res.status).toBe(201);
    }
    const sixth = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("15:00", TUESDAY).toISOString(), ...details("Guest", "Six", "09190000009") }, 4);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.message).toBe("Too many bookings from this connection. Please call the clinic.");
  });

  it("answers a bot as if it booked, and saves nothing", async () => {
    const w = await world();
    const before = (await db.select().from(appointments)).length;
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), website: "http://spam.example", ...details("Bot", "Bot", "09190000008") }, 5);
    expect(res.status).toBe(201);
    expect((await db.select().from(appointments)).length).toBe(before);
    expect(await db.select().from(patients).where(eq(patients.mobile, "+639190000008"))).toEqual([]);
  });

  it("needs the privacy notice agreed", async () => {
    const w = await world();
    const res = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), ...details("Fe", "Lim", "09190000007"), consent: false }, 6);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields.consent).toBe("Agree to the privacy notice to book.");
  });

  it("is closed when online booking is off", async () => {
    const w = await world();
    await db.update(practice).set({ onlineBooking: false });
    const res = await times(w.cleaning.id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Online booking isn't available right now.");
    const booked = await bookOnline({ branch: "downtown", service: w.cleaning.id, start: at("16:00", TUESDAY).toISOString(), ...details("Fe", "Lim", "09190000007") }, 6);
    expect(booked.status).toBe(404);
    await db.update(practice).set({ onlineBooking: true });
  });
});

describe("online requests", () => {
  it("lists the branch's waiting online requests for the front desk", async () => {
    const w = await world();
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.desk }));
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.length).toBeGreaterThanOrEqual(9);
    expect(list).toContainEqual(
      expect.objectContaining({ patientName: "Santos, Ana", mobile: "+639171234567", services: ["Oral Prophylaxis (Cleaning)"], dentistName: "Dr. Reyes", note: "Tooth pain" }),
    );
  });

  it("is for people who manage the branch's visits", async () => {
    const w = await world();
    const res = await call(onlineRequestsRoute.GET, request("/api/v1/online-requests?branch=downtown", { cookie: w.reyesCookie }));
    expect(res.status).toBe(403);
  });
});
```

Run: `npx vitest run tests/db/portal.test.ts`
Expected: FAIL (the route modules do not exist).

- [ ] **Step 4: The portal service**

Create `src/server/portal.ts`:

```ts
import { and, asc, count, eq, gt, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, patients, procedureDentists, procedures, users } from "@/db/schema";
import { BOOKING_DAYS, chooseDentist, NOTICE_MS } from "@/lib/portal";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { mobileSchema } from "@/lib/validation";
import { audit } from "./audit";
import { findOpenTimes } from "./availability";
import { requireBranch } from "./branches";
import { ApiError, pgCode } from "./errors";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

/** Online booking spec 8. */
const BOOKINGS_PER_IP_PER_HOUR = 5;
const WAITING_PER_PATIENT = 2;

const closed = () => new ApiError(404, "closed", "Online booking isn't available right now.");
const taken = () => new ApiError(409, "taken", "That time was just taken. Please pick another.");

export type PortalInfo =
  | { open: false; practiceName: string }
  | { open: true; practiceName: string; branches: { code: string; name: string }[]; services: { id: string; name: string }[] };

/** What /book shows (online booking spec 3): the active branches and the services offered online, nothing else. */
export async function portalInfo(): Promise<PortalInfo> {
  const settings = await practiceSettings();
  if (!settings.onlineBooking) return { open: false, practiceName: settings.name };
  const branchRows = await db
    .select({ code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sort), asc(branches.name));
  const services = await db
    .select({ id: procedures.id, name: procedures.name })
    .from(procedures)
    .where(and(eq(procedures.active, true), eq(procedures.online, true)))
    .orderBy(asc(procedures.sort), asc(procedures.name));
  return { open: true, practiceName: settings.name, branches: branchRows, services };
}

/** The branch and service a patient picked, refused as in online booking spec 8, with the service's dentists (null: all). */
async function target(tx: Db, branchCode: string, serviceId: string) {
  const settings = await practiceSettings(tx);
  if (!settings.onlineBooking) throw closed();
  const [branch] = await tx.select().from(branches).where(eq(branches.code, branchCode));
  if (!branch?.active) throw new ApiError(404, "branch", "That branch doesn't take online bookings.");
  const [service] = await tx.select().from(procedures).where(eq(procedures.id, serviceId));
  if (!service?.active || !service.online) throw new ApiError(404, "service", "That service isn't offered online.");
  const limited = await tx.select({ id: procedureDentists.dentistId }).from(procedureDentists).where(eq(procedureDentists.procedureId, service.id));
  return { settings, branch, service, dentistIds: limited.length > 0 ? limited.map((d) => d.id) : null };
}

/** Today to 30 days ahead, in Manila dates. */
const bookable = (date: string, now: Date) => date >= manilaDate(now) && date <= addDays(manilaDate(now), BOOKING_DAYS);

export const timesSchema = z.object({ branch: z.string().min(1), service: z.uuid(), date: z.iso.date() });

/** GET /portal/times: the open starts only (online booking spec 6.3), never who is free. */
export async function portalTimes(q: z.infer<typeof timesSchema>): Promise<{ times: string[] }> {
  const now = new Date();
  const t = await target(db, q.branch, q.service);
  if (!bookable(q.date, now)) return { times: [] };
  const open = await findOpenTimes({
    branch: t.branch,
    date: q.date,
    minutes: t.settings.visitMinutes,
    turnover: t.settings.cleaningMinutes,
    notBefore: new Date(now.getTime() + NOTICE_MS),
    dentistIds: t.dentistIds,
  });
  return { times: open.map((o) => o.start.toISOString()) };
}

export const onlineBookingSchema = z.object({
  branch: z.string().min(1),
  service: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  firstName: z.string().trim().min(1, "Enter your first name").max(50, "Use at most 50 characters"),
  lastName: z.string().trim().min(1, "Enter your last name").max(50, "Use at most 50 characters"),
  mobile: mobileSchema,
  note: z.string().trim().max(500, "Use at most 500 characters").optional().default(""),
  consent: z.literal(true, "Agree to the privacy notice to book."),
  website: z.string().max(200).optional().default(""),
});

/** Online booking spec 7: an existing patient with this mobile number and last name (lowest chart number), or a new one. */
async function matchPatient(tx: Db, input: { firstName: string; lastName: string; mobile: string }, branchId: string): Promise<string> {
  const [found] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.mobile, input.mobile), sql`lower(trim(${patients.lastName})) = lower(${input.lastName})`))
    .orderBy(asc(patients.chartNo))
    .limit(1);
  if (found) return found.id;
  const [created] = await tx
    .insert(patients)
    .values({ firstName: input.firstName, lastName: input.lastName, mobile: input.mobile, homeBranchId: branchId })
    .returning({ id: patients.id });
  await audit({ userId: null, action: "patient.created", entity: "patient", entityId: created.id, branchId, details: { online: true } }, tx);
  return created.id;
}

/** Each dentist's visits on a Manila date, any status but Cancelled and No-Show (online booking spec 6.4). */
async function visitsOn(tx: Db, date: string, dentistIds: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ dentistId: appointments.dentistId, n: count() })
    .from(appointments)
    .where(
      and(
        inArray(appointments.dentistId, dentistIds),
        gte(appointments.startTime, manilaInstant(date, 0)),
        lt(appointments.startTime, manilaInstant(addDays(date, 1), 0)),
        notInArray(appointments.status, ["cancelled", "no_show"]),
      ),
    )
    .groupBy(appointments.dentistId);
  return new Map(rows.map((r) => [r.dentistId, r.n]));
}

/** POST /portal/bookings (online booking spec 3 to 8). Answers with names only, never anything about existing records. */
export async function bookOnline(input: z.infer<typeof onlineBookingSchema>, ip: string): Promise<{ branch: string; service: string; start: string }> {
  // The bot trap: the same answer as a real booking, and nothing saved.
  if (input.website !== "") {
    const t = await target(db, input.branch, input.service);
    return { branch: t.branch.name, service: t.service.name, start: new Date(input.start).toISOString() };
  }
  const now = new Date();
  const start = new Date(input.start);
  try {
    return await db.transaction(async (tx) => {
      // One online booking at a time, so two cannot both pass the counts below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dentasync.portal'))`);
      const t = await target(tx, input.branch, input.service);
      const [fromIp] = await tx
        .select({ n: count() })
        .from(auditLog)
        .where(and(eq(auditLog.action, "appointment.requested_online"), sql`${auditLog.details}->>'ip' = ${ip}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
      if (fromIp.n >= BOOKINGS_PER_IP_PER_HOUR) {
        throw new ApiError(429, "too_many_requests", "Too many bookings from this connection. Please call the clinic.");
      }
      const patientId = await matchPatient(tx, input, t.branch.id);
      const [waiting] = await tx
        .select({ n: count() })
        .from(appointments)
        .where(and(eq(appointments.patientId, patientId), eq(appointments.source, "portal"), eq(appointments.status, "requested"), gt(appointments.startTime, now)));
      if (waiting.n >= WAITING_PER_PATIENT) {
        throw new ApiError(429, "too_many_waiting", "You already have 2 requests waiting. The clinic will call you.");
      }
      const date = manilaDate(start);
      if (!bookable(date, now)) throw taken();
      const open = await findOpenTimes(
        {
          branch: t.branch,
          date,
          minutes: t.settings.visitMinutes,
          turnover: t.settings.cleaningMinutes,
          notBefore: new Date(now.getTime() + NOTICE_MS),
          dentistIds: t.dentistIds,
          patientId,
        },
        tx,
      );
      const slot = open.find((o) => o.start.getTime() === start.getTime());
      if (!slot) throw taken();
      const dentist = chooseDentist(slot.dentists, await visitsOn(tx, date, slot.dentists.map((d) => d.id)));
      if (!dentist) throw taken();
      const end = new Date(start.getTime() + t.settings.visitMinutes * 60_000);
      const [row] = await tx
        .insert(appointments)
        .values({
          patientId,
          dentistId: dentist.id,
          branchId: t.branch.id,
          chairNumber: Math.min(...dentist.chairs),
          startTime: start,
          endTime: end,
          chairFreeAt: new Date(end.getTime() + t.settings.cleaningMinutes * 60_000),
          status: "requested",
          source: "portal",
          note: input.note,
        })
        .returning({ id: appointments.id });
      await tx.insert(appointmentProcedures).values({ appointmentId: row.id, position: 0, procedureId: t.service.id, name: t.service.name });
      await audit(
        {
          userId: null,
          action: "appointment.requested_online",
          entity: "appointment",
          entityId: row.id,
          branchId: t.branch.id,
          details: { ip, privacyNoticeAccepted: true, online: true, start: start.toISOString() },
        },
        tx,
      );
      return { branch: t.branch.name, service: t.service.name, start: start.toISOString() };
    });
  } catch (error) {
    // The database refused a clash with a booking saved in between (spec 8.8).
    if (pgCode(error) === "23P01") throw taken();
    throw error;
  }
}

export const onlineRequestsSchema = z.object({ branch: z.string().min(1) });

export type OnlineRequest = {
  id: string;
  start: Date;
  createdAt: Date;
  note: string;
  mobile: string | null;
  dentistName: string;
  patientName: string;
  services: string[];
};

/** Online booking spec 4: the branch's Requested online visits from now on, the oldest request first. */
export async function onlineRequests(actor: Staff, q: z.infer<typeof onlineRequestsSchema>): Promise<OnlineRequest[]> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.manage", { branchId: branch.id });
  const rows = await db
    .select({
      id: appointments.id,
      start: appointments.startTime,
      createdAt: appointments.createdAt,
      note: appointments.note,
      mobile: patients.mobile,
      dentistName: users.name,
      lastName: patients.lastName,
      firstName: patients.firstName,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .where(and(eq(appointments.branchId, branch.id), eq(appointments.source, "portal"), eq(appointments.status, "requested"), gt(appointments.startTime, new Date())))
    .orderBy(asc(appointments.createdAt), asc(appointments.startTime));
  const procs = rows.length
    ? await db
        .select()
        .from(appointmentProcedures)
        .where(inArray(appointmentProcedures.appointmentId, rows.map((r) => r.id)))
        .orderBy(asc(appointmentProcedures.position))
    : [];
  return rows.map(({ lastName, firstName, ...r }) => ({
    ...r,
    patientName: `${lastName}, ${firstName}`,
    services: procs.filter((p) => p.appointmentId === r.id).map((p) => p.name),
  }));
}
```

If `pgCode` is not exported from `./errors`, it is: `src/server/appointments.ts` imports it from there.

- [ ] **Step 5: The routes**

Create `src/app/api/v1/portal/times/route.ts`:

```ts
import { json, publicRoute } from "@/server/api";
import { portalTimes, timesSchema } from "@/server/portal";

// Public and read from the database on every request.
export const dynamic = "force-dynamic";

export const GET = publicRoute(async (req) => json(await portalTimes(timesSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
```

Create `src/app/api/v1/portal/bookings/route.ts`:

```ts
import { clientIp, json, publicRoute, readJson } from "@/server/api";
import { bookOnline, onlineBookingSchema } from "@/server/portal";

export const POST = publicRoute(async (req) => json(await bookOnline(await readJson(req, onlineBookingSchema), clientIp(req)), 201));
```

Create `src/app/api/v1/online-requests/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { onlineRequests, onlineRequestsSchema } from "@/server/portal";

export const GET = staffRoute(async (req, staff) => json(await onlineRequests(staff, onlineRequestsSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
```

- [ ] **Step 6: "Online booking" in the history and the access log**

In `src/server/appointments.ts`, in `historyText`, before the final `return action;`, add:

```ts
  if (action === "appointment.requested_online") return "Booked online, waiting to be confirmed";
```

and in `appointmentDetail`, the history mapping's `by` becomes:

```ts
    history: history.map((h) => ({ at: h.at, by: h.by ?? (h.details.online === true ? "Online booking" : "Someone"), text: historyText(h.action, h.details) })),
```

In `src/lib/access-log.ts`, add `"appointment.requested_online": "Booked a visit online",` after `"appointment.created"`.

In `src/app/[branch]/settings/access-log-panel.tsx`, the actor cell becomes:

```tsx
                  <TableCell>{r.userName ?? (r.userId ? "A removed account" : r.details.online === true ? "Online booking" : "No one signed in")}</TableCell>
```

If the panel's row type lacks `details`, add `details: Record<string, unknown>;` to it (the API already returns it: `actionText` reads it).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/unit/portal.test.ts tests/db/portal.test.ts`
Expected: PASS. Then `npm test`, `npm run typecheck`, `npm run lint`: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: book online through /api/v1/portal, and list online requests for the front desk

A booking enters as Requested from the portal, with the free dentist who has the fewest visits that day and the lowest free chair, on the matching patient's record or a new one. It is refused when online booking is off, the time was taken, a connection made five bookings in the hour, or the patient already has two waiting; a bot that fills the hidden field is answered as if it booked, and nothing is saved.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The booking page and the Online requests list

**Files:**
- Create: `src/app/book/page.tsx`, `src/app/book/book-form.tsx`, `src/app/book/privacy/page.tsx`
- Create: `src/components/calendar/online-requests.tsx`
- Modify: `src/app/[branch]/calendar/calendar-screen.tsx`, `src/app/[branch]/calendar/page.tsx`

**Interfaces:**
- Consumes: `portalInfo`, `BOOKING_DAYS`, `practiceSettings`, `GET /api/v1/portal/times`, `POST /api/v1/portal/bookings`, `GET /api/v1/online-requests` (Tasks 1 and 3).
- Produces: `CalendarScreen` takes `canManage: boolean`.

- [ ] **Step 1: The booking page**

Create `src/app/book/page.tsx`:

```tsx
import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { manilaDate } from "@/lib/time";
import { portalInfo } from "@/server/portal";
import { BookForm } from "./book-form";

export const metadata: Metadata = { title: "Book a visit" };

/** Online booking spec 3: the public booking page, made for phones. */
export default async function BookPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  const info = await portalInfo();
  if (!info.open) {
    return <AuthCard title={info.practiceName} description="Online booking isn't available right now. Please call the clinic." />;
  }
  return (
    <AuthCard title={`Book a visit at ${info.practiceName}`} description="Pick a branch, a service, and a time. The clinic will call or text you to confirm.">
      <BookForm
        practiceName={info.practiceName}
        branches={info.branches.map((b) => ({ value: b.code, label: b.name }))}
        services={info.services.map((s) => ({ value: s.id, label: s.name }))}
        today={manilaDate(new Date())}
      />
    </AuthCard>
  );
}
```

Create `src/app/book/book-form.tsx`:

```tsx
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { BOOKING_DAYS } from "@/lib/portal";
import { addDays, formatDay, formatTime, manilaDate } from "@/lib/time";

type Option = { value: string; label: string };
type Done = { branch: string; service: string; start: string };

const EMPTY = { firstName: "", lastName: "", mobile: "", note: "", consent: false, website: "" };

/** Online booking spec 3: branch, service, day and time, then the patient's details, on one page. */
export function BookForm({ practiceName, branches, services, today }: { practiceName: string; branches: Option[]; services: Option[]; today: string }) {
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0].value : "");
  const [service, setService] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("");
  const [details, setDetails] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Done | null>(null);
  const days = Array.from({ length: BOOKING_DAYS + 1 }, (_, i) => addDays(today, i));
  const times = useQuery({
    queryKey: ["portal-times", branch, service, date],
    queryFn: () => api<{ times: string[] }>(`/portal/times?branch=${encodeURIComponent(branch)}&service=${service}&date=${date}`),
    enabled: branch !== "" && service !== "",
  });
  const book = useMutation({
    mutationFn: () => api<Done>("/portal/bookings", { method: "POST", body: { branch, service, start, ...details } }),
    onSuccess: (data) => setDone(data),
    onError: async (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) {
        // Someone may have just taken the time: show the day's times as they are now.
        setStart("");
        await times.refetch();
      }
    },
  });

  if (done) {
    const when = new Date(done.start);
    return (
      <section role="status" className="grid gap-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Your request is in.</h2>
        <p>{`${practiceName} will call or text you to confirm.`}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Branch</dt>
          <dd>{done.branch}</dd>
          <dt className="text-muted-foreground">Service</dt>
          <dd>{done.service}</dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>{`${formatDay(manilaDate(when))}, ${formatTime(when)}`}</dd>
        </dl>
      </section>
    );
  }

  const set = (field: "firstName" | "lastName" | "mobile" | "note" | "website") => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDetails({ ...details, [field]: event.target.value });
  const general = book.error && Object.keys(fieldErrors(book.error)).length === 0 ? errorMessage(book.error) : null;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        book.mutate();
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Branch
        <NativeSelect
          value={branch}
          onChange={(event) => {
            setBranch(event.target.value);
            setStart("");
          }}
        >
          <NativeSelectOption value="">Pick a branch</NativeSelectOption>
          {branches.map((b) => (
            <NativeSelectOption key={b.value} value={b.value}>
              {b.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Service
        <NativeSelect
          value={service}
          onChange={(event) => {
            setService(event.target.value);
            setStart("");
          }}
        >
          <NativeSelectOption value="">Pick a service</NativeSelectOption>
          {services.map((s) => (
            <NativeSelectOption key={s.value} value={s.value}>
              {s.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Day
        <NativeSelect
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setStart("");
          }}
        >
          {days.map((d) => (
            <NativeSelectOption key={d} value={d}>
              {formatDay(d)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Time</legend>
        {branch === "" || service === "" ? (
          <p className="text-sm text-muted-foreground">Pick a branch and a service to see the open times.</p>
        ) : times.isPending ? (
          <p className="text-sm text-muted-foreground">Finding open times...</p>
        ) : times.isError ? (
          <FormAlert message={errorMessage(times.error)} />
        ) : times.data.times.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open times this day. Try another day.</p>
        ) : (
          <div role="group" aria-label="Open times" className="flex flex-wrap gap-2">
            {times.data.times.map((t) => (
              <Button key={t} type="button" variant={start === t ? "default" : "outline"} aria-pressed={start === t} onClick={() => setStart(t)}>
                {formatTime(new Date(t))}
              </Button>
            ))}
          </div>
        )}
      </fieldset>
      <TextField label="First name" value={details.firstName} onChange={set("firstName")} maxLength={50} autoComplete="given-name" error={errors.firstName} />
      <TextField label="Last name" value={details.lastName} onChange={set("lastName")} maxLength={50} autoComplete="family-name" error={errors.lastName} />
      <TextField label="Mobile number" value={details.mobile} onChange={set("mobile")} inputMode="tel" autoComplete="tel" hint="For example 0917 123 4567" error={errors.mobile} />
      <label className="grid gap-1.5 text-sm font-medium">
        What would you like the dentist to know? (optional)
        <Textarea value={details.note} maxLength={500} onChange={set("note")} />
      </label>
      {/* A trap for bots (online booking spec 8): people never see it, so they never fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={details.website} onChange={set("website")} />
        </label>
      </div>
      <div className="grid gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-4 accent-primary" checked={details.consent} onChange={(event) => setDetails({ ...details, consent: event.target.checked })} />
          <span>
            I agree to the{" "}
            <a href="/book/privacy" target="_blank" rel="noopener" className="underline">
              privacy notice
            </a>
            .
          </span>
        </label>
        {errors.consent && <p className="text-sm text-destructive">{errors.consent}</p>}
      </div>
      {general && <FormAlert message={general} />}
      <Button type="submit" disabled={book.isPending || start === ""}>
        {book.isPending ? "Sending..." : "Request this time"}
      </Button>
    </form>
  );
}
```

Create `src/app/book/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { practiceSettings } from "@/server/practice";

export const metadata: Metadata = { title: "Privacy notice" };

/** Online booking spec 3: the owner's notice, shown only while online booking is on. */
export default async function PrivacyPage() {
  // Request time only: `next build` must never open the database.
  await connection();
  const settings = await practiceSettings();
  if (!settings.onlineBooking) notFound();
  return (
    <AuthCard title={`${settings.name} privacy notice`}>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{settings.privacyNotice}</div>
    </AuthCard>
  );
}
```

- [ ] **Step 2: The Online requests list on the calendar**

Create `src/components/calendar/online-requests.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type OnlineRequest = { id: string; start: string; createdAt: string; note: string; mobile: string | null; dentistName: string; patientName: string; services: string[] };

/** Online booking spec 4: the branch's online requests waiting for a call. Choosing one opens its visit panel. */
export function OnlineRequests({ branchCode, onOpen }: { branchCode: string; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  // Under "appointments", so every change to a visit refreshes it too.
  const list = useQuery({
    queryKey: ["appointments", "online", branchCode],
    queryFn: () => api<OnlineRequest[]>(`/online-requests?branch=${branchCode}`),
    refetchInterval: 30_000,
  });
  const count = list.data?.length ?? 0;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          void list.refetch();
        }}
      >
        {`Online requests (${count})`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Online requests</DialogTitle>
            <DialogDescription>Call or text each patient, then open the visit to confirm it, change it, or cancel it.</DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading online requests...</p>
          ) : list.isError ? (
            <FormAlert message={errorMessage(list.error)} />
          ) : count === 0 ? (
            <p className="text-sm text-muted-foreground">No online requests are waiting.</p>
          ) : (
            <ul className="grid gap-2">
              {list.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="grid min-h-11 w-full gap-1 rounded-md border p-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setOpen(false);
                      onOpen(r.id);
                    }}
                  >
                    <span className="font-medium">{`${formatDateTime(new Date(r.start))}, ${r.patientName}`}</span>
                    <span>{`${r.mobile ?? "No mobile number"}. ${r.services.join(", ")}, with ${r.dentistName}.`}</span>
                    {r.note && <span className="text-muted-foreground">{r.note}</span>}
                    <span className="text-xs text-muted-foreground">{`Came in ${formatDateTime(new Date(r.createdAt))}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
```

In `src/app/[branch]/calendar/calendar-screen.tsx`:
1. `import { OnlineRequests } from "@/components/calendar/online-requests";`
2. Add `canManage: boolean;` to `CalendarProps`, and `canManage` to the destructured props.
3. Right after the `{canBook && ( ... )}` group of New booking and Walk-in buttons, add `{canManage && <OnlineRequests branchCode={branch.code} onOpen={setOpenId} />}`.

In `src/app/[branch]/calendar/page.tsx`, add the prop `canManage={can(staff, "appointment.manage", { branchId: branch.id })}` to `<CalendarScreen ... />`.

- [ ] **Step 3: Check it in a browser**

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`: all pass. With the development data (the seed switches online booking on), start `npm run dev` and check, at a phone width of 390 pixels: `/book` shows Branch, Service, Day, Time, the details, and the privacy box; picking a branch and service lists open times; booking shows "Your request is in."; `/book/privacy` shows the sample notice. Signed in as a seeded manager, the branch calendar shows "Online requests (1)"; choosing the request opens its visit, which says "Requested · Online" and "Booked online, waiting to be confirmed" by "Online booking" in its history; Confirm works. Switch online booking off in Settings: `/book` says it isn't available and `/book/privacy` is not found. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: the /book page for patients, and Online requests on the branch calendar

Patients pick a branch, a service, a day, and an open time, give their name and mobile number, and agree to the privacy notice at /book/privacy. The front desk sees the branch's waiting online requests from the calendar and opens each one to confirm it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The end-to-end run, the README, and the final checks

**Files:**
- Modify: `tests/e2e/visit.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add online booking to the end-to-end run**

In `tests/e2e/visit.spec.ts`, at the end of the test (after the dentist completes the visit), add:

```ts
  // Online booking: the owner turns it on and gives the dentist a week at the branch; a patient books tomorrow's first
  // open time at /book; the front desk confirms it from Online requests.
  const send = (method: "PATCH" | "PUT", path: string, data: object) => page.request.fetch(`/api/v1${path}`, { method, data, headers: { origin } });
  expect((await send("PATCH", "/practice", { onlineBooking: true, privacyNotice: "E2E privacy notice." })).ok()).toBe(true);
  const dana = ((await (await page.request.get("/api/v1/dentists")).json()) as { id: string; name: string }[]).find((d) => d.name === "Dr. Dana Dentist");
  const downtown = ((await (await page.request.get("/api/v1/branches")).json()) as { id: string; code: string }[]).find((b) => b.code === "downtown");
  const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ branchId: downtown?.id, dayOfWeek, startTime: "09:00", endTime: "17:00" }));
  expect((await send("PUT", `/dentists/${dana?.id}/schedule`, { blocks: week })).ok()).toBe(true);

  const tomorrow = new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  const patient = await (await browser.newContext({ baseURL: origin })).newPage();
  await patient.goto("/book");
  await patient.getByLabel("Branch").selectOption({ label: "Downtown" });
  await patient.getByLabel("Service").selectOption({ label: "Consultation" });
  await patient.getByLabel("Day").selectOption(tomorrow);
  await patient.getByRole("group", { name: "Open times" }).getByRole("button").first().click();
  await patient.getByLabel("First name").fill("Ben");
  await patient.getByLabel("Last name").fill("Cruz");
  await patient.getByLabel("Mobile number").fill("0917 555 0101");
  await patient.getByRole("checkbox", { name: /privacy notice/ }).check();
  await patient.getByRole("button", { name: "Request this time" }).click();
  await expect(patient.getByText("Your request is in.")).toBeVisible();

  await page.goto("/downtown/calendar");
  await page.getByRole("button", { name: "Online requests (1)" }).click();
  await page.getByRole("dialog", { name: "Online requests" }).getByRole("button", { name: /Cruz, Ben/ }).click();
  const online = page.getByRole("dialog", { name: "Cruz, Ben" });
  await online.getByRole("button", { name: "Confirm" }).click();
  await expect(online.getByText("Confirmed", { exact: true })).toBeVisible();
```

If the schedule `PUT` answers with a question about existing visits, read `replaceWeek` in `src/server/schedules.ts` and send what it asks for; the visit booked earlier in this run is completed and should not count.

Run: `npm run test:e2e` (use `PLAYWRIGHT_CHANNEL=chrome` if Playwright's own Chromium is not installed; stop `npm run dev` first; run before 23:00 Manila time).
Expected: 1 passed.

- [ ] **Step 2: The README**

In `README.md`:

1. In "Run it", step 4, after "The database migrates itself.", add: "The development data turns online booking on: try it at http://localhost:3700/book."
2. In "Going live", step 3 ("First run"), replace the sentence beginning "In Settings, add the real branches" with: "In Settings, set the standard visit length and chair cleaning time (Practice), add the real branches, hours, and chairs, and the services, each offered online or not and limited to certain dentists if needed (for example Braces and Retainers to the orthodontist); then each dentist's weekly schedule; and print each branch's QR poster for its staff room. To take online bookings, paste the privacy notice (reviewed by a lawyer; it should say the booking page keeps the visitor's internet address for an hour to limit repeat bookings) and switch online booking on. Patients book at `APP_URL/book`; their requests come in as Requested, marked Online, and the front desk confirms them from Online requests on the branch calendar."
3. In "Going live", step 1, after the paragraph about applying migrations, add: "A release that adds files under `drizzle/` needs them applied first; this one also drops the old procedure length columns, so merge right after migrating (the Services pages error for that minute)."

- [ ] **Step 3: Everything at once**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:e2e`.
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: book online and confirm it in the end-to-end run; document online booking for going live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
