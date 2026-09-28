import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import BookingFlow from "@/app/[slug]/BookingFlow";
import type { PublicClinic } from "@/lib/booking-input";

// The page's first screen renders without a browser or a server: no action runs until a patient taps something.
vi.mock("@/app/[slug]/actions", () => ({}));

const makati = { id: "7d2e9f10-3b5c-4e8a-b1d4-2c6f8a0e5b92", name: "Makati", address: "12 Rizal St, Makati", mapsUrl: "https://maps.app.goo.gl/abc" };
const pasig = { id: "8e3f0a21-4c6d-4f9b-a2e5-3d7a9b1f6c03", name: "Pasig", address: "5 Ortigas Ave, Pasig", mapsUrl: null };
const clinic: PublicClinic = {
  id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  slug: "bright-dental",
  name: "Bright Dental",
  smsName: "Bright Dental",
  mobile: "+639170000000",
  address: "Makati",
  mapsUrl: null,
  rules: { slotMinutes: 30, minNoticeMinutes: 120, maxDaysAhead: 60 },
  branch: makati,
  branches: [makati, pasig],
  dentists: [{ id: "0b6a3c52-8a47-4a55-9a77-6f2b0e1d9c01", name: "Dr. Ana Reyes", smsName: "Dr. Reyes", hours: [[], [{ start: 540, end: 1020 }], [], [], [], [], []] }],
  procedures: [{ id: "9e8d7c6b-5a49-4382-a716-151413121110", name: "Consultation", minutes: 30 }],
};

const render = (props: { clinic?: PublicClinic } = {}) =>
  renderToStaticMarkup(createElement(BookingFlow, { clinic, nowIso: "2026-09-28T02:00:00.000Z", ...props }));

describe("the booking page's main page", () => {
  it("offers the three paths with booking as the one primary button", () => {
    const html = render();
    const book = html.indexOf("Book an appointment");
    expect(book).toBeGreaterThan(-1);
    expect(html.indexOf("Reschedule or edit a booking")).toBeGreaterThan(book);
    expect(html.indexOf("Cancel a booking")).toBeGreaterThan(html.indexOf("Reschedule or edit a booking"));
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toContain("Book a visit, or change or cancel one you have.");
  });

  it("lists every active branch with its address, and a map link where there is one", () => {
    const html = render();
    expect(html).toContain("Our branches");
    expect(html).toContain("12 Rizal St, Makati");
    expect(html).toContain("5 Ortigas Ave, Pasig");
    expect(html).toContain('href="https://maps.app.goo.gl/abc"');
    expect(html.match(/>Map</g)).toHaveLength(1);
  });

  it("says where to find a clinic with one branch", () => {
    const html = render({ clinic: { ...clinic, branches: [makati] } });
    expect(html).toContain("Where to find us");
    expect(html).not.toContain("Pasig");
  });
});
