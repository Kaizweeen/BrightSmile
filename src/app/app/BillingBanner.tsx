"use client";

import { usePlayApp } from "@/lib/play-app";

type Props = { text: string; neutralText: string };

/**
 * Play Store spec 3.2: swaps in the neutral text inside the Play app. The server always computes and sends
 * both (src/lib/billing-data.ts); this only picks which one to show, so browsers never see anything different.
 * Fails closed (usePlayApp): the server and the first client render both show the neutral text, and a browser
 * switches to the full text right after hydration, with no mismatch warning.
 */
export default function BillingBanner({ text, neutralText }: Props) {
  const play = usePlayApp();
  return <>{play ? neutralText : text}</>;
}
