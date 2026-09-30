import type { Role } from "./permissions";

export type NavItem = { href: string; label: string };

/** The main navigation at a branch, or at "all", where the overview replaces the calendar (chairs belong to one branch). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = [branch === "all" ? { href: "/all", label: "Overview" } : { href: `/${branch}/calendar`, label: "Calendar" }];
  if (staff.seesPatients) items.push({ href: `/${branch}/my-day`, label: "My day" });
  items.push({ href: `/${branch}/patients`, label: "Patients" });
  if (branch !== "all") items.push({ href: `/${branch}/supplies`, label: "Supplies" });
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff" });
  items.push({ href: `/${branch}/settings`, label: staff.role === "owner" ? "Settings" : "Schedules" });
  return items;
}
