import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { CLINIC, QR_ROWS } from "@/app/clinic/data";

/** The landing page's QR is written out by hand, so it drifts silently when the booking URL changes. */
describe("the clinic landing page QR", () => {
  it("encodes the booking URL", () => {
    const { modules } = QRCode.create(CLINIC.bookingUrl, { errorCorrectionLevel: "M" });
    const rows = Array.from({ length: modules.size }, (_, y) =>
      Array.from({ length: modules.size }, (_, x) => (modules.data[y * modules.size + x] ? "#" : ".")).join(""),
    );
    expect(QR_ROWS).toEqual(rows);
  });
});
