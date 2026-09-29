import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dentistSchedules, users } from "@/db/schema";
import { STATUSES, type Status } from "@/lib/lifecycle";
import { covers } from "@/lib/permissions";
import { addDays, manilaInstant, weekday } from "@/lib/time";
import { listAppointments, type VisitView } from "./appointments";
import { listBranches } from "./branches";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export type BranchSummary = {
  id: string;
  code: string;
  name: string;
  chairs: number;
  chairsInUse: number;
  counts: Record<Status, number>;
  dentistsOnDuty: string[];
};

/** Spec 10, All branches: each branch's day (visits by status, chairs in use now, dentists on duty) and every visit. */
export async function overview(actor: Staff, date: string): Promise<{ date: string; branches: BranchSummary[]; visits: VisitView[] }> {
  requireCan(actor, "overview.view");
  const branches = (await listBranches()).filter((b) => b.active && covers(actor, b.id));
  const visits = await listAppointments(actor, {
    branch: "all",
    from: manilaInstant(date, 0).toISOString(),
    to: manilaInstant(addDays(date, 1), 0).toISOString(),
  });
  const onDuty = await db
    .select({ branchId: dentistSchedules.branchId, name: users.name })
    .from(dentistSchedules)
    .innerJoin(users, eq(users.id, dentistSchedules.dentistId))
    .where(and(eq(dentistSchedules.dayOfWeek, weekday(date)), eq(users.status, "active"), eq(users.seesPatients, true)));
  const now = Date.now();
  return {
    date,
    visits,
    branches: branches.map((b) => {
      const here = visits.filter((v) => v.branchId === b.id);
      return {
        id: b.id,
        code: b.code,
        name: b.name,
        chairs: b.chairCount,
        chairsInUse: new Set(
          here.filter((v) => v.status === "in_treatment" && v.start.getTime() <= now && now < v.chairFreeAt.getTime()).map((v) => v.chairNumber),
        ).size,
        counts: Object.fromEntries(STATUSES.map((s) => [s, here.filter((v) => v.status === s).length])) as Record<Status, number>,
        dentistsOnDuty: [...new Set(onDuty.filter((d) => d.branchId === b.id).map((d) => d.name))].sort(),
      };
    }),
  };
}
