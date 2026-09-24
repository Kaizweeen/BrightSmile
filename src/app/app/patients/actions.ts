"use server";

import { refresh } from "next/cache";
import { deletePatient, searchPatients, updatePatient, type PatientHit } from "@/lib/patients";
import type { Saved } from "@/lib/staff-input";
import { requireStaff } from "@/lib/supabase/server";

/** The New appointment patient finder. Arguments are untrusted (spec 12). */
export async function findPatients(query: unknown): Promise<PatientHit[]> {
  const staff = await requireStaff();
  try {
    return await searchPatients(staff, query);
  } catch (e) {
    console.error("findPatients failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return [];
  }
}

export async function savePatient(id: unknown, input: unknown): Promise<Saved> {
  const staff = await requireStaff();
  const result = await updatePatient(staff, String(id), input, new Date());
  if (result.ok) refresh();
  return result;
}

export async function removePatient(id: unknown): Promise<Saved> {
  const staff = await requireStaff();
  return deletePatient(staff, String(id), new Date());
}
