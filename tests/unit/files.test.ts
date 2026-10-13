import { describe, expect, it } from "vitest";
import { cleanFileName, formatSize, sniffType } from "@/lib/files";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("patient files", () => {
  it("knows a file's type by its bytes, not its name", () => {
    expect(sniffType(ascii("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffType(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffType(ascii("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffType(ascii("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(bytes())).toBeNull();
  });

  it("keeps a name without folders, control characters, or quotes, and shortens a long one keeping its extension", () => {
    expect(cleanFileName("C:\\scans\\x-ray 16.png")).toBe("x-ray 16.png");
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName('a"b\u0000\nc.pdf')).toBe("abc.pdf");
    expect(cleanFileName("   ")).toBe("file");
    const long = cleanFileName(`${"a".repeat(200)}.jpeg`);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".jpeg")).toBe(true);
  });

  it("says sizes in words", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(820 * 1024)).toBe("820 KB");
    expect(formatSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });
});
