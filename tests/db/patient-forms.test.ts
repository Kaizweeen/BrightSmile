import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as attachRoute from "@/app/api/v1/patient-forms/[id]/attach/route";
import * as formRoute from "@/app/api/v1/patient-forms/[id]/route";
import * as formsListRoute from "@/app/api/v1/patient-forms/route";
import * as patientsRoute from "@/app/api/v1/patients/route";
import * as formsRoute from "@/app/api/v1/portal/forms/route";
import { db } from "@/db";
import { auditLog, branches, patientForms, patients, practice } from "@/db/schema";
import { normalizeMobile } from "@/lib/validation";
import { clientKey } from "@/server/api";
import { welcomeInfo } from "@/server/patient-forms";
import { call, makeBranch, makeUser, request, signIn } from "../helpers";

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
    try {
      await db.update(practice).set({ patientForms: false });
      const off = await send(form({ lastName: "Off" }), 3);
      expect(off.status).toBe(404);
      expect((await off.json()).error).toMatchObject({ code: "closed", message: "Patient forms aren't available right now." });
      await db.update(practice).set({ patientForms: true });
      for (const branch of ["nowhere", "shut"]) {
        const res = await send(form({ branch, lastName: "Nowhere" }), 3);
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatchObject({ code: "branch", message: "That branch doesn't take patient forms." });
      }
      expect(await formCount()).toBe(before);
    } finally {
      // A failed assertion above must not leave forms off for the tests that follow.
      await db.update(practice).set({ patientForms: true });
    }
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

  it("refuses a connection that is at its limit without opening a transaction", async () => {
    await world();
    for (let i = 0; i < 5; i++) expect((await send(form({ lastName: `Full${i}` }), 10)).status).toBe(201);
    // A transaction would wait for the connection's lock, so the refusal comes before any (as in online booking).
    const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
    const spy = vi.spyOn(real, "transaction");
    try {
      const sixth = await send(form({ lastName: "Full5" }), 10);
      expect(sixth.status).toBe(429);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("answers busy when the database gives up waiting for the connection's lock", async () => {
    await world();
    const before = [await formCount(), await receivedCount()];
    // A real wait needs two connections and PGlite has one, so the database's answer (55P03, lock_not_available) is injected.
    const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
    const spy = vi.spyOn(real, "transaction").mockRejectedValueOnce(Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }));
    try {
      const res = await send(form({ lastName: "Busy" }), 11);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatchObject({ code: "busy", message: "Patient forms are busy right now. Please try again in a moment." });
      expect([await formCount(), await receivedCount()]).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("waits at most five seconds for the connection's lock", async () => {
    await world();
    const real = (globalThis as unknown as { __dentasync: { db: typeof db } }).__dentasync.db;
    const original = real.transaction.bind(real);
    let waits: string | undefined;
    // `set local` lasts to the end of the transaction, so the limit is read from inside it, once the form is saved.
    const spy = vi.spyOn(real, "transaction").mockImplementationOnce((run, config) =>
      original(async (tx) => {
        const done = await run(tx);
        const { rows } = (await tx.execute(sql`show lock_timeout`)) as unknown as { rows: { lock_timeout: string }[] };
        waits = rows[0].lock_timeout;
        return done;
      }, config),
    );
    try {
      expect((await send(form({ lastName: "Patient" }), 12)).status).toBe(201);
      expect(waits).toBe("5s");
    } finally {
      spy.mockRestore();
    }
  });

  it("counts only the last hour toward the limit", async () => {
    await world();
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const client = clientOf(8);
    await db.insert(auditLog).values(
      Array.from({ length: 5 }, () => ({ userId: null, action: "patient.form_received", entity: "patient_form", details: { client, privacyNoticeAccepted: true }, at: twoHoursAgo })),
    );
    expect((await send(form({ lastName: "Later" }), 8)).status).toBe(201);
  });

  it("holds the limit when many forms arrive at once from one connection", async () => {
    await world();
    const before = await formCount();
    // PGlite has one connection, so this shows the count runs inside the transaction; on real Postgres the advisory lock is what holds it.
    const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => send(form({ lastName: `Rush${i}` }), 9)));
    expect(answers.map((res) => res.status).sort((a, b) => a - b)).toEqual([201, 201, 201, 201, 201, 429, 429, 429]);
    expect((await formCount()) - before).toBe(5);
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

async function frontDesk() {
  const w = await world();
  const up = await makeBranch({ code: "uptown", name: "Uptown" });
  const owner = await makeUser({ role: "owner" });
  const manager = await makeUser({ role: "manager", branchIds: [w.dt.id] });
  const other = await makeUser({ role: "manager", branchIds: [up.id] });
  const dentist = await makeUser({ role: "dentist", branchIds: [w.dt.id] });
  return {
    ...w,
    ownerId: owner.id,
    managerId: manager.id,
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

  it("lists at most the newest 100 waiting forms", async () => {
    const s = await desk();
    const crowded = await makeBranch({ code: "crowded", name: "Crowded" });
    // 105 forms a minute apart: Crowd0 is the newest and Crowd104 the oldest, so the five oldest are left off.
    await db.insert(patientForms).values(
      Array.from({ length: 105 }, (_, i) => ({
        branchId: crowded.id,
        lastName: `Crowd${i}`,
        firstName: "Many",
        birthday: "1970-01-01",
        sex: "male",
        mobile: "+639170002000",
        address: "Crowd St",
        createdAt: new Date(Date.now() - i * 60_000),
      })),
    );
    const res = await list(s.owner, "crowded");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lastName: string }[]).map((f) => f.lastName)).toEqual(Array.from({ length: 100 }, (_, i) => `Crowd${i}`));
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
    expect((await again.json()).error).toMatchObject({ code: "handled", message: "That form was already handled." });
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
    expect(row).toMatchObject({ userId: s.managerId, entity: "patient", entityId: known.id, branchId: s.dt.id });
    expect(row.details).toEqual({ form: f.id });
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
    expect(row).toMatchObject({ userId: s.ownerId, entity: "patient_form", branchId: s.dt.id });
    expect(row.details).toEqual({});
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
