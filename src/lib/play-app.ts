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

/**
 * Play Store spec 3.2: called once from the dashboard layout's PlaySource. Remembers `?source=play` (the Play
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

/** True once this browser tab has seen `?source=play` (spec 3.2). Safe when sessionStorage is missing or throws. */
export function inPlayApp(from: Store | null = playStore()): boolean {
  try {
    return from?.getItem(KEY) === "play";
  } catch {
    return false;
  }
}
