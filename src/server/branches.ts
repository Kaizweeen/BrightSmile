import { and, asc, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, chairs, userBranches, users, type OperatingHours } from "@/db/schema";
import { operatingHoursSchema } from "@/lib/hours";
import { randomToken } from "@/lib/tokens";
import { audit } from "./audit";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

/** Statuses that hold time: the exclusion constraints' "active" (spec section 7). */
export const ACTIVE_STATUSES = ["requested", "confirmed", "checked_in", "in_treatment"] as const;

const somethingToChange = (patch: Record<string, unknown>) => Object.values(patch).some((value) => value !== undefined);

export const branchCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/, "Use 2 to 24 lowercase letters, numbers, or hyphens")
  .refine((code) => code !== "all", "That code is reserved");

export const branchSchema = z.object({
  code: branchCodeSchema,
  name: z.string().trim().min(1, "Enter a name").max(40, "Use at most 40 characters"),
  address: z.string().trim().max(200, "Use at most 200 characters"),
  phone: z.string().trim().max(20, "Use at most 20 characters"),
  operatingHours: operatingHoursSchema,
});

export const branchPatchSchema = branchSchema
  .partial()
  .extend({ active: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() })
  .refine(somethingToChange, "Nothing to change");

export const chairSchema = z.object({ label: z.string().trim().max(30, "Use at most 30 characters") });

export const chairPatchSchema = z
  .object({ label: chairSchema.shape.label.optional(), active: z.boolean().optional() })
  .refine(somethingToChange, "Nothing to change");

export type BranchView = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  operatingHours: OperatingHours;
  active: boolean;
  sort: number;
  chairCount: number;
};

/** Every branch with its count of active chairs (the prompt's chairs_count). Join codes never leave the server here. */
export async function listBranches(): Promise<BranchView[]> {
  return db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      address: branches.address,
      phone: branches.phone,
      operatingHours: branches.operatingHours,
      active: branches.active,
      sort: branches.sort,
      chairCount: sql<number>`(select count(*)::int from ${chairs} where ${chairs.branchId} = ${branches.id} and ${chairs.active})`,
    })
    .from(branches)
    .orderBy(asc(branches.sort), asc(branches.name));
}

export async function branchByCode(code: string) {
  const [row] = await db.select().from(branches).where(eq(branches.code, code));
  return row ?? null;
}

export async function requireBranch(code: string) {
  const branch = await branchByCode(code);
  if (!branch) throw notFound("That branch");
  return branch;
}

const codeTaken = () =>
  new ApiError(409, "code_taken", "Another branch uses that code.", { fields: { code: "Another branch uses that code." } });

export async function createBranch(actor: Staff, input: z.infer<typeof branchSchema>): Promise<{ id: string; code: string }> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, input.code));
    if (taken) throw codeTaken();
    const [row] = await tx
      .insert(branches)
      .values({ ...input, joinCode: randomToken(16) })
      .returning({ id: branches.id, code: branches.code });
    await audit({ userId: actor.id, action: "branch.created", entity: "branch", entityId: row.id, branchId: row.id, details: { code: row.code } }, tx);
    return row;
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function updateBranch(
  actor: Staff,
  code: string,
  patch: z.infer<typeof branchPatchSchema>,
): Promise<{ id: string; code: string }> {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.code, code)).for("update");
    if (!branch) throw notFound("That branch");
    if (patch.code && patch.code !== branch.code) {
      const [taken] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.code, patch.code));
      if (taken) throw codeTaken();
    }
    if (patch.active === false && branch.active) {
      const [others] = await tx
        .select({ n: count() })
        .from(branches)
        .where(and(eq(branches.active, true), ne(branches.id, branch.id)));
      if (others.n === 0) throw new ApiError(422, "last_branch", "Keep at least one branch open.");
      const [visits] = await tx
        .select({ n: count() })
        .from(appointments)
        // Visits not over yet count, including one in the chair right now.
        .where(and(eq(appointments.branchId, branch.id), inArray(appointments.status, [...ACTIVE_STATUSES]), gt(appointments.endTime, new Date())));
      if (visits.n > 0) {
        throw new ApiError(422, "has_visits", `This branch has ${plural(visits.n, "upcoming visit")}. Move or cancel ${visits.n === 1 ? "it" : "them"} first.`);
      }
      // Staff cover open branches only (staffById), so no one active may be left without one.
      const members = await tx
        .select({ id: users.id, name: users.name })
        .from(userBranches)
        .innerJoin(users, eq(users.id, userBranches.userId))
        .where(and(eq(userBranches.branchId, branch.id), ne(users.role, "owner"), eq(users.status, "active")));
      const elsewhere = members.length
        ? await tx
            .select({ id: userBranches.userId })
            .from(userBranches)
            .innerJoin(branches, eq(branches.id, userBranches.branchId))
            .where(and(inArray(userBranches.userId, members.map((m) => m.id)), eq(branches.active, true), ne(branches.id, branch.id)))
        : [];
      const stranded = members.filter((m) => !elsewhere.some((e) => e.id === m.id)).map((m) => m.name);
      if (stranded.length > 0) {
        const who = new Intl.ListFormat("en", { type: "conjunction" }).format(stranded);
        throw new ApiError(422, "has_staff", `${who} ${stranded.length === 1 ? "works" : "work"} only at this branch. Give them another branch or disable them first.`);
      }
    }
    const [row] = await tx.update(branches).set(patch).where(eq(branches.id, branch.id)).returning({ id: branches.id, code: branches.code });
    await audit({ userId: actor.id, action: "branch.updated", entity: "branch", entityId: branch.id, branchId: branch.id, details: patch }, tx);
    return row;
  });
}

