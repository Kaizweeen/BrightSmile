"use client";

import { useEffect } from "react";
import { rememberPlaySource } from "@/lib/play-app";

/** Play Store spec 3.2: remembers `?source=play` (the Play app's start URL) for the rest of this app session. */
export default function PlaySource() {
  useEffect(() => rememberPlaySource(window.location.search), []);
  return null;
}
