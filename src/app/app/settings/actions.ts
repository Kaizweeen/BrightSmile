"use server";

import { refresh } from "next/cache";
import * as settings from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { requireStaff, type Staff } from "@/lib/supabase/server";
import { passwordProblem } from "@/lib/validate";

/** Every settings action: signed-in staff only, untrusted arguments (spec 12), re-render on success. */
async function run(save: (staff: Staff) => Promise<Saved>): Promise<Saved> {
  const staff = await requireStaff();
  const result = await save(staff);
  if (result.ok) refresh();
  return result;
}

const idOrNull = (value: unknown) => (value === null ? null : String(value));

export async function updateProfile(input: unknown): Promise<Saved> {
  return run((staff) => settings.saveProfile(staff, input));
}

export async function updateRules(input: unknown): Promise<Saved> {
  return run((staff) => settings.saveRules(staff, input));
}

export async function saveDentistAction(dentistId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.saveDentist(staff, idOrNull(dentistId), input));
}

export async function setDentistActiveAction(dentistId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setDentistActive(staff, String(dentistId), active === true));
}

export async function addTimeOffAction(dentistId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.addTimeOff(staff, String(dentistId), input, new Date()));
}

export async function removeTimeOffAction(timeOffId: unknown): Promise<Saved> {
  return run((staff) => settings.removeTimeOff(staff, String(timeOffId)));
}

export async function saveProcedureAction(procedureId: unknown, input: unknown): Promise<Saved> {
  return run((staff) => settings.saveProcedure(staff, idOrNull(procedureId), input));
}

export async function setProcedureActiveAction(procedureId: unknown, active: unknown): Promise<Saved> {
  return run((staff) => settings.setProcedureActive(staff, String(procedureId), active === true));
}

/** Spec 5.3 account: the current password is checked first, so an unlocked phone alone can't change it. */
export async function changePassword(current: unknown, next: unknown): Promise<Saved> {
  const staff = await requireStaff();
  const password = typeof next === "string" ? next : "";
  const weak = passwordProblem(password);
  if (weak) return { ok: false, field: "next", error: weak };
  const { data } = await staff.db.auth.getClaims();
  const email = data?.claims?.email;
  if (!email || typeof current !== "string" || current === "") return { ok: false, field: "current", error: "Enter your current password." };
  const { error: wrong } = await staff.db.auth.signInWithPassword({ email, password: current });
  if (wrong) return { ok: false, field: "current", error: "That is not your current password." };
  const { error } = await staff.db.auth.updateUser({ password });
  if (error) {
    return {
      ok: false,
      error: error.code === "same_password" ? "Choose a password you have not used here before." : "Something went wrong. Please try again.",
    };
  }
  return { ok: true };
}
