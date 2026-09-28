import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BillingBanner from "@/app/app/BillingBanner";
import { inPlayApp } from "@/lib/play-app";

vi.mock("@/lib/play-app", () => ({ inPlayApp: vi.fn() }));

const props = { text: "Online booking is paused. Pay to reopen it.", neutralText: "Online booking is paused." };
const render = () => renderToStaticMarkup(createElement(BillingBanner, props));

describe("BillingBanner (Play Store spec 3.2)", () => {
  it("shows the normal text in a browser", () => {
    vi.mocked(inPlayApp).mockReturnValue(false);
    expect(render()).toBe(props.text);
  });

  it("shows the neutral text inside the Play app, with no price, GCash, Pay, or peso sign", () => {
    vi.mocked(inPlayApp).mockReturnValue(true);
    const html = render();
    expect(html).toBe(props.neutralText);
    for (const banned of ["GCash", "Pay", "₱"]) expect(html).not.toContain(banned);
  });
});
