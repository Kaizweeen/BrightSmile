import { and, asc, count, eq, gt, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointmentProcedures, appointments, auditLog, branches, chairs, patients, procedureDentists, procedures, users } from "@/db/schema";
import { bookable, chooseDentist, NOTICE_MS } from "@/lib/portal";
import { addDays, manilaDate, manilaInstant } from "@/lib/time";
import { mobileSchema } from "@/lib/validation";
import { audit } from "./audit";
import { findOpenTimes } from "./availability";
import { requireBranch } from "./branches";
import { ApiError, pgCode } from "./errors";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

/** Online booking spec 8. */
const BOOKINGS_PER_IP_PER_HOUR = 5;
const WAITING_PER_PATIENT = 2;

const closed = () => new ApiError(404, "closed", "Online booking isn't available right now.");
const taken = () => new ApiError(409, "taken", "That time was just taken. Please pick another.");

export type PortalInfo =
  | { open: false; practiceName: string }
  | { open: true; practiceName: string; branches: { code: string; name: string }[]; services: { id: string; name: string }[] };

/** What /book shows (online booking spec 3): the active branches and the services offered online, nothing else. */
export async function portalInfo(): Promise<PortalInfo> {
  const settings = await practiceSettings();
  if (!settings.onlineBooking) return { open: false, practiceName: settings.name };
  const branchRows = await db
    .select({ code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.active, true))
    .orderBy(asc(branches.sort), asc(branches.name));
  const services = await db
    .select({ id: procedures.id, name: procedures.name })
    .from(procedures)
    .where(and(eq(procedures.active, true), eq(procedures.online, true)))
    .orderBy(asc(procedures.sort), asc(procedures.name));
  return { open: true, practiceName: settings.name, branches: branchRows, services };
}

/**
 * The branch and service a patient picked, refused as in online booking spec 8, with the service's dentists (null: all).
 * With `lock`, in a booking's transaction, the branch is read with the shared lock staff bookings take (src/server/booking.ts):
 * closing the branch waits for the booking, and a closing that committed first is seen here. The public open times and the
 * bot trap only read, so they pass false.
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
function openStarts(tx: Db, t: Target, date: string, now: Date, patientId?: string) {
  return findOpenTimes(
    {
      branch: t.branch,
      date,
      minutes: t.settings.visitMinutes,
      turnover: t.settings.cleaningMinutes,
      notBefore: new Date(now.getTime() + NOTICE_MS),
      dentistIds: t.dentistIds,
      patientId,
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

/** Online booking spec 7: the existing patient with this mobile number and last name (lowest chart number), if there is one. */
async function findPatient(tx: Db, input: { lastName: string; mobile: string }): Promise<string | null> {
  const [found] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.mobile, input.mobile), sql`lower(trim(${patients.lastName})) = lower(${input.lastName})`))
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

/** POST /portal/bookings (online booking spec 3 to 8). Answers with names only, never anything about existing records. */
export async function bookOnline(input: z.infer<typeof onlineBookingSchema>, ip: string): Promise<{ branch: string; service: string; start: string }> {
  // The bot trap: the same answer as a real booking, and nothing saved.
  if (input.website !== "") {
    const t = await target(db, input.branch, input.service, false);
    return { branch: t.branch.name, service: t.service.name, start: new Date(input.start).toISOString() };
  }
  const now = new Date();
  const start = new Date(input.start);
  try {
    return await db.transaction(async (tx) => {
      // One online booking at a time, so two cannot both pass the counts below.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dentasync.portal'))`);
      const t = await target(tx, input.branch, input.service, true);
      const [fromIp] = await tx
        .select({ n: count() })
        .from(auditLog)
        .where(and(eq(auditLog.action, "appointment.requested_online"), sql`${auditLog.details}->>'ip' = ${ip}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
      if (fromIp.n >= BOOKINGS_PER_IP_PER_HOUR) {
        throw new ApiError(429, "too_many_requests", "Too many bookings from this connection. Please call the clinic.");
      }
      const existing = await findPatient(tx, input);
      if (existing) {
        const [waiting] = await tx
          .select({ n: count() })
          .from(appointments)
          .where(and(eq(appointments.patientId, existing), eq(appointments.source, "portal"), eq(appointments.status, "requested"), gt(appointments.startTime, now)));
        if (waiting.n >= WAITING_PER_PATIENT) {
          throw new ApiError(429, "too_many_waiting", "You already have 2 requests waiting. The clinic will call you.");
        }
      }
      const date = manilaDate(start);
      if (!bookable(date, now)) throw taken();
      const open = await openStarts(tx, t, date, now, existing ?? undefined);
      const slot = open.find((o) => o.start.getTime() === start.getTime());
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
          details: { ip, privacyNoticeAccepted: true, online: true, start: start.toISOString() },
        },
        tx,
      );
      return { branch: t.branch.name, service: t.service.name, start: start.toISOString() };
    });
  } catch (error) {
    // The database refused a clash with a booking saved in between (spec 8.8).
    if (pgCode(error) === "23P01") throw taken();
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
