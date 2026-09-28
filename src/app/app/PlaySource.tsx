"use client";

import { useEffect } from "react";
import { isPlayReferrer, rememberPlaySource } from "@/lib/play-app";

type Props = { packageName?: string };

/**
 * Play Store spec 3.2: remembers `?source=play` (the Play app's start URL) for the rest of this app session.
 * Rendered from the root layout, so signed-out pages (login, signup, onboarding, a join link) see it too, not
 * just the dashboard. Also covers a Trusted Web Activity that opened some other link first, by its
 * android-app:// referrer (item 4): packageName comes from the root layout's own ANDROID_PACKAGE_NAME, server side.
 */
export default function PlaySource({ packageName }: Props) {
  useEffect(() => {
    rememberPlaySource(isPlayReferrer(document.referrer, packageName) ? "?source=play" : window.location.search);
  }, [packageName]);
  return null;
}
