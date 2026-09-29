import { and, asc, eq, gt, inArray, lt, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, chairs, patients, users } from "@/db/schema";
import { checkBooking, conflictFor, type Conflict, type Finding } from "@/lib/booking-rules";
import { ACTIVE, actionFor, changeProblem, STATUS_LABEL, STATUSES, type Status } from "@/lib/lifecycle";
import { alertLines } from "@/lib/patients";
import { can } from "@/lib/permissions";
import { formatDateTime, formatTime, manilaMinutes } from "@/lib/time";
import { audit } from "./audit";
import { activeVisits, bookingFacts, LONGEST_VISIT_MS, type BookingRequest, type ProcedureSnapshot } from "./booking";
import { requireBranch } from "./branches";
import { ApiError, forbidden, notFound, pgCode } from "./errors";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

const instant = z.iso.datetime({ offset: true });
const minutesSchema = z.number().int().min(15, "At least 15 minutes").max(480, "At most 480 minutes").multipleOf(15, "Use 15-minute steps");
const minutesBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);

export const bookingSchema = z.object({
  branch: z.string().min(1),
  chairNumber: z.number().int().min(1).max(99),
  dentistId: z.uuid(),
  patientId: z.uuid(),
  start: instant.nullable().optional(),
  procedureIds: z.array(z.uuid()).min(1, "Pick at least one service").max(10, "Pick at most 10 services"),
  minutes: minutesSchema.optional(),
  walkIn: z.boolean().optional().default(false),
  requested: z.boolean().optional().default(false),
  note: z.string().trim().max(500, "Use at most 500 characters").optional().default(""),
  acknowledgeWarnings: z.boolean().optional().default(false),
});

export const validateSchema = bookingSchema.extend({ excludeAppointmentId: z.uuid().nullable().optional() });

export const moveSchema = z.object({
  chairNumber: z.number().int().min(1).max(99).optional(),
  dentistId: z.uuid().optional(),
  start: instant.optional(),
  procedureIds: z.array(z.uuid()).min(1).max(10).optional(),
  minutes: minutesSchema.optional(),
  acknowledgeWarnings: z.boolean().optional().default(false),
  // The visit's updatedAt as the screen last saw it: a move made from an older view is refused (spec 8.8).
  expectedUpdatedAt: instant.optional(),
});

export const transitionSchema = z.object({
  to: z.enum(STATUSES),
  reason: z.string().trim().min(1, "Give a reason").max(200, "Use at most 200 characters").nullish(),
});

export const listSchema = z.object({ branch: z.string().min(1), from: instant, to: instant, dentist: z.uuid().optional() });

export const conflictsSchema = z.object({
  branch: z.string().min(1),
  chair: z.coerce.number().int().min(1).max(99),
  from: instant,
  until: instant,
  exclude: z.uuid().optional(),
});

export type Check = { ok: boolean; end: Date; chairFreeAt: Date; errors: Finding[]; warnings: Finding[]; conflicts: Conflict[] };

/** A walk-in starts at the current minute; anything else needs a start on the 15-minute grid (spec 8.1). */
function startOf(input: { start?: string | null; walkIn: boolean }, now: Date): Date {
  if (input.walkIn) return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  if (!input.start) throw new ApiError(400, "invalid", "Pick a start time.", { fields: { start: "Pick a start time." } });
  const start = new Date(input.start);
  if (start.getTime() % 60_000 !== 0 || manilaMinutes(start) % 15 !== 0) {
    throw new ApiError(400, "invalid", "Pick a start on the 15-minute grid.", { fields: { start: "Pick a start on the 15-minute grid." } });
  }
  return start;
}

async function check(tx: Db, req: BookingRequest, now: Date): Promise<{ result: Check; procedures: ProcedureSnapshot[] }> {
  const { facts, procedures } = await bookingFacts(tx, req, now);
  const found = checkBooking(facts);
  return { result: { ...found, ok: found.errors.length === 0, end: facts.end, chairFreeAt: facts.chairFreeAt }, procedures };
}

function refuse(result: Check): never {
  const clash = result.conflicts.length > 0;
  throw new ApiError(clash ? 409 : 422, clash ? "conflict" : "refused", result.errors[0].message, {
    errors: result.errors,
    warnings: result.warnings,
    conflicts: result.conflicts,
  });
}

