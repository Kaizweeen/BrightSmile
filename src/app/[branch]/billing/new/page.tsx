import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { checkoutDraft } from "@/server/billing";
import { ApiError } from "@/server/errors";
import { requireStaff } from "@/server/session";
import { CheckoutScreen } from "./checkout-screen";

export const metadata: Metadata = { title: "Take payment" };

/** Only a missing or forbidden record is a Not Found page; a real failure still surfaces. */
const missing = (error: unknown) => {
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
  throw error;
};

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ branch: string }>; searchParams: Promise<{ appointment?: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const { appointment } = await searchParams;
  const draft = await checkoutDraft(staff, branch, appointment ?? null).catch(missing);
  if (!draft) notFound();
  if (draft.billedId) redirect(`/${branch}/billing/${draft.billedId}`);
  return <CheckoutScreen branch={branch} draft={draft} />;
}
