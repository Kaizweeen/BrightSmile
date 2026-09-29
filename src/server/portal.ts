import { and, asc, count, eq, gt, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, chairs, patients, procedureDentists, procedures, userBranches, users } from "@/db/schema";
import { ACTIVE } from "@/lib/lifecycle";
import { bookable, chooseDentist, NOTICE_MS } from "@/lib/portal";
import { STEP } from "@/lib/slots";
import { addDays, manilaDate, manilaInstant, manilaMinutes } from "@/lib/time";
import { mobileSchema } from "@/lib/validation";
import { audit } from "./audit";
import { findOpenTimes } from "./availability";
import { requireBranch } from "./branches";
import { ApiError, pgCode } from "./errors";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

/** Online booking spec 8. */
const BOOKINGS_PER_CLIENT_PER_HOUR = 5;
const WAITING_PER_PATIENT = 2;

const closed = () => new ApiError(404, "closed", "Online booking isn't available right now.");
const taken = () => new ApiError(409, "taken", "That time was just taken. Please pick another.");
const tooMany = () => new ApiError(429, "too_many_requests", "Too many bookings from this connection. Please call the clinic.");
const busy = () => new ApiError(503, "busy", "Online booking is busy right now. Please try again in a moment.");

/** `branches` holds the codes of the branches offering the service: null for all of them (the service has no dentist limit). */
type PortalService = { id: string; name: string; branches: string[] | null };

export type PortalInfo =
  | { open: false; practiceName: string }
  | { open: true; practiceName: string; branches: { code: string; name: string }[]; services: PortalService[] };

/**
 * What /book shows (online booking spec 3): the active branches and the services offered online, nothing else. A service limited
 * to dentists is offered only where one of them works (as in findOpenTimes: an active dentist who sees patients, linked to the
 * branch, or the owner, who works at every one), and left out when that is nowhere.
 */
export async function portalInfo(): Promise<PortalInfo> {
  const settings = await practiceSettings();
  if (!settings.onlineBooking) return { open: false, practiceName: settings.name };
  const branchRows = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sort), asc(branches.name));
  const rows = await db
    .select({ id: procedures.id, name: procedures.name })
    .from(procedures)
    .where(and(eq(procedures.active, true), eq(procedures.online, true)))
    .orderBy(asc(procedures.sort), asc(procedures.name));
  const limits = await db.select().from(procedureDentists);
  const dentists = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.status, "active"), eq(users.seesPatients, true)));
  const links = await db.select().from(userBranches);
  const services = rows.flatMap((service): PortalService[] => {
    const allowed = limits.filter((l) => l.procedureId === service.id).map((l) => l.dentistId);
    if (allowed.length === 0) return [{ ...service, branches: null }];
    const at = branchRows
      .filter((b) => dentists.some((d) => allowed.includes(d.id) && (d.role === "owner" || links.some((l) => l.userId === d.id && l.branchId === b.id))))
      .map((b) => b.code);
    return at.length > 0 ? [{ ...service, branches: at }] : [];
  });
  return { open: true, practiceName: settings.name, branches: branchRows.map(({ code, name }) => ({ code, name })), services };
}

/**
 * The branch and service a patient picked, refused as in online booking spec 8, with the service's dentists (null: all).
 * With `lock`, in a booking's transaction, the branch is read with the shared lock staff bookings take (src/server/booking.ts):
 * closing the branch waits for the booking, and a closing that committed first is seen here. The public open times, the bot
 * trap, and a booking's lock-free checks before its transaction only read, so they pass false.
 */
async function target(tx: Db, branchCode: string, serviceId: string, lock: boolean) {
  const settings = await practiceSettings(tx);
  if (!settings.onlineBooking) throw closed();
  const query = tx.select().from(branches).where(eq(branches.code, branchCode));
  const [branch] = lock ? await query.for("share") : await query;
  if (!branch?.active) throw new ApiError(404, "branch", "That branch doesn't take online bookings.");
  const [service] = await tx.select().from(procedures).where(eq(procedures.id, serviceId));
  if (!service?.active || !service.online) throw new ApiError(404, "service", "That service isn't offered online.");
  const limited = await tx.select({ id: procedureDentists.dentistId }).from(procedureDentists).where(eq(procedureDentists.procedureId, service.id));
  return { settings, branch, service, dentistIds: limited.length > 0 ? limited.map((d) => d.id) : null };
}

type Target = Awaited<ReturnType<typeof target>>;

/** Online booking spec 6.3: the open starts at the standard length, two hours away at the earliest. */
function openStarts(tx: Db, t: Target, date: string, now: Date) {
  return findOpenTimes(
    {
      branch: t.branch,
      date,
      minutes: t.settings.visitMinutes,
      turnover: t.settings.cleaningMinutes,
      notBefore: new Date(now.getTime() + NOTICE_MS),
      dentistIds: t.dentistIds,
    },
    tx,
  );
}

export const timesSchema = z.object({ branch: z.string().min(1), service: z.uuid(), date: z.iso.date() });

