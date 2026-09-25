"use server";

import { refresh } from "next/cache";
import { cancelByPatient } from "@/lib/patient-link";

export async function cancelVisit(token: string): Promise<"cancelled" | "not_allowed" | "not_found" | "unavailable"> {
  try {
    const result = await cancelByPatient(String(token), new Date());
    // Re-render the page so it shows the new status and the Book again link.
    refresh();
    return result;
  } catch (e) {
    console.error("cancelVisit failed:", String((e as { message?: unknown } | null)?.message ?? e));
    return "unavailable";
  }
}
