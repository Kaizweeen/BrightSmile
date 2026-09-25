import { expect, test } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { addDays, manilaDate, weekday } from "@/lib/time";
import { adminDb, dropStaffClinic, staffClinic, type StaffSeed } from "../db/helpers";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const mobile = `0917${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
let seed: StaffSeed | undefined;

test.beforeAll(async () => {
  seed = await staffClinic();
});

test.afterAll(async () => {
  if (seed) await dropStaffClinic(seed);
  await adminDb().from("otp_requests").delete().eq("mobile", `+63${mobile.slice(1)}`);
});

/** Session cookies for the staff login, written by the same SSR client the app uses, so the format always matches. */
async function sessionCookies(login: { email: string; password: string }) {
  const jar: { name: string; value: string }[] = [];
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => jar,
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          const at = jar.findIndex((c) => c.name === name);
          if (at >= 0) jar.splice(at, 1);
          if (value) jar.push({ name, value });
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword(login);
  expect(error).toBeNull();
  expect(jar.length, "signing in wrote no session cookie").toBeGreaterThan(0);
  return jar;
}

test("a patient books, the clinic approves, and the visit is on the schedule", async ({ page, context, baseURL }) => {
  const s = seed!;
  const today = manilaDate(new Date());
  const day = addDays(today, 1);
  const [, month, date] = day.split("-").map(Number);

  // The patient books tomorrow's first opening on the public page.
  await page.goto(`/${s.seed.clinic.slug}`);
  await page.getByRole("checkbox", { name: "Consultation, 30 minutes" }).check();
  await page.getByRole("button", { name: "Pick a day" }).click();
  if (day.slice(0, 7) !== today.slice(0, 7)) await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: `${DAYS[weekday(day)]}, ${MONTHS[month - 1]} ${date}`, exact: true }).click();
  await page.locator(".slot-grid .slot").first().click();
  await page.getByRole("button", { name: /^Take / }).click();
  await page.getByLabel("First name").fill("Playwright");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByRole("checkbox", { name: /^I agree to/ }).check();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Check your texts" })).toBeVisible();

  // The code comes from sms_log, where log mode keeps it (spec 10.6).
  const { data: text } = await adminDb()
    .from("sms_log")
    .select("body")
    .eq("clinic_id", s.staff.clinicId)
    .eq("kind", "otp")
    .order("id", { ascending: false })
    .limit(1)
    .single()
    .throwOnError();
  const code = (text.body as string | null)?.match(/ is (\d{6})\./)?.[1];
  expect(code, "sms_log has no code: the dev server must run with SMS_MODE=log").toBeTruthy();
  await page.getByLabel("Code from the text").fill(code!);
  await page.getByRole("button", { name: "Confirm request" }).click();
  await expect(page.getByRole("heading", { name: "Request sent" })).toBeVisible();

  // The clinic approves it in the dashboard.
  const cookies = await sessionCookies(s.login);
  await context.addCookies(cookies.map((c) => ({ ...c, url: baseURL!, httpOnly: true, sameSite: "Lax" as const })));
  await page.goto("/app/requests");
  const request = page.locator("article", { hasText: "Playwright Tester" });
  await expect(request.getByText("Pending", { exact: true })).toBeVisible();
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(request).toHaveCount(0);

  // And sees it on tomorrow's schedule.
  await page.goto(`/app/schedule?date=${day}`);
  const visit = page.locator("article", { hasText: "Playwright Tester" });
  await expect(visit.getByText("Confirmed", { exact: true })).toBeVisible();
});
