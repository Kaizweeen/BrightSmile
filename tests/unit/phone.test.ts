import { describe, expect, it } from "vitest";
import { localMobile, normalizeMobile } from "@/lib/phone";

describe("normalizeMobile", () => {
  it.each([
    "09171234567",
    "9171234567",
    "639171234567",
    "+639171234567",
    "0917 123 4567",
    "0917-123-4567",
    "+63 (917) 123 4567",
  ])("accepts %s", (input) => {
    expect(normalizeMobile(input)).toBe("+639171234567");
  });

  it.each(["(02) 8123 4567", "0281234567", "+14155552671", "091712345", "091712345678", "+6391712345678", "abc", ""])(
    "rejects %s",
    (input) => {
      expect(normalizeMobile(input)).toBeNull();
    },
  );

  it("formats for people and for Semaphore", () => {
    expect(localMobile("+639171234567")).toBe("09171234567");
  });
});
