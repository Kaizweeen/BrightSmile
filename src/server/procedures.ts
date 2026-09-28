import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { procedures } from "@/db/schema";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const procedureSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters"),
  durationMinutes: z.number().int().min(5, "At least 5 minutes").max(480, "At most 480 minutes").multipleOf(5, "Use 5-minute steps"),
  bufferMinutes: z.number().int().min(0, "0 or more minutes").max(120, "At most 120 minutes"),
});

export const procedurePatchSchema = procedureSchema
  .partial()
  .extend({ active: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export type ProcedureRow = typeof procedures.$inferSelect;

const nameTaken = () =>
  new ApiError(409, "name_taken", "Another procedure has that name.", { fields: { name: "Another procedure has that name." } });

export async function listProcedures(opts: { activeOnly?: boolean } = {}): Promise<ProcedureRow[]> {
  return db
    .select()
    .from(procedures)
    .where(opts.activeOnly ? eq(procedures.active, true) : undefined)
    .orderBy(asc(procedures.sort), asc(procedures.name));
}

export async function createProcedure(actor: Staff, input: z.infer<typeof procedureSchema>): Promise<ProcedureRow> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, input.name));
    if (taken) throw nameTaken();
    const [row] = await tx.insert(procedures).values(input).returning();
    await audit({ userId: actor.id, action: "procedure.created", entity: "procedure", entityId: row.id, details: input }, tx);
    return row;
  });
}

export async function updateProcedure(actor: Staff, id: string, patch: z.infer<typeof procedurePatchSchema>): Promise<ProcedureRow> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    if (patch.name) {
      const [taken] = await tx.select({ id: procedures.id }).from(procedures).where(eq(procedures.name, patch.name));
      if (taken && taken.id !== id) throw nameTaken();
    }
    const [row] = await tx.update(procedures).set(patch).where(eq(procedures.id, id)).returning();
    if (!row) throw notFound("That procedure");
    await audit({ userId: actor.id, action: "procedure.updated", entity: "procedure", entityId: id, details: patch }, tx);
    return row;
  });
}
