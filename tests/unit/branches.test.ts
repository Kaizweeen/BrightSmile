import { describe, expect, it } from "vitest";
import { activeBranchesProblem, branchSmsNameProblem, clinicSmsNameProblem, smsClinicName } from "@/lib/branches";
import { renderSms } from "@/lib/sms/templates";

describe("smsClinicName", () => {
  it("is the clinic's name for texts alone while the clinic has one active branch", () => {
    expect(smsClinicName("Bright Dental", "Makati", 1)).toBe("Bright Dental");
  });

  it("adds the branch's short name once the clinic has 2 or more active branches", () => {
    expect(smsClinicName("Bright Dental", "Makati", 2)).toBe("Bright Dental Makati");
    expect(smsClinicName("Bright Dental", null, 3)).toBe("Bright Dental");
  });

  it("is the clinic's name alone, never a clipped pair, once the combined pair would be longer than 20 characters", () => {
    // branchSmsNameProblem keeps a new pair within 20 characters, but a clinic can lengthen its text name after a
    // branch's short name was already saved against the old, shorter one: 15 + 1 + 10 is 26, past the 20 every
    // template is sized for, so this must fall back to the clinic's name alone, not a pair renderSms would clip.
    expect(smsClinicName("C".repeat(15), "B".repeat(10), 2)).toBe("C".repeat(15));
  });
});

describe("branchSmsNameProblem", () => {
  it("allows a short name that keeps the pair within the 20 characters every text has room for", () => {
    // "Bright Dental" is 13 characters, so a space and 6 more make 20.
    expect(branchSmsNameProblem("Bright Dental", "Makati")).toBeNull();
    expect(branchSmsNameProblem("Bright Dental", " Pasig ")).toBeNull();
  });

  it("refuses a short name that would push the pair past 20 characters, or an empty one", () => {
    expect(branchSmsNameProblem("Bright Dental", "Quezon C")).toBe("Use 1 to 6 characters, so the clinic and branch names fit in a text together.");
    expect(branchSmsNameProblem("Bright Dental", "  ")).toBe("Use 1 to 6 characters, so the clinic and branch names fit in a text together.");
    expect(branchSmsNameProblem("Bright Smile Dental", "M")).toBe("Shorten the clinic's name for texts first, so a branch name fits beside it.");
  });

  it("says 1 character, not 1 characters, when only one is left to offer", () => {
    // "C" x 18 leaves room for exactly 1 character beside it.
    expect(branchSmsNameProblem("C".repeat(18), "XY")).toBe("Use 1 character, so the clinic and branch names fit in a text together.");
  });

  it("keeps the confirmation text whole with the longest pair it allows", () => {
    const clinic = smsClinicName("C".repeat(13), "B".repeat(6), 2);
    expect(branchSmsNameProblem("C".repeat(13), "B".repeat(6))).toBeNull();
    expect(clinic).toHaveLength(20);
    const text = renderSms("confirmed", { clinic, first: "Juan", date: "Thu Sep 24", time: "10:00 AM", link: "https://brightsmile.ph/a/Ab12Cd34Ef56" });
    expect(text.startsWith(`${clinic}: Juan's visit`)).toBe(true);
  });
});

describe("activeBranchesProblem", () => {
  it("checks nothing while one branch is active, when texts carry the clinic's name alone", () => {
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main Branch Office" }])).toBeNull();
  });

  it("names the first active branch whose short name does not fit once there are 2", () => {
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main" }, { name: "Pasig", smsName: "Pasig" }])).toBeNull();
    expect(activeBranchesProblem("Bright Dental", [{ name: "Main", smsName: "Main Branch" }, { name: "Pasig", smsName: "Pasig" }])).toBe(
      "Main: Use 1 to 6 characters, so the clinic and branch names fit in a text together.",
    );
  });
});

describe("clinicSmsNameProblem", () => {
  it("leaves the clinic's text name alone while it has one active branch", () => {
    expect(clinicSmsNameProblem("Bright Smile Dental", ["Main"])).toBeNull();
  });

  it("keeps room for the longest active branch short name once there are 2", () => {
    expect(clinicSmsNameProblem("Bright Dental", ["Makati", "Pasig"])).toBeNull();
    expect(clinicSmsNameProblem("Bright Smile Dental", ["Makati", "Pasig"])).toBe(
      "Texts add the branch's short name after this. Use up to 13 characters, or shorten your branches' short names first.",
    );
  });

  it("says 1 character, not 1 characters, when only one is left to offer", () => {
    // "C" x 18 is the longest active branch short name, leaving room for exactly 1 character.
    expect(clinicSmsNameProblem("AB", ["C".repeat(18), "x"])).toBe(
      "Texts add the branch's short name after this. Use up to 1 character, or shorten your branches' short names first.",
    );
  });
});
