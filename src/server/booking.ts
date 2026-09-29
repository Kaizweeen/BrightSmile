import { and, eq, gt, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { appointments, branches, chairs, dentistSchedules, dentistTimeOff, patients, procedures, userBranches, users } from "@/db/schema";
import type { BookingFacts, Visit } from "@/lib/booking-rules";
import { ACTIVE } from "@/lib/lifecycle";
import { ApiError, notFound } from "./errors";

/**
 * A visit never crosses midnight (spec 8.3) and its turnover is short, so no visit that started more than this long
 * before a moment still holds its chair then: a lower bound on start time that lets the start-time indexes skip history.
 */
export const LONGEST_VISIT_MS = 26 * 3_600_000;

/** Active visits whose chair time overlaps [from, until), narrowed by `where`. */
export async function activeVisits(tx: Db, from: Date, until: Date, where?: SQL): Promise<Visit[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      branchId: appointments.branchId,
      branchName: branches.name,
      chairNumber: appointments.chairNumber,
      dentistId: appointments.dentistId,
      dentistName: users.name,
      patientId: appointments.patientId,
      lastName: patients.lastName,
      firstName: patients.firstName,
      start: appointments.startTime,
      end: appointments.endTime,
      chairFreeAt: appointments.chairFreeAt,
    })
    .from(appointments)
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(users, eq(users.id, appointments.dentistId))
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(
      and(
        inArray(appointments.status, [...ACTIVE]),
        lt(appointments.startTime, until),
        gt(appointments.startTime, new Date(from.getTime() - LONGEST_VISIT_MS)),
        gt(appointments.chairFreeAt, from),
        where,
      ),
    );
  return rows.map(({ lastName, firstName, ...visit }) => ({ ...visit, patientName: `${lastName}, ${firstName}` }));
}

export type BookingRequest = {
  branchId: string;
  chairNumber: number;
  dentistId: string;
  patientId: string;
  start: Date;
  procedureIds: string[];
  /** The visit's length; online booking spec 6.2. */
  minutes: number;
  /** How long the chair stays blocked after the visit. */
  cleaningMinutes: number;
  walkIn: boolean;
  excludeId?: string | null;
};

export type ProcedureSnapshot = { id: string; name: string };

/** Everything the booking rules need (spec 8.2 to 8.4), read in one place so the rules stay pure. */
export async function bookingFacts(tx: Db, req: BookingRequest, now: Date): Promise<{ facts: BookingFacts; procedures: ProcedureSnapshot[] }> {
  // Shared locks on the branch and the chair: closing either one waits for this booking, and a closing that committed
  // first is seen here (src/server/branches.ts locks them before counting visits).
  const [branch] = await tx.select().from(branches).where(eq(branches.id, req.branchId)).for("share");
  if (!branch) throw notFound("That branch");
  const [dentist] = await tx.select().from(users).where(eq(users.id, req.dentistId));
  if (!dentist) throw notFound("That dentist");
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, req.patientId));
  if (!patient) throw notFound("That patient");
  const picked = await tx.select().from(procedures).where(inArray(procedures.id, req.procedureIds));
  if (new Set(req.procedureIds).size !== req.procedureIds.length || picked.length !== req.procedureIds.length) {
    throw new ApiError(400, "invalid", "Pick each procedure once, from the list.", {
      fields: { procedureIds: "Pick each procedure once, from the list." },
    });
  }
  const ordered = req.procedureIds.map((id) => picked.find((p) => p.id === id) as (typeof picked)[number]);
  const end = new Date(req.start.getTime() + req.minutes * 60_000);
  const chairFreeAt = new Date(end.getTime() + req.cleaningMinutes * 60_000);

  const [chair] = await tx.select().from(chairs).where(and(eq(chairs.branchId, branch.id), eq(chairs.number, req.chairNumber))).for("share");
  const link = await tx
    .select({ id: userBranches.branchId })
    .from(userBranches)
    .where(and(eq(userBranches.userId, dentist.id), eq(userBranches.branchId, branch.id)));
  const blocks = await tx
    .select({ branchId: dentistSchedules.branchId, dayOfWeek: dentistSchedules.dayOfWeek, startTime: dentistSchedules.startTime, endTime: dentistSchedules.endTime })
    .from(dentistSchedules)
    .innerJoin(branches, eq(branches.id, dentistSchedules.branchId))
    // A closed branch's old blocks no longer place the dentist anywhere.
    .where(and(eq(dentistSchedules.dentistId, dentist.id), eq(branches.active, true)));
  const names = await tx.select({ id: branches.id, name: branches.name }).from(branches);
  const timeOff = await tx
    .select({ startsAt: dentistTimeOff.startsAt, endsAt: dentistTimeOff.endsAt, reason: dentistTimeOff.reason })
    .from(dentistTimeOff)
    .where(and(eq(dentistTimeOff.dentistId, dentist.id), lt(dentistTimeOff.startsAt, end), gt(dentistTimeOff.endsAt, req.start)));
  const visits = await activeVisits(
    tx,
    req.start,
    chairFreeAt,
    and(
      req.excludeId ? ne(appointments.id, req.excludeId) : undefined,
      or(
        eq(appointments.dentistId, dentist.id),
        and(eq(appointments.branchId, branch.id), eq(appointments.chairNumber, req.chairNumber)),
        eq(appointments.patientId, req.patientId),
      ),
    ),
  );

  return {
    procedures: ordered.map(({ id, name }) => ({ id, name })),
    facts: {
      now,
      walkIn: req.walkIn,
      start: req.start,
      end,
      chairFreeAt,
      branch: { id: branch.id, name: branch.name, active: branch.active, hours: branch.operatingHours },
      chair: chair ? { number: chair.number, active: chair.active } : null,
      dentist: {
        id: dentist.id,
        name: dentist.name,
        active: dentist.status === "active",
        seesPatients: dentist.seesPatients,
        worksHere: dentist.role === "owner" || link.length > 0,
      },
      patientId: req.patientId,
      procedures: ordered.map((p) => ({ name: p.name, active: p.active })),
      blocks: blocks.map((b) => ({ ...b, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) })),
      branchNames: new Map(names.map((n) => [n.id, n.name])),
      timeOff,
      visits,
    },
  };
}
