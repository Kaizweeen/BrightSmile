import { expect, test } from "@playwright/test";
import { E2E } from "./env";

const origin = `http://localhost:${E2E.port}`;

/** The next quarter hour at least 15 minutes away, as "HH:MM" in Manila, or null when its 30-minute visit would end tomorrow. */
function nextSlot(): string | null {
  const manila = new Date(Date.now() + 8 * 3_600_000);
  const slot = Math.ceil((manila.getUTCHours() * 60 + manila.getUTCMinutes() + 15) / 15) * 15;
  return slot + 30 < 24 * 60 ? `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}` : null;
}

test("a visit from setup to completion", async ({ page, browser }) => {
  const slot = nextSlot();
  test.skip(slot === null, "The visit is booked for later today: run this before 23:00 Manila time.");

  // Setup (spec 6.1): the practice and its owner.
  await page.goto("/setup");
  await page.getByLabel("Setup code").fill(E2E.setupCode);
  await page.getByLabel("Practice name").fill("E2E Dental");
  await page.getByLabel("Your full name").fill("Dr. Olivia Owner");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("owner password 1");
  await page.getByLabel("Password again").fill("owner password 1");
  await page.getByRole("button", { name: "Set up DentaSync" }).click();
  await expect(page.getByRole("heading", { name: "All branches" })).toBeVisible();

  // A branch, a chair, and a procedure through the API, as the owner (the Settings screens have their own checks).
  const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, { open: "09:00", close: "18:00" }]));
  const post = (path: string, data: object) => page.request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect((await post("/branches", { code: "downtown", name: "Downtown", address: "", phone: "", operatingHours: hours })).ok()).toBe(true);
  expect((await post("/branches/downtown/chairs", { label: "General" })).ok()).toBe(true);
  expect((await post("/procedures", { name: "Consultation", durationMinutes: 30, bufferMinutes: 10 })).ok()).toBe(true);

  // A dentist asks to join with the branch's QR (spec 6.3), in a browser of their own.
  await page.goto("/poster/downtown");
  const joinUrl = ((await page.getByText("/join/").textContent()) ?? "").trim();
  const dentist = await (await browser.newContext({ baseURL: origin })).newPage();
  await dentist.goto(joinUrl);
  await dentist.getByLabel("Your full name").fill("Dr. Dana Dentist");
  await dentist.getByLabel("Username").fill("dr.dana");
  await dentist.getByLabel("Password", { exact: true }).fill("dentist password 1");
  await dentist.getByLabel("Password again").fill("dentist password 1");
  await dentist.getByLabel("Dentist or hygienist").check();
  await dentist.getByRole("button", { name: "Ask for an account" }).click();
  await expect(dentist).toHaveURL(/\/waiting/);

  // The owner approves (spec 6.4).
  await page.goto("/all/staff");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("cell", { name: "Dr. Dana Dentist" })).toBeVisible();

  // The owner books a new patient for later today (spec 10, the booking panel). The dentist has no weekly schedule
  // yet, so the booking needs "Book anyway".
  await page.goto("/downtown/calendar");
  await page.getByRole("button", { name: "New booking" }).click();
  const booking = page.getByRole("dialog", { name: "New booking" });
  await booking.getByRole("button", { name: "Add a new patient" }).click();
  const addPatient = page.getByRole("dialog", { name: "Add a patient" });
  await addPatient.getByLabel("Last name").fill("Santos");
  await addPatient.getByLabel("First name").fill("Ana");
  await addPatient.getByRole("button", { name: "Add patient" }).click();
  await expect(booking.getByText("Santos, Ana")).toBeVisible();
  await booking.getByLabel("Consultation, 30 min").check();
  await booking.getByRole("button", { name: "Pick another time" }).click();
  await booking.getByLabel("Start").fill(slot ?? "");
  await booking.getByLabel("Dentist for this visit").selectOption({ label: "Dr. Dana Dentist" });
  await booking.getByLabel("Chair").selectOption({ label: "Chair 1 · General" });
  await booking.getByRole("button", { name: "Book anyway" }).click();
  await expect(page.getByText("Booked.")).toBeVisible();

  // The front desk checks the patient in (spec 8.6).
  await page.getByRole("button", { name: /Santos, Ana/ }).click();
  const visit = page.getByRole("dialog", { name: "Santos, Ana" });
  await visit.getByRole("button", { name: "Check in" }).click();
  await expect(visit.getByText("Checked in", { exact: true })).toBeVisible();

  // The dentist starts treatment from My day, charts a tooth, fills in the exam, writes a note, and completes the visit.
  await dentist.goto("/login");
  await dentist.getByLabel("Username").fill("dr.dana");
  await dentist.getByLabel("Password").fill("dentist password 1");
  await dentist.getByRole("button", { name: "Sign in" }).click();
  await expect(dentist).toHaveURL(/\/downtown\/my-day/);
  await dentist.getByRole("button", { name: "Start treatment" }).click();
  await expect(dentist.getByText("In treatment", { exact: true })).toBeVisible();
  await dentist.getByRole("link", { name: "Open chart" }).click();
  await dentist.getByRole("button", { name: "Tooth 16, nothing charted" }).click();
  const tooth = dentist.getByRole("dialog", { name: "Tooth 16" });
  await tooth.getByLabel("Code").selectOption("Co");
  await tooth.getByLabel("Occlusal").check();
  await tooth.getByRole("button", { name: "Add to the chart" }).click();
  await expect(tooth.getByText("Tooth 16: Composite filling on occlusal")).toBeVisible();
  await dentist.keyboard.press("Escape");
  await dentist.getByLabel("Gingivitis").check();
  await dentist.getByRole("button", { name: "Save the exam" }).click();
  await expect(dentist.getByText("Exam saved.")).toBeVisible();
  await dentist.getByRole("tab", { name: "Notes" }).click();
  await dentist.getByLabel("Note", { exact: true }).fill("Consultation done. Composite on 16.");
  await dentist.getByRole("button", { name: "Add the note" }).click();
  await expect(dentist.getByText("Consultation done. Composite on 16.")).toBeVisible();
  await dentist.goto("/downtown/my-day");
  await dentist.getByRole("button", { name: "Complete" }).click();
  await expect(dentist.getByText("Completed", { exact: true })).toBeVisible();
});
