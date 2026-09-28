import { hashPassword } from "better-auth/crypto";
import { and, asc, count, eq, gt, inArray, like, lt, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Db } from "@/db";
import { auditLog, branches, dentistSchedules, userBranches, users, verifications } from "@/db/schema";
import { appUrl } from "@/lib/env";
import { can, covers, type Role } from "@/lib/permissions";
import { randomToken, sha256 } from "@/lib/tokens";
import { passwordSchema, personNameSchema, staffRoleSchema, titleSchema, usernameSchema } from "@/lib/validation";
import { createCredentialUser, endSessions, setPasswordHash } from "./accounts";
import { audit } from "./audit";
import { ApiError, forbidden, notFound } from "./errors";
import { requireCan } from "./guard";
import { qrSvg } from "./qr";
import type { Staff } from "./session";

const REQUESTS_PER_IP_PER_HOUR = 5;
const OPEN_REQUESTS_PER_BRANCH = 20;
const RESET_MINUTES = 15;
const RESET_PREFIX = "staff-reset:";
const SEVEN_DAYS_AGO = sql`now() - interval '7 days'`;

/** Spec 6.3: an expired request is deleted the next time a join or approval screen loads. */
function deleteExpiredRequests(tx: Db = db) {
  return tx.delete(users).where(and(eq(users.status, "pending"), lt(users.createdAt, SEVEN_DAYS_AGO)));
}

export const joinSchema = z.object({
  name: personNameSchema,
  username: usernameSchema,
  password: passwordSchema,
  role: staffRoleSchema,
});

export const approveSchema = z.object({
  role: staffRoleSchema,
  branchIds: z.array(z.uuid()).min(1, "Pick at least one branch").max(20),
  title: titleSchema.nullable().optional(),
});

export const updateStaffSchema = z
  .object({
    role: staffRoleSchema.optional(),
    branchIds: z.array(z.uuid()).max(20).optional(),
    title: titleSchema.nullable().optional(),
    seesPatients: z.boolean().optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Nothing to change");

export const resetSchema = z.object({ password: passwordSchema });

/** The branch a join QR belongs to, while the code is current and the branch is open. */
export async function branchForJoinCode(code: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.joinCode, code), eq(branches.active, true)));
  return row ?? null;
}

const usernameTaken = () =>
  new ApiError(409, "username_taken", "That username is taken. Try another.", {
    fields: { username: "That username is taken. Try another." },
  });

/** Spec 6.3: a pending account for the QR's branch. It can sign in, but reaches nothing until someone approves it. */
export async function requestToJoin(code: string, input: z.infer<typeof joinSchema>, ip: string): Promise<{ username: string }> {
  const branch = await branchForJoinCode(code);
  if (!branch) throw new ApiError(404, "qr_replaced", "This QR code no longer works. Ask the owner for the current one.");
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    // One join at a time, so two requests cannot both pass the per-connection and per-branch counts below. Joins are rare.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('dentasync.join'))`);
    await deleteExpiredRequests(tx);
    const [fromIp] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.action, "staff.join_requested"), sql`${auditLog.details}->>'ip' = ${ip}`, gt(auditLog.at, sql`now() - interval '1 hour'`)));
    if (fromIp.n >= REQUESTS_PER_IP_PER_HOUR) {
      throw new ApiError(429, "too_many_requests", "Too many requests from this connection. Try again in an hour.");
    }
    const [open] = await tx
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.status, "pending"), eq(users.requestedBranchId, branch.id)));
    if (open.n >= OPEN_REQUESTS_PER_BRANCH) {
      throw new ApiError(429, "branch_full", "This branch has too many requests waiting. Ask the owner or a manager to approve or decline them first.");
    }
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.username, input.username));
    if (taken) throw usernameTaken();
    const user = await createCredentialUser(
      {
        name: input.name,
        username: input.username,
        role: input.role,
        status: "pending",
        seesPatients: input.role === "dentist",
        requestedBranchId: branch.id,
        primaryBranchId: branch.id,
      },
      passwordHash,
      tx,
    );
    await audit(
      { userId: user.id, action: "staff.join_requested", entity: "user", entityId: user.id, branchId: branch.id, details: { ip, username: input.username, role: input.role } },
      tx,
    );
    return { username: input.username };
  });
}

export type JoinRequestView = {
  id: string;
  name: string;
  username: string;
  role: Role;
  branchId: string;
  branchName: string;
  createdAt: Date;
};

