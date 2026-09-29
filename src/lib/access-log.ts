/** Every action the app writes to the audit log, in words. */
const ACTIONS: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.sign_in_failed": "Failed to sign in",
  "auth.password_changed": "Changed their password",
  "setup.completed": "Set up DentaSync",
  "setup.owner_password_reset": "Reset the owner's password with the setup code",
  "patient.view": "Viewed the record",
  "patient.created": "Added the patient",
  "patient.updated": "Changed the patient's details",
  "chart.added": "Charted a tooth",
  "chart.voided": "Voided a chart entry",
  "exam.saved": "Saved an exam",
  "note.added": "Added a treatment note",
  "appointment.created": "Booked a visit",
  "appointment.requested_online": "Booked a visit online",
  "appointment.moved": "Moved a visit",
  "appointment.status_changed": "Changed a visit's status",
  "staff.join_requested": "Asked to join",
  "staff.approved": "Approved a join request",
  "staff.declined": "Declined a join request",
  "staff.updated": "Changed a staff member",
  "staff.reset_link_created": "Made a password reset QR",
  "staff.password_reset": "Reset their password",
  "branch.created": "Added a branch",
  "branch.updated": "Changed a branch",
  "branch.qr_replaced": "Replaced a branch QR",
  "chair.added": "Added a chair",
  "chair.updated": "Changed a chair",
  "procedure.created": "Added a service",
  "procedure.updated": "Changed a service",
  "practice.renamed": "Renamed the practice",
  "practice.updated": "Changed the practice's settings",
  "schedule.replaced": "Changed a weekly schedule",
  "time_off.added": "Added time off",
  "time_off.removed": "Removed time off",
};

/** An audit row in words, with the part of the record viewed, the fields changed, or the username a failed sign-in tried. */
export function actionText(row: { action: string; details: Record<string, unknown> }): string {
  const base = ACTIONS[row.action] ?? row.action;
  const { part, fields, username } = row.details;
  if (row.action === "patient.view" && typeof part === "string") return `${base} (${part})`;
  if (row.action === "patient.updated" && Array.isArray(fields)) return `${base}: ${fields.join(", ")}`;
  if (row.action === "auth.sign_in_failed" && typeof username === "string") return `${base} as ${username}`;
  return base;
}
