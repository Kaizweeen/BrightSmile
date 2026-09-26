import { beforeEach, describe, expect, it, vi } from "vitest";
import { extendTrialAction, recordGcashPayment } from "@/app/admin/actions";
import { extendTrial, recordPayment } from "@/lib/billing-data";
import { requireOperator } from "@/lib/supabase/server";

const CLINIC = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OPERATOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

vi.mock("@/lib/supabase/server", () => ({ requireOperator: vi.fn() }));
vi.mock("@/lib/billing-data", () => ({ recordPayment: vi.fn(), extendTrial: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: () => {} }));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const payment = form({ clinicId: CLINIC, months: "3", amount: "3,897", reference: "5012 345 678901" });
const trial = form({ clinicId: CLINIC, days: "30" });

beforeEach(() => {
  vi.mocked(recordPayment).mockReset().mockResolvedValue({ status: "ok", paidThrough: new Date("2030-01-01T00:00:00Z") } as never);
  vi.mocked(extendTrial).mockReset().mockResolvedValue(new Date("2030-01-01T00:00:00Z") as never);
});

describe("admin actions", () => {
  it("stop before any write when the caller is not an operator", async () => {
    // Like notFound(), requireOperator throws for everyone who is not on OPERATOR_EMAILS.
    vi.mocked(requireOperator).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(recordGcashPayment({}, payment)).rejects.toThrow("404");
    await expect(extendTrialAction({}, trial)).rejects.toThrow("404");
    expect(recordPayment).not.toHaveBeenCalled();
    expect(extendTrial).not.toHaveBeenCalled();
  });

  it("record a GCash payment as the signed-in operator, with the reference's spaces removed", async () => {
    vi.mocked(requireOperator).mockResolvedValue({ userId: OPERATOR } as never);
    expect(await recordGcashPayment({}, payment)).toEqual({ done: "Payment recorded." });
    expect(recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, method: "gcash", months: 3, amountCentavos: 389_700, reference: "5012345678901", sessionId: null, recordedBy: OPERATOR }),
    );
  });
});
