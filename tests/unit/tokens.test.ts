import { describe, expect, it } from "vitest";
import { randomToken, sameSecret, sha256 } from "@/lib/tokens";

describe("tokens", () => {
  it("makes URL-safe tokens of the right length", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(24)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });

  it("hashes and compares secrets", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sameSecret("a-secret-value", "a-secret-value")).toBe(true);
    expect(sameSecret("a-secret-value", "another")).toBe(false);
  });
});
