import type { Role } from "./permissions";

/** Which icon the navigation draws; the shell (a client component) maps the name to the glyph, so this stays plain data. */
export type NavIcon = "overview" | "calendar" | "my-day" | "patients" | "billing" | "supplies" | "staff" | "settings" | "schedules";

export type NavItem = { href: string; label: string; icon: NavIcon };

/** The main navigation at a branch, or at "all", where the overview replaces the calendar (chairs belong to one branch). */
export function navItems(staff: { role: Role; seesPatients: boolean }, branch: string): NavItem[] {
  const items: NavItem[] = [
    branch === "all" ? { href: "/all", label: "Overview", icon: "overview" } : { href: `/${branch}/calendar`, label: "Calendar", icon: "calendar" },
  ];
  if (staff.seesPatients) items.push({ href: `/${branch}/my-day`, label: "My day", icon: "my-day" });
  items.push({ href: `/${branch}/patients`, label: "Patients", icon: "patients" });
  if (staff.role !== "dentist" && branch !== "all") items.push({ href: `/${branch}/billing`, label: "Billing", icon: "billing" });
  if (branch !== "all") items.push({ href: `/${branch}/supplies`, label: "Supplies", icon: "supplies" });
  if (staff.role !== "dentist") items.push({ href: `/${branch}/staff`, label: "Staff", icon: "staff" });
  const owner = staff.role === "owner";
  items.push({ href: `/${branch}/settings`, label: owner ? "Settings" : "Schedules", icon: owner ? "settings" : "schedules" });
  return items;
}
