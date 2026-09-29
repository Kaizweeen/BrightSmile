import { and, asc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appointments, chairs, dentistSchedules, dentistTimeOff, procedures, userBranches, users } from "@/db/schema";
import type { WeeklyBlock } from "@/lib/booking-rules";
import { openTimes, type OpenTime } from "@/lib/slots";
import { addDays, manilaInstant } from "@/lib/time";
import { activeVisits } from "./booking";
import { requireBranch } from "./branches";
import { ApiError } from "./errors";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const availabilitySchema = z.object({
  branch: z.string().min(1),
  date: z.iso.date(),
  procedures: z
    .string()
    .min(1)
    .transform((value) => value.split(","))
    .pipe(z.array(z.uuid()).min(1).max(10)),
  dentist: z.uuid().optional(),
  patient: z.uuid().optional(),
});

/** Spec 8.5: the open times at a branch on a day, for a set of procedures (and optionally a dentist and a patient). */
export async function availability(
  actor: Staff,
  q: z.infer<typeof availabilitySchema>,
): Promise<{ date: string; minutes: number; turnover: number; times: OpenTime[] }> {
  const branch = await requireBranch(q.branch);
  requireCan(actor, "appointment.book", { branchId: branch.id });
  const picked = await db
    .select()
    .from(procedures)
    .where(and(inArray(procedures.id, q.procedures), eq(procedures.active, true)));
  if (picked.length !== new Set(q.procedures).size) {
    throw new ApiError(400, "invalid", "Pick procedures that are offered.", { fields: { procedures: "Pick procedures that are offered." } });
  }
  const minutes = picked.reduce((sum, p) => sum + p.durationMinutes, 0);
  const turnover = Math.max(0, ...picked.map((p) => p.bufferMinutes));
  const empty = { date: q.date, minutes, turnover, times: [] };
  // A closed branch takes no bookings (spec 8.3), so it has no open times.
  if (!branch.active) return empty;

  const chairNumbers = (
    await db
      .select({ number: chairs.number })
      .from(chairs)
      .where(and(eq(chairs.branchId, branch.id), eq(chairs.active, true)))
      .orderBy(asc(chairs.number))
  ).map((c) => c.number);
  const links = await db.select({ userId: userBranches.userId }).from(userBranches).where(eq(userBranches.branchId, branch.id));
  const dentists = (
    await db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.seesPatients, true)))
  ).filter((d) => (d.role === "owner" || links.some((l) => l.userId === d.id)) && (!q.dentist || d.id === q.dentist));
  if (chairNumbers.length === 0 || dentists.length === 0) return empty;

  const ids = dentists.map((d) => d.id);
  const dayStart = manilaInstant(q.date, 0);
  const dayEnd = manilaInstant(addDays(q.date, 1), 0);
  const blockRows = await db.select().from(dentistSchedules).where(inArray(dentistSchedules.dentistId, ids));
  const offRows = await db
    .select()
    .from(dentistTimeOff)
    .where(and(inArray(dentistTimeOff.dentistId, ids), lt(dentistTimeOff.startsAt, dayEnd), gt(dentistTimeOff.endsAt, dayStart)));
  const visits = await activeVisits(
    db,
    dayStart,
    dayEnd,
    or(inArray(appointments.dentistId, ids), eq(appointments.branchId, branch.id), q.patient ? eq(appointments.patientId, q.patient) : undefined),
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

  const times = openTimes({
    date: q.date,
    now: new Date(),
    minutes,
    turnover,
    branch: { id: branch.id, hours: branch.operatingHours },
    chairs: chairNumbers,
    dentists: dentists.map(({ id, name }) => ({ id, name })),
    blocks,
    timeOff,
    visits,
    patientId: q.patient,
  });
  return { ...empty, times };
}
