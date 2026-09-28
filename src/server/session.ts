import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { branches, userBranches, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Role, Subject } from "@/lib/permissions";

export type StaffStatus = "pending" | "active" | "disabled";

export type Staff = Subject & {
  name: string;
  username: string;
  title: string | null;
  status: StaffStatus;
  primaryBranchId: string | null;
};

/** A staff member as the guard sees them, read fresh from the database. The owner covers every active branch. */
export async function staffById(id: string): Promise<Staff | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  if (!row) return null;
  const branchIds =
    row.role === "owner"
      ? (await db.select({ id: branches.id }).from(branches).where(eq(branches.active, true))).map((b) => b.id)
      : (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, id))).map(
          (b) => b.id,
        );
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role as Role,
    status: row.status as StaffStatus,
    seesPatients: row.seesPatients,
    title: row.title,
    primaryBranchId: row.primaryBranchId,
    branchIds,
  };
}

/** The signed-in person for these request headers, or null. */
export async function staffFromHeaders(requestHeaders: Headers): Promise<Staff | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  return session ? staffById(session.user.id) : null;
}

/** For pages: the signed-in, approved staff member, or a redirect to where they belong. */
export const requireStaff = cache(async (): Promise<Staff> => {
  const staff = await staffFromHeaders(await headers());
  if (!staff || staff.status === "disabled") redirect("/login");
  if (staff.status === "pending") redirect("/waiting");
  return staff;
});
