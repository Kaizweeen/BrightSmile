import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/.well-known/assetlinks.json/route";

const saved = { ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME, ANDROID_CERT_SHA256: process.env.ANDROID_CERT_SHA256 };
const fingerprint = (pair: string) => Array(32).fill(pair).join(":");
const FP_A = fingerprint("AB");
const FP_B = fingerprint("CD");

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /.well-known/assetlinks.json", () => {
  it("answers the Digital Asset Links shape from the environment (spec 3.1)", async () => {
    process.env.ANDROID_PACKAGE_NAME = "com.brightsmile.clinic";
    process.env.ANDROID_CERT_SHA256 = FP_A;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "com.brightsmile.clinic", sha256_cert_fingerprints: [FP_A] },
      },
    ]);
  });

  it("lists every fingerprint, comma separated and trimmed, so the upload key and Play App Signing key can both be listed", async () => {
    process.env.ANDROID_PACKAGE_NAME = "com.brightsmile.clinic";
    process.env.ANDROID_CERT_SHA256 = `${FP_A} , ${FP_B}`;
    const res = await GET();
    const body = (await res.json()) as { target: { sha256_cert_fingerprints: string[] } }[];
    expect(body[0].target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });

  it("answers 404 when either variable is unset, or both are", async () => {
    delete process.env.ANDROID_PACKAGE_NAME;
    delete process.env.ANDROID_CERT_SHA256;
    expect((await GET()).status).toBe(404);
    process.env.ANDROID_PACKAGE_NAME = "com.brightsmile.clinic";
    expect((await GET()).status).toBe(404);
    delete process.env.ANDROID_PACKAGE_NAME;
    process.env.ANDROID_CERT_SHA256 = FP_A;
    expect((await GET()).status).toBe(404);
  });

  it("sends a public, hour-long cache and a JSON content type, so Android can fetch it", async () => {
    process.env.ANDROID_PACKAGE_NAME = "com.brightsmile.clinic";
    process.env.ANDROID_CERT_SHA256 = FP_A;
    const res = await GET();
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});
