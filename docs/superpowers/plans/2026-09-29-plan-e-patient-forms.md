# Patient QR and Patient Forms Implementation Plan (Plan E)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each branch prints a patient QR poster whose QR opens a welcome page (Book a visit, Fill in my patient form); the short patient form waits in a Patient forms list until the front desk makes a chart from it, adds it to an existing record, or discards it.

**Architecture:** Forms live in their own `patient_forms` table, never as charts. The public side is one API route (`POST /api/v1/portal/forms`) behind a practice switch, a per-connection limit, and a bot trap, like online booking. The staff side reuses the existing duplicate rule and Add patient dialog: a chart made from a form deletes the form in the same transaction.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query 5, Zod 4, Drizzle ORM 0.45 with drizzle-kit 0.31, PGlite for tests, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-dentasync-patient-forms-design.md` (read it; this plan implements it).

## Global Constraints

- Work only in `D:\dentasync`, on branch `patient-forms`. Never touch any other folder.
- No em dashes or en dashes anywhere: code, copy, comments, docs, commit messages.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests run on PGlite only. Never set `DATABASE_URL`, never run `npm run db:migrate`, never connect to any remote database.
- This is Next.js 16: `params` and `searchParams` of pages are Promises. When unsure of an API, read `node_modules/next/dist/docs/` first (AGENTS.md).
- A page that reads the database calls `await connection()` first (`next build` must never open the database), as `src/app/book/page.tsx` does.
- Every table has row level security (`.enableRLS()`).
- The access log never holds anything a patient typed on the form (no names, birthday, sex, mobile, address), and never the raw internet address: only the keyed hash from `clientKey`.
- Forms are seen and handled only by the owner and the managers of the form's branch (`patient.edit`, and `covers(actor, branchId)`).
- Exact words (copy them verbatim):
  - API: "Patient forms aren't available right now." (404, code `closed`); "That branch doesn't take patient forms." (404, code `branch`); "Too many forms from this connection. Please ask at the front desk." (429, code `too_many_requests`); "That form was already handled." (404, code `handled`); "Add the privacy notice first." (422, as now).
  - Field errors: "Enter your first name", "Enter your last name", "Enter your birthday", "Use a real birthday", "Pick female or male", "Enter your address", "Use at most 50 characters", "Use at most 200 characters", "Agree to the privacy notice to send the form."; the mobile error stays "Use a Philippine mobile number like 0917 123 4567".
  - Welcome page: buttons "Book a visit" and "Fill in my patient form"; with both off, "Please ask at the front desk."; tab title "Welcome to {practice}".
  - Form page: tab title "Patient form at {practice}"; while off, "Patient forms aren't available right now. Please ask at the front desk."; submit "Send the form"; done "Thanks, {first name}." then "Tell the front desk you filled in the form."
  - Poster: "Patients" and "Scan to book a visit or fill in your patient form."
  - Settings: "Take patient forms", "Print staff poster", "Print patient poster", "Each branch has its own hours, chairs, and QR posters."
  - Patients page: "Patient forms", "Patient forms (N)", "New chart", "Existing patient", "Discard", "Discard this form?", "Its details are deleted."
  - Access log: "Sent a patient form" (who: "Patient form"), "Added a patient form to the record", "Discarded a patient form".
- Limits: 5 forms an hour per connection; waiting forms are deleted after 30 days; names 1 to 50 characters, address 1 to 200, birthday from 1900-01-01 to today in Manila.
- Checks before a task is done: `npm test`, `npm run typecheck`, `npm run lint` (and `npm run build` from Task 3 on; `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` in Task 4).

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema.ts` (modify) | `patient_forms` table; `practice.patient_forms` column |
| `drizzle/0005_patient_forms.sql` + `drizzle/meta/*` (generated) | The migration: additions only |
| `src/server/practice.ts` (modify) | The Take patient forms switch and its notice rule |
| `src/lib/queries.ts` (modify) | The client's `PracticeSettings` type |
| `src/server/patient-forms.ts` (create) | Everything about forms: the public schema and send, expiry, the list, attach, discard, and the welcome page's facts |
| `src/server/patients.ts` (modify) | `duplicates` exported; `takeForm` (a form used up inside a transaction); `createPatient` takes `formId` |
| `src/app/api/v1/portal/forms/route.ts` (create) | Public POST |
| `src/app/api/v1/patient-forms/route.ts`, `[id]/route.ts`, `[id]/attach/route.ts` (create) | Staff GET, DELETE, POST attach |
| `src/lib/access-log.ts` (modify), `src/app/[branch]/settings/access-log-panel.tsx` (modify) | Words for the new actions; who did it (`actorText`) |
| `src/app/welcome/[code]/page.tsx`, `src/app/welcome/[code]/form/page.tsx`, `src/app/welcome/[code]/form/patient-form.tsx` (create) | The public welcome page and form |
| `src/app/book/page.tsx`, `book-form.tsx`, `privacy/page.tsx` (modify) | `?branch=`; the notice shows while either switch is on |
| `src/lib/validation.ts` (modify) | `welcome` is a reserved branch code |
| `src/app/poster/[code]/patients/page.tsx` (create) | The patient poster |
| `src/app/[branch]/settings/branches-panel.tsx`, `practice-panel.tsx` (modify) | Poster links; the switch |
| `src/components/patient-forms.tsx` (create), `src/components/add-patient-dialog.tsx` (modify), `src/app/[branch]/patients/patients-screen.tsx` (modify) | The front desk's Patient forms button and dialogs |
| `tests/db/patient-forms.test.ts` (create), `tests/db/settings.test.ts`, `tests/unit/access-log.test.ts`, `tests/e2e/visit.spec.ts` (modify) | Tests |
| `README.md` (modify) | Going live |

---

### Task 1: Forms data, the switch, and the public API

**Files:**
- Modify: `src/db/schema.ts` (the `practice` table; add `patientForms` after the `patients` table)
- Generate: `drizzle/0005_patient_forms.sql`, `drizzle/meta/0005_snapshot.json`, `drizzle/meta/_journal.json`
- Modify: `src/server/practice.ts`, `src/lib/queries.ts:21`
- Create: `src/server/patient-forms.ts`, `src/app/api/v1/portal/forms/route.ts`
- Create: `tests/db/patient-forms.test.ts`; Modify: `tests/db/settings.test.ts`

