export type Visitor = { signedIn: boolean; hasClinic: boolean };

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Where the proxy sends a visitor, or null to let the request through. */
export function guardRedirect(path: string, visitor: Visitor): string | null {
  const dashboard = under(path, "/app");
  const onboarding = under(path, "/onboarding");
  const authPage = path === "/login" || path === "/signup";
  if (!visitor.signedIn) return dashboard || onboarding ? "/login" : null;
  if (!visitor.hasClinic) return dashboard || authPage ? "/onboarding" : null;
  return onboarding || authPage ? "/app" : null;
}

/** A same-site path to continue to after an email link, or the fallback. Letters, digits, hyphens, and slashes only. */
export function safeNext(value: string | null, fallback: string): string {
  return value && /^\/(?!\/)[A-Za-z0-9\-/]*$/.test(value) ? value : fallback;
}
