"use client";

import { useState, type ReactNode } from "react";
import { inPlayApp } from "@/lib/play-app";

/**
 * Play Store spec 3.2: shows its children in a browser and the fallback (nothing by default) inside the Play app,
 * where prices, payment history, and prompts to pay must not appear. The server renders both; this only picks.
 */
export default function WebOnly({ children, fallback = null }: { children?: ReactNode; fallback?: ReactNode }) {
  const [play] = useState(inPlayApp);
  return <>{play ? fallback : children}</>;
}
