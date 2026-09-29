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
