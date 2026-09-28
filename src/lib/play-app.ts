import { useSyncExternalStore } from "react";

const KEY = "bs_source";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** sessionStorage, or null when it does not exist (the server) or throws just to access (a locked-down WebView). */
function playStore(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The current URL's search string, or null when there is none (the server). Guarded exactly like playStore. */
function currentSearch(): string | null {
  try {
    return typeof location === "undefined" ? null : location.search;
  } catch {
    return null;
  }
}

/**
 * Play Store spec 3.2: called once from the root layout's PlaySource. Remembers `?source=play` (the Play
 * app's start URL) in sessionStorage for the rest of this browser tab's session; a cookie would hide payments
 * in the phone's Chrome too, since the Trusted Web Activity shares cookies with it.
 */
export function rememberPlaySource(search: string, into: Store | null = playStore()): void {
  if (new URLSearchParams(search).get("source") !== "play") return;
  try {
    into?.setItem(KEY, "play");
  } catch {
    // No storage available (private browsing): the Play app just shows the normal, priced dashboard.
  }
}

/**
 * True once this browser tab has seen `?source=play` (spec 3.2): either right now, in the current URL, so a
 * component rendering on the very first, launch page already knows, before PlaySource's effect has stored
 * anything yet, or earlier this session, in sessionStorage. Safe when location or sessionStorage is missing or throws.
 */
export function inPlayApp(from: Store | null = playStore(), search: string | null = currentSearch()): boolean {
  try {
    if (search !== null && new URLSearchParams(search).get("source") === "play") return true;
    return from?.getItem(KEY) === "play";
  } catch {
    return false;
  }
}

/**
 * Play Store spec 3.2 item 4: true when a Trusted Web Activity's referrer names exactly this app's package, so
 * PlaySource can remember the flag even when the TWA opened some other link first. Other Android apps also send
 * `android-app://` referrers, so this must match in full, and it does nothing when the package name is unset.
 */
export function isPlayReferrer(referrer: string, packageName: string | undefined): boolean {
  return Boolean(packageName) && referrer === `android-app://${packageName}/`;
}

const subscribeNoop = () => () => {};

/**
 * Play Store spec 3.2: fails closed. The server has no session or URL to read, so it always renders the
 * Play-safe answer (the third argument), and React reuses that same answer for the first client render too, so
 * hydration never mismatches. Right after hydration, React re-reads the real client answer (inPlayApp) and, in
 * a browser, switches to the full version; inside the Play app nothing visibly changes.
 */
export function usePlayApp(): boolean {
  return useSyncExternalStore(subscribeNoop, inPlayApp, () => true);
}
