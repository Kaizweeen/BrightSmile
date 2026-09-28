import { describe, expect, it } from "vitest";
import { inPlayApp, isPlayReferrer, rememberPlaySource } from "@/lib/play-app";

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

describe("inPlayApp reading the current URL directly (Play Store spec 3.2 item 2)", () => {
  it("is true on the very first render, from ?source=play in the URL, with nothing stored yet", () => {
    expect(inPlayApp(fakeStore(), "?source=play")).toBe(true);
  });

  it("does not mistake an unrelated query string for the Play source", () => {
    expect(inPlayApp(fakeStore(), "?utm_source=play")).toBe(false);
    expect(inPlayApp(fakeStore(), "")).toBe(false);
  });

  it("is still true once the URL carries nothing, as long as the session stored it earlier", () => {
    const store = fakeStore();
    rememberPlaySource("?source=play", store);
    expect(inPlayApp(store, "")).toBe(true);
  });

  it("is false on the server, where there is no store or URL at all", () => {
    expect(inPlayApp(null, null)).toBe(false);
  });
});

describe("isPlayReferrer (Play Store spec 3.2 item 4)", () => {
  it("matches a Trusted Web Activity's referrer for exactly this package", () => {
    expect(isPlayReferrer("android-app://com.brightsmile.clinic/", "com.brightsmile.clinic")).toBe(true);
  });

  it("does not match another app's android-app referrer", () => {
    expect(isPlayReferrer("android-app://com.other.app/", "com.brightsmile.clinic")).toBe(false);
  });

  it("does not match a partial or differently shaped referrer", () => {
    expect(isPlayReferrer("android-app://com.brightsmile.clinic", "com.brightsmile.clinic")).toBe(false);
    expect(isPlayReferrer("https://bsmile.vercel.app/", "com.brightsmile.clinic")).toBe(false);
    expect(isPlayReferrer("", "com.brightsmile.clinic")).toBe(false);
  });

  it("does nothing when the package name is unset", () => {
    expect(isPlayReferrer("android-app://com.brightsmile.clinic/", undefined)).toBe(false);
    expect(isPlayReferrer("", undefined)).toBe(false);
  });
});
