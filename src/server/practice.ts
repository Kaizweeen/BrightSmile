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
    const current = await practiceSettings(tx);
    const next = { ...current, ...patch };
    if (next.onlineBooking && next.privacyNotice === "") {
      throw new ApiError(422, "notice_needed", "Add the privacy notice first.", { fields: { privacyNotice: "Add the privacy notice first." } });
    }
    await tx.insert(practice).values(next).onConflictDoUpdate({ target: practice.id, set: next });
    // A changed notice is logged in full (at most 5000 characters, no personal data), so the clinic can show which notice was
    // in force when a patient agreed to it.
    const { privacyNotice, ...rest } = patch;
    await audit(
      { userId: actor.id, action: "practice.updated", entity: "practice", details: { ...rest, ...(privacyNotice === undefined || privacyNotice === current.privacyNotice ? {} : { privacyNotice }) } },
      tx,
    );
    return next;
  });
}
