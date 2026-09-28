import type { Block, BookingRules } from "@/lib/slots";

export type PublicDentist = { id: string; name: string; smsName: string; hours: Block[][] };
export type PublicProcedure = { id: string; name: string; minutes: number };

/** A branch as patients see it (booking flow spec 4): where to go. */
export type PublicBranch = { id: string; name: string; address: string; mapsUrl: string | null };

/**
 * Everything the public booking page receives (spec 6): no patients and no busy intervals. It is loaded for one
 * branch (booking flow spec 4): the dentists and their hours are that branch's; branches lists every active one.
 */
export type PublicClinic = {
  id: string;
  slug: string;
  name: string;
  smsName: string;
  mobile: string;
  address: string;
  mapsUrl: string | null;
  rules: BookingRules;
  branch: PublicBranch;
  branches: PublicBranch[];
  dentists: PublicDentist[];
  procedures: PublicProcedure[];
};


export type ResolvedSelection = { dentist: PublicDentist; procedures: PublicProcedure[]; duration: number };

/** Common HMO providers, offered as suggestions on the patient form (spec 5.1, booking flow spec 6). */
export const HMO_SUGGESTIONS = [
  "Maxicare",
  "Intellicare",
  "MediCard",
  "PhilCare",
  "Cocolife",
  "Avega",
  "ValuCare",
  "Insular Health Care",
  "EastWest Healthcare",
  "Kaiser",
];

// appointments.procedure_names holds 1 to 20 names.
const MAX_PROCEDURES = 20;

/** The dentist and procedures the client picked, checked against the clinic, or null. */
export function resolveSelection(clinic: PublicClinic, value: unknown): ResolvedSelection | null {
  if (typeof value !== "object" || value === null) return null;
  const { dentistId, procedureIds } = value as Record<string, unknown>;
  const dentist = clinic.dentists.find((d) => d.id === dentistId);
  if (!dentist || !Array.isArray(procedureIds) || procedureIds.length === 0 || procedureIds.length > MAX_PROCEDURES) return null;
  const ids = new Set(procedureIds);
  const procedures = clinic.procedures.filter((p) => ids.has(p.id));
  if (ids.size !== procedureIds.length || procedures.length !== ids.size) return null;
  return { dentist, procedures, duration: procedures.reduce((sum, p) => sum + p.minutes, 0) };
}
