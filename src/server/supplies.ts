import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, procedures, procedureSupplies, supplies } from "@/db/schema";
import { audit } from "./audit";
import { can } from "@/lib/permissions";
import type { Shortage } from "@/lib/shortages";
import { ApiError, notFound } from "./errors";
import { requireBranch } from "./branches";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const name = z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters");
const unit = z.string().trim().min(1, "Enter a unit").max(20, "Use at most 20 characters");
const count = z.number().int("Use a whole number").min(0, "Use 0 or more").max(1_000_000);

export const suppliesQuerySchema = z.object({ branch: z.string().min(1) });

/** The services that use a supply, and how many of its units each one takes. */
const usage = z
  .array(z.object({ procedureId: z.uuid(), quantity: z.number().int("Use a whole number").min(1, "Use 1 or more").max(1000, "Use at most 1000") }))
  .max(100)
  .refine((rows) => new Set(rows.map((r) => r.procedureId)).size === rows.length, "List each service once");

export const supplySchema = z.object({
  branch: z.string().min(1),
  name,
  unit: unit.optional(),
  quantity: count.optional(),
  reorderLevel: count.optional(),
  usage: usage.optional(),
});

/** `adjust` adds (or, negative, removes) stock in one atomic step, so two people counting at once never overwrite each other. */
export const supplyPatchSchema = z
  .object({ name, unit, reorderLevel: count, active: z.boolean(), adjust: z.number().int("Use a whole number").min(-1_000_000).max(1_000_000), usage })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export type SupplyUsage = { procedureId: string; quantity: number };
export type SupplyView = typeof supplies.$inferSelect & { usage: SupplyUsage[] };

const nameTaken = () => new ApiError(409, "name_taken", "This branch already has that supply.", { fields: { name: "This branch already has that supply." } });

export async function listSupplies(actor: Staff, branchCode: string): Promise<SupplyView[]> {
  const branch = await requireBranch(branchCode);
  requireCan(actor, "supplies.view", { branchId: branch.id });
  const rows = await db.select().from(supplies).where(eq(supplies.branchId, branch.id)).orderBy(asc(supplies.name));
  const links = rows.length === 0 ? [] : await db.select().from(procedureSupplies).where(inArray(procedureSupplies.supplyId, rows.map((r) => r.id)));
  return rows.map((row) => ({ ...row, usage: links.filter((l) => l.supplyId === row.id).map(({ procedureId, quantity }) => ({ procedureId, quantity })) }));
}

/** Replaces the services that use a supply. */
async function setUsage(tx: Db, supplyId: string, rows: SupplyUsage[]): Promise<SupplyUsage[]> {
  if (rows.length > 0) {
    const ids = rows.map((r) => r.procedureId);
    const found = await tx.select({ id: procedures.id }).from(procedures).where(inArray(procedures.id, ids));
    if (found.length !== ids.length) throw new ApiError(400, "invalid", "Pick services from the list.", { fields: { usage: "Pick services from the list." } });
  }
  await tx.delete(procedureSupplies).where(eq(procedureSupplies.supplyId, supplyId));
  if (rows.length > 0) await tx.insert(procedureSupplies).values(rows.map((r) => ({ ...r, supplyId })));
  return rows.map(({ procedureId, quantity }) => ({ procedureId, quantity }));
}

async function usageOf(tx: Db, supplyId: string): Promise<SupplyUsage[]> {
  return tx.select({ procedureId: procedureSupplies.procedureId, quantity: procedureSupplies.quantity }).from(procedureSupplies).where(eq(procedureSupplies.supplyId, supplyId));
}

export async function createSupply(actor: Staff, input: z.infer<typeof supplySchema>): Promise<SupplyView> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "supplies.edit", { branchId: branch.id });
  const fields = { name: input.name, unit: input.unit, quantity: input.quantity, reorderLevel: input.reorderLevel };
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: supplies.id })
      .from(supplies)
      .where(and(eq(supplies.branchId, branch.id), sql`lower(${supplies.name}) = lower(${input.name})`));
    if (taken) throw nameTaken();
    const [row] = await tx.insert(supplies).values({ ...fields, branchId: branch.id }).returning();
    const used = await setUsage(tx, row.id, input.usage ?? []);
    await audit({ userId: actor.id, action: "supply.created", entity: "supply", entityId: row.id, branchId: branch.id, details: { ...fields, usage: input.usage } }, tx);
    return { ...row, usage: used };
  });
}