export async function listJoinRequests(actor: Staff): Promise<JoinRequestView[]> {
  requireCan(actor, "staff.view");
  await deleteExpiredRequests();
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, branchId: branches.id, branchName: branches.name, createdAt: users.createdAt })
    .from(users)
    .innerJoin(branches, eq(branches.id, users.requestedBranchId))
    .where(and(eq(users.status, "pending"), gt(users.createdAt, SEVEN_DAYS_AGO)))
    .orderBy(asc(users.createdAt));
  return rows
    .filter((row) => can(actor, "staff.approve", { branchId: row.branchId }))
    .map((row) => ({ ...row, role: row.role as Role }));
}

async function pendingRequest(tx: Db, userId: string) {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "pending"), gt(users.createdAt, SEVEN_DAYS_AGO)))
    .for("update");
  if (!row?.requestedBranchId) throw new ApiError(404, "not_found", "This request no longer exists.");
  return { ...row, requestedBranchId: row.requestedBranchId };
}

/** Spec 6.4: the owner, or a manager of the request's branch, gives the role and branches. */
export async function approveRequest(actor: Staff, userId: string, input: z.infer<typeof approveSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await pendingRequest(tx, userId);
    requireCan(actor, "staff.approve", { branchId: target.requestedBranchId });
    const granted = [...new Set(input.branchIds)];
    if (granted.some((branchId) => !covers(actor, branchId))) throw forbidden("You can only give branches you work at.");
    const open = await tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(inArray(branches.id, granted), eq(branches.active, true)));
    if (open.length !== granted.length) {
      throw new ApiError(400, "invalid", "Pick open branches only.", { fields: { branchIds: "Pick open branches only." } });
    }
    await tx
      .update(users)
      .set({
        status: "active",
        role: input.role,
        title: input.title ?? null,
        seesPatients: input.role === "dentist",
        primaryBranchId: granted.includes(target.requestedBranchId) ? target.requestedBranchId : granted[0],
        approvedBy: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx.insert(userBranches).values(granted.map((branchId) => ({ userId, branchId })));
    await audit(
      { userId: actor.id, action: "staff.approved", entity: "user", entityId: userId, branchId: target.requestedBranchId, details: { role: input.role, branchIds: granted } },
      tx,
    );
  });
}

export async function declineRequest(actor: Staff, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const target = await pendingRequest(tx, userId);
    requireCan(actor, "staff.approve", { branchId: target.requestedBranchId });
    await tx.delete(users).where(eq(users.id, userId));
    await audit(
      { userId: actor.id, action: "staff.declined", entity: "user", entityId: userId, branchId: target.requestedBranchId, details: { username: target.username } },
      tx,
    );
  });
}

export type StaffView = {
  id: string;
  name: string;
  username: string;
  role: Role;
  title: string | null;
  status: "active" | "disabled";
  seesPatients: boolean;
  branchIds: string[];
  canManage: boolean;
};

async function branchesByUser(tx: Db = db): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const link of await tx.select().from(userBranches)) map.set(link.userId, [...(map.get(link.userId) ?? []), link.branchId]);
  return map;
}

/** Approved staff: everyone for the owner; for a manager, themselves and the staff who share a branch with them. */
export async function listStaff(actor: Staff): Promise<StaffView[]> {
  requireCan(actor, "staff.view");
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, role: users.role, title: users.title, status: users.status, seesPatients: users.seesPatients })
    .from(users)
    .where(ne(users.status, "pending"))
    .orderBy(asc(users.name));
  const links = await branchesByUser();
  return rows
    .map((row) => {
      const role = row.role as Role;
      const branchIds = links.get(row.id) ?? [];
      const ownerSelf = row.id === actor.id && role === "owner";
      return {
        ...row,
        role,
        status: row.status as StaffView["status"],
        branchIds,
        canManage: ownerSelf || can(actor, "staff.manage", { userId: row.id, userRole: role, branchIds }),
      };
    })
    .filter((row) => actor.role === "owner" || row.id === actor.id || row.branchIds.some((branchId) => covers(actor, branchId)));
}