function askToConfirm(result: Check): never {
  throw new ApiError(422, "warnings", "This booking needs a second look. Book it anyway?", { warnings: result.warnings });
}

/** Two desks at once (spec 8.8): the database refused the second booking, so say which visit won. */
async function explainClash(req: BookingRequest): Promise<never> {
  const { result } = await check(db, req, new Date());
  if (result.conflicts.length > 0) refuse(result);
  throw new ApiError(409, "conflict", "That time was just taken. Refresh and try again.");
}

async function saveProcedures(tx: Db, appointmentId: string, list: ProcedureSnapshot[]): Promise<void> {
  await tx.delete(appointmentProcedures).where(eq(appointmentProcedures.appointmentId, appointmentId));
  await tx.insert(appointmentProcedures).values(list.map((p, position) => ({ appointmentId, position, procedureId: p.id, name: p.name })));
}

/**
 * Online booking spec 6.2: a new visit takes the practice's standard length unless given one, and today's cleaning time.
 * A visit being moved keeps its own length and cleaning time unless given a new length.
 */
async function lengthsFor(minutes: number | undefined, visitId?: string | null): Promise<{ minutes: number; cleaningMinutes: number }> {
  if (visitId) {
    const [visit] = await db.select().from(appointments).where(eq(appointments.id, visitId));
    if (visit) return { minutes: minutes ?? minutesBetween(visit.startTime, visit.endTime), cleaningMinutes: minutesBetween(visit.endTime, visit.chairFreeAt) };
  }
  const settings = await practiceSettings();
  return { minutes: minutes ?? settings.visitMinutes, cleaningMinutes: settings.cleaningMinutes };
}

/** POST /appointments/validate (spec 11.1): the booking check, answered without saving. */
export async function validateBooking(actor: Staff, input: z.infer<typeof validateSchema>): Promise<Check> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const now = new Date();
  const lengths = await lengthsFor(input.minutes, input.excludeAppointmentId);
  const { result } = await check(
    db,
    {
      branchId: branch.id,
      chairNumber: input.chairNumber,
      dentistId: input.dentistId,
      patientId: input.patientId,
      start: startOf(input, now),
      procedureIds: input.procedureIds,
      ...lengths,
      walkIn: input.walkIn,
      excludeId: input.excludeAppointmentId,
    },
    now,
  );
  return result;
}

