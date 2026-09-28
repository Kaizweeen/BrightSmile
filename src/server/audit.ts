import { db, type Db } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditEntry = {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  branchId?: string | null;
  details?: Record<string, unknown>;
};

/** Records who did what (spec 13). Pass the transaction so the entry commits with the change. Never log health data. */
export async function audit(entry: AuditEntry, tx: Db = db): Promise<void> {
  await tx.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    branchId: entry.branchId ?? null,
    details: entry.details ?? {},
  });
}
