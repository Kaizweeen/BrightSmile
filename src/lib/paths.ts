/** The same page at another branch: "/downtown/staff" becomes "/westside/staff". */
export function withBranch(pathname: string, branch: string): string {
  return `/${branch}${pathname.replace(/^\/[^/]+/, "")}`;
}
