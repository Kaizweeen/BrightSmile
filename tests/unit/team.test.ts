import { describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { hashInviteToken, isInviteToken } from "@/lib/team";

describe("join link tokens", () => {
  it("are newToken's 12 letters and digits, nothing else", () => {
    expect(isInviteToken(newToken())).toBe(true);
    for (const bad of ["", "AbCdEfGhIjK", "AbCdEfGhIjKlM", "AbCd-fGhIjKl", "AbCdEfGhIjK ", "ÄbCdEfGhIjKl", 123456789012, null, undefined]) {
      expect(isInviteToken(bad)).toBe(false);
    }
  });

  it("are stored as their SHA-256 in hex, the digest accept_invite computes", () => {
    // Postgres: select encode(sha256(convert_to('AbCdEfGhIjKl', 'UTF8')), 'hex') gives the same digest.
    expect(hashInviteToken("AbCdEfGhIjKl")).toBe("1b0a0a91ec2b4ba3cd4ba12cf7a3ffff12aac9425166be009fb55702f7cb2c10");
  });
});
