"use client";

import { type ReactNode } from "react";
import { usePlayApp } from "@/lib/play-app";

/**
 * Play Store spec 3.2: shows its children in a browser and the fallback (nothing by default) inside the Play app,
 * where prices, payment history, and prompts to pay must not appear. Fails closed (usePlayApp): the server and
 * the first client render both show the fallback; a browser switches to the children right after hydration.
 */
export default function WebOnly({ children, fallback = null }: { children?: ReactNode; fallback?: ReactNode }) {
  const play = usePlayApp();
  return <>{play ? fallback : children}</>;
}
