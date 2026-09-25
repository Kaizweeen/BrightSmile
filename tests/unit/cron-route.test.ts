import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/daily/route";

const saved = process.env.CRON_SECRET;

afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("GET /api/cron/daily", () => {
  it("refuses a request without the cron secret, before touching anything", async () => {
    process.env.CRON_SECRET = "a-long-enough-cron-secret";
    const res = await GET(new Request("http://localhost/api/cron/daily"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    const wrong = await GET(new Request("http://localhost/api/cron/daily", { headers: { authorization: "Bearer nope" } }));
    expect(wrong.status).toBe(401);
  });

  it("refuses everyone when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request("http://localhost/api/cron/daily", { headers: { authorization: "Bearer undefined" } }));
    expect(res.status).toBe(401);
  });
});
