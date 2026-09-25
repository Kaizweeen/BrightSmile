"use server";

import { refresh } from "next/cache";
import { parseGcashPayment, parseTrialDays } from "@/lib/admin";
import { extendTrial, recordPayment } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { requireOperator } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validate";

export type AdminState = { error?: string; done?: string };

/** Billing spec 7.2: the operator records a GCash payment they saw arrive. Operator only, every field checked here. */
export async function recordGcashPayment(_state: AdminState, form: FormData): Promise<AdminState> {
  const { userId } = await requireOperator();
  const parsed = parseGcashPayment({
    clinicId: form.get("clinicId"),
    months: form.get("months"),
    amount: form.get("amount"),
    reference: form.get("reference"),
  });
  if (!parsed.ok) return { error: parsed.error };
  try {
    await recordPayment({ ...parsed.value, method: "gcash", sessionId: null, recordedBy: userId });
  } catch (e) {
    logError("recordGcashPayment", e);
    return { error: "The payment was not recorded. Try again." };
  }
  refresh();
  return { done: "Payment recorded." };
}

/** Billing spec 7.6: adds days to a clinic's trial, from the later of its end and now. Operator only. */
export async function extendTrialAction(_state: AdminState, form: FormData): Promise<AdminState> {
  await requireOperator();
  const clinicId = form.get("clinicId");
  const days = parseTrialDays(form.get("days"));
  if (!isUuid(clinicId)) return { error: "That clinic no longer exists. Reload the page." };
  if (!days) return { error: "Enter 1 to 365 days." };
  try {
    await extendTrial(clinicId, days);
  } catch (e) {
    logError("extendTrialAction", e);
    return { error: "The trial was not extended. Try again." };
  }
  refresh();
  return { done: "Trial extended." };
}
