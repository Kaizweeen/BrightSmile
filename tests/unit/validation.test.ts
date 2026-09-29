import { describe, expect, it } from "vitest";
import { mobileSchema, normalizeMobile, passwordSchema, usernameSchema } from "@/lib/validation";

describe("field rules", () => {
  it("normalizes usernames", () => {
    expect(usernameSchema.parse("  Ana.Cruz ")).toBe("ana.cruz");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("ana cruz").success).toBe(false);
  });

  it("needs 10 to 128 password characters", () => {
    expect(passwordSchema.safeParse("123456789").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("normalizes Philippine mobiles", () => {
    for (const input of ["09171234567", "0917 123 4567", "+63 917 123 4567", "639171234567", "9171234567"]) {
      expect(normalizeMobile(input)).toBe("+639171234567");
    }
    expect(normalizeMobile("0817 123 4567")).toBeNull();
    expect(normalizeMobile("12345")).toBeNull();
    expect(mobileSchema.parse("0917-123-4567")).toBe("+639171234567");
    expect(mobileSchema.safeParse("12345").success).toBe(false);
  });
});
