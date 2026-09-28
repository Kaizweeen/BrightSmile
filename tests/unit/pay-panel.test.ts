import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PayPanel from "@/app/app/billing/PayPanel";
import { inPlayApp } from "@/lib/play-app";

// PayPanel's first render never calls the action (no form submitted yet), like the booking page's actions mock.
vi.mock("@/app/app/billing/actions", () => ({ payOnline: async (state: unknown) => state }));
vi.mock("@/lib/play-app", () => ({ inPlayApp: vi.fn() }));

const props = { activeDentists: 2, slug: "bright-dental", gcash: { name: "Kai B.", number: "0917 555 0101" }, online: true };
const render = () => renderToStaticMarkup(createElement(PayPanel, props));

describe("PayPanel (Play Store spec 3.2)", () => {
  it("shows prices, GCash details, and Pay online in a browser", () => {
    vi.mocked(inPlayApp).mockReturnValue(false);
    const html = render();
    expect(html).toContain("₱399");
    expect(html).toContain("GCash");
    expect(html).toContain("Pay ₱399 online");
  });

  it("renders nothing inside the Play app: no price, months picker, GCash details, or Pay online", () => {
    vi.mocked(inPlayApp).mockReturnValue(true);
    const html = render();
    expect(html).toBe("");
  });
});
