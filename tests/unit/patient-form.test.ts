import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PatientForm from "@/app/[slug]/PatientForm";
import { parseIntakeForm, type IntakeForm } from "@/lib/intake";

// The form renders without a browser: what a patient sees first, for a new form and for one filled earlier.
const today = "2026-09-28";
const base = { last: "Cruz", first: "Ana", birthday: "1990-05-17", sex: "female", address: "Makati", agree: true, signature: "Ana Cruz" };

function filled(extra: Record<string, unknown>): IntakeForm {
  const parsed = parseIntakeForm({ ...base, ...extra }, today);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.form;
}

function render(initial: IntakeForm | null): string {
  const props = { clinicName: "Bright Dental", mobile: "+639171112222", today, initial, onDone: () => {}, onBack: () => {} };
  return renderToStaticMarkup(createElement(PatientForm, props));
}

const marks = (html: string) => html.split(">Required<").length - 1;

describe("the new patient form", () => {
  it("marks the required fields in words, shows the verified number read only, and names the clinic in the waiver", () => {
    const html = render(null);
    // Last name, first name, birthday, sex, home address, and the signature.
    expect(marks(html)).toBe(6);
    expect(html).toContain('readOnly="" value="09171112222"');
    expect(html).toContain("I allow the dentists of Bright Dental to examine me");
    expect(html).toContain("I have read and agree");
    for (const section of ["Patient", "Parent or guardian", "HMO or dental insurance", "Dental history", "Medical history", "Emergency contact", "Waiver and consent"]) {
      expect(html).toContain(`>${section}</h3>`);
    }
  });

  it("never labels two fields Mobile number, so a screen reader tells the patient's own number from the emergency contact's", () => {
    const html = render(null);
    expect(html.match(/>Mobile number</g)).toHaveLength(1);
    expect(html).toContain(">Emergency contact&#x27;s mobile number<");
  });

  it("asks the women's questions only when the patient is female", () => {
    expect(render(filled({}))).toContain("Are you pregnant?");
    expect(render(filled({ sex: "male" }))).not.toContain("Are you pregnant?");
    expect(render(null)).not.toContain("Are you pregnant?");
  });

  it("needs a parent or guardian while the patient is under 18 today", () => {
    expect(marks(render(filled({ birthday: "2015-01-01", guardian: "Ben Cruz" })))).toBe(7);
    expect(marks(render(filled({ birthday: "2008-09-28" })))).toBe(6);
  });

  it("opens a detail box beside a Yes and an Other tick", () => {
    const html = render(filled({ medical: { takingMedicine: true, medicineDetail: "Losartan", allergies: ["other"], allergyOther: "Shrimp" } }));
    expect(html).toContain("Which medicine?");
    expect(html).toContain('value="Losartan"');
    expect(html).toContain("Which other allergy?");
    expect(html).not.toContain("For what condition?");
  });
});
