import { describe, expect, it } from "vitest";
import { inPlayApp, rememberPlaySource } from "@/lib/play-app";

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function fakeStore(): Store {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function throwingStore(): Store {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
}

describe("rememberPlaySource and inPlayApp (Play Store spec 3.2)", () => {
  it("remembers ?source=play, so inPlayApp then reads it back", () => {
    const store = fakeStore();
    rememberPlaySource("?source=play", store);
    expect(inPlayApp(store)).toBe(true);
  });

  it("leaves the store alone without ?source=play, so inPlayApp stays false", () => {
    const store = fakeStore();
    rememberPlaySource("", store);
    rememberPlaySource("?source=browser", store);
    rememberPlaySource("?utm_source=play", store);
    expect(inPlayApp(store)).toBe(false);
  });

  it("is false with no store at all, such as on the server", () => {
    expect(inPlayApp(null)).toBe(false);
    expect(() => rememberPlaySource("?source=play", null)).not.toThrow();
  });

  it("is false by default outside a browser, which has no sessionStorage global", () => {
    expect(inPlayApp()).toBe(false);
    expect(() => rememberPlaySource("?source=play")).not.toThrow();
  });

  it("never throws when the store itself throws, such as in private browsing", () => {
    const store = throwingStore();
    expect(() => rememberPlaySource("?source=play", store)).not.toThrow();
    expect(inPlayApp(store)).toBe(false);
  });
});
