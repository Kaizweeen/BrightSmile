import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, "Use 3 to 30 letters, numbers, dots, or underscores");

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters");

export const personNameSchema = z.string().trim().min(2, "Enter the full name").max(80, "Use at most 80 characters");

export const titleSchema = z.string().trim().min(1, "Enter a title").max(40, "Use at most 40 characters");

export const practiceNameSchema = z.string().trim().min(1, "Enter the practice name").max(80, "Use at most 80 characters");

/** The roles a join request or an approval can give. Only /setup creates the owner. */
export const staffRoleSchema = z.enum(["manager", "dentist"]);

/** A Philippine mobile number in any common form, as +639XXXXXXXXX, or null. */
export function normalizeMobile(input: string): string | null {
  const compact = input.replace(/[\s()-]/g, "");
  const match = /^(?:\+?63|0)?(9\d{9})$/.exec(compact);
  return match ? `+63${match[1]}` : null;
}

export const mobileSchema = z
  .string()
  .refine((value) => normalizeMobile(value) !== null, "Use a Philippine mobile number like 0917 123 4567")
  .transform((value) => normalizeMobile(value) as string);

/**
 * A branch lives at /{code}, so its code may not be "all" (every branch at once) or one of the app's own top-level pages.
 * tests/unit/branch-codes.test.ts keeps this list complete: it fails when a folder is added under src/app without a code here.
 */
export const RESERVED_CODES = new Set(["all", "api", "book", "join", "login", "poster", "reset", "setup", "waiting", "welcome"]);

export const branchCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/, "Use 2 to 24 lowercase letters, numbers, or hyphens")
  .refine((code) => !RESERVED_CODES.has(code), "That code is reserved");
