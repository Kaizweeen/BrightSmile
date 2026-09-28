import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, branches, dentistSchedules, dentistTimeOff, patients, userBranches, users } from "@/db/schema";
import { can, covers } from "@/lib/permissions";
import { blockProblems, type Block } from "@/lib/schedule";
import { audit } from "./audit";
import { ACTIVE_STATUSES } from "./branches";
import { ApiError, notFound } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00");

export const weekSchema = z.object({
  blocks: z
    .array(z.object({ branchId: z.uuid(), dayOfWeek: z.number().int().min(0).max(6), startTime: clock, endTime: clock }))
    .max(60),
});

export const timeOffSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().max(100, "Use at most 100 characters"),
  })
  .refine((t) => t.startsAt < t.endsAt, { message: "The end must be after the start", path: ["endsAt"] });

export type DentistView = { id: string; name: string; title: string | null; branchIds: string[] };
export type WeekBlock = Block & { id: string };
export type TimeOffView = { id: string; startsAt: Date; endsAt: Date; reason: string };
export type AffectedVisit = { id: string; startTime: Date; branchName: string; patientName: string };

async function openBranchIds(): Promise<string[]> {
  return (await db.select({ id: branches.id }).from(branches).where(eq(branches.active, true))).map((b) => b.id);
}

/** An active person who sees patients, with the branches they work at (a treating owner works at every open branch). */
async function dentist(id: string): Promise<DentistView> {
  const [row] = await db
    .select({ id: users.id, name: users.name, title: users.title, role: users.role, status: users.status, seesPatients: users.seesPatients })
    .from(users)
    .where(eq(users.id, id));
  if (!row || row.status !== "active" || !row.seesPatients) throw notFound("That dentist");
  const branchIds =
    row.role === "owner"
      ? await openBranchIds()
      : (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, id))).map((b) => b.id);
  return { id: row.id, name: row.name, title: row.title, branchIds };
}

/** Everyone who sees patients, as far as the caller may see their schedules. */
export async function listDentists(actor: Staff): Promise<DentistView[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, title: users.title, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
    .orderBy(asc(users.name));
  const links = await db.select().from(userBranches);
  const open = await openBranchIds();
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      branchIds: row.role === "owner" ? open : links.filter((link) => link.userId === row.id).map((link) => link.branchId),
    }))
    .filter((d) => can(actor, "schedule.view", { dentistId: d.id, branchIds: d.branchIds }));
}

const toBlock = (row: typeof dentistSchedules.$inferSelect): WeekBlock => ({
  id: row.id,
  branchId: row.branchId,
  dayOfWeek: row.dayOfWeek,
  startTime: row.startTime.slice(0, 5),
  endTime: row.endTime.slice(0, 5),
});

async function weekOf(dentistId: string, tx = db): Promise<WeekBlock[]> {
  const rows = await tx
    .select()
    .from(dentistSchedules)
    .where(eq(dentistSchedules.dentistId, dentistId))
    .orderBy(asc(dentistSchedules.dayOfWeek), asc(dentistSchedules.startTime));
  return rows.map(toBlock);
}

export async function dentistWeek(actor: Staff, dentistId: string): Promise<WeekBlock[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.view", { dentistId, branchIds: d.branchIds });
  return weekOf(dentistId);
}

