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
