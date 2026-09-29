import { can, type Action, type Subject, type Target } from "@/lib/permissions";
import { forbidden } from "./errors";

/** Throws 403 unless the permission table allows the action. */
export function requireCan(s: Subject, action: Action, target?: Target): void {
  if (!can(s, action, target)) throw forbidden();
}
