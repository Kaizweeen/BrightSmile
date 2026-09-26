import { describe, expect, it } from "vitest";
import {
  amountCentavos,
  bannerText,
  billingDate,
  billingFromRow,
  billingStatus,
  formatPesos,
  manilaMonthStart,
  parseMonths,
  pausedMessage,
  statusLine,
  tierFor,
  type Billing,
} from "@/lib/billing";
import { manilaInstant } from "@/lib/time";

const DAY = 24 * 60 * 60 * 1000;
const trialEnd = manilaInstant("2026-10-09", 600); // Fri Oct 9, 10:00 AM
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const trial: Billing = { trialEndsAt: trialEnd, paidThrough: null };

describe("tierFor and amountCentavos", () => {
  it("prices by active dentists, with no dentists paying Solo", () => {
    expect([0, 1, 2, 3, 6, 7, 40].map((n) => tierFor(n).name)).toEqual(["Solo", "Solo", "Solo", "Team", "Team", "Group", "Group"]);
    expect(amountCentavos(0, 1)).toBe(39_900);
    expect(amountCentavos(2, 12)).toBe(478_800);
    expect(amountCentavos(3, 1)).toBe(129_900);
    expect(amountCentavos(6, 3)).toBe(389_700);
    expect(amountCentavos(7, 1)).toBe(179_900);
    expect(amountCentavos(7, 12)).toBe(2_158_800);
  });

  it("multiplies the monthly price for every month from 1 to 12", () => {
    for (let months = 1; months <= 12; months++) expect(amountCentavos(4, months)).toBe(129_900 * months);
  });
});

describe("parseMonths", () => {
  it("accepts whole months from 1 to 12, as numbers or form text", () => {
    expect([1, "3", " 6 ", 12, "01"].map(parseMonths)).toEqual([1, 3, 6, 12, 1]);
  });

  it("refuses everything else", () => {
    for (const bad of [0, 13, 3.5, "1.5", "", "abc", "100", null, undefined, {}]) expect(parseMonths(bad)).toBeNull();
  });
});

describe("formatPesos", () => {
  it("writes pesos with thousands separators and centavos only when there are some", () => {
    expect(formatPesos(39_900)).toBe("₱399");
    expect(formatPesos(129_900)).toBe("₱1,299");
    expect(formatPesos(2_158_800)).toBe("₱21,588");
    expect(formatPesos(119_750)).toBe("₱1,197.50");
    expect(formatPesos(5)).toBe("₱0.05");
    expect(formatPesos(100_000_000)).toBe("₱1,000,000");
  });
});

describe("billingFromRow", () => {
  it("reads the row, and treats a missing row as a trial that ended at signup", () => {
    expect(billingFromRow({ trial_ends_at: trialEnd.toISOString(), paid_through: null }, "2026-09-25T02:00:00Z")).toEqual(trial);
    expect(billingFromRow(null, "2026-09-25T02:00:00Z")).toEqual({ trialEndsAt: new Date("2026-09-25T02:00:00Z"), paidThrough: null });
  });
});

describe("billingStatus", () => {
  it("is trial until the trial ends, then 3 days of grace, then lapsed", () => {
    expect(billingStatus(trial, at(trialEnd, -1))).toEqual({ status: "trial", endsAt: trialEnd, pausesAt: at(trialEnd, 3 * DAY), open: true });
    expect(billingStatus(trial, trialEnd).status).toBe("grace");
    expect(billingStatus(trial, at(trialEnd, 3 * DAY - 1))).toMatchObject({ status: "grace", open: true });
    expect(billingStatus(trial, at(trialEnd, 3 * DAY))).toMatchObject({ status: "lapsed", open: false });
  });

  it("is active while paid through is ahead, then grace from paid through", () => {
    const paid = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2027-01-09", 600) };
    expect(billingStatus(paid, at(paid.paidThrough, -1))).toMatchObject({ status: "active", endsAt: paid.paidThrough, open: true });
    expect(billingStatus(paid, paid.paidThrough)).toMatchObject({ status: "grace", open: true });
    expect(billingStatus(paid, at(paid.paidThrough, 3 * DAY))).toMatchObject({ status: "lapsed", open: false });
  });

  it("counts a payment made during the trial as active, ending after the trial", () => {
    const paidDuringTrial = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2026-11-09", 600) };
    expect(billingStatus(paidDuringTrial, manilaInstant("2026-09-30", 600))).toMatchObject({ status: "active", endsAt: paidDuringTrial.paidThrough });
  });

  it("ends at the later date when a trial was extended past an old payment", () => {
    const extended = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2026-09-01", 600) };
    expect(billingStatus(extended, manilaInstant("2026-10-01", 600))).toMatchObject({ status: "trial", endsAt: trialEnd });
  });
});

