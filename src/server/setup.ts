import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { practice, users } from "@/db/schema";
import { sameSecret } from "@/lib/tokens";
import { passwordSchema, personNameSchema, practiceNameSchema, usernameSchema } from "@/lib/validation";
import { createCredentialUser, setPasswordHash } from "./accounts";
import { audit } from "./audit";
import { ApiError } from "./errors";

export const setupSchema = z.object({
  setupCode: z.string().min(1, "Enter the setup code"),
  practiceName: practiceNameSchema,
  name: personNameSchema,
  username: usernameSchema,
  password: passwordSchema,
});

export const recoverSchema = z.object({
  setupCode: z.string().min(1, "Enter the setup code"),
  password: passwordSchema,
});

export async function ownerExists(): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1);
  return row !== undefined;
}

function checkSetupCode(code: string): void {
  const expected = process.env.SETUP_TOKEN;
  if (!expected || !sameSecret(code, expected)) {
    throw new ApiError(403, "bad_setup_code", "That setup code is not right.", {
      fields: { setupCode: "That setup code is not right." },
    });
  }
}

/** First run (spec 6.1): creates the practice and its owner, once. */
export async function createOwner(input: z.infer<typeof setupSchema>): Promise<{ username: string }> {
  checkSetupCode(input.setupCode);
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1);
    if (existing) throw new ApiError(409, "already_set_up", "DentaSync is already set up. Sign in instead.");
    await tx
      .insert(practice)
      .values({ name: input.practiceName })
      .onConflictDoUpdate({ target: practice.id, set: { name: input.practiceName } });
    const owner = await createCredentialUser(
      { name: input.name, username: input.username, role: "owner", status: "active", seesPatients: false },
      passwordHash,
      tx,
    );
    await audit({ userId: owner.id, action: "setup.completed", entity: "user", entityId: owner.id }, tx);
  });
  return { username: input.username };
}

/** The owner's own password reset with the setup code (spec 6.6). Ends the owner's sessions. */
export async function recoverOwner(input: z.infer<typeof recoverSchema>): Promise<{ username: string }> {
  checkSetupCode(input.setupCode);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.role, "owner"));
    if (!owner) throw new ApiError(404, "not_set_up", "DentaSync is not set up yet. Open /setup first.");
    await setPasswordHash(owner.id, passwordHash, tx);
    await audit({ userId: owner.id, action: "setup.owner_password_reset", entity: "user", entityId: owner.id }, tx);
    return { username: owner.username };
  });
}