**Interfaces:**
- Produces: table `patientForms` (columns `id, branchId, lastName, firstName, middleName, birthday, sex, mobile, address, createdAt`); `practice.patientForms`; `PracticeSettings.patientForms: boolean` (server and client types); from `src/server/patient-forms.ts`: `patientFormSchema`, `sendPatientForm(input, client): Promise<{ firstName: string }>`, `expireForms(tx?: Db): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/patient-forms.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as formsRoute from "@/app/api/v1/portal/forms/route";
import { db } from "@/db";
import { auditLog, branches, patientForms, practice } from "@/db/schema";
import { clientKey } from "@/server/api";
import { call, makeBranch, request } from "../helpers";

async function build() {
  await db.insert(practice).values({ name: "Smile Dental", patientForms: true, privacyNotice: "We keep your details to run your visits." });
  const dt = await makeBranch({ code: "downtown", name: "Downtown" });
  const shut = await makeBranch({ code: "shut", name: "Shut" });
  await db.update(branches).set({ active: false }).where(eq(branches.id, shut.id));
  return { dt };
}
let worldPromise: ReturnType<typeof build> | undefined;
const world = () => (worldPromise ??= build());

const ip = (n: number) => ({ "x-nf-client-connection-ip": `198.51.100.${n}` });
const send = (body: Record<string, unknown>, from: number) =>
  call(formsRoute.POST, request("/api/v1/portal/forms", { method: "POST", body, headers: ip(from) }));
/** What the access log holds for the address `ip(n)` sends: a keyed hash of it (src/server/api.ts). */
const clientOf = (n: number) => clientKey(request("/api/v1/portal/forms", { headers: ip(n) }));
const form = (changes: Record<string, unknown> = {}) => ({
  branch: "downtown",
  firstName: "Ana",
  middleName: "",
  lastName: "Santos",
  birthday: "1990-04-02",
  sex: "female",
  mobile: "0917 123 4567",
  address: "1 Rizal Ave, Manila",
  consent: true,
  ...changes,
});
const formCount = async () => (await db.select().from(patientForms)).length;
const receivedCount = async () => (await db.select().from(auditLog).where(eq(auditLog.action, "patient.form_received"))).length;

describe("sending a patient form", () => {
  it("saves the form for the front desk, and logs that it came without anything the patient typed", async () => {
    const w = await world();
    const res = await send(form({ firstName: "  Ana ", middleName: "Cruz" }), 1);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ firstName: "Ana" });
    const [saved] = await db.select().from(patientForms).where(eq(patientForms.lastName, "Santos"));
    expect(saved).toMatchObject({ branchId: w.dt.id, firstName: "Ana", middleName: "Cruz", birthday: "1990-04-02", sex: "female", mobile: "+639171234567", address: "1 Rizal Ave, Manila" });
    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, saved.id));
    expect(row).toMatchObject({ userId: null, action: "patient.form_received", entity: "patient_form", branchId: w.dt.id });
    expect(row.details).toEqual({ client: clientOf(1), privacyNoticeAccepted: true });
    for (const typed of ["Santos", "9171234567", "Rizal", "1990-04-02", "198.51.100.1"]) expect(JSON.stringify(row.details)).not.toContain(typed);
  });

  it("checks each field and the privacy box, and saves nothing", async () => {
    await world();
    const before = await formCount();
    const res = await send(form({ firstName: " ", lastName: "", birthday: "", sex: "", mobile: "12345", address: "", consent: false }), 2);
    expect(res.status).toBe(400);
    expect((await res.json()).error.fields).toEqual({
      firstName: "Enter your first name",
      lastName: "Enter your last name",
      birthday: "Enter your birthday",
      sex: "Pick female or male",
      mobile: "Use a Philippine mobile number like 0917 123 4567",
      address: "Enter your address",
      consent: "Agree to the privacy notice to send the form.",
    });
    const future = await send(form({ lastName: "Future", birthday: "2999-01-01" }), 2);
    expect((await future.json()).error.fields).toEqual({ birthday: "Use a real birthday" });
    expect(await formCount()).toBe(before);
  });

  it("answers 404 while forms are off, and for an unknown or closed branch, saving nothing", async () => {
    await world();
    const before = await formCount();
    await db.update(practice).set({ patientForms: false });
    const off = await send(form({ lastName: "Off" }), 3);
    expect(off.status).toBe(404);
    expect((await off.json()).error.message).toBe("Patient forms aren't available right now.");
    await db.update(practice).set({ patientForms: true });
    for (const branch of ["nowhere", "shut"]) {
      const res = await send(form({ branch, lastName: "Nowhere" }), 3);
      expect(res.status).toBe(404);
      expect((await res.json()).error.message).toBe("That branch doesn't take patient forms.");
    }
    expect(await formCount()).toBe(before);
  });

  it("gives a bot the usual answer and keeps nothing", async () => {
    await world();
    const before = [await formCount(), await receivedCount()];
    const res = await send(form({ lastName: "Bot", website: "http://spam.example" }), 4);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ firstName: "Ana" });
    expect([await formCount(), await receivedCount()]).toEqual(before);
  });

  it("takes five forms an hour from one connection, and still takes forms from another", async () => {
    await world();
    for (let i = 0; i < 5; i++) expect((await send(form({ lastName: `Limit${i}` }), 5)).status).toBe(201);
    const sixth = await send(form({ lastName: "Limit5" }), 5);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.message).toBe("Too many forms from this connection. Please ask at the front desk.");
    expect((await send(form({ lastName: "Other" }), 6)).status).toBe(201);
  });

  it("deletes forms waiting more than 30 days when a new one arrives", async () => {
    const w = await world();
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    const base = { branchId: w.dt.id, firstName: "Old", birthday: "1970-01-01", sex: "male", mobile: "+639170000000", address: "Old St" };
    await db.insert(patientForms).values([
      { ...base, lastName: "Stale", createdAt: daysAgo(31) },
      { ...base, lastName: "Recent", createdAt: daysAgo(29) },
    ]);
    expect((await send(form({ lastName: "Fresh" }), 7)).status).toBe(201);
    const left = (await db.select().from(patientForms)).map((f) => f.lastName);
    expect(left).toContain("Recent");
    expect(left).not.toContain("Stale");
  });
});
```

In `tests/db/settings.test.ts`, add this as the last test inside `describe("practice", ...)`:

```ts
  it("keeps patient forms off until there is a privacy notice", async () => {
    const { cookie } = await ownerCookie();
    const patch = (body: object) => call(practiceRoute.PATCH, request("/api/v1/practice", { method: "PATCH", cookie, body }));
    expect((await patch({ onlineBooking: false, privacyNotice: "" })).status).toBe(200);
    const refused = await patch({ patientForms: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error.fields.privacyNotice).toBe("Add the privacy notice first.");
    expect((await patch({ patientForms: true, privacyNotice: "We keep your details to run your visits." })).status).toBe(200);
    const read = await (await call(practiceRoute.GET, request("/api/v1/practice", { cookie }))).json();
    expect(read).toMatchObject({ onlineBooking: false, patientForms: true });
    expect((await patch({ privacyNotice: "" })).status).toBe(422);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/db/patient-forms.test.ts tests/db/settings.test.ts`
Expected: FAIL: `patient-forms.test.ts` cannot resolve `@/app/api/v1/portal/forms/route` (or `patientForms` is not exported), and the settings test fails (the practice has no `patientForms`).

- [ ] **Step 3: Add the table and the column**

In `src/db/schema.ts`, in the `practice` table, add the column after `onlineBooking`:

```ts
    onlineBooking: boolean("online_booking").notNull().default(false),
    patientForms: boolean("patient_forms").notNull().default(false),
```

After the `patients` table (after its closing `).enableRLS();`), add:

```ts
/** A patient's own form, sent from the branch's patient poster (patient forms spec, section 6). It waits for the front desk. */
export const patientForms = pgTable(
  "patient_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    birthday: date("birthday").notNull(),
    sex: text("sex").notNull(),
    mobile: text("mobile").notNull(),
    address: text("address").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("patient_forms_last_name", sql`char_length(${t.lastName}) between 1 and 50`),
    check("patient_forms_first_name", sql`char_length(${t.firstName}) between 1 and 50`),
    check("patient_forms_middle_name", sql`char_length(${t.middleName}) between 1 and 50`),
    check("patient_forms_birthday", sql`${t.birthday} >= '1900-01-01'`),
    check("patient_forms_sex", sql`${t.sex} in ('female', 'male')`),
    check("patient_forms_mobile", sql`${t.mobile} ~ '^\\+639[0-9]{9}$'`),
    check("patient_forms_address", sql`char_length(${t.address}) between 1 and 200`),
    index("patient_forms_branch_created").on(t.branchId, t.createdAt),
  ],
).enableRLS();
```

- [ ] **Step 4: Generate the migration and read it**

Run: `npm run db:generate -- --name patient_forms`
Expected: it writes `drizzle/0005_patient_forms.sql`, `drizzle/meta/0005_snapshot.json`, and a new `_journal.json` entry, without asking any question. Open the SQL: it must contain only `CREATE TABLE "patient_forms"`, `ENABLE ROW LEVEL SECURITY`, `ALTER TABLE "practice" ADD COLUMN "patient_forms" boolean DEFAULT false NOT NULL`, the foreign key, the index, and the seven checks. No `DROP`, no `RENAME`. If drizzle-kit asks anything, stop and report it.

- [ ] **Step 5: The practice switch**

In `src/server/practice.ts`:

1. In `practiceSchema`'s object, after `onlineBooking: z.boolean(),` add `patientForms: z.boolean(),`.
2. The type and defaults become:

```ts
export type PracticeSettings = {
  name: string;
  visitMinutes: number;
  cleaningMinutes: number;
  onlineBooking: boolean;
  patientForms: boolean;
  privacyNotice: string;
};

/** Before /setup there is no practice row; these match the database's defaults. */
const DEFAULTS: PracticeSettings = { name: "DentaSync", visitMinutes: 60, cleaningMinutes: 10, onlineBooking: false, patientForms: false, privacyNotice: "" };
```

3. In `practiceSettings`, read and return the new column:

```ts
  const { name, visitMinutes, cleaningMinutes, onlineBooking, patientForms, privacyNotice } = row;
  return { name, visitMinutes, cleaningMinutes, onlineBooking, patientForms, privacyNotice };
```

4. In `updatePractice`, the doc comment and the rule become:

```ts
/**
 * Online booking spec 10 and patient forms spec 6: only the owner changes these, and neither online booking nor patient forms
 * can go on without a privacy notice.
 */
```

```ts
    if ((next.onlineBooking || next.patientForms) && next.privacyNotice === "") {
```

In `src/lib/queries.ts`, line 21 becomes:

```ts
export type PracticeSettings = { name: string; visitMinutes: number; cleaningMinutes: number; onlineBooking: boolean; patientForms: boolean; privacyNotice: string };
```

- [ ] **Step 6: Sending a form**

Create `src/server/patient-forms.ts`:

