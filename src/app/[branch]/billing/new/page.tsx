import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { checkoutDraft } from "@/server/billing";
import { requireStaff } from "@/server/session";
import { CheckoutScreen } from "./checkout-screen";

export const metadata: Metadata = { title: "Take payment" };

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ branch: string }>; searchParams: Promise<{ appointment?: string }> }) {
  const staff = await requireStaff();
  const { branch } = await params;
  const { appointment } = await searchParams;
  const draft = await checkoutDraft(staff, branch, appointment ?? null).catch(() => null);
  if (!draft) notFound();
  if (draft.billedId) redirect(`/${branch}/billing/${draft.billedId}`);
  return <CheckoutScreen branch={branch} draft={draft} />;
}
