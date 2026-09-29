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

/** This connection's forms in the last hour, counted from the access log (spec 7), read inside `tx` when given. */
async function formsFrom(client: string, tx: Db = db): Promise<number> {
  const [row] = await tx
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
  // A connection already at its limit is refused without waiting for the lock or holding a connection.
  if ((await formsFrom(client)) >= FORMS_PER_CLIENT_PER_HOUR) throw tooMany();
  await db.transaction(async (tx) => {
    // The count that decides: forms from one connection wait for each other here, so it holds even when many arrive at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dentasync.forms:${client}`}))`);
    if ((await formsFrom(client, tx)) >= FORMS_PER_CLIENT_PER_HOUR) throw tooMany();
    await expireForms(tx);
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

export type WelcomeInfo = { practiceName: string; branch: { code: string; name: string }; booking: boolean; forms: boolean };

/** What /welcome/{code} shows (patient forms spec 4): null for an unknown or closed branch. */
export async function welcomeInfo(code: string): Promise<WelcomeInfo | null> {
  const settings = await practiceSettings();
  const [branch] = await db.select({ code: branches.code, name: branches.name, active: branches.active }).from(branches).where(eq(branches.code, code));
  if (!branch?.active) return null;
  return { practiceName: settings.name, branch: { code: branch.code, name: branch.name }, booking: settings.onlineBooking, forms: settings.patientForms };
}