```ts
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { auditLog, branches, patientForms } from "@/db/schema";
import { manilaDate } from "@/lib/time";
import { mobileSchema } from "@/lib/validation";
import { audit } from "./audit";
import { ApiError } from "./errors";
import { practiceSettings } from "./practice";

/** Patient forms spec 7. */
const FORMS_PER_CLIENT_PER_HOUR = 5;

const closed = () => new ApiError(404, "closed", "Patient forms aren't available right now.");
const noBranch = () => new ApiError(404, "branch", "That branch doesn't take patient forms.");
const tooMany = () => new ApiError(429, "too_many_requests", "Too many forms from this connection. Please ask at the front desk.");

const nameField = (what: string) => z.string().trim().min(1, `Enter your ${what}`).max(50, "Use at most 50 characters");

/** Patient forms spec 4: the basics, all required but the middle name, and the privacy notice agreed to. */
export const patientFormSchema = z.object({
  branch: z.string().min(1),
  firstName: nameField("first name"),
  middleName: z.string().trim().max(50, "Use at most 50 characters").optional().default(""),
  lastName: nameField("last name"),
  birthday: z.iso.date("Enter your birthday").refine((d) => d >= "1900-01-01" && d <= manilaDate(new Date()), "Use a real birthday"),
  sex: z.enum(["female", "male"], "Pick female or male"),
  mobile: mobileSchema,
  address: z.string().trim().min(1, "Enter your address").max(200, "Use at most 200 characters"),
  consent: z.literal(true, "Agree to the privacy notice to send the form."),
  website: z.string().max(200).optional().default(""),
});

/** Patient forms spec 6: a form still waiting after 30 days is deleted whenever forms are listed or one arrives (no scheduled job). */
export async function expireForms(tx: Db = db): Promise<void> {
  await tx.delete(patientForms).where(lt(patientForms.createdAt, sql`now() - interval '30 days'`));
}

/** This connection's forms in the last hour, counted from the access log (spec 7). */
async function formsFrom(client: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.action, "patient.form_received"), sql`${auditLog.details}->>'client' = ${client}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
  return row.n;
}

/** POST /portal/forms (patient forms spec 4 and 7): the form waits for the front desk. The answer holds only the first name typed. */
export async function sendPatientForm(input: z.infer<typeof patientFormSchema>, client: string): Promise<{ firstName: string }> {
  const settings = await practiceSettings();
  if (!settings.patientForms) throw closed();
  const [branch] = await db.select({ id: branches.id, active: branches.active }).from(branches).where(eq(branches.code, input.branch));
  if (!branch?.active) throw noBranch();
  // The bot trap: the same answer as a real form, and nothing saved or logged.
  if (input.website !== "") return { firstName: input.firstName };
  // ponytail: no lock, so two forms sent at once can both pass the count and let a sixth through, which does no harm.
  if ((await formsFrom(client)) >= FORMS_PER_CLIENT_PER_HOUR) throw tooMany();
  await expireForms();
  await db.transaction(async (tx) => {
    const [form] = await tx
      .insert(patientForms)
      .values({
        branchId: branch.id,
        lastName: input.lastName,
        firstName: input.firstName,
        middleName: input.middleName || null,
        birthday: input.birthday,
        sex: input.sex,
        mobile: input.mobile,
        address: input.address,
      })
      .returning({ id: patientForms.id });
    // The client is a keyed hash of the address, never the address (src/server/api.ts), and nothing the patient typed is logged.
    await audit(
      { userId: null, action: "patient.form_received", entity: "patient_form", entityId: form.id, branchId: branch.id, details: { client, privacyNoticeAccepted: true } },
      tx,
    );
  });
  return { firstName: input.firstName };
}
```

Create `src/app/api/v1/portal/forms/route.ts`:

```ts
import { clientKey, json, publicRoute, readJson } from "@/server/api";
import { patientFormSchema, sendPatientForm } from "@/server/patient-forms";

export const POST = publicRoute(async (req) => json(await sendPatientForm(await readJson(req, patientFormSchema), clientKey(req)), 201));
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/db/patient-forms.test.ts tests/db/settings.test.ts`
Expected: PASS, every test. Then run `npm test`, `npm run typecheck`, and `npm run lint`: all pass (the other test files must not change behavior; `practice` rows they insert get `patient_forms = false`).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle src/server/practice.ts src/lib/queries.ts src/server/patient-forms.ts src/app/api/v1/portal/forms tests/db/patient-forms.test.ts tests/db/settings.test.ts
git commit -m "feat: take patient forms from the public page, behind a switch, a per-connection limit, and the bot trap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The front desk's API

**Files:**
- Modify: `src/server/patients.ts` (imports, `duplicates`, `createPatientSchema`, `takeForm`, `createPatient`)
- Modify: `src/server/patient-forms.ts` (list, attach, discard)
- Create: `src/app/api/v1/patient-forms/route.ts`, `src/app/api/v1/patient-forms/[id]/route.ts`, `src/app/api/v1/patient-forms/[id]/attach/route.ts`
- Modify: `src/lib/access-log.ts`, `src/app/[branch]/settings/access-log-panel.tsx:93`
- Test: `tests/db/patient-forms.test.ts`, `tests/unit/access-log.test.ts`

**Interfaces:**
- Consumes: `patientForms`, `expireForms`, `sendPatientForm` route (Task 1).
- Produces: `GET /api/v1/patient-forms?branch={code}` answering `PatientFormView[]` (`{ id, createdAt, lastName, firstName, middleName, birthday, sex, mobile, address, matches: PatientSummary[] }`, newest first); `POST /api/v1/patients` accepting `formId`; `POST /api/v1/patient-forms/{id}/attach` with `{ patientId }` answering `{ ok: true }`; `DELETE /api/v1/patient-forms/{id}` answering `{ ok: true }`; `actorText(row)` in `src/lib/access-log.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db/patient-forms.test.ts` (add the new imports to the file's import block: `and` from `drizzle-orm`; the route modules; `patients` from `@/db/schema`; `normalizeMobile` from `@/lib/validation`; `makeUser`, `signIn` from `../helpers`):

```ts
import * as attachRoute from "@/app/api/v1/patient-forms/[id]/attach/route";
import * as formRoute from "@/app/api/v1/patient-forms/[id]/route";
import * as formsListRoute from "@/app/api/v1/patient-forms/route";
import * as patientsRoute from "@/app/api/v1/patients/route";
```

```ts
async function frontDesk() {
  const w = await world();
  const up = await makeBranch({ code: "uptown", name: "Uptown" });
  const owner = await makeUser({ role: "owner" });
  const manager = await makeUser({ role: "manager", branchIds: [w.dt.id] });
  const other = await makeUser({ role: "manager", branchIds: [up.id] });
  const dentist = await makeUser({ role: "dentist", branchIds: [w.dt.id] });
  return {
    ...w,
    owner: await signIn(owner.username),
    manager: await signIn(manager.username),
    other: await signIn(other.username),
    dentist: await signIn(dentist.username),
  };
}
let deskPromise: ReturnType<typeof frontDesk> | undefined;
const desk = () => (deskPromise ??= frontDesk());

const list = (cookie: string, branch = "downtown") => call(formsListRoute.GET, request(`/api/v1/patient-forms?branch=${branch}`, { cookie }));
const addPatient = (cookie: string, body: Record<string, unknown>) => call(patientsRoute.POST, request("/api/v1/patients", { method: "POST", cookie, body }));
const attach = (cookie: string, id: string, patientId: string) =>
  call(attachRoute.POST, request(`/api/v1/patient-forms/${id}/attach`, { method: "POST", cookie, body: { patientId } }), { id });
const discard = (cookie: string, id: string) => call(formRoute.DELETE, request(`/api/v1/patient-forms/${id}`, { method: "DELETE", cookie }), { id });
const stillThere = async (id: string) => (await db.select().from(patientForms).where(eq(patientForms.id, id))).length === 1;

/** Sends a form (each from its own connection, so the hourly limit never interferes) and answers its row, found by its mobile number. */
let connection = 100;
async function sent(changes: { lastName: string; firstName: string; mobile: string; birthday?: string }) {
  expect((await send(form(changes), connection++)).status).toBe(201);
  const [row] = await db.select().from(patientForms).where(eq(patientForms.mobile, normalizeMobile(changes.mobile) as string));
  return row;
}

