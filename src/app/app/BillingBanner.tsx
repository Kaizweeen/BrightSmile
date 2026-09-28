"use client";

import { useState } from "react";
import { inPlayApp } from "@/lib/play-app";

type Props = { text: string; neutralText: string };

/**
 * Play Store spec 3.2: swaps in the neutral text inside the Play app. The server always computes and sends
 * both (src/lib/billing-data.ts); this only picks which one to show, so browsers never see anything different.
 * ponytail: reads sessionStorage once, at mount. A banner on the very first page of a session could still show
 * the normal text that one time, if PlaySource has not yet stored the flag; every real entry point (the Play
 * app's start URL, every push) opens /app/requests first, so revisit only if that ever stops being true.
 */
export default function BillingBanner({ text, neutralText }: Props) {
  const [play] = useState(inPlayApp);
  return <>{play ? neutralText : text}</>;
}