export async function createAppointment(actor: Staff, input: z.infer<typeof bookingSchema>): Promise<{ id: string }> {
  const branch = await requireBranch(input.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const now = new Date();
  const lengths = await lengthsFor(input.minutes);
  const req: BookingRequest = {
    branchId: branch.id,
    chairNumber: input.chairNumber,
    dentistId: input.dentistId,
    patientId: input.patientId,
    start: startOf(input, now),
    procedureIds: input.procedureIds,
    ...lengths,
    walkIn: input.walkIn,
  };
  try {
    return await db.transaction(async (tx) => {
      const { result, procedures } = await check(tx, req, now);
      if (!result.ok) refuse(result);
      if (result.warnings.length > 0 && !input.acknowledgeWarnings) askToConfirm(result);
      const status: Status = input.walkIn ? "checked_in" : input.requested ? "requested" : "confirmed";
      const [row] = await tx
        .insert(appointments)
        .values({
          patientId: req.patientId,
          dentistId: req.dentistId,
          branchId: req.branchId,
          chairNumber: req.chairNumber,
          startTime: req.start,
          endTime: result.end,
          chairFreeAt: result.chairFreeAt,
          status,
          source: input.walkIn ? "walk_in" : "staff",
          note: input.note,
          createdBy: actor.id,
        })
        .returning({ id: appointments.id });
      await saveProcedures(tx, row.id, procedures);
      await audit(
        { userId: actor.id, action: "appointment.created", entity: "appointment", entityId: row.id, branchId: req.branchId, details: { status, start: req.start.toISOString() } },
        tx,
      );
      return row;
    });
  } catch (error) {
    if (pgCode(error) === "23P01") return explainClash(req);
    throw error;
  }
}

/** Spec 8.8: locks the visit for the move, and refuses it when the visit changed after it was read (a check-in, another move). */
const changed = () => new ApiError(409, "changed", "Someone just changed this visit. Refresh to see it, then try again.");

async function lockUnchanged(tx: Db, visit: typeof appointments.$inferSelect): Promise<void> {
  const [now] = await tx.select().from(appointments).where(eq(appointments.id, visit.id)).for("update");
  const same = (a: Date, b: Date) => a.getTime() === b.getTime();
  const unchanged =
    now &&
    now.status === visit.status &&
    now.dentistId === visit.dentistId &&
    now.chairNumber === visit.chairNumber &&
    same(now.startTime, visit.startTime) &&
    same(now.endTime, visit.endTime) &&
    same(now.updatedAt, visit.updatedAt);
  if (!unchanged) throw changed();
}

/** Spec 8.7: a requested or confirmed visit moves through the same checks as a new booking; a checked-in one changes chair only. */
export async function moveAppointment(actor: Staff, id: string, input: z.infer<typeof moveSchema>): Promise<void> {
  const [visit] = await db.select().from(appointments).where(eq(appointments.id, id));
  if (!visit) throw notFound("That visit");
  requireCan(actor, "appointment.manage", { branchId: visit.branchId });
  // Every move and status change stamps updatedAt, so a screen that opened the visit earlier is caught here.
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== visit.updatedAt.getTime()) throw changed();
  const status = visit.status as Status;
  const chairNumber = input.chairNumber ?? visit.chairNumber;

  if (status === "checked_in") {
    if ((input.dentistId && input.dentistId !== visit.dentistId) || input.start || input.procedureIds || input.minutes !== undefined) {
      throw new ApiError(422, "checked_in", "A checked-in visit can change only its chair.");
    }
    await db.transaction(async (tx) => {
      await lockUnchanged(tx, visit);
      const [chair] = await tx.select().from(chairs).where(and(eq(chairs.branchId, visit.branchId), eq(chairs.number, chairNumber))).for("share");
      if (!chair?.active) throw new ApiError(422, "refused", `Chair ${chairNumber} is not in use.`);
      const clashes = await activeVisits(
        tx,
        visit.startTime,
        visit.chairFreeAt,
        and(ne(appointments.id, id), eq(appointments.branchId, visit.branchId), eq(appointments.chairNumber, chairNumber)),
      );
      if (clashes.length > 0) {
        throw new ApiError(409, "conflict", `Chair ${chairNumber} is taken until ${formatTime(clashes[0].chairFreeAt)}, cleaning included.`, {
          conflicts: clashes.map((c) => conflictFor("chair", c)),
        });
      }
      await tx.update(appointments).set({ chairNumber, updatedAt: new Date() }).where(eq(appointments.id, id));
      await audit(
        { userId: actor.id, action: "appointment.moved", entity: "appointment", entityId: id, branchId: visit.branchId, details: { start: visit.startTime.toISOString(), chair: chairNumber } },
        tx,
      );
    });
    return;
  }
  if (status !== "requested" && status !== "confirmed") {
    throw new ApiError(422, "cannot_move", "Only a requested, confirmed, or checked-in visit can move.");
  }

  const now = new Date();
  const current = await db
    .select({ id: appointmentProcedures.procedureId })
    .from(appointmentProcedures)
    .where(eq(appointmentProcedures.appointmentId, id))
    .orderBy(asc(appointmentProcedures.position));
  const req: BookingRequest = {
    branchId: visit.branchId,
    chairNumber,
    dentistId: input.dentistId ?? visit.dentistId,
    patientId: visit.patientId,
    start: input.start ? startOf({ start: input.start, walkIn: false }, now) : visit.startTime,
    procedureIds: input.procedureIds ?? current.map((p) => p.id),
    minutes: input.minutes ?? minutesBetween(visit.startTime, visit.endTime),
    cleaningMinutes: minutesBetween(visit.endTime, visit.chairFreeAt),
    walkIn: false,
    excludeId: id,
  };
  try {
    await db.transaction(async (tx) => {
      await lockUnchanged(tx, visit);
      const { result, procedures } = await check(tx, req, now);
      if (!result.ok) refuse(result);
      if (result.warnings.length > 0 && !input.acknowledgeWarnings) askToConfirm(result);
      await tx
        .update(appointments)
        .set({ chairNumber, dentistId: req.dentistId, startTime: req.start, endTime: result.end, chairFreeAt: result.chairFreeAt, updatedAt: new Date() })
        .where(eq(appointments.id, id));
      await saveProcedures(tx, id, procedures);
      await audit(
        { userId: actor.id, action: "appointment.moved", entity: "appointment", entityId: id, branchId: visit.branchId, details: { start: req.start.toISOString(), chair: chairNumber, dentistId: req.dentistId } },
        tx,
      );
    });
  } catch (error) {
    if (pgCode(error) === "23P01") return explainClash(req);
    throw error;
  }
}