describe("the front desk", () => {
  it("lists the branch's waiting forms, the newest first, each with the patients it may be", async () => {
    const s = await desk();
    const [known] = await db.insert(patients).values({ lastName: "Villar", firstName: "Rosa", birthday: "1975-03-09" }).returning();
    const rosa = await sent({ lastName: "Villar", firstName: "Rosa", birthday: "1975-03-09", mobile: "0917 000 1001" });
    const ben = await sent({ lastName: "Diaz", firstName: "Ben", mobile: "0917 000 1002" });
    const res = await list(s.manager);
    expect(res.status).toBe(200);
    const forms = (await res.json()) as { id: string; matches: { id: string }[] }[];
    const ids = forms.map((f) => f.id);
    expect(ids.indexOf(ben.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(ben.id)).toBeLessThan(ids.indexOf(rosa.id));
    expect(forms.find((f) => f.id === rosa.id)?.matches.map((m) => m.id)).toEqual([known.id]);
    expect(forms.find((f) => f.id === ben.id)?.matches).toEqual([]);
    expect(((await (await list(s.owner)).json()) as { id: string }[]).map((f) => f.id)).toEqual(ids);
  });

  it("shows a branch's forms only to the owner and that branch's managers", async () => {
    const s = await desk();
    expect((await list(s.dentist)).status).toBe(403);
    expect((await list(s.other)).status).toBe(403);
    const uptown = await list(s.other, "uptown");
    expect(uptown.status).toBe(200);
    expect(await uptown.json()).toEqual([]);
  });

  it("makes a chart from a form and removes the form in one go", async () => {
    const s = await desk();
    const f = await sent({ lastName: "Garcia", firstName: "Lea", birthday: "2001-11-30", mobile: "0917 000 1003" });
    const body = { lastName: "Garcia", firstName: "Lea", birthday: "2001-11-30", sex: "female", mobile: "+639170001003", address: "1 Rizal Ave, Manila", homeBranch: "downtown", formId: f.id };
    const res = await addPatient(s.manager, body);
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const [chart] = await db.select().from(patients).where(eq(patients.id, id));
    expect(chart).toMatchObject({ lastName: "Garcia", firstName: "Lea", birthday: "2001-11-30", sex: "female", mobile: "+639170001003", homeBranchId: s.dt.id });
    expect(await stillThere(f.id)).toBe(false);
    const [created] = await db.select().from(auditLog).where(and(eq(auditLog.action, "patient.created"), eq(auditLog.entityId, id)));
    expect(created.details).toEqual({ form: f.id });
    // The form is gone: a second chart from it is refused, and nothing is made.
    const before = (await db.select().from(patients)).length;
    const again = await addPatient(s.manager, { ...body, firstName: "Leah", allowDuplicate: true });
    expect(again.status).toBe(404);
    expect((await again.json()).error.message).toBe("That form was already handled.");
    expect((await db.select().from(patients)).length).toBe(before);
  });

  it("keeps the duplicate warning for a chart made from a form, and the form with it", async () => {
    const s = await desk();
    const f = await sent({ lastName: "Villar", firstName: "Rosa", birthday: "1975-03-09", mobile: "0917 000 1004" });
    const res = await addPatient(s.manager, { lastName: "Villar", firstName: "Rosa", birthday: "1975-03-09", formId: f.id });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("possible_duplicate");
    expect(await stillThere(f.id)).toBe(true);
  });

  it("refuses a form from another branch's poster, and to dentists, and keeps it", async () => {
    const s = await desk();
    const f = await sent({ lastName: "Ramos", firstName: "Jo", mobile: "0917 000 1005" });
    const before = (await db.select().from(patients)).length;
    expect((await addPatient(s.other, { lastName: "Ramos", firstName: "Jo", formId: f.id })).status).toBe(403);
    expect((await db.select().from(patients)).length).toBe(before);
    expect((await discard(s.other, f.id)).status).toBe(403);
    expect((await discard(s.dentist, f.id)).status).toBe(403);
    expect(await stillThere(f.id)).toBe(true);
  });

  it("adds a form to an existing patient's record", async () => {
    const s = await desk();
    const [known] = await db.insert(patients).values({ lastName: "Lopez", firstName: "Mia" }).returning();
    const f = await sent({ lastName: "Lopez", firstName: "Mia", mobile: "0917 000 1006" });
    const res = await attach(s.manager, f.id, known.id);
    expect(res.status).toBe(200);
    expect(await stillThere(f.id)).toBe(false);
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, "patient.form_attached"));
    expect(row).toMatchObject({ entity: "patient", entityId: known.id, branchId: s.dt.id, details: { form: f.id } });
    expect((await attach(s.manager, f.id, known.id)).status).toBe(404);
  });

  it("refuses to add a form to a patient who is not there, and keeps the form", async () => {
    const s = await desk();
    const f = await sent({ lastName: "Tan", firstName: "Kim", mobile: "0917 000 1007" });
    expect((await attach(s.manager, f.id, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await stillThere(f.id)).toBe(true);
  });

  it("discards a form", async () => {
    const s = await desk();
    const f = await sent({ lastName: "Spam", firstName: "Bot", mobile: "0917 000 1008" });
    expect((await discard(s.owner, f.id)).status).toBe(200);
    expect(await stillThere(f.id)).toBe(false);
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.action, "patient.form_discarded"), eq(auditLog.entityId, f.id)));
    expect(row).toMatchObject({ entity: "patient_form", branchId: s.dt.id });
    expect((await discard(s.owner, f.id)).status).toBe(404);
  });

  it("deletes forms waiting more than 30 days when the list is read", async () => {
    const s = await desk();
    await db.insert(patientForms).values({
      branchId: s.dt.id,
      lastName: "Expired",
      firstName: "Old",
      birthday: "1970-01-01",
      sex: "male",
      mobile: "+639170000009",
      address: "Old St",
      createdAt: new Date(Date.now() - 31 * 86_400_000),
    });
    const forms = (await (await list(s.manager)).json()) as { lastName: string }[];
    expect(forms.map((f) => f.lastName)).not.toContain("Expired");
    expect(await db.select().from(patientForms).where(eq(patientForms.lastName, "Expired"))).toEqual([]);
  });
});
```

In `tests/unit/access-log.test.ts`, change the import to `import { actionText, actorText } from "@/lib/access-log";`, add these lines inside the first test:

```ts
    expect(actionText({ action: "patient.form_received", details: { client: "x" } })).toBe("Sent a patient form");
    expect(actionText({ action: "patient.form_attached", details: { form: "x" } })).toBe("Added a patient form to the record");
    expect(actionText({ action: "patient.form_discarded", details: {} })).toBe("Discarded a patient form");
```

and add this test after it:

```ts
  it("names who did it, or the public page when no one was signed in", () => {
    const row = { userId: null, userName: null, action: "patient.form_received", details: {} };
    expect(actorText({ ...row, userId: "u1", userName: "Ana Reyes" })).toBe("Ana Reyes");
    expect(actorText({ ...row, userId: "u1" })).toBe("A removed account");
    expect(actorText({ ...row, action: "appointment.requested_online", details: { online: true } })).toBe("Online booking");
    expect(actorText(row)).toBe("Patient form");
    expect(actorText({ ...row, action: "auth.sign_in_failed" })).toBe("No one signed in");
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/db/patient-forms.test.ts tests/unit/access-log.test.ts`
Expected: FAIL: the `patient-forms` route modules do not exist, and `actorText` is not exported.

- [ ] **Step 3: A chart can use a form up**

In `src/server/patients.ts`:

1. Imports: `import { db, type Db } from "@/db";`, add `patientForms` to the `@/db/schema` import, and `import { can, covers } from "@/lib/permissions";`.
2. Give `duplicates` a doc comment and export it:

```ts
/** Patients who are probably the same person (spec 10): the same name and birthday, or the same mobile number and first name. */
export async function duplicates(p: { lastName: string; firstName: string; birthday?: string | null; mobile?: string | null }): Promise<PatientSummary[]> {
```

3. `createPatientSchema` gains `formId`:

```ts
export const createPatientSchema = patientSchema.extend({
  allowDuplicate: z.boolean().optional(),
  homeBranch: z.string().optional(),
  formId: z.uuid().optional(),
});
```

4. Add, after `duplicates`:

```ts
const handled = () => new ApiError(404, "handled", "That form was already handled.");

/**
 * Patient forms spec 5: deletes a form the front desk has dealt with, inside the caller's transaction, and answers its branch.
 * Only the owner or a manager of the form's branch may; a form already gone answers 404.
 */
export async function takeForm(tx: Db, actor: Staff, formId: string): Promise<string> {
  requireCan(actor, "patient.edit");
  const [form] = await tx.delete(patientForms).where(eq(patientForms.id, formId)).returning({ branchId: patientForms.branchId });
  if (!form) throw handled();
  // Throwing rolls the delete back, so the form waits for someone who may handle it.
  if (!covers(actor, form.branchId)) throw forbidden();
  return form.branchId;
}
```

5. In `createPatient`, take `formId` out of the input, use the form up first inside the transaction, and name it in the log:

```ts
  const { allowDuplicate, homeBranch, consent, formId, ...fields } = input;
```

```ts
  return db.transaction(async (tx) => {
    // Patient forms spec 5: a chart made from a form uses the form up, in the same transaction.
    if (formId) await takeForm(tx, actor, formId);
    const [row] = await tx
```

```ts
    await audit(
      { userId: actor.id, action: "patient.created", entity: "patient", entityId: row.id, branchId: home?.id ?? null, details: formId ? { form: formId } : undefined },
      tx,
    );
```

- [ ] **Step 4: List, attach, and discard**

In `src/server/patient-forms.ts`, extend the imports:

```ts
import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { auditLog, branches, patientForms, patients } from "@/db/schema";
import { covers } from "@/lib/permissions";
import { manilaDate } from "@/lib/time";
import { mobileSchema } from "@/lib/validation";
import { audit } from "./audit";
import { requireBranch } from "./branches";
import { ApiError, forbidden, notFound } from "./errors";
import { requireCan } from "./guard";
import { duplicates, takeForm, type PatientSummary } from "./patients";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";
```

and add at the end of the file:

```ts
export const patientFormsQuerySchema = z.object({ branch: z.string().min(1) });
export const attachSchema = z.object({ patientId: z.uuid() });

export type PatientFormView = {
  id: string;
  createdAt: Date;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthday: string;
  sex: string;
  mobile: string;
  address: string;
  /** The patients this may already be, by the duplicate warning's rule (patients spec 10). */
  matches: PatientSummary[];
};

/** GET /patient-forms (patient forms spec 5): the branch's waiting forms, the newest first, each with the patients it may be. */
export async function listPatientForms(actor: Staff, q: z.infer<typeof patientFormsQuerySchema>): Promise<PatientFormView[]> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "patient.edit");
  if (!covers(actor, branch.id)) throw forbidden();
  await expireForms();
  const rows = await db
    .select({
      id: patientForms.id,
      createdAt: patientForms.createdAt,
      lastName: patientForms.lastName,
      firstName: patientForms.firstName,
      middleName: patientForms.middleName,
      birthday: patientForms.birthday,
      sex: patientForms.sex,
      mobile: patientForms.mobile,
      address: patientForms.address,
    })
    .from(patientForms)
    .where(eq(patientForms.branchId, branch.id))
    .orderBy(desc(patientForms.createdAt));
  return Promise.all(rows.map(async (form) => ({ ...form, matches: await duplicates(form) })));
}

/** POST /patient-forms/{id}/attach (spec 5): the form was an existing patient's. It is deleted; staff change the record by hand. */
export async function attachPatientForm(actor: Staff, id: string, input: z.infer<typeof attachSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const branchId = await takeForm(tx, actor, id);
    const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, input.patientId));
    if (!patient) throw notFound("That patient");
    await audit({ userId: actor.id, action: "patient.form_attached", entity: "patient", entityId: patient.id, branchId, details: { form: id } }, tx);
  });
}

