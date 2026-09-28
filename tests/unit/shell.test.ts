import { describe, expect, it } from "vitest";
import { roleLabel } from "@/lib/labels";
import { navItems } from "@/lib/nav";
import { withBranch } from "@/lib/paths";
import { contentSecurityPolicy } from "@/lib/security";

describe("content security policy", () => {
  it("allows only scripts with this request's nonce", () => {
    const csp = contentSecurityPolicy("abc123", { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("adds eval only for the development server and skips the https upgrade on plain http", () => {
    const csp = contentSecurityPolicy("n", { dev: true, https: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});

describe("shell helpers", () => {
  it("labels roles", () => {
    expect(roleLabel("owner", null)).toBe("Owner");
    expect(roleLabel("owner", "Dentist")).toBe("Owner, Dentist");
    expect(roleLabel("manager", null)).toBe("Front desk");
    expect(roleLabel("dentist", "Orthodontist")).toBe("Orthodontist");
    expect(roleLabel("dentist", null)).toBe("Dentist");
  });

  it("builds the navigation for each role", () => {
    expect(navItems({ role: "owner", seesPatients: false }, "all").map((i) => i.label)).toEqual(["Patients", "Staff", "Settings"]);
    expect(navItems({ role: "manager", seesPatients: false }, "downtown").map((i) => i.href)).toEqual([
      "/downtown/patients",
      "/downtown/staff",
      "/downtown/settings",
    ]);
    expect(navItems({ role: "dentist", seesPatients: true }, "downtown").map((i) => i.label)).toEqual(["Patients", "Schedules"]);
  });

  it("keeps the page when switching branch", () => {
    expect(withBranch("/downtown/staff", "westside")).toBe("/westside/staff");
    expect(withBranch("/all/settings", "downtown")).toBe("/downtown/settings");
    expect(withBranch("/downtown", "all")).toBe("/all");
  });
});
