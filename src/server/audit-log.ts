import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, auditLog, branches, patients, users } from "@/db/schema";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const auditQuerySchema = z.object({
  patient: z.uuid().optional(),
  user: z.uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
});

const PAGE = 50;

/** Spec 10 and 13: the owner's access log, newest first, 50 at a time, filtered by patient or by staff member. */
export async function accessLog(actor: Staff, q: z.infer<typeof auditQuerySchema>) {
  requireCan(actor, "audit.view");
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      details: auditLog.details,
      userId: auditLog.userId,
      userName: users.name,
      branchName: branches.name,
      patientName: sql<string | null>`${patients.lastName} || ', ' || ${patients.firstName}`,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(branches, eq(branches.id, auditLog.branchId))
    // A row names its patient directly, or through the visit it is about.
    .leftJoin(appointments, and(eq(auditLog.entity, "appointment"), eq(sql`${appointments.id}::text`, auditLog.entityId)))
    .leftJoin(
      patients,
      or(and(eq(auditLog.entity, "patient"), eq(sql`${patients.id}::text`, auditLog.entityId)), eq(patients.id, appointments.patientId)),
    )
    .where(
      and(
        q.patient ? eq(patients.id, q.patient) : undefined,
        // By the person, or about them (a failed sign-in as them, a change to their access, their schedule).
        q.user ? or(eq(auditLog.userId, q.user), eq(auditLog.entityId, q.user)) : undefined,
        q.before ? lt(auditLog.id, q.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(PAGE);
}