/** Replaces a dentist's week. A manager changes only the blocks at branches they cover; the other blocks stay. */
export async function replaceWeek(actor: Staff, dentistId: string, input: z.infer<typeof weekSchema>): Promise<WeekBlock[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.edit", { dentistId, branchIds: d.branchIds });
  const all = await db.select({ id: branches.id, active: branches.active, hours: branches.operatingHours }).from(branches);
  const hours = new Map(all.map((b) => [b.id, b.hours]));
  const allowed = new Set(d.branchIds.filter((id) => all.some((b) => b.id === id && b.active)));
  const mine = (block: { branchId: string }) => covers(actor, block.branchId);

  return db.transaction(async (tx) => {
    const current = await tx.select().from(dentistSchedules).where(eq(dentistSchedules.dentistId, dentistId));
    const submitted = input.blocks.map((block, index) => ({ block, index })).filter(({ block }) => mine(block));
    const kept = current.filter((row) => !mine(row)).map(toBlock);
    const problems = blockProblems([...submitted.map((s) => s.block), ...kept], { allowedBranchIds: allowed, hours })
      .filter((problem) => problem.index < submitted.length)
      .map((problem) => ({ index: submitted[problem.index].index, message: problem.message }));
    if (problems.length > 0) throw new ApiError(400, "invalid", "Check the highlighted blocks.", { blocks: problems });

    const replaced = current.filter(mine).map((row) => row.id);
    if (replaced.length > 0) await tx.delete(dentistSchedules).where(inArray(dentistSchedules.id, replaced));
    if (submitted.length > 0) await tx.insert(dentistSchedules).values(submitted.map(({ block }) => ({ dentistId, ...block })));
    await audit({ userId: actor.id, action: "schedule.replaced", entity: "user", entityId: dentistId, details: { blocks: submitted.length } }, tx);
    return weekOf(dentistId, tx);
  });
}

export async function listTimeOff(actor: Staff, dentistId: string): Promise<TimeOffView[]> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.view", { dentistId, branchIds: d.branchIds });
  return db
    .select({ id: dentistTimeOff.id, startsAt: dentistTimeOff.startsAt, endsAt: dentistTimeOff.endsAt, reason: dentistTimeOff.reason })
    .from(dentistTimeOff)
    .where(and(eq(dentistTimeOff.dentistId, dentistId), gt(dentistTimeOff.endsAt, sql`now() - interval '30 days'`)))
    .orderBy(asc(dentistTimeOff.startsAt));
}

/** Spec 7: adding time off over booked visits names them; nothing is cancelled automatically. */
export async function addTimeOff(
  actor: Staff,
  dentistId: string,
  input: z.infer<typeof timeOffSchema>,
): Promise<{ id: string; affected: AffectedVisit[] }> {
  const d = await dentist(dentistId);
  requireCan(actor, "schedule.edit", { dentistId, branchIds: d.branchIds });
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dentistTimeOff)
      .values({ dentistId, startsAt, endsAt, reason: input.reason, createdBy: actor.id })
      .returning({ id: dentistTimeOff.id });
    await audit({ userId: actor.id, action: "time_off.added", entity: "user", entityId: dentistId, details: { startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString() } }, tx);
    const visits = await tx
      .select({ id: appointments.id, startTime: appointments.startTime, branchName: branches.name, lastName: patients.lastName, firstName: patients.firstName })
      .from(appointments)
      .innerJoin(branches, eq(branches.id, appointments.branchId))
      .innerJoin(patients, eq(patients.id, appointments.patientId))
      .where(
        and(
          eq(appointments.dentistId, dentistId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
          lt(appointments.startTime, endsAt),
          gt(appointments.endTime, startsAt),
        ),
      )
      .orderBy(asc(appointments.startTime));
    return {
      id: row.id,
      affected: visits.map((v) => ({ id: v.id, startTime: v.startTime, branchName: v.branchName, patientName: `${v.lastName}, ${v.firstName}` })),
    };
  });
}

export async function removeTimeOff(actor: Staff, id: string): Promise<void> {
  const [row] = await db.select().from(dentistTimeOff).where(eq(dentistTimeOff.id, id));
  if (!row) throw notFound("That time off");
  const d = await dentist(row.dentistId);
  requireCan(actor, "schedule.edit", { dentistId: row.dentistId, branchIds: d.branchIds });
  await db.transaction(async (tx) => {
    await tx.delete(dentistTimeOff).where(eq(dentistTimeOff.id, id));
    await audit({ userId: actor.id, action: "time_off.removed", entity: "user", entityId: row.dentistId }, tx);
  });
}