/** GET /portal/times: the open starts only (online booking spec 6.3), never who is free. */
export async function portalTimes(q: z.infer<typeof timesSchema>): Promise<{ times: string[] }> {
  const now = new Date();
  const t = await target(db, q.branch, q.service, false);
  if (!bookable(q.date, now)) return { times: [] };
  const open = await openStarts(db, t, q.date, now);
  return { times: open.map((o) => o.start.toISOString()) };
}

export const onlineBookingSchema = z.object({
  branch: z.string().min(1),
  service: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  firstName: z.string().trim().min(1, "Enter your first name").max(50, "Use at most 50 characters"),
  lastName: z.string().trim().min(1, "Enter your last name").max(50, "Use at most 50 characters"),
  mobile: mobileSchema,
  note: z.string().trim().max(500, "Use at most 500 characters").optional().default(""),
  consent: z.literal(true, "Agree to the privacy notice to book."),
  website: z.string().max(200).optional().default(""),
});

/**
 * Online booking spec 7: the existing patient with this mobile number, first name, and last name (lowest chart number), if there
 * is one. Families share phones, so a child booked from a parent's number never lands on the parent's chart.
 */
async function findPatient(tx: Db, input: { firstName: string; lastName: string; mobile: string }): Promise<string | null> {
  const [found] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(
      and(
        eq(patients.mobile, input.mobile),
        sql`lower(trim(${patients.firstName})) = lower(${input.firstName})`,
        sql`lower(trim(${patients.lastName})) = lower(${input.lastName})`,
      ),
    )
    .orderBy(asc(patients.chartNo))
    .limit(1);
  return found?.id ?? null;
}

/** Online booking spec 7: a new patient, with the booking's branch as home branch and no creator. */
async function createPatient(tx: Db, input: { firstName: string; lastName: string; mobile: string }, branchId: string): Promise<string> {
  const [created] = await tx
    .insert(patients)
    .values({ firstName: input.firstName, lastName: input.lastName, mobile: input.mobile, homeBranchId: branchId })
    .returning({ id: patients.id });
  await audit({ userId: null, action: "patient.created", entity: "patient", entityId: created.id, branchId, details: { online: true } }, tx);
  return created.id;
}

/** Each dentist's visits on a Manila date, any status but Cancelled and No-Show (online booking spec 6.4). */
async function visitsOn(tx: Db, date: string, dentistIds: string[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ dentistId: appointments.dentistId, n: count() })
    .from(appointments)
    .where(
      and(
        inArray(appointments.dentistId, dentistIds),
        gte(appointments.startTime, manilaInstant(date, 0)),
        lt(appointments.startTime, manilaInstant(addDays(date, 1), 0)),
        notInArray(appointments.status, ["cancelled", "no_show"]),
      ),
    )
    .groupBy(appointments.dentistId);
  return new Map(rows.map((r) => [r.dentistId, r.n]));
}

