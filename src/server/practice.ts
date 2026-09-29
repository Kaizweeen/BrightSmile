import { z } from "zod";
import { db } from "@/db";
import { practice } from "@/db/schema";
import { practiceNameSchema } from "@/lib/validation";
import { audit } from "./audit";
import { requireCan } from "./guard";
import type { Staff } from "./session";

export const practiceSchema = z.object({ name: practiceNameSchema });

export async function practiceName(): Promise<string> {
  const [row] = await db.select({ name: practice.name }).from(practice);
  return row?.name ?? "DentaSync";
}

export async function renamePractice(actor: Staff, input: z.infer<typeof practiceSchema>): Promise<void> {
  requireCan(actor, "settings.edit");
  await db.transaction(async (tx) => {
    await tx.insert(practice).values({ name: input.name }).onConflictDoUpdate({ target: practice.id, set: { name: input.name } });
    await audit({ userId: actor.id, action: "practice.renamed", entity: "practice", details: { name: input.name } }, tx);
  });
}
