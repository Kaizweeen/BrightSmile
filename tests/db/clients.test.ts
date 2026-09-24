import { describe, expect, it } from "vitest";
import { adminClient } from "@/lib/supabase/admin";
// helpers refuses to run outside the development project.
import "./helpers";

describe("adminClient", () => {
  it("reads otp_requests, which only the secret key can reach", async () => {
    const { error } = await adminClient().from("otp_requests").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("is created once per process", () => {
    expect(adminClient()).toBe(adminClient());
  });
});
