import { beforeEach, describe, expect, it, vi } from "vitest";
import { payOnline } from "@/app/app/billing/actions";
import { activeDentists } from "@/lib/billing-data";
import { createCheckout } from "@/lib/paymongo";

const fake = vi.hoisted(() => ({ slugRead: null as unknown as () => Promise<{ data: { slug: string } }> }));

vi.mock("@/lib/supabase/server", () => ({
  requireStaff: async () => ({
    clinicId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    db: { from: () => ({ select: () => ({ eq: () => ({ single: () => ({ throwOnError: () => fake.slugRead() }) }) }) }) },
  }),
}));
vi.mock("@/lib/billing-data", () => ({ activeDentists: vi.fn() }));
vi.mock("@/lib/paymongo", () => ({ paymongoKeys: () => ({ secretKey: "sk_live_abc", webhookSecret: "whsk_abc" }), createCheckout: vi.fn() }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://brightsmile.ph" }));
// Like Next's redirect, this throws, so a redirect caught by a try block would show up as a returned error.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const UNAVAILABLE = { error: "Online payment is not available right now. You can pay by GCash." };
const form = (months: string) => {
  const data = new FormData();
  data.set("months", months);
  return data;
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(activeDentists).mockReset().mockResolvedValue(3);
  vi.mocked(createCheckout).mockReset().mockResolvedValue("https://checkout.paymongo.com/cs_1");
  fake.slugRead = async () => ({ data: { slug: "bright-dental" } });
});

describe("payOnline", () => {
  it("offers GCash instead when the dentist count or the clinic cannot be read, and logs where", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(activeDentists).mockRejectedValueOnce(new Error("connection reset"));
    expect(await payOnline({}, form("3"))).toEqual(UNAVAILABLE);
    fake.slugRead = async () => {
      throw new Error("JWT expired");
    };
    expect(await payOnline({}, form("3"))).toEqual(UNAVAILABLE);
    expect(logged.mock.calls).toEqual([
      ["payOnline failed:", "connection reset"],
      ["payOnline failed:", "JWT expired"],
    ]);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it("charges what the server computes and redirects to checkout", async () => {
    await expect(payOnline({}, form("3"))).rejects.toThrow("NEXT_REDIRECT https://checkout.paymongo.com/cs_1");
    expect(vi.mocked(createCheckout).mock.calls[0][0]).toMatchObject({ slug: "bright-dental", tier: "Team", months: 3, amountCentavos: 389_700 });
  });
});