/** Spec 8.6. The database trigger enforces the allowed pairs too, and stamps the time of each change. */
export async function transitionAppointment(actor: Staff, id: string, input: z.infer<typeof transitionSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const [visit] = await tx.select().from(appointments).where(eq(appointments.id, id)).for("update");
    if (!visit) throw notFound("That visit");
    requireCan(actor, actionFor(input.to), { branchId: visit.branchId, dentistId: visit.dentistId });
    const problem = changeProblem(visit.status as Status, input.to, visit.startTime, new Date());
    if (problem) throw new ApiError(422, "status_change", problem);
    if (input.to === "cancelled" && !input.reason) {
      throw new ApiError(400, "invalid", "Give a reason for cancelling.", { fields: { reason: "Give a reason for cancelling." } });
    }
    await tx
      .update(appointments)
      .set({ status: input.to, ...(input.to === "cancelled" ? { cancelReason: input.reason } : {}) })
      .where(eq(appointments.id, id));
    await audit(
      {
        userId: actor.id,
        action: "appointment.status_changed",
        entity: "appointment",
        entityId: id,
        branchId: visit.branchId,
        // Never the cancel reason: it can hold health information, and the audit log is never edited (spec 13).
        details: { from: visit.status, to: input.to },
      },
      tx,
    );
  });
}

export type VisitView = {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  chairNumber: number;
  chairLabel: string;
  dentistId: string;
  dentistName: string;
  patientId: string;
  patientName: string;
  chartNo: number;
  hasAlerts: boolean;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  status: Status;
  source: string;
  note: string;
  cancelReason: string | null;
  procedures: string[];
};

