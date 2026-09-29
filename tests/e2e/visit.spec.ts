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
  // The first sign-in after a build can take over 30 seconds while the dev server compiles.
  await expect(page.getByRole("heading", { name: "All branches" })).toBeVisible({ timeout: 60_000 });

  // A branch, a chair, and a procedure through the API, as the owner (the Settings screens have their own checks).
  const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((day) => [day, { open: "09:00", close: "18:00" }]));
  const post = (path: string, data: object) => page.request.post(`/api/v1${path}`, { data, headers: { origin } });
  expect((await post("/branches", { code: "downtown", name: "Downtown", address: "", phone: "", operatingHours: hours })).ok()).toBe(true);
  expect((await post("/branches/downtown/chairs", { label: "General" })).ok()).toBe(true);
  expect((await post("/procedures", { name: "Consultation" })).ok()).toBe(true);

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
  await booking.getByLabel("Consultation", { exact: true }).check();
  await booking.getByLabel("Length").selectOption({ label: "30 minutes" });
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

  // Online booking: the owner turns it on and gives the dentist a week at the branch; a patient books tomorrow's first
  // open time at /book; the front desk confirms it from Online requests.
  const send = (method: "PATCH" | "PUT", path: string, data: object) => page.request.fetch(`/api/v1${path}`, { method, data, headers: { origin } });
  expect((await send("PATCH", "/practice", { onlineBooking: true, privacyNotice: "E2E privacy notice." })).ok()).toBe(true);
  const dana = ((await (await page.request.get("/api/v1/dentists")).json()) as { id: string; name: string }[]).find((d) => d.name === "Dr. Dana Dentist");
  const downtown = ((await (await page.request.get("/api/v1/branches")).json()) as { id: string; code: string }[]).find((b) => b.code === "downtown");
  const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ branchId: downtown?.id, dayOfWeek, startTime: "09:00", endTime: "17:00" }));
  expect((await send("PUT", `/dentists/${dana?.id}/schedule`, { blocks: week })).ok()).toBe(true);
  // A second branch where no dentist works, and a service only Dr. Dana gives: /book offers that service at Downtown alone.
  expect((await post("/branches", { code: "uptown", name: "Uptown", address: "", phone: "", operatingHours: hours })).ok()).toBe(true);
  expect((await post("/procedures", { name: "Braces and Retainers", dentistIds: [dana?.id] })).ok()).toBe(true);

  const tomorrow = new Date(Date.now() + 8 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  const patient = await (await browser.newContext({ baseURL: origin })).newPage();
  // The welcome page's link opens /book at its branch (patient forms spec 9); any other value is ignored.
  await patient.goto("/book?branch=uptown");
  await expect(patient.getByLabel("Branch")).toHaveValue("uptown");
  await patient.goto("/book?branch=nowhere");
  await expect(patient.getByLabel("Branch")).toHaveValue("");
  await patient.goto("/book");
  // The Service list follows the branch: every service before one is chosen, and a picked service goes when the new branch lacks it.
  const service = patient.getByLabel("Service");
  const braces = service.getByRole("option", { name: "Braces and Retainers" });
  await expect(braces).toHaveCount(1);
  await patient.getByLabel("Branch").selectOption({ label: "Downtown" });
  await service.selectOption({ label: "Braces and Retainers" });
  await patient.getByLabel("Branch").selectOption({ label: "Uptown" });
  await expect(braces).toHaveCount(0);
  await expect(service).toHaveValue("");
  await patient.getByLabel("Branch").selectOption({ label: "Downtown" });
  await expect(braces).toHaveCount(1);
  await service.selectOption({ label: "Consultation" });
  await patient.getByLabel("Day").selectOption(tomorrow);
  await patient.getByRole("group", { name: "Open times" }).getByRole("button").first().click();
  await patient.getByLabel("First name").fill("Ben");
  await patient.getByLabel("Last name").fill("Cruz");
  await patient.getByLabel("Mobile number").fill("0917 555 0101");
  await patient.getByRole("checkbox", { name: /privacy notice/ }).check();

  // The time is taken in between (the booking route answers 409 once): the patient sees why, then picks a time again and books for real.
  const bookings = "**/api/v1/portal/bookings";
  await patient.route(bookings, (route) => route.fulfill({ status: 409, json: { error: { code: "taken", message: "That time was just taken. Please pick another." } } }), { times: 1 });
  await patient.getByRole("button", { name: "Request this time" }).click();
  await expect(patient.getByText("That time was just taken. Please pick another.")).toBeVisible();
  await patient.unroute(bookings);
  await patient.getByRole("group", { name: "Open times" }).getByRole("button").first().click();
  await expect(patient.getByText("That time was just taken. Please pick another.")).toBeHidden();
  await patient.getByRole("button", { name: "Request this time" }).click();
  await expect(patient.getByText("Your request is in.")).toBeVisible();

  await page.goto("/downtown/calendar");
  await page.getByRole("button", { name: "Online requests (1)" }).click();
  await page.getByRole("dialog", { name: "Online requests" }).getByRole("button", { name: /Cruz, Ben/ }).click();
  const online = page.getByRole("dialog", { name: "Cruz, Ben" });
  await online.getByRole("button", { name: "Confirm" }).click();
  await expect(online.getByText("Confirmed", { exact: true })).toBeVisible();

  // Patient forms: the owner switches them on and online booking off; a patient opens the branch's welcome page from its
  // patient poster, fills in the form, and the front desk makes a chart from it.
  expect((await send("PATCH", "/practice", { onlineBooking: false, patientForms: true })).ok()).toBe(true);
  await page.goto("/poster/downtown/patients");
  const welcomeUrl = ((await page.getByText("/welcome/").textContent()) ?? "").trim();
  const walkIn = await (await browser.newContext({ baseURL: origin })).newPage();
  await walkIn.goto(welcomeUrl);
  await expect(walkIn.getByRole("link", { name: "Book a visit" })).toHaveCount(0);
  await walkIn.getByRole("link", { name: "Fill in my patient form" }).click();
  await walkIn.getByLabel("First name").fill("Carla");
  await walkIn.getByLabel("Last name").fill("Reyes");
  await walkIn.getByLabel("Birthday").fill("1988-07-14");
  await walkIn.getByLabel("Sex").selectOption("female");
  await walkIn.getByLabel("Mobile number").fill("0918 222 3333");
  await walkIn.getByLabel("Address").fill("12 Mabini St, Makati");
  await walkIn.getByRole("checkbox", { name: /privacy notice/ }).check();
  await walkIn.getByRole("button", { name: "Send the form" }).click();
  await expect(walkIn.getByText("Thanks, Carla.")).toBeVisible();
  // With online booking off, the notice still shows, for the form.
  await walkIn.goto("/book/privacy");
  await expect(walkIn.getByText("E2E privacy notice.")).toBeVisible();

  await page.goto("/downtown/patients");
  await page.getByRole("button", { name: "Patient forms (1)" }).click();
  await page.getByRole("dialog", { name: "Patient forms" }).getByRole("button", { name: /Reyes, Carla/ }).click();
  await page.getByRole("dialog", { name: "Reyes, Carla" }).getByRole("button", { name: "New chart" }).click();
  const chart = page.getByRole("dialog", { name: "Add a patient" });
  await expect(chart.getByLabel("First name")).toHaveValue("Carla");
  await expect(chart.getByLabel("Home address")).toHaveValue("12 Mabini St, Makati");
  await expect(chart.getByLabel("Birthday")).toHaveValue("1988-07-14");
  await expect(chart.getByLabel("Sex")).toHaveValue("female");
  await expect(chart.getByLabel("Mobile", { exact: true })).toHaveValue("+639182223333");
  await chart.getByRole("button", { name: "Add patient" }).click();
  await expect(page).toHaveURL(/\/downtown\/patients\/[0-9a-f-]{36}$/);
  await page.goto("/downtown/patients");
  await expect(page.getByRole("button", { name: "Patient forms (0)" })).toBeVisible();
});
