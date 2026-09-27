import { describe, expect, it } from "vitest";
import { newToken } from "@/lib/codes";
import { hashInviteToken, isInviteToken, joinRefusal, joinView } from "@/lib/team";

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

describe("joinView", () => {
  it("says the link no longer works, whoever opens it", () => {
    for (const visitor of [null, { hasClinic: false }, { hasClinic: true }]) expect(joinView(null, visitor)).toBe("gone");
  });

  it("asks visitors to sign up or log in, lets an account without a clinic join, and stops one that has a clinic", () => {
    expect(joinView("Bright Dental", null)).toBe("signed_out");
    expect(joinView("Bright Dental", { hasClinic: false })).toBe("join");
    expect(joinView("Bright Dental", { hasClinic: true })).toBe("member");
  });
});

describe("joinRefusal", () => {
  it("maps accept_invite's refusals to the join page's words, and nothing else", () => {
    for (const code of ["BSUNK", "BSREV", "BSUSD", "BSEXP"]) expect(joinRefusal(code)).toBe("gone");
    expect(joinRefusal("23505")).toBe("member");
    for (const code of [undefined, "42501", "PGRST301", "08006"]) expect(joinRefusal(code)).toBeNull();
  });
});
