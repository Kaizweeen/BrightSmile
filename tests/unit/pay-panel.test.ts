import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PayPanel from "@/app/app/billing/PayPanel";

// PayPanel's first render never calls the action (no form submitted yet), like the booking page's actions mock.
vi.mock("@/app/app/billing/actions", () => ({ payOnline: async (state: unknown) => state }));

const props = { activeDentists: 2, slug: "bright-dental", gcash: { name: "Kai B.", number: "0917 555 0101" }, online: true };
const render = () => renderToStaticMarkup(createElement(PayPanel, props));

describe("PayPanel (Play Store spec 3.2)", () => {
  it("fails closed: server rendering shows nothing, no price, months picker, GCash details, or Pay online", () => {
    expect(render()).toBe("");
  });
});