export async function updateSupply(actor: Staff, id: string, patch: z.infer<typeof supplyPatchSchema>): Promise<SupplyView> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(supplies).where(eq(supplies.id, id)).for("update");
    // Someone outside the branch learns nothing about it: 404, not 403.
    if (!current || !can(actor, "supplies.view", { branchId: current.branchId })) throw notFound("That supply");
    requireCan(actor, "supplies.edit", { branchId: current.branchId });
    const { adjust, usage: newUsage, ...fields } = patch;
    if (fields.name && fields.name.toLowerCase() !== current.name.toLowerCase()) {
      const [taken] = await tx
        .select({ id: supplies.id })
        .from(supplies)
        .where(and(eq(supplies.branchId, current.branchId), sql`lower(${supplies.name}) = lower(${fields.name})`));
      if (taken) throw nameTaken();
    }
    // The database refuses a count below zero (supplies_quantity); say why instead of a 500.
    if (adjust !== undefined && current.quantity + adjust < 0) {
      throw new ApiError(422, "not_enough", `Only ${current.quantity} ${current.unit} in stock.`, { fields: { adjust: `Only ${current.quantity} ${current.unit} in stock.` } });
    }
    const changes = { ...fields, ...(adjust === undefined ? {} : { quantity: sql`${supplies.quantity} + ${adjust}` }) };
    const [row] = Object.keys(changes).length > 0 ? await tx.update(supplies).set(changes).where(eq(supplies.id, id)).returning() : [current];
    const used = newUsage ? await setUsage(tx, id, newUsage) : await usageOf(tx, id);
    await audit({ userId: actor.id, action: "supply.updated", entity: "supply", entityId: id, branchId: current.branchId, details: patch }, tx);
    return { ...row, usage: used };
  });
}

export type SupplyShortage = Shortage & { supplyId: string };

/**
 * Takes what a completed visit's services use out of its branch's stock, inside the completing transaction. A visit is
 * never held back by a stock count: when the shelf count is short, it drops to zero and the gap is logged, so the
 * branch can recount. Retired supplies are left alone.
 */
export async function takeSuppliesForVisit(tx: Db, actor: Staff, visit: { id: string; branchId: string }): Promise<SupplyShortage[]> {
  const needs = await tx
    .select({ supplyId: procedureSupplies.supplyId, needed: sql<number>`sum(${procedureSupplies.quantity})::int` })
    .from(appointmentProcedures)
    .innerJoin(procedureSupplies, eq(procedureSupplies.procedureId, appointmentProcedures.procedureId))
    .innerJoin(supplies, eq(supplies.id, procedureSupplies.supplyId))
    .where(and(eq(appointmentProcedures.appointmentId, visit.id), eq(supplies.branchId, visit.branchId), eq(supplies.active, true)))
    .groupBy(procedureSupplies.supplyId);
  if (needs.length === 0) return [];
  const ids = needs.map((n) => n.supplyId);
  // Locked in id order, so two visits completing at once never wait on each other in a circle.
  const stock = await tx.select().from(supplies).where(inArray(supplies.id, ids)).orderBy(asc(supplies.id)).for("update");
  const shortages: SupplyShortage[] = [];
  for (const row of stock) {
    const needed = needs.find((n) => n.supplyId === row.id)!.needed;
    const taken = Math.min(needed, row.quantity);
    if (taken > 0) await tx.update(supplies).set({ quantity: sql`${supplies.quantity} - ${taken}` }).where(eq(supplies.id, row.id));
    if (taken < needed) shortages.push({ supplyId: row.id, name: row.name, unit: row.unit, needed, taken });
    await audit(
      { userId: actor.id, action: "supply.used", entity: "supply", entityId: row.id, branchId: row.branchId, details: { appointmentId: visit.id, needed, taken } },
      tx,
    );
  }
  return shortages;
}
