import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, type Db } from "@/db";
import { accounts, sessions, users } from "@/db/schema";
import type { Role } from "@/lib/permissions";

/** Better Auth needs an email on every user. Ours are random addresses under the reserved .invalid domain. */
export function placeholderEmail(): string {
  return `${randomUUID()}@users.invalid`;
}

export type NewUser = {
  name: string;
  username: string;
  role: Role;
  status: "pending" | "active" | "disabled";
  seesPatients: boolean;
  title?: string | null;
  requestedBranchId?: string | null;
  primaryBranchId?: string | null;
};

/** Creates a user with a password the way Better Auth's own sign-up would: provider "credential", accountId = user id. */
export async function createCredentialUser(user: NewUser, passwordHash: string, tx: Db = db): Promise<{ id: string }> {
  const [row] = await tx
    .insert(users)
    .values({ ...user, displayUsername: user.username, email: placeholderEmail() })
    .returning({ id: users.id });
  await tx.insert(accounts).values({ userId: row.id, accountId: row.id, providerId: "credential", password: passwordHash });
  return row;
}

/** Replaces a password and signs the person out everywhere. */
export async function setPasswordHash(userId: string, passwordHash: string, tx: Db = db): Promise<void> {
  await tx
    .update(accounts)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
  await endSessions(userId, tx);
}

/** Ends every session of a person; their next request finds none. */
export async function endSessions(userId: string, tx: Db = db): Promise<void> {
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}