async function visitViews(where: SQL | undefined): Promise<VisitView[]> {
  const rows = await db
    .select({
      id: appointments.id,
      branchId: appointments.branchId,
      branchCode: branches.code,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      chairLabel: chairs.label,
      dentistId: appointments.dentistId,
      dentistName: users.name,
      patientId: appointments.patientId,
      lastName: patients.lastName,
      firstName: patients.firstName,
      chartNo: patients.chartNo,
      allergies: patients.allergies,
      allergiesOther: patients.allergiesOther,
      medicalAlerts: patients.medicalAlerts,
      start: appointments.startTime,
      end: appointments.endTime,
      chairFreeAt: appointments.chairFreeAt,
      status: appointments.status,
      source: appointments.source,
      note: appointments.note,
      cancelReason: appointments.cancelReason,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(chairs, and(eq(chairs.branchId, appointments.branchId), eq(chairs.number, appointments.chairNumber)))
    .where(where)
    .orderBy(asc(appointments.startTime));
  const ids = rows.map((r) => r.id);
  const procs = ids.length
    ? await db.select().from(appointmentProcedures).where(inArray(appointmentProcedures.appointmentId, ids)).orderBy(asc(appointmentProcedures.position))
    : [];
  return rows.map(({ lastName, firstName, chairLabel, allergies, allergiesOther, medicalAlerts, ...row }) => ({
    ...row,
    chairLabel: chairLabel ?? "",
    patientName: `${lastName}, ${firstName}`,
    hasAlerts: alertLines({ allergies, allergiesOther, medicalAlerts }).length > 0,
    status: row.status as Status,
    procedures: procs.filter((p) => p.appointmentId === row.id).map((p) => p.name),
  }));
}

/**
 * The calendar's visits (every status) in [from, to). `branch` is a code or "all"; "all" needs the All branches view,
 * except for a dentist asking for their own visits, which they see at every branch (spec section 5).
 */
export async function listAppointments(actor: Staff, q: z.infer<typeof listSchema>): Promise<VisitView[]> {
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (!(from < to) || to.getTime() - from.getTime() > 42 * 86_400_000) {
    throw new ApiError(400, "invalid", "Ask for at most six weeks at a time.");
  }
  const own = q.dentist !== undefined && q.dentist === actor.id;
  let scope: SQL | undefined;
  if (q.branch === "all") {
    if (!own && !can(actor, "overview.view")) throw forbidden();
    if (!own && actor.role !== "owner") scope = inArray(appointments.branchId, [...actor.branchIds]);
  } else {
    const branch = await requireBranch(q.branch);
    requireCan(actor, "calendar.view", { branchId: branch.id, dentistId: q.dentist });
    scope = eq(appointments.branchId, branch.id);
  }
  return visitViews(
    and(
      scope,
      q.dentist ? eq(appointments.dentistId, q.dentist) : undefined,
      lt(appointments.startTime, to),
      gt(appointments.startTime, new Date(from.getTime() - LONGEST_VISIT_MS)),
      gt(appointments.endTime, from),
    ),
  );
}

/** Spec 6.5: a dentist's active visits that have not ended, at the branches the caller covers, so a disabled dentist's can be moved. */
export async function upcomingVisits(actor: Staff, dentistId: string): Promise<VisitView[]> {
  requireCan(actor, "staff.view");
  return visitViews(
    and(
      eq(appointments.dentistId, dentistId),
      inArray(appointments.status, [...ACTIVE]),
      gt(appointments.endTime, new Date()),
      gt(appointments.startTime, new Date(Date.now() - LONGEST_VISIT_MS)),
      actor.role === "owner" ? undefined : inArray(appointments.branchId, [...actor.branchIds]),
    ),
  );
}

function historyText(action: string, details: Record<string, unknown>): string {
  const label = (status: unknown) => STATUS_LABEL[status as Status]?.toLowerCase() ?? String(status);
  if (action === "appointment.created") return `Booked as ${label(details.status)}`;
  if (action === "appointment.moved") return `Moved to ${formatDateTime(new Date(String(details.start)))}, chair ${String(details.chair)}`;
  if (action === "appointment.status_changed") {
    return `${STATUS_LABEL[details.from as Status] ?? String(details.from)} to ${label(details.to)}`;
  }
  return action;
}

/** One visit with its patient's alerts, procedures, and history (spec section 10, the visit panel). */
export async function appointmentDetail(actor: Staff, id: string) {
  const [view] = await visitViews(eq(appointments.id, id));
  if (!view) throw notFound("That visit");
  requireCan(actor, "calendar.view", { branchId: view.branchId, dentistId: view.dentistId });
  const [patient] = await db
    .select({ allergies: patients.allergies, allergiesOther: patients.allergiesOther, medicalAlerts: patients.medicalAlerts })
    .from(patients)
    .where(eq(patients.id, view.patientId));
  const procedureIds = (
    await db
      .select({ id: appointmentProcedures.procedureId })
      .from(appointmentProcedures)
      .where(eq(appointmentProcedures.appointmentId, id))
      .orderBy(asc(appointmentProcedures.position))
  ).map((p) => p.id);
  const [{ updatedAt }] = await db.select({ updatedAt: appointments.updatedAt }).from(appointments).where(eq(appointments.id, id));
  // The panel shows the patient's allergies and alerts, so opening it is a view of the record (spec 13).
  await audit({ userId: actor.id, action: "patient.view", entity: "patient", entityId: view.patientId, details: { part: "visit", appointmentId: id } });
  const history = await db
    .select({ at: auditLog.at, action: auditLog.action, details: auditLog.details, by: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.entity, "appointment"), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));
  return {
    ...view,
    updatedAt,
    procedureIds,
    alerts: alertLines(patient),
    history: history.map((h) => ({ at: h.at, by: h.by ?? "Someone", text: historyText(h.action, h.details) })),
  };
}

/** Spec 11.2: active visits on a chair whose time plus turnover overlaps [from, until). */
export async function chairConflicts(actor: Staff, q: z.infer<typeof conflictsSchema>): Promise<Conflict[]> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "calendar.view", { branchId: branch.id });
  const clashes = await activeVisits(
    db,
    new Date(q.from),
    new Date(q.until),
    and(eq(appointments.branchId, branch.id), eq(appointments.chairNumber, q.chair), q.exclude ? ne(appointments.id, q.exclude) : undefined),
  );
  return clashes.map((c) => conflictFor("chair", c));
}
