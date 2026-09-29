import type { Role } from "./permissions";

/** How a role reads on screen: managers are the front desk, and dentists show their title. */
export function roleLabel(role: Role, title: string | null): string {
  if (role === "owner") return title ? `Owner, ${title}` : "Owner";
  if (role === "manager") return title ?? "Front desk";
  return title ?? "Dentist";
}
