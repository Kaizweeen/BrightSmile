import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/request";

describe("clientIp", () => {
  it("takes the first address Vercel lists", () => {
    expect(clientIp("203.0.113.7, 10.0.0.1")).toBe("203.0.113.7");
    expect(clientIp(" 2001:db8::1 ")).toBe("2001:db8::1");
  });

  it("falls back to one shared bucket when the header is missing", () => {
    expect(clientIp(null)).toBe("unknown");
    expect(clientIp("")).toBe("unknown");
    expect(clientIp(" , 10.0.0.1")).toBe("unknown");
  });

  it("caps the length it stores", () => {
    expect(clientIp("x".repeat(200))).toHaveLength(64);
  });
});
