import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { supplies } from "@/db/schema";
import { audit } from "./audit";
import { can } from "@/lib/permissions";
import { ApiError, notFound } from "./errors";
import { requireBranch } from "./branches";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const name = z.string().trim().min(1, "Enter a name").max(60, "Use at most 60 characters");
const unit = z.string().trim().min(1, "Enter a unit").max(20, "Use at most 20 characters");
const count = z.number().int("Use a whole number").min(0, "Use 0 or more").max(1_000_000);

export const suppliesQuerySchema = z.object({ branch: z.string().min(1) });

export const supplySchema = z.object({ branch: z.string().min(1), name, unit: unit.optional(), quantity: count.optional(), reorderLevel: count.optional() });

/** `adjust` adds (or, negative, removes) stock in one atomic step, so two people counting at once never overwrite each other. */
export const supplyPatchSchema = z
  .object({ name, unit, reorderLevel: count, active: z.boolean(), adjust: z.number().int("Use a whole number").min(-1_000_000).max(1_000_000) })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export type SupplyView = typeof supplies.$inferSelect;

const nameTaken = () => new ApiError(409, "name_taken", "This branch already has that supply.", { fields: { name: "This branch already has that supply." } });

export async function listSupplies(actor: Staff, branchCode: string): Promise<SupplyView[]> {
  const branch = await requireBranch(branchCode);
  requireCan(actor, "supplies.view", { branchId: branch.id });
  return db.select().from(supplies).where(eq(supplies.branchId, branch.id)).orderBy(asc(supplies.name));
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
    await audit({ userId: actor.id, action: "supply.created", entity: "supply", entityId: row.id, branchId: branch.id, details: fields }, tx);
    return row;
  });
}

export async function updateSupply(actor: Staff, id: string, patch: z.infer<typeof supplyPatchSchema>): Promise<SupplyView> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(supplies).where(eq(supplies.id, id)).for("update");
    // Someone outside the branch learns nothing about it: 404, not 403.
    if (!current || !can(actor, "supplies.view", { branchId: current.branchId })) throw notFound("That supply");
    requireCan(actor, "supplies.edit", { branchId: current.branchId });
    const { adjust, ...fields } = patch;
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
    const [row] = await tx
      .update(supplies)
      .set({ ...fields, ...(adjust === undefined ? {} : { quantity: sql`${supplies.quantity} + ${adjust}` }) })
      .where(eq(supplies.id, id))
      .returning();
    await audit({ userId: actor.id, action: "supply.updated", entity: "supply", entityId: id, branchId: current.branchId, details: patch }, tx);
    return row;
  });
}
