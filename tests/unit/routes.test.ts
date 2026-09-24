import { describe, expect, it } from "vitest";
import { guardRedirect, safeNext } from "@/lib/routes";

const out = { signedIn: false, hasClinic: false };
const noClinic = { signedIn: true, hasClinic: false };
const staff = { signedIn: true, hasClinic: true };

describe("guardRedirect", () => {
  it("sends signed-out visitors from the dashboard and onboarding to log in", () => {
    expect(guardRedirect("/app", out)).toBe("/login");
    expect(guardRedirect("/app/requests", out)).toBe("/login");
    expect(guardRedirect("/onboarding", out)).toBe("/login");
    expect(guardRedirect("/login", out)).toBeNull();
    expect(guardRedirect("/signup", out)).toBeNull();
  });

  it("does not mistake /apple-icon.png for the dashboard", () => {
    expect(guardRedirect("/apple-icon.png", out)).toBeNull();
  });

  it("sends signed-in users without a clinic to onboarding", () => {
    expect(guardRedirect("/app", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/login", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/signup", noClinic)).toBe("/onboarding");
    expect(guardRedirect("/onboarding", noClinic)).toBeNull();
  });

  it("sends staff with a clinic to the dashboard", () => {
    expect(guardRedirect("/onboarding", staff)).toBe("/app");
    expect(guardRedirect("/login", staff)).toBe("/app");
    expect(guardRedirect("/app", staff)).toBeNull();
    expect(guardRedirect("/app/schedule", staff)).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/onboarding", "/app")).toBe("/onboarding");
    expect(safeNext("/reset-password", "/app")).toBe("/reset-password");
  });

  it("falls back for anything that could leave the site", () => {
    expect(safeNext(null, "/app")).toBe("/app");
    expect(safeNext("", "/app")).toBe("/app");
    expect(safeNext("//evil.example", "/app")).toBe("/app");
    expect(safeNext("https://evil.example", "/app")).toBe("/app");
    expect(safeNext("/\\evil.example", "/app")).toBe("/app");
    expect(safeNext("/app?x=1", "/app")).toBe("/app");
  });
});
