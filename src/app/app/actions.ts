"use server";

import { refresh } from "next/cache";
import { changeStatus, createAppointment, moveAppointment, type ActionResult, type StaffTarget } from "@/lib/appointment-actions";
import { staffOpenStarts } from "@/lib/dashboard";
import { parseDay } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validate";

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

// 20 procedures of up to 480 minutes each.
const MAX_DURATION = 20 * 480;

/** Open start times (ISO) for New and Move. The duration only shapes the list; saving recomputes it. */
export async function openTimes(q: unknown): Promise<string[]> {
  const staff = await requireStaff();
  const v = (typeof q === "object" && q !== null ? q : {}) as Record<string, unknown>;
  const duration = Number(v.duration);
  if (!isUuid(v.dentistId) || typeof v.date !== "string" || parseDay(v.date, "") !== v.date) return [];
  if (!Number.isInteger(duration) || duration < 5 || duration > MAX_DURATION) return [];
  const ignoreId = isUuid(v.ignoreId) ? v.ignoreId : undefined;
  try {
    const starts = await staffOpenStarts(staff, { dentistId: v.dentistId, date: v.date, duration, ignoreId }, new Date());
    return starts.map((s) => s.toISOString());
  } catch (e) {
    console.error("openTimes failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return [];
  }
}

/** Spec 5.3 New appointment. */
export async function createVisit(input: unknown): Promise<Done> {
  const staff = await requireStaff();
  const result = await createAppointment(staff, input, new Date());
  if (result.ok) refresh();
  return done(result);
}

/** Spec 9.2 moved. */
export async function moveVisit(id: unknown, slot: unknown): Promise<Done> {
  const staff = await requireStaff();
  const result = await moveAppointment(staff, String(id), slot, new Date());
  if (result.ok) refresh();
  return done(result);
}
