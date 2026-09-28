import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WebOnly from "@/app/app/WebOnly";
import { billingStatus, neutralStatusLine } from "@/lib/billing";

const html = (fallback?: string) => renderToStaticMarkup(createElement(WebOnly, { fallback }, "₱399 a month"));

describe("WebOnly", () => {
  it("fails closed: server rendering always shows only the fallback, never the children", () => {
    expect(html("Paid until Fri Oct 9.")).toBe("Paid until Fri Oct 9.");
    expect(html()).toBe("");
  });
});

describe("neutralStatusLine", () => {
  const now = new Date("2026-10-12T01:00:00Z");
  const at = (trial: string, paid: string | null) => ({ trialEndsAt: new Date(trial), paidThrough: paid ? new Date(paid) : null });

  it("states the plan's facts in every status without asking anyone to pay", () => {
    const states = [
      billingStatus(at("2026-09-01T00:00:00Z", "2026-11-01T00:00:00Z"), now),
      billingStatus(at("2026-10-20T00:00:00Z", null), now),
      billingStatus(at("2026-10-11T00:00:00Z", null), now),
      billingStatus(at("2026-09-01T00:00:00Z", null), now),
    ];
    expect(states.map((s) => s.status)).toEqual(["active", "trial", "grace", "lapsed"]);
    for (const state of states) {
      const line = neutralStatusLine(state, now);
      expect(line).not.toMatch(/pay/i);
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