/** A new QR code for the branch; the printed old one stops working at once (spec 6.2). */
export async function replaceJoinCode(actor: Staff, code: string): Promise<void> {
  requireCan(actor, "settings.edit");
  await db.transaction(async (tx) => {
    const [row] = await tx.update(branches).set({ joinCode: randomToken(16) }).where(eq(branches.code, code)).returning({ id: branches.id });
    if (!row) throw notFound("That branch");
    await audit({ userId: actor.id, action: "branch.qr_replaced", entity: "branch", entityId: row.id, branchId: row.id }, tx);
  });
}

export async function listChairs(branchId: string) {
  return db.select().from(chairs).where(eq(chairs.branchId, branchId)).orderBy(asc(chairs.number));
}

export async function addChair(actor: Staff, branchId: string, input: z.infer<typeof chairSchema>) {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${chairs.number}), 0)::int + 1` })
      .from(chairs)
      .where(eq(chairs.branchId, branchId));
    if (next > 99) throw new ApiError(422, "too_many_chairs", "A branch can have at most 99 chairs.");
    const [row] = await tx.insert(chairs).values({ branchId, number: next, label: input.label }).returning();
    await audit({ userId: actor.id, action: "chair.added", entity: "chair", entityId: `${branchId}:${next}`, branchId, details: { label: input.label } }, tx);
    return row;
  });
}

export async function updateChair(actor: Staff, branchId: string, number: number, patch: z.infer<typeof chairPatchSchema>) {
  requireCan(actor, "settings.edit");
  return db.transaction(async (tx) => {
    // Locked before counting, so no booking lands in between (bookings read the chair with a shared lock).
    const [chair] = await tx.select().from(chairs).where(and(eq(chairs.branchId, branchId), eq(chairs.number, number))).for("update");
    if (!chair) throw notFound("That chair");
    if (patch.active === false) {
      const [visits] = await tx
        .select({ n: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.branchId, branchId),
            eq(appointments.chairNumber, number),
            inArray(appointments.status, [...ACTIVE_STATUSES]),
            gt(appointments.endTime, new Date()),
          ),
        );
      if (visits.n > 0) {
        throw new ApiError(422, "has_visits", `Chair ${number} has ${plural(visits.n, "upcoming visit")}. Move ${visits.n === 1 ? "it" : "them"} first.`);
      }
    }
    const [row] = await tx.update(chairs).set(patch).where(and(eq(chairs.branchId, branchId), eq(chairs.number, number))).returning();
    await audit({ userId: actor.id, action: "chair.updated", entity: "chair", entityId: `${branchId}:${number}`, branchId, details: patch }, tx);
    return row;
  });
}
