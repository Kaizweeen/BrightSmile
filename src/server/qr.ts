import QRCode from "qrcode";

/** A QR code as an SVG string: black on white, with a quiet zone, readable by any phone camera. */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
}
