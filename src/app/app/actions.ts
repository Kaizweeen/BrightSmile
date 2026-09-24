"use server";

import { refresh } from "next/cache";
import { changeStatus, type ActionResult, type StaffTarget } from "@/lib/appointment-actions";
import { requireStaff } from "@/lib/supabase/server";

export type Done = { ok: true; notice?: string } | { ok: false; error: string };

const TARGETS: StaffTarget[] = ["confirmed", "declined", "cancelled", "completed", "no_show"];

/** Spec 13: a failed text never fails the action, but staff are told so they can call. */
function done(r: ActionResult): Done {
  if (!r.ok) return r;
  return r.text === "failed" ? { ok: true, notice: "Saved. The text was not delivered. Please call the patient." } : { ok: true };
}

/** Approve, decline, cancel, completed, or no-show. Arguments are untrusted (spec 12). */
export async function setStatus(id: unknown, to: unknown, reason: unknown): Promise<Done> {
  const staff = await requireStaff();
  if (!TARGETS.includes(to as StaffTarget)) return { ok: false, error: "That change isn't possible for this appointment." };
  const result = await changeStatus(staff, String(id), to as StaffTarget, typeof reason === "string" ? reason : "", new Date());
  if (result.ok) refresh();
  return done(result);
}
