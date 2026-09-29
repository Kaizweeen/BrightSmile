import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import type { Staff } from "./session";

/** Where each person lands after signing in (spec 10): the owner at All branches, a dentist at My day, the front desk at the calendar. */
export async function homePath(staff: Staff): Promise<string> {
  if (staff.role === "owner") return "/all";
  // Their main branch, unless it is closed; then their first open one.
  const branchId = staff.branchIds.find((id) => id === staff.primaryBranchId) ?? staff.branchIds[0];
  const [branch] = branchId
    ? await db.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId))
    : [];
  if (!branch) throw new Error("This account has no branch. Ask the owner to give it one.");
  return staff.role === "dentist" ? `/${branch.code}/my-day` : `/${branch.code}/calendar`;
}
