import { X509Certificate } from "node:crypto";
import { describe, expect, it } from "vitest";
import { databaseSsl } from "@/db/ssl";

describe("database TLS", () => {
  it("checks a Supabase host against Supabase's root certificate", () => {
    const ssl = databaseSsl("postgresql://postgres.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres");
    const root = new X509Certificate(String(ssl?.ca));
    expect(root.subject).toContain("CN=Supabase Root 2021 CA");
    expect(root.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
  });

  it("leaves any other host to its URL's sslmode", () => {
    expect(databaseSsl("postgres://user:pass@localhost:5432/dentasync")).toBeUndefined();
  });
});
