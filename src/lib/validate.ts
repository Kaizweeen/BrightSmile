export const RESERVED_SLUGS = new Set([
  "a", "app", "api", "auth", "login", "signup", "onboarding", "forgot",
  "reset-password", "privacy", "terms", "admin", "static", "_next",
]);

export const LIMITS = {
  clinicName: 80,
  clinicSmsName: 20,
  dentistName: 60,
  dentistSmsName: 16,
  personName: 50,
  reason: 36,
  procedureName: 60,
  hmo: 60,
  address: 200,
  mapsUrl: 300,
  timeOffNote: 100,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checked before an id reaches a query, so a bad id reads as "not found" instead of a database error. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Why a booking link can't be used, or null when it can. */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/.test(slug)) {
    return "Use 3 to 24 lowercase letters, numbers, or hyphens, starting and ending with a letter or number.";
  }
  if (RESERVED_SLUGS.has(slug)) return "That link is reserved. Try another.";
  return null;
}

/** A booking link suggestion: "Elite Dental Makati" becomes "elite-dental-makati". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");
}

/** Why a short name for texts can't be used, or null. Semaphore silently drops texts that start with "TEST". */
export function smsNameProblem(name: string, max: number): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > max) return `Use 1 to ${max} characters.`;
  if (/^test/i.test(trimmed)) return 'The SMS provider drops texts that start with "test". Try another name.';
  return null;
}

/** The trimmed text when it fits, "" when optional and empty, otherwise null. */
export function cleanText(value: unknown, max: number, optional = false): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) return optional ? "" : null;
  return trimmed.length <= max ? trimmed : null;
}

/** A "YYYY-MM-DD" birthday between 1900-01-01 and today, "" when empty, otherwise null. */
export function cleanBirthday(value: unknown, today: string): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed === "") return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed >= "1900-01-01" && trimmed <= today ? trimmed : null;
}

/** A trimmed, lowercased email address, or null. */
export function cleanEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Why a password can't be used, or null. 72 is bcrypt's limit, which Supabase Auth uses. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Use at most 72 characters.";
  return null;
}