describe("the words", () => {
  const now = manilaInstant("2026-10-07", 600);

  it("dates this year without the year, and other years with it", () => {
    expect(billingDate(trialEnd, now)).toBe("Fri Oct 9");
    expect(billingDate(manilaInstant("2027-09-30", 600), now)).toBe("Thu Sep 30, 2027");
  });

  it("says where the plan stands on the Billing page", () => {
    expect(statusLine(billingStatus(trial, now), now)).toBe("Free trial until Fri Oct 9.");
    const paid = { trialEndsAt: trialEnd, paidThrough: manilaInstant("2027-03-03", 600) };
    expect(statusLine(billingStatus(paid, now), now)).toBe("Paid until Wed Mar 3, 2027.");
    const graceNow = at(trialEnd, 2 * DAY);
    expect(statusLine(billingStatus(trial, graceNow), graceNow)).toBe("Your plan ended Fri Oct 9. Online booking pauses in 1 day.");
    expect(statusLine(billingStatus(trial, at(trialEnd, 1)), at(trialEnd, 1))).toBe("Your plan ended Fri Oct 9. Online booking pauses in 3 days.");
    const lapsedNow = at(trialEnd, 4 * DAY);
    expect(statusLine(billingStatus(trial, lapsedNow), lapsedNow)).toBe("Your plan ended Fri Oct 9. Online booking reopens when you pay.");
  });

  it("counts grace days on the Manila calendar, to the date the banner names", () => {
    // The trial ended Fri Oct 9, 10:00 AM, so booking pauses Mon Oct 12, 10:00 AM.
    const saturday = manilaInstant("2026-10-10", 60); // 1:00 AM, 2 days and 9 hours before the pause
    expect(statusLine(billingStatus(trial, saturday), saturday)).toBe("Your plan ended Fri Oct 9. Online booking pauses in 2 days.");
    const monday = manilaInstant("2026-10-12", 60);
    expect(statusLine(billingStatus(trial, monday), monday)).toBe("Your plan ended Fri Oct 9. Online booking pauses today.");
    expect(bannerText(billingStatus(trial, monday), monday)).toBe("Your plan ended. Online booking pauses on Mon Oct 12.");
  });

  it("shows the banner only from 3 days before the end", () => {
    const early = at(trialEnd, -3 * DAY - 1);
    expect(bannerText(billingStatus(trial, early), early)).toBeNull();
    const threeDays = at(trialEnd, -3 * DAY);
    expect(bannerText(billingStatus(trial, threeDays), threeDays)).toBe("Your plan ends on Fri Oct 9.");
    const grace = at(trialEnd, DAY);
    expect(bannerText(billingStatus(trial, grace), grace)).toBe("Your plan ended. Online booking pauses on Mon Oct 12.");
    const lapsed = at(trialEnd, 3 * DAY);
    expect(bannerText(billingStatus(trial, lapsed), lapsed)).toBe("Online booking is paused. Pay to reopen it.");
  });

  it("tells patients of a paused clinic to call", () => {
    expect(pausedMessage("Bright Dental", "09171234567")).toBe("Bright Dental is not taking online requests right now. Call 09171234567 to book.");
  });
});

describe("manilaMonthStart", () => {
  it("is 00:00 Manila on the 1st, whatever the UTC date", () => {
    expect(manilaMonthStart(manilaInstant("2026-10-01", 30))).toEqual(manilaInstant("2026-10-01", 0)); // still Sep 30 in UTC
    expect(manilaMonthStart(manilaInstant("2026-09-30", 23 * 60))).toEqual(manilaInstant("2026-09-01", 0));
  });
});
