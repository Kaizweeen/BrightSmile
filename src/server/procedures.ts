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
const priceSchema = z.number().int("Use whole centavos").min(0, "Use 0 or more").max(100_000_000, "That price is too high");

export const procedureSchema = z.object({
  name: nameSchema,
  online: z.boolean().optional().default(true),
  dentistIds: dentistIdsSchema.optional().default([]),
  price: priceSchema.optional().default(0),
});

export const procedurePatchSchema = z
  .object({ name: nameSchema, online: z.boolean(), dentistIds: dentistIdsSchema, active: z.boolean(), sort: z.number().int().min(0).max(999), price: priceSchema })
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

/**
 * Replaces a service's dentists; only active dentists who see patients can be chosen. A pending join request sees patients
 * too, but a link to it would block declining or expiring it (the foreign key).
 */
async function setDentists(tx: Db, procedureId: string, dentistIds: string[]): Promise<string[]> {
  const unique = [...new Set(dentistIds)];
  if (unique.length > 0) {
    const found = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, unique), eq(users.seesPatients, true), eq(users.status, "active")));
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
    const [row] = await tx.insert(procedures).values({ name: input.name, online: input.online, price: input.price }).returning();
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
