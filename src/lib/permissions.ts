export type Role = "owner" | "manager" | "dentist";

/** Who is asking: their id, their role, whether they see patients, and the branches they cover. */
export type Subject = { id: string; role: Role; seesPatients: boolean; branchIds: readonly string[] };

export type Action =
  | "calendar.view"
  | "appointment.book"
  | "appointment.manage"
  | "appointment.treat"
  | "patient.view"
  | "patient.edit"
  | "patient.editAlerts"
  | "clinical.read"
  | "clinical.write"
  | "schedule.view"
  | "schedule.edit"
  | "staff.view"
  | "staff.approve"
  | "staff.manage"
  | "settings.edit"
  | "overview.view"
  | "audit.view"
  | "billing.view"
  | "billing.issue"
  | "billing.void"
  | "billing.close";

/** What the action is about: a branch, a dentist's visit or schedule, or a staff member. */
export type Target = {
  branchId?: string;
  branchIds?: readonly string[];
  dentistId?: string | null;
  userId?: string;
  userRole?: Role;
};

/** The owner covers every branch; everyone else covers the branches listed for them. */
export function covers(s: Subject, branchId: string): boolean {
  return s.role === "owner" || s.branchIds.includes(branchId);
}

/** The permission table (spec section 5). Every route and page asks it before touching data. */
export function can(s: Subject, action: Action, t: Target = {}): boolean {
  const owner = s.role === "owner";
  const manager = s.role === "manager";
  const dentist = s.role === "dentist";
  const inBranch = t.branchId !== undefined && covers(s, t.branchId);
  const sharesBranch = (t.branchIds ?? []).some((branchId) => covers(s, branchId));
  const own = t.dentistId != null && t.dentistId === s.id;

  switch (action) {
    case "calendar.view":
      return inBranch || (dentist && own);
    case "appointment.book":
    case "appointment.manage":
      return owner || (manager && inBranch);
    case "appointment.treat":
      return owner || (manager && inBranch) || (dentist && own);
    case "patient.view":
    case "patient.editAlerts":
    case "clinical.read":
      return true;
    case "patient.edit":
      return owner || manager;
    case "clinical.write":
      return owner ? s.seesPatients : dentist && (t.dentistId == null || own);
    case "schedule.view":
      return owner || (manager && sharesBranch) || (dentist && own);
    case "schedule.edit":
      return owner || (manager && sharesBranch);
    case "staff.view":
      return owner || manager;
    case "staff.approve":
      return owner || (manager && inBranch);
    case "staff.manage":
      return t.userId !== s.id && (owner || (manager && t.userRole !== "owner" && sharesBranch));
    case "settings.edit":
    case "audit.view":
      return owner;
    case "overview.view":
      return owner || (manager && s.branchIds.length >= 2);
    case "billing.view":
    case "billing.issue":
    case "billing.void":
    case "billing.close":
      return owner || (manager && inBranch);
  }
}
