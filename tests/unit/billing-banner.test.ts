import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BillingBanner from "@/app/app/BillingBanner";

const props = { text: "Online booking is paused. Pay to reopen it.", neutralText: "Online booking is paused." };
const render = () => renderToStaticMarkup(createElement(BillingBanner, props));

describe("BillingBanner (Play Store spec 3.2)", () => {
  it("fails closed: server rendering always shows the neutral text, with no price, GCash, Pay, or peso sign", () => {
    const html = render();
    expect(html).toBe(props.neutralText);
    for (const banned of ["GCash", "Pay", "₱"]) expect(html).not.toContain(banned);
  });
});