/** This client's online bookings in the last hour, counted from the access log (online booking spec 8). */
async function bookingsFrom(tx: Db, client: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.action, "appointment.requested_online"), sql`${auditLog.details}->>'client' = ${client}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
  return row.n;
}

/** POST /portal/bookings (online booking spec 3 to 8). Answers with names only, never anything about existing records. */
export async function bookOnline(input: z.infer<typeof onlineBookingSchema>, client: string): Promise<{ branch: string; service: string; start: string }> {
  // The practice, branch, and service as they are now, read without the lock: a closed practice, or an unknown branch or
  // service, answers 404 before anything else, and the refusals below never ask for the global lock. This read can be a
  // moment out of date. `t` inside the transaction is the same read with the locks, and it is the one that decides.
  const early = await target(db, input.branch, input.service, false);
  // The bot trap: the same answer as a real booking, and nothing saved.
  if (input.website !== "") {
    return { branch: early.branch.name, service: early.service.name, start: new Date(input.start).toISOString() };
  }
  const now = new Date();
  const start = new Date(input.start);
  const date = manilaDate(start);
  // More refusals that need no lock, so a flood of them never queues behind real bookings: a start no list of open times
  // could hold (out of range, off the grid, or too soon), a client that is already at its limit, and a start that is not
  // among the open starts right now.
  const offGrid = start.getTime() % 60_000 !== 0 || manilaMinutes(start) % STEP !== 0;
  if (!bookable(date, now) || offGrid || start.getTime() < now.getTime() + NOTICE_MS) throw taken();
  if ((await bookingsFrom(db, client)) >= BOOKINGS_PER_CLIENT_PER_HOUR) throw tooMany();
  if (!(await openStarts(db, early, date, now)).some((o) => o.start.getTime() === start.getTime())) throw taken();
  try {
    return await db.transaction(async (tx) => {
      // A busy lock is waited for a few seconds at most, so one stuck booking cannot hold every other one until the request times out.
      await tx.execute(sql`set local lock_timeout = '5s'`);
      // One online booking at a time, so two cannot both pass the counts below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dentasync.portal'))`);
      // The reads that decide: what `early` read without the lock is read again with it, and with the shared row locks.
      const t = await target(tx, input.branch, input.service, true);
      if ((await bookingsFrom(tx, client)) >= BOOKINGS_PER_CLIENT_PER_HOUR) throw tooMany();
      // The start comes first, against the public open starts again, and the patient only after it: a refused start is the
      // same answer whoever asks (spec 7).
      const slot = (await openStarts(tx, t, date, now)).find((o) => o.start.getTime() === start.getTime());
      if (!slot) throw taken();
      const dentist = chooseDentist(slot.dentists, await visitsOn(tx, date, slot.dentists.map((d) => d.id)));
      if (!dentist) throw taken();
      // The shared lock staff bookings take on the chair (src/server/booking.ts): closing it waits for this booking, and a
      // closing that committed first is seen here.
      const [chair] = await tx
        .select()
        .from(chairs)
        .where(and(eq(chairs.branchId, t.branch.id), eq(chairs.number, Math.min(...dentist.chairs))))
        .for("share");
      if (!chair?.active) throw taken();
      const end = new Date(start.getTime() + t.settings.visitMinutes * 60_000);
      const existing = await findPatient(tx, input);
      if (existing) {
        const [waiting] = await tx
          .select({ n: count() })
          .from(appointments)
          .where(and(eq(appointments.patientId, existing), eq(appointments.source, "portal"), eq(appointments.status, "requested"), gt(appointments.startTime, now)));
        if (waiting.n >= WAITING_PER_PATIENT) {
          throw new ApiError(429, "too_many_waiting", "You already have 2 requests waiting. The clinic will call you.");
        }
        // One place at a time: the patient has no other active visit that overlaps this one.
        const [clash] = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(and(eq(appointments.patientId, existing), inArray(appointments.status, [...ACTIVE]), lt(appointments.startTime, end), gt(appointments.endTime, start)))
          .limit(1);
        if (clash) throw taken();
      }
      // A new patient is made last, so a refused booking never uses up a chart number.
      const patientId = existing ?? (await createPatient(tx, input, t.branch.id));
      const [row] = await tx
        .insert(appointments)
        .values({
          patientId,
          dentistId: dentist.id,
          branchId: t.branch.id,
          chairNumber: chair.number,
          startTime: start,
          endTime: end,
          chairFreeAt: new Date(end.getTime() + t.settings.cleaningMinutes * 60_000),
          status: "requested",
          source: "portal",
          note: input.note,
        })
        .returning({ id: appointments.id });
      await tx.insert(appointmentProcedures).values({ appointmentId: row.id, position: 0, procedureId: t.service.id, name: t.service.name });
      await audit(
        {
          userId: null,
          action: "appointment.requested_online",
          entity: "appointment",
          entityId: row.id,
          branchId: t.branch.id,
          // The client is a keyed hash of the address, never the address (src/server/api.ts).
          details: { client, privacyNoticeAccepted: true, online: true, start: start.toISOString() },
        },
        tx,
      );
      return { branch: t.branch.name, service: t.service.name, start: start.toISOString() };
    });
  } catch (error) {
    // The database refused a clash with a booking saved in between (spec 8.8), or the global lock stayed busy.
    if (pgCode(error) === "23P01") throw taken();
    if (pgCode(error) === "55P03") throw busy();
    throw error;
  }
}

export const onlineRequestsSchema = z.object({ branch: z.string().min(1) });

export type OnlineRequest = {
  id: string;
  start: Date;
  createdAt: Date;
  note: string;
  mobile: string | null;
  dentistName: string;
  patientName: string;
  services: string[];
};

/** Online booking spec 4: the branch's Requested online visits from now on, the oldest request first. */
export async function onlineRequests(actor: Staff, q: z.infer<typeof onlineRequestsSchema>): Promise<OnlineRequest[]> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.manage", { branchId: branch.id });
  const rows = await db
    .select({
      id: appointments.id,
      start: appointments.startTime,
      createdAt: appointments.createdAt,
      note: appointments.note,
      mobile: patients.mobile,
      dentistName: users.name,
      lastName: patients.lastName,
      firstName: patients.firstName,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .where(and(eq(appointments.branchId, branch.id), eq(appointments.source, "portal"), eq(appointments.status, "requested"), gt(appointments.startTime, new Date())))
    .orderBy(asc(appointments.createdAt), asc(appointments.startTime));
  const procs = rows.length
    ? await db
        .select()
        .from(appointmentProcedures)
        .where(inArray(appointmentProcedures.appointmentId, rows.map((r) => r.id)))
        .orderBy(asc(appointmentProcedures.position))
    : [];
  return rows.map(({ lastName, firstName, ...r }) => ({
    ...r,
    patientName: `${lastName}, ${firstName}`,
    services: procs.filter((p) => p.appointmentId === r.id).map((p) => p.name),
  }));
}
