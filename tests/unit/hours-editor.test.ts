import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HoursEditor, { type HourBlock } from "@/components/HoursEditor";

const makati = { id: "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92", name: "Makati" };
const pasig = { id: "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03", name: "Pasig" };
const week = (monday: HourBlock[]): HourBlock[][] => [[], monday, [], [], [], [], []];

const render = (hours: HourBlock[][], branches?: { id: string; name: string }[]) =>
  renderToStaticMarkup(createElement(HoursEditor, { hours, onChange: () => {}, branches }));

describe("the working hours editor", () => {
  it("asks for each block's branch once the clinic has 2 or more active branches", () => {
    const html = render(
      week([
        { start: "09:00", end: "12:00", branchId: makati.id },
        { start: "13:00", end: "17:00", branchId: pasig.id },
      ]),
      [makati, pasig],
    );
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Monday, block 1, branch"');
    expect(html).toContain(`<option value="${pasig.id}" selected="">Pasig</option>`);
  });

  it("looks as before with one branch, and in onboarding", () => {
    const monday = week([{ start: "09:00", end: "12:00", branchId: makati.id }]);
    expect(render(monday, [makati])).not.toContain("<select");
    expect(render(monday)).not.toContain("<select");
  });
});
