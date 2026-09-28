import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";

describe("the Privacy Notice", () => {
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("explains how the patient form's health information is kept", () => {
    expect(html).toContain(">Health information</h2>");
    expect(html).toContain("sensitive personal information under the Data Privacy Act (RA 10173)");
    expect(html).toContain("only with your consent");
    expect(html).toContain("never appear in text messages or push alerts");
    expect(html).toContain("the whole form is erased");
  });

  it("keeps every note for the legal review", () => {
    expect(html.match(/\[Legal review:/g)).toHaveLength(3);
    expect(html).toContain("Draft for legal review.");
  });
});
