import { and, asc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { appointments, chairs, dentistSchedules, dentistTimeOff, type OperatingHours, userBranches, users } from "@/db/schema";
import type { WeeklyBlock } from "@/lib/booking-rules";
import { openTimes, type OpenTime } from "@/lib/slots";
import { addDays, manilaInstant } from "@/lib/time";
import { activeVisits } from "./booking";
import { requireBranch } from "./branches";
import { requireCan } from "./guard";
import { practiceSettings } from "./practice";
import type { Staff } from "./session";

export const availabilitySchema = z.object({
  branch: z.string().min(1),
  date: z.iso.date(),
  minutes: z.coerce.number().int().min(15).max(480).multipleOf(15).optional(),
  dentist: z.uuid().optional(),
  patient: z.uuid().optional(),
});

export type OpenTimesQuery = {
  branch: { id: string; active: boolean; operatingHours: OperatingHours };
  date: string;
  minutes: number;
  turnover: number;
  /** Starts before this are left out: now for staff, two hours from now online. */
  notBefore: Date;
  /** Only these dentists; every dentist who works at the branch when missing. */
  dentistIds?: readonly string[] | null;
  patientId?: string;
};

/** Spec 8.5 with the online booking spec's 6.3: the open times for a visit of `minutes` plus `turnover` at a branch on a day. */
export async function findOpenTimes(q: OpenTimesQuery, tx: Db = db): Promise<OpenTime[]> {
  // A closed branch takes no bookings (spec 8.3), so it has no open times.
  if (!q.branch.active) return [];
  const chairNumbers = (
    await tx
      .select({ number: chairs.number })
      .from(chairs)
      .where(and(eq(chairs.branchId, q.branch.id), eq(chairs.active, true)))
      .orderBy(asc(chairs.number))
  ).map((c) => c.number);
  const links = await tx.select({ userId: userBranches.userId }).from(userBranches).where(eq(userBranches.branchId, q.branch.id));
  const dentists = (
    await tx
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
  ).filter((d) => (d.role === "owner" || links.some((l) => l.userId === d.id)) && (!q.dentistIds || q.dentistIds.includes(d.id)));
  if (chairNumbers.length === 0 || dentists.length === 0) return [];

  const ids = dentists.map((d) => d.id);
  const dayStart = manilaInstant(q.date, 0);
  const dayEnd = manilaInstant(addDays(q.date, 1), 0);
  const blockRows = await tx.select().from(dentistSchedules).where(inArray(dentistSchedules.dentistId, ids));
  const offRows = await tx
    .select()
    .from(dentistTimeOff)
    .where(and(inArray(dentistTimeOff.dentistId, ids), lt(dentistTimeOff.startsAt, dayEnd), gt(dentistTimeOff.endsAt, dayStart)));
  const visits = await activeVisits(
    tx,
    dayStart,
    dayEnd,
    or(inArray(appointments.dentistId, ids), eq(appointments.branchId, q.branch.id), q.patientId ? eq(appointments.patientId, q.patientId) : undefined),
  );

  const blocks = new Map<string, WeeklyBlock[]>();
  for (const b of blockRows) {
    blocks.set(b.dentistId, [
      ...(blocks.get(b.dentistId) ?? []),
      { branchId: b.branchId, dayOfWeek: b.dayOfWeek, startTime: b.startTime.slice(0, 5), endTime: b.endTime.slice(0, 5) },
    ]);
  }
  const timeOff = new Map<string, { startsAt: Date; endsAt: Date }[]>();
  for (const t of offRows) timeOff.set(t.dentistId, [...(timeOff.get(t.dentistId) ?? []), { startsAt: t.startsAt, endsAt: t.endsAt }]);

  return openTimes({
    date: q.date,
    now: q.notBefore,
    minutes: q.minutes,
    turnover: q.turnover,
    branch: { id: q.branch.id, hours: q.branch.operatingHours },
    chairs: chairNumbers,
    dentists: dentists.map(({ id, name }) => ({ id, name })),
    blocks,
    timeOff,
    visits,
    patientId: q.patientId,
  });
}

/** GET /availability: open times for staff, for a visit of `minutes` (the practice's standard length when missing). */
export async function availability(
  actor: Staff,
  q: z.infer<typeof availabilitySchema>,
): Promise<{ date: string; minutes: number; turnover: number; times: OpenTime[] }> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const settings = await practiceSettings();
  const minutes = q.minutes ?? settings.visitMinutes;
  const turnover = settings.cleaningMinutes;
  const times = await findOpenTimes({ branch, date: q.date, minutes, turnover, notBefore: new Date(), dentistIds: q.dentist ? [q.dentist] : null, patientId: q.patient });
  return { date: q.date, minutes, turnover, times };
}