/** DELETE /patient-forms/{id} (spec 5): spam, or a form sent twice. */
export async function discardPatientForm(actor: Staff, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const branchId = await takeForm(tx, actor, id);
    await audit({ userId: actor.id, action: "patient.form_discarded", entity: "patient_form", entityId: id, branchId }, tx);
  });
}
```

(`and`, `count`, `gt`, `lt`, `sql` stay in use by Task 1's code; keep the import list to what the file uses, as lint reports.)

- [ ] **Step 5: The routes**

Create `src/app/api/v1/patient-forms/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { listPatientForms, patientFormsQuerySchema } from "@/server/patient-forms";

export const GET = staffRoute(async (req, staff) => json(await listPatientForms(staff, patientFormsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));
```

Create `src/app/api/v1/patient-forms/[id]/route.ts`:

```ts
import { json, staffRoute } from "@/server/api";
import { discardPatientForm } from "@/server/patient-forms";

export const DELETE = staffRoute<{ id: string }>(async (_req, staff, { id }) => {
  await discardPatientForm(staff, id);
  return json({ ok: true });
});
```

Create `src/app/api/v1/patient-forms/[id]/attach/route.ts`:

```ts
import { json, readJson, staffRoute } from "@/server/api";
import { attachPatientForm, attachSchema } from "@/server/patient-forms";

export const POST = staffRoute<{ id: string }>(async (req, staff, { id }) => {
  await attachPatientForm(staff, id, await readJson(req, attachSchema));
  return json({ ok: true });
});
```

- [ ] **Step 6: The access log in words**

In `src/lib/access-log.ts`, add to `ACTIONS` after `"patient.updated"`:

```ts
  "patient.form_received": "Sent a patient form",
  "patient.form_attached": "Added a patient form to the record",
  "patient.form_discarded": "Discarded a patient form",
```

and add at the end of the file:

```ts
/** Who did it: the staff member, or, for a row no one signed in wrote, the public page that wrote it. */
export function actorText(row: { userId: string | null; userName: string | null; action: string; details: Record<string, unknown> }): string {
  if (row.userName !== null) return row.userName;
  if (row.userId !== null) return "A removed account";
  if (row.details.online === true) return "Online booking";
  if (row.action === "patient.form_received") return "Patient form";
  return "No one signed in";
}
```

In `src/app/[branch]/settings/access-log-panel.tsx`, add `actorText` to the existing import from `@/lib/access-log`, and replace the Who cell (line 93) with:

```tsx
                  <TableCell>{actorText(r)}</TableCell>
```

(If the row type there allows `userName` or `userId` to be `undefined`, keep `actorText`'s parameter type and adapt the call with `?? null`; do not change what is shown.)

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx vitest run tests/db/patient-forms.test.ts tests/unit/access-log.test.ts tests/db/patients.test.ts`
Expected: PASS. Then `npm test`, `npm run typecheck`, `npm run lint`: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/patients.ts src/server/patient-forms.ts src/app/api/v1/patient-forms src/lib/access-log.ts "src/app/[branch]/settings/access-log-panel.tsx" tests/db/patient-forms.test.ts tests/unit/access-log.test.ts
git commit -m "feat: let the front desk list patient forms and turn each into a chart, add it to a record, or discard it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The public pages

**Files:**
- Modify: `src/server/patient-forms.ts` (add `welcomeInfo`)
- Create: `src/app/welcome/[code]/page.tsx`, `src/app/welcome/[code]/form/page.tsx`, `src/app/welcome/[code]/form/patient-form.tsx`
- Modify: `src/lib/validation.ts:36`, `src/app/book/page.tsx`, `src/app/book/book-form.tsx`, `src/app/book/privacy/page.tsx`
- Test: `tests/db/patient-forms.test.ts`, `tests/unit/branch-codes.test.ts` (unchanged; it now covers `welcome`)

**Interfaces:**
- Consumes: `practiceSettings()` with `patientForms` (Task 1); `POST /api/v1/portal/forms` (Task 1).
- Produces: `welcomeInfo(code): Promise<WelcomeInfo | null>` with `WelcomeInfo = { practiceName: string; branch: { code: string; name: string }; booking: boolean; forms: boolean }`; pages `/welcome/{code}` and `/welcome/{code}/form`; `/book?branch={code}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/db/patient-forms.test.ts` (import `welcomeInfo` from `@/server/patient-forms`):

```ts
describe("the welcome page", () => {
  it("names the practice and the branch, and says what patients can do there", async () => {
    await world();
    await db.update(practice).set({ onlineBooking: false, patientForms: true });
    expect(await welcomeInfo("downtown")).toEqual({ practiceName: "Smile Dental", branch: { code: "downtown", name: "Downtown" }, booking: false, forms: true });
    await db.update(practice).set({ onlineBooking: true, patientForms: false });
    expect(await welcomeInfo("downtown")).toMatchObject({ booking: true, forms: false });
    await db.update(practice).set({ onlineBooking: false, patientForms: true });
  });

  it("knows no unknown or closed branch", async () => {
    await world();
    expect(await welcomeInfo("nowhere")).toBeNull();
    expect(await welcomeInfo("shut")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/db/patient-forms.test.ts`
Expected: FAIL: `welcomeInfo` is not exported.

- [ ] **Step 3: The welcome page's facts**

Add to `src/server/patient-forms.ts`:

```ts
export type WelcomeInfo = { practiceName: string; branch: { code: string; name: string }; booking: boolean; forms: boolean };

/** What /welcome/{code} shows (patient forms spec 4): null for an unknown or closed branch. */
export async function welcomeInfo(code: string): Promise<WelcomeInfo | null> {
  const settings = await practiceSettings();
  const [branch] = await db.select({ code: branches.code, name: branches.name, active: branches.active }).from(branches).where(eq(branches.code, code));
  if (!branch?.active) return null;
  return { practiceName: settings.name, branch: { code: branch.code, name: branch.name }, booking: settings.onlineBooking, forms: settings.patientForms };
}
```

Run: `npx vitest run tests/db/patient-forms.test.ts`
Expected: PASS.

- [ ] **Step 4: The welcome page**

Create `src/app/welcome/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { welcomeInfo } from "@/server/patient-forms";
import { practiceName } from "@/server/practice";

/** The practice's name in the browser tab (the root layout's template adds " | DentaSync"). */
export async function generateMetadata(): Promise<Metadata> {
  // Request time only: `next build` must never open the database.
  await connection();
  return { title: `Welcome to ${await practiceName()}` };
}

/** Patient forms spec 4: where the branch's patient poster leads, with a button for each thing patients can do online. */
export default async function WelcomePage({ params }: { params: Promise<{ code: string }> }) {
  // Request time only: `next build` must never open the database.
  await connection();
  const { code } = await params;
  const info = await welcomeInfo(code);
  if (!info) notFound();
  if (!info.booking && !info.forms) {
    return <AuthCard title={info.practiceName} description={`${info.branch.name}. Please ask at the front desk.`} />;
  }
  const branch = encodeURIComponent(info.branch.code);
  return (
    <AuthCard title={info.practiceName} description={info.branch.name}>
      <div className="grid gap-3">
        {info.booking && (
          <Link href={`/book?branch=${branch}`} className={buttonVariants({ size: "lg" })}>
            Book a visit
          </Link>
        )}
        {info.forms && (
          <Link href={`/welcome/${branch}/form`} className={buttonVariants({ size: "lg", variant: info.booking ? "outline" : "default" })}>
            Fill in my patient form
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
```

- [ ] **Step 5: Run the reserved-codes test to see it fail, then reserve `welcome`**

Run: `npx vitest run tests/unit/branch-codes.test.ts`
Expected: FAIL for `welcome` (the new top-level folder is not reserved).

In `src/lib/validation.ts`, line 36 becomes:

```ts
export const RESERVED_CODES = new Set(["all", "api", "book", "join", "login", "poster", "reset", "setup", "waiting", "welcome"]);
```

Run: `npx vitest run tests/unit/branch-codes.test.ts`
Expected: PASS.

- [ ] **Step 6: The patient form**

Create `src/app/welcome/[code]/form/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { manilaDate } from "@/lib/time";
import { welcomeInfo } from "@/server/patient-forms";
import { practiceName } from "@/server/practice";
import { PatientForm } from "./patient-form";

/** The practice's name in the browser tab (the root layout's template adds " | DentaSync"). */
export async function generateMetadata(): Promise<Metadata> {
  // Request time only: `next build` must never open the database.
  await connection();
  return { title: `Patient form at ${await practiceName()}` };
}

/** Patient forms spec 4: the patient's own basic details, for the front desk to check at the visit. */
export default async function PatientFormPage({ params }: { params: Promise<{ code: string }> }) {
  // Request time only: `next build` must never open the database.
  await connection();
  const { code } = await params;
  const info = await welcomeInfo(code);
  if (!info) notFound();
  if (!info.forms) {
    return <AuthCard title={info.practiceName} description="Patient forms aren't available right now. Please ask at the front desk." />;
  }
  return (
    <AuthCard title="Patient form" description={`${info.practiceName}, ${info.branch.name}. The front desk checks it with you at your visit.`}>
      <PatientForm branch={info.branch.code} booking={info.booking} today={manilaDate(new Date())} />
    </AuthCard>
  );
}
```

Create `src/app/welcome/[code]/form/patient-form.tsx`:

```tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

const EMPTY = { firstName: "", middleName: "", lastName: "", birthday: "", sex: "", mobile: "", address: "", consent: false, website: "" };
type TextKey = Exclude<keyof typeof EMPTY, "consent">;

/** Moves focus to the heading when it appears, so screen readers announce the outcome. One function for every render, so it runs on mount only. */
const focusHeading = (heading: HTMLHeadingElement | null) => heading?.focus();

/** Patient forms spec 4: the patient's basic details and their agreement to the privacy notice, for the front desk to check. */
export function PatientForm({ branch, booking, today }: { branch: string; booking: boolean; today: string }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sexErrorId = useId();
  const consentErrorId = useId();
  const send = useMutation({
    mutationFn: () => api<{ firstName: string }>("/portal/forms", { method: "POST", body: { branch, ...form } }),
    onSuccess: () => setErrors({}),
    onError: (error) => setErrors(fieldErrors(error)),
  });

  if (send.data) {
    return (
      <section role="status" className="grid gap-3 rounded-lg border p-4">
        <h2 tabIndex={-1} ref={focusHeading} className="text-lg font-semibold outline-none">
          {`Thanks, ${send.data.firstName}.`}
        </h2>
        <p>Tell the front desk you filled in the form.</p>
        <div className="flex flex-wrap gap-2">
          {booking && (
            <Link href={`/book?branch=${encodeURIComponent(branch)}`} className={buttonVariants()}>
              Book a visit
            </Link>
          )}
          {/* A parent often fills in one for each child. */}
          <Button
            variant="outline"
            onClick={() => {
              setForm(EMPTY);
              send.reset();
            }}
          >
            Fill in another form
          </Button>
        </div>
      </section>
    );
  }

  const set = (key: TextKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });
  const general = send.error ? errorMessage(send.error) : null;
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <TextField label="First name" value={form.firstName} onChange={set("firstName")} maxLength={50} autoComplete="given-name" error={errors.firstName} />
      <TextField label="Middle name (optional)" value={form.middleName} onChange={set("middleName")} maxLength={50} autoComplete="additional-name" error={errors.middleName} />
      <TextField label="Last name" value={form.lastName} onChange={set("lastName")} maxLength={50} autoComplete="family-name" error={errors.lastName} />
      <TextField label="Birthday" type="date" value={form.birthday} onChange={set("birthday")} min="1900-01-01" max={today} autoComplete="bday" error={errors.birthday} />
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Sex
          <NativeSelect
            className="w-full"
            value={form.sex}
            onChange={set("sex")}
            aria-invalid={errors.sex ? true : undefined}
            aria-describedby={errors.sex ? sexErrorId : undefined}
          >
            <NativeSelectOption value="">Pick one</NativeSelectOption>
            <NativeSelectOption value="female">Female</NativeSelectOption>
            <NativeSelectOption value="male">Male</NativeSelectOption>
          </NativeSelect>
        </label>
        {errors.sex && (
          <p id={sexErrorId} className="text-sm text-destructive">
            {errors.sex}
          </p>
        )}
      </div>
      <TextField label="Mobile number" value={form.mobile} onChange={set("mobile")} inputMode="tel" autoComplete="tel" hint="For example 0917 123 4567" error={errors.mobile} />
      <TextField label="Address" value={form.address} onChange={set("address")} maxLength={200} autoComplete="street-address" error={errors.address} />
      {/* A trap for bots (patient forms spec 7): people never see it, so they never fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </label>
      </div>
      <div className="grid gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={form.consent}
            onChange={(event) => setForm({ ...form, consent: event.target.checked })}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? consentErrorId : undefined}
          />
          <span>
            I agree to the{" "}
            <a href="/book/privacy" target="_blank" rel="noopener" className="underline">
              privacy notice
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p id={consentErrorId} className="text-sm text-destructive">
            {errors.consent}
          </p>
        )}
      </div>
      {general && <FormAlert message={general} />}
      <Button type="submit" disabled={send.isPending}>
        {send.isPending ? "Sending..." : "Send the form"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 7: `/book?branch=` and the notice for either switch**

In `src/app/book/page.tsx`, the page takes `searchParams` and passes the branch on:

```tsx
/** Online booking spec 3: the public booking page, made for phones. `?branch=` picks a branch (patient forms spec 9). */
export default async function BookPage({ searchParams }: { searchParams: Promise<{ branch?: string | string[] }> }) {
  // Request time only: `next build` must never open the database.
  await connection();
  const info = await portalInfo();
  // Off, or nothing to pick from: the same plain answer, never a form that cannot be finished.
  if (!info.open || info.branches.length === 0 || info.services.length === 0) {
    return <AuthCard title={info.practiceName} description="Online booking isn't available right now. Please call the clinic." />;
  }
  const { branch } = await searchParams;
  // Only a branch the page lists; any other value is ignored.
  const initialBranch = typeof branch === "string" && info.branches.some((b) => b.code === branch) ? branch : undefined;
  return (
    <AuthCard title={`Book a visit at ${info.practiceName}`} description="Pick a branch, a service, and a time. The clinic will call or text you to confirm.">
      <BookForm
        practiceName={info.practiceName}
        branches={info.branches.map((b) => ({ value: b.code, label: b.name }))}
        services={info.services.map((s) => ({ value: s.id, label: s.name, branches: s.branches }))}
        today={manilaDate(new Date())}
        initialBranch={initialBranch}
      />
    </AuthCard>
  );
}
```

In `src/app/book/book-form.tsx`, the component takes `initialBranch` and starts there:

```tsx
export function BookForm({
  practiceName,
  branches,
  services,
  today,
  initialBranch,
}: {
  practiceName: string;
  branches: Option[];
  services: ServiceOption[];
  today: string;
  initialBranch?: string;
}) {
  const [branch, setBranch] = useState(initialBranch ?? (branches.length === 1 ? branches[0].value : ""));
```

In `src/app/book/privacy/page.tsx`, the doc comment and the guard become:

```tsx
/** Online booking spec 3 and patient forms spec 4: the owner's notice, shown while online booking or patient forms is on. */
```

```tsx
  if (!settings.onlineBooking && !settings.patientForms) notFound();
```

- [ ] **Step 8: Run every check**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
Expected: all pass. The build lists `/welcome/[code]` and `/welcome/[code]/form` as dynamic routes.

- [ ] **Step 9: Commit**

```bash
git add src/server/patient-forms.ts src/app/welcome src/lib/validation.ts src/app/book tests/db/patient-forms.test.ts
git commit -m "feat: add the patient welcome page and form, and let the booking page open at a branch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The staff screens, the end-to-end run, and going live

**Files:**
- Create: `src/app/poster/[code]/patients/page.tsx`, `src/components/patient-forms.tsx`
- Modify: `src/app/[branch]/settings/branches-panel.tsx:49,83-85`, `src/app/[branch]/settings/practice-panel.tsx:99-118`, `src/components/add-patient-dialog.tsx`, `src/app/[branch]/patients/patients-screen.tsx`
- Modify: `tests/e2e/visit.spec.ts` (append), `README.md` (Going live, steps 3 and 5)

**Interfaces:**
- Consumes: `GET /api/v1/patient-forms`, `POST /api/v1/patients` with `formId`, `POST /api/v1/patient-forms/{id}/attach`, `DELETE /api/v1/patient-forms/{id}` (Task 2); `/welcome/{code}` (Task 3); `PracticeSettings.patientForms` (Task 1).
- Produces: `AddPatientDialog` props `initial?: Partial<PatientDraft>` and `formId?: string`; `PatientForms({ branchCode, onOpenPatient })`.

- [ ] **Step 1: Write the failing end-to-end steps**

Append inside the test in `tests/e2e/visit.spec.ts`, after the last line (the Confirmed check):

```ts
  // Patient forms: the owner switches them on and online booking off; a patient opens the branch's welcome page from its
  // patient poster, fills in the form, and the front desk makes a chart from it.
  expect((await send("PATCH", "/practice", { onlineBooking: false, patientForms: true })).ok()).toBe(true);
  await page.goto("/poster/downtown/patients");
  const welcomeUrl = ((await page.getByText("/welcome/").textContent()) ?? "").trim();
  const walkIn = await (await browser.newContext({ baseURL: origin })).newPage();
  await walkIn.goto(welcomeUrl);
  await expect(walkIn.getByRole("link", { name: "Book a visit" })).toHaveCount(0);
  await walkIn.getByRole("link", { name: "Fill in my patient form" }).click();
  await walkIn.getByLabel("First name").fill("Carla");
  await walkIn.getByLabel("Last name").fill("Reyes");
  await walkIn.getByLabel("Birthday").fill("1988-07-14");
  await walkIn.getByLabel("Sex").selectOption("female");
  await walkIn.getByLabel("Mobile number").fill("0918 222 3333");
  await walkIn.getByLabel("Address").fill("12 Mabini St, Makati");
  await walkIn.getByRole("checkbox", { name: /privacy notice/ }).check();
  await walkIn.getByRole("button", { name: "Send the form" }).click();
  await expect(walkIn.getByText("Thanks, Carla.")).toBeVisible();
  // With online booking off, the notice still shows, for the form.
  await walkIn.goto("/book/privacy");
  await expect(walkIn.getByText("E2E privacy notice.")).toBeVisible();

  await page.goto("/downtown/patients");
  await page.getByRole("button", { name: "Patient forms (1)" }).click();
  await page.getByRole("dialog", { name: "Patient forms" }).getByRole("button", { name: /Reyes, Carla/ }).click();
  await page.getByRole("dialog", { name: "Reyes, Carla" }).getByRole("button", { name: "New chart" }).click();
  const chart = page.getByRole("dialog", { name: "Add a patient" });
  await expect(chart.getByLabel("First name")).toHaveValue("Carla");
  await expect(chart.getByLabel("Home address")).toHaveValue("12 Mabini St, Makati");
  await chart.getByRole("button", { name: "Add patient" }).click();
  await expect(page).toHaveURL(/\/downtown\/patients\/[0-9a-f-]{36}$/);
  await page.goto("/downtown/patients");
  await expect(page.getByRole("button", { name: "Patient forms (0)" })).toBeVisible();
```

Run: `npm run build`, then `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` (no dev server may be running; the run skips itself between 23:00 and midnight Manila time, because it books a visit for later today, so run it outside that hour and check the output says `1 passed`, not skipped).
Expected: FAIL at `page.goto("/poster/downtown/patients")` (404) or at the Patient forms button.

- [ ] **Step 2: The patient poster**

Create `src/app/poster/[code]/patients/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appUrl } from "@/lib/env";
import { can } from "@/lib/permissions";
import { branchByCode } from "@/server/branches";
import { practiceName } from "@/server/practice";
import { qrSvg } from "@/server/qr";
import { requireStaff } from "@/server/session";
import { PrintButton } from "../print-button";

export const metadata: Metadata = { title: "Patient QR poster" };

/** Patient forms spec 3: an A4 poster with the branch's patient QR. Printed on white whatever the screen's theme. */
export default async function PatientPosterPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requireStaff();
  if (!can(staff, "settings.edit")) notFound();
  const { code } = await params;
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const welcomeUrl = `${appUrl()}/welcome/${branch.code}`;
  const svg = await qrSvg(welcomeUrl);
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-2xl content-center gap-8 bg-white p-8 text-center text-black">
      <div className="grid gap-2">
        <p className="text-lg">{await practiceName()}</p>
        <h1 className="text-4xl font-semibold">{branch.name}</h1>
      </div>
      <div className="mx-auto w-72 sm:w-80" role="img" aria-label="Patient QR code" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="grid gap-2">
        <p className="text-2xl font-semibold">Patients</p>
        <p className="text-lg">Scan to book a visit or fill in your patient form.</p>
      </div>
      <p className="text-xs break-all">{welcomeUrl}</p>
      <div className="print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
```

In `src/app/[branch]/settings/branches-panel.tsx`, line 49's text becomes `Each branch has its own hours, chairs, and QR posters.`, and the poster link becomes two:

```tsx
                      <Link href={`/poster/${b.code}`} target="_blank" className={buttonVariants({ variant: "ghost" })}>
                        Print staff poster
                      </Link>
                      <Link href={`/poster/${b.code}/patients`} target="_blank" className={buttonVariants({ variant: "ghost" })}>
                        Print patient poster
                      </Link>
```

- [ ] **Step 3: The switch in Settings**

In `src/app/[branch]/settings/practice-panel.tsx`, the notice's hint (line 100) becomes:

```tsx
          Patients agree to it when they book online or send a patient form. Have a lawyer review it (RA 10173).
```

and after the Booking page address `TextField` (before the Save button's `<div>`), add:

```tsx
      <div className="grid gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={form.patientForms} onChange={(event) => setForm({ ...form, patientForms: event.target.checked })} />
          Take patient forms
        </label>
        <p className="text-sm text-muted-foreground">Patients reach the form from each branch&apos;s patient poster (Branches, Print patient poster).</p>
      </div>
```

- [ ] **Step 4: The Add patient dialog starts from a form**

Replace `src/components/add-patient-dialog.tsx` up to the `return (` line with:

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { EMPTY_PATIENT, PatientFields, type PatientDraft } from "@/components/patient-fields";
import type { PatientHit } from "@/components/patient-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, fieldErrors, RequestError } from "@/lib/fetcher";

type Added = { id: string; name: string };

/**
 * Adds a patient to the practice, warning first about a likely duplicate (spec section 10). From a patient form (patient forms
 * spec 5) it starts filled in, saving uses the form up, and choosing an existing record adds the form to that record instead.
 */
export function AddPatientDialog({
  open,
  onOpenChange,
  onAdded,
  homeBranch,
  initial,
  formId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (patient: Added) => void;
  homeBranch?: string;
  initial?: Partial<PatientDraft>;
  formId?: string;
}) {
  const client = useQueryClient();
  const start = { ...EMPTY_PATIENT, ...initial };
  const [draft, setDraft] = useState<PatientDraft>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<PatientHit[] | null>(null);

  const reset = () => {
    setDraft(start);
    setErrors({});
    setCandidates(null);
  };
  const finish = (patient: Added) => {
    onAdded(patient);
    reset();
    onOpenChange(false);
  };
  const add = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      api<{ id: string; chartNo: number }>("/patients", { method: "POST", body: { ...draft, allowDuplicate, homeBranch, formId } }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ["patients"] });
      toast.success(`Added ${draft.lastName}, ${draft.firstName} as chart ${created.chartNo}.`);
      finish({ id: created.id, name: `${draft.lastName}, ${draft.firstName}` });
    },
    onError: (error) => {
      if (error instanceof RequestError && error.body.code === "possible_duplicate") {
        setCandidates((error.body.candidates ?? []) as PatientHit[]);
        return;
      }
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  // With a form, the existing record takes the form (patient forms spec 5); without one, the record is simply opened.
  const pick = useMutation({
    mutationFn: (c: PatientHit) => (formId ? api(`/patient-forms/${formId}/attach`, { method: "POST", body: { patientId: c.id } }) : Promise.resolve(null)),
    onSuccess: (_done, c) => finish({ id: c.id, name: `${c.lastName}, ${c.firstName}` }),
    onError: (error) => toast.error(errorMessage(error)),
  });

```

and in the candidates list, the Use this record button becomes:

```tsx
                  <Button variant="outline" disabled={pick.isPending} onClick={() => pick.mutate(c)}>
                    Use this record
                  </Button>
```

Everything else in the file stays as it is.

- [ ] **Step 5: The Patient forms button and dialogs**

Create `src/components/patient-forms.tsx`:

```tsx
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch, type PatientHit } from "@/components/patient-search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorMessage, RequestError } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type PatientForm = {
  id: string;
  createdAt: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthday: string;
  sex: string;
  mobile: string;
  address: string;
  matches: PatientHit[];
};

type Person = { id: string; lastName: string; firstName: string };

const SEX: Record<string, string> = { female: "Female", male: "Male" };

/**
 * Patient forms spec 5: the branch's waiting forms. Each becomes a new chart, goes to an existing patient's record, or is
 * discarded. A form someone else has just handled answers 404, and the list reloads.
 */
export function PatientForms({ branchCode, onOpenPatient }: { branchCode: string; onOpenPatient: (id: string) => void }) {
  const client = useQueryClient();
  const [listOpen, setListOpen] = useState(false);
  const [chosen, setChosen] = useState<PatientForm | null>(null);
  const [searching, setSearching] = useState(false);
  const [making, setMaking] = useState<PatientForm | null>(null);
  const [discarding, setDiscarding] = useState<PatientForm | null>(null);
  const list = useQuery({
    queryKey: ["patient-forms", branchCode],
    queryFn: () => api<PatientForm[]>(`/patient-forms?branch=${encodeURIComponent(branchCode)}`),
    refetchInterval: 30_000,
  });
  const reload = () => client.invalidateQueries({ queryKey: ["patient-forms"] });
  const choose = (form: PatientForm | null) => {
    setSearching(false);
    setChosen(form);
  };
  const failed = (error: unknown) => {
    toast.error(errorMessage(error));
    if (error instanceof RequestError && error.status === 404) {
      choose(null);
      void reload();
    }
  };
  const attach = useMutation({
    mutationFn: ({ form, person }: { form: PatientForm; person: Person }) =>
      api(`/patient-forms/${form.id}/attach`, { method: "POST", body: { patientId: person.id } }),
    onSuccess: async (_done, { person }) => {
      toast.success(`The form is on ${person.lastName}, ${person.firstName}'s record. Change anything that differs there.`);
      choose(null);
      await reload();
      onOpenPatient(person.id);
    },
    onError: failed,
  });
  const discard = useMutation({
    mutationFn: (form: PatientForm) => api(`/patient-forms/${form.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Form discarded.");
      setDiscarding(null);
      await reload();
    },
    onError: (error) => {
      setDiscarding(null);
      failed(error);
    },
  });
  const count = list.data?.length ?? 0;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setListOpen(true);
          void list.refetch();
        }}
      >
        {list.data ? `Patient forms (${count})` : "Patient forms"}
      </Button>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Patient forms</DialogTitle>
            <DialogDescription>Forms patients sent from this branch&apos;s poster. Check each one with the patient at the desk.</DialogDescription>
          </DialogHeader>
          {list.isPending ? (
            <p className="text-sm text-muted-foreground">Loading patient forms...</p>
          ) : list.isError ? (
            <FormAlert message={errorMessage(list.error)} />
          ) : count === 0 ? (
            <p className="text-sm text-muted-foreground">No patient forms are waiting.</p>
          ) : (
            <ul className="grid gap-2">
              {list.data.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="grid min-h-11 w-full gap-1 rounded-md border p-3 text-left text-sm wrap-anywhere outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={() => {
                      setListOpen(false);
                      choose(f);
                    }}
                  >
                    <span className="font-medium">{`${f.lastName}, ${f.firstName}`}</span>
                    <span>{`Born ${f.birthday}. ${f.mobile}.`}</span>
                    <span className="text-xs text-muted-foreground">{`Sent ${formatDateTime(new Date(f.createdAt))}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={chosen !== null} onOpenChange={(next) => !next && choose(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {chosen && (
            <>
              <DialogHeader>
                <DialogTitle>{`${chosen.lastName}, ${chosen.firstName}`}</DialogTitle>
                <DialogDescription>{`Sent ${formatDateTime(new Date(chosen.createdAt))}. Check it with the patient.`}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{[chosen.firstName, chosen.middleName, chosen.lastName].filter(Boolean).join(" ")}</dd>
                <dt className="text-muted-foreground">Birthday</dt>
                <dd>{chosen.birthday}</dd>
                <dt className="text-muted-foreground">Sex</dt>
                <dd>{SEX[chosen.sex] ?? chosen.sex}</dd>
                <dt className="text-muted-foreground">Mobile</dt>
                <dd>{chosen.mobile}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="wrap-anywhere">{chosen.address}</dd>
              </dl>
              {searching ? (
                <PatientSearch onPick={(p) => attach.mutate({ form: chosen, person: p })} autoFocus />
              ) : (
                chosen.matches.length > 0 && (
                  <div className="grid gap-2">
                    <p className="text-sm font-medium">May already be on file</p>
                    <ul className="grid gap-2">
                      {chosen.matches.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                          <span>
                            {`${m.lastName}, ${m.firstName}`}
                            <span className="block text-sm text-muted-foreground">{[`Chart ${m.chartNo}`, m.birthday, m.mobile].filter(Boolean).join(" · ")}</span>
                          </span>
                          <Button variant="outline" disabled={attach.isPending} onClick={() => attach.mutate({ form: chosen, person: m })}>
                            This is the patient
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
              <DialogFooter className="flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDiscarding(chosen);
                    choose(null);
                  }}
                >
                  Discard
                </Button>
                <Button variant="outline" onClick={() => setSearching(!searching)}>
                  {searching ? "Back" : "Existing patient"}
                </Button>
                <Button
                  onClick={() => {
                    setMaking(chosen);
                    choose(null);
                  }}
                >
                  New chart
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {making && (
        <AddPatientDialog
          key={making.id}
          open
          onOpenChange={(next) => !next && setMaking(null)}
          onAdded={(p) => {
            setMaking(null);
            void reload();
            onOpenPatient(p.id);
          }}
          homeBranch={branchCode}
          initial={{
            lastName: making.lastName,
            firstName: making.firstName,
            middleName: making.middleName ?? "",
            birthday: making.birthday,
            sex: making.sex,
            mobile: making.mobile,
            address: making.address,
          }}
          formId={making.id}
        />
      )}
      <ConfirmDialog
        open={discarding !== null}
        title="Discard this form?"
        description="Its details are deleted."
        confirmLabel="Discard"
        pending={discard.isPending}
        onConfirm={() => discarding && discard.mutate(discarding)}
        onOpenChange={(next) => !next && setDiscarding(null)}
      />
    </>
  );
}
```

Replace `src/app/[branch]/patients/patients-screen.tsx` with:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { PatientForms } from "@/components/patient-forms";
import { PatientSearch } from "@/components/patient-search";
import { Button } from "@/components/ui/button";

export function PatientsScreen({ branch, canAdd }: { branch: string; canAdd: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = (id: string) => router.push(`/${branch}/patients/${id}`);
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Patients</h1>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            {/* Patient forms spec 5: a branch's forms, on that branch's page only. */}
            {branch !== "all" && <PatientForms branchCode={branch} onOpenPatient={open} />}
            <Button onClick={() => setAdding(true)}>Add patient</Button>
          </div>
        )}
      </div>
      <PatientSearch onPick={(p) => open(p.id)} autoFocus />
      {canAdd && (
        <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={(p) => open(p.id)} homeBranch={branch === "all" ? undefined : branch} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Going live**

In `README.md`, "Going live":

1. At the end of step 3 (after "...the front desk confirms them from Online requests on the branch calendar."), add: ` To take patient forms, make sure the notice also covers the patient form (what it asks, why, and that a form waits for the front desk and is deleted once handled or after 30 days), tick Take patient forms, and print each branch's patient poster (Settings, Branches, Print patient poster) for where patients wait. Its QR opens APP_URL/welcome/{branch code}, with Book a visit and Fill in my patient form; the forms wait under Patient forms on that branch's Patients page, for the owner and the branch's managers.`
2. In step 5, the reserved codes become `` `all`, `api`, `book`, `join`, `login`, `poster`, `reset`, `setup`, `waiting`, or `welcome` `` and the query becomes `select code from branches where code in ('all', 'api', 'book', 'join', 'login', 'poster', 'reset', 'setup', 'waiting', 'welcome');`.

- [ ] **Step 7: Run every check**

Run: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, then `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` (outside 23:00 to midnight Manila time; no dev server running).
Expected: all pass; the Playwright output says `1 passed`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/poster/[code]/patients" "src/app/[branch]/settings/branches-panel.tsx" "src/app/[branch]/settings/practice-panel.tsx" src/components/add-patient-dialog.tsx src/components/patient-forms.tsx "src/app/[branch]/patients/patients-screen.tsx" tests/e2e/visit.spec.ts README.md
git commit -m "feat: print patient posters, switch patient forms on, and handle the forms from the Patients page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
