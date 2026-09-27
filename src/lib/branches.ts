import { LIMITS } from "@/lib/validate";

/**
 * The clinic field of a text about an appointment (booking flow spec 4): the clinic's name for texts, followed by the
 * branch's short name when the clinic has 2 or more active branches, so the patient knows where to go. Every template
 * is sized for a clinic field of at most 20 characters, which branchSmsNameProblem keeps for a pair saved together.
 * A clinic can lengthen its own text name afterwards, so this checks the pair again: past 20 characters, it falls
 * back to the clinic's name alone rather than hand renderSms a pair it would have to clip.
 */
export function smsClinicName(clinicSmsName: string, branchSmsName: string | null | undefined, activeBranches: number): string {
  if (activeBranches < 2 || !branchSmsName) return clinicSmsName;
  const combined = `${clinicSmsName} ${branchSmsName}`;
  return combined.length > LIMITS.clinicSmsName ? clinicSmsName : combined;
}

/** Why a branch's short name for texts cannot be used beside this clinic's name for texts, or null (spec 4). */
export function branchSmsNameProblem(clinicSmsName: string, branchSmsName: string): string | null {
  const room = LIMITS.clinicSmsName - clinicSmsName.trim().length - 1;
  const length = branchSmsName.trim().length;
  if (room < 1) return "Shorten the clinic's name for texts first, so a branch name fits beside it.";
  if (length === 0 || length > room) return `Use 1 to ${room} characters, so the clinic and branch names fit in a text together.`;
  return null;
}
