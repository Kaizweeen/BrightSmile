"use server";

import { redirect } from "next/navigation";
import { appUrl } from "@/lib/app-url";
import { amountCentavos, parseMonths, tierFor } from "@/lib/billing";
import { activeDentists } from "@/lib/billing-data";
import { logError } from "@/lib/log";
import { createCheckout, paymongoKeys } from "@/lib/paymongo";
import { requireStaff } from "@/lib/supabase/server";

export type PayState = { error?: string };

const UNAVAILABLE = "Online payment is not available right now. You can pay by GCash.";

/**
 * Billing spec 7.3: opens PayMongo checkout for the chosen months. The amount comes from the clinic's active
 * dentists, read here on the server, never from the form. redirect stays outside any try block.
 */
export async function payOnline(_state: PayState, form: FormData): Promise<PayState> {
  const staff = await requireStaff();
  const months = parseMonths(form.get("months"));
  if (!months) return { error: "Choose how many months to pay for." };
  const keys = paymongoKeys();
  if (!keys) return { error: UNAVAILABLE };
  let dentists: number;
  let slug: string;
  try {
    const [count, clinic] = await Promise.all([
      activeDentists(staff.db, staff.clinicId),
      staff.db.from("clinics").select("slug").eq("id", staff.clinicId).single().throwOnError(),
    ]);
    dentists = count;
    slug = (clinic.data as { slug: string }).slug;
  } catch (e) {
    logError("payOnline", e);
    return { error: UNAVAILABLE };
  }
  const checkoutUrl = await createCheckout(
    {
      clinicId: staff.clinicId,
      slug,
      tier: tierFor(dentists).name,
      months,
      amountCentavos: amountCentavos(dentists, months),
      appUrl: appUrl(),
    },
    keys.secretKey,
  );
  if (!checkoutUrl) return { error: UNAVAILABLE };
  redirect(checkoutUrl);
}