/** Spec 6.5. Role, branch, and status changes act on the person's next request; disabling also ends their sessions. */
export async function updateStaff(actor: Staff, userId: string, patch: z.infer<typeof updateStaffSchema>): Promise<void> {
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), ne(users.status, "pending")))
      .for("update");
    if (!target) throw notFound("That person");
    const current = (await tx.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.id);
    const targetRole = target.role as Role;
    if (target.id === actor.id) {
      // Only the owner (settings.edit) edits themselves: their title and whether they see patients, nothing else.
      if (!can(actor, "settings.edit") || patch.role || patch.branchIds || patch.status) throw forbidden("Ask the owner to change your own access.");
    } else {
      requireCan(actor, "staff.manage", { userId, userRole: targetRole, branchIds: current });
    }
    if (patch.seesPatients !== undefined && targetRole !== "owner") {
      throw new ApiError(400, "invalid", "Only the owner's own access to patients can be switched.", {
        fields: { seesPatients: "Only the owner's own access to patients can be switched." },
      });
    }

    const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.seesPatients !== undefined) set.seesPatients = patch.seesPatients;
    if (patch.status) set.status = patch.status;
    if (patch.role) {
      set.role = patch.role;
      set.seesPatients = patch.role === "dentist";
      if (patch.role === "manager") await tx.delete(dentistSchedules).where(eq(dentistSchedules.dentistId, userId));
    }
    if (patch.branchIds) {
      const wanted = [...new Set(patch.branchIds)];
      if (actor.role !== "owner" && wanted.some((branchId) => !current.includes(branchId) && !covers(actor, branchId))) {
        throw forbidden("You can only give branches you work at.");
      }
      // A manager changes only the branches they cover; the person keeps their other branches.
      const next = [
        ...new Set(
          actor.role === "owner"
            ? wanted
            : [...current.filter((branchId) => !covers(actor, branchId)), ...wanted.filter((branchId) => covers(actor, branchId))],
        ),
      ];
      if (next.length === 0) {
        throw new ApiError(400, "invalid", "Keep at least one branch.", { fields: { branchIds: "Keep at least one branch." } });
      }
      const known = await tx.select({ id: branches.id }).from(branches).where(inArray(branches.id, next));
      if (known.length !== next.length) {
        throw new ApiError(400, "invalid", "Pick branches that exist.", { fields: { branchIds: "Pick branches that exist." } });
      }
      await tx.delete(userBranches).where(eq(userBranches.userId, userId));
      await tx.insert(userBranches).values(next.map((branchId) => ({ userId, branchId })));
      await tx.delete(dentistSchedules).where(and(eq(dentistSchedules.dentistId, userId), notInArray(dentistSchedules.branchId, next)));
      if (!target.primaryBranchId || !next.includes(target.primaryBranchId)) set.primaryBranchId = next[0];
    }
    await tx.update(users).set(set).where(eq(users.id, userId));
    if (patch.status === "disabled") await endSessions(userId, tx);
    await audit({ userId: actor.id, action: "staff.updated", entity: "user", entityId: userId, details: patch }, tx);
  });
}

/** Spec 6.6: a one-use link, valid 15 minutes, shown as a QR. Only the token's hash is stored. */
export async function createResetLink(actor: Staff, userId: string): Promise<{ url: string; expiresAt: Date; qrSvg: string }> {
  const [target] = await db.select().from(users).where(and(eq(users.id, userId), ne(users.status, "pending")));
  if (!target) throw notFound("That person");
  const current = (await db.select({ id: userBranches.branchId }).from(userBranches).where(eq(userBranches.userId, userId))).map((row) => row.id);
  requireCan(actor, "staff.manage", { userId, userRole: target.role as Role, branchIds: current });
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
  await db.transaction(async (tx) => {
    await tx.delete(verifications).where(and(like(verifications.identifier, `${RESET_PREFIX}%`), eq(verifications.value, userId)));
    await tx.insert(verifications).values({ identifier: `${RESET_PREFIX}${sha256(token)}`, value: userId, expiresAt });
    await audit({ userId: actor.id, action: "staff.reset_link_created", entity: "user", entityId: userId }, tx);
  });
  const url = `${appUrl()}/reset/${token}`;
  return { url, expiresAt, qrSvg: await qrSvg(url) };
}

export async function resetWithToken(token: string, input: z.infer<typeof resetSchema>): Promise<{ username: string }> {
  const passwordHash = await hashPassword(input.password);
  const expired = () =>
    new ApiError(404, "link_expired", "This reset link has expired or was already used. Ask your manager for a new one.");
  return db.transaction(async (tx) => {
    const [link] = await tx
      .delete(verifications)
      .where(and(eq(verifications.identifier, `${RESET_PREFIX}${sha256(token)}`), gt(verifications.expiresAt, new Date())))
      .returning();
    if (!link) throw expired();
    const [user] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.id, link.value), eq(users.status, "active")));
    if (!user) throw expired();
    await setPasswordHash(user.id, passwordHash, tx);
    await audit({ userId: user.id, action: "staff.password_reset", entity: "user", entityId: user.id }, tx);
    return { username: user.username };
  });
}
