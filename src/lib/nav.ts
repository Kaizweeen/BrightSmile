import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch (or "all", which has no calendar: chairs belong to one branch). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = branch === "all" ? [] : [{ href: `/${branch}/calendar`, label: "Calendar" }];
  items.push({ href: `/${branch}/patients`, label: "Patients" });
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
