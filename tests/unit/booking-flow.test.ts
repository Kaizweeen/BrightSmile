import { describe, expect, it } from "vitest";
import { flow, START, type FlowAction, type FlowState } from "@/lib/booking-flow";
import type { IntakeForm } from "@/lib/intake";

// Booking flow spec 3 and 7, move by move. The reducer only carries the form, so a partial one stands in for it.
const MOBILE = "+639171112222";
const MAKATI = "branch-makati";
const FORM = { first: "Leo", last: "Cruz" } as IntakeForm;
const NINE = "2026-10-20T01:00:00.000Z";
const TEN = "2026-10-20T02:00:00.000Z";
const APPOINTMENT = { id: "a1", branchId: MAKATI, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE };

const run = (actions: FlowAction[], from: FlowState = START) => actions.reduce(flow, from);
const steps = (actions: FlowAction[], from: FlowState = START) => {
  const seen: string[] = [];
  actions.reduce((s, a) => {
    const next = flow(s, a);
    seen.push(next.step);
    return next;
  }, from);
  return seen;
};

const bookOne: FlowAction = { type: "start", path: "book", onlyBranchId: MAKATI };
const codeSent: FlowAction = { type: "code_sent", mobile: MOBILE, requestId: "r1" };
const verified = (hasPatients: boolean): FlowAction => ({ type: "verified", mobile: MOBILE, hasPatients });
const services = (timeFits: boolean, procedureIds = ["x1"]): FlowAction => ({ type: "services", procedureIds, dentistId: "d1", timeFits });
const toSummary: FlowAction[] = [bookOne, codeSent, verified(true), { type: "patient", patientId: "p1" }, services(false), { type: "time", startsAt: NINE }];
const summary = run(toSummary);
const details = (path: "change" | "cancel") =>
  run([{ type: "start", path, onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }]);

describe("book an appointment (spec 3.3)", () => {
  it("goes number, code, who, services, time, summary, sent, with no branch step for a clinic with one branch", () => {
    expect(steps([...toSummary, { type: "done" }])).toEqual(["number", "code", "who", "services", "time", "summary", "done"]);
    expect(summary).toMatchObject({ path: "book", branchId: MAKATI, mobile: MOBILE, requestId: null, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE });
    expect(flow(summary, { type: "done" })).toMatchObject({ step: "done", branchId: MAKATI, startsAt: NINE, history: [] });
  });

  it("asks for the branch first when the clinic has several", () => {
    expect(steps([{ type: "start", path: "book", onlyBranchId: null }, { type: "branch", branchId: "b2" }])).toEqual(["branch", "number"]);
    expect(run([{ type: "start", path: "book", onlyBranchId: null }, { type: "branch", branchId: "b2" }]).branchId).toBe("b2");
  });

  it("goes straight on for a number this phone verified before", () => {
    expect(steps([bookOne, verified(true)])).toEqual(["number", "who"]);
  });

  it("opens the new patient form at once for a number with no patients, then the services", () => {
    expect(steps([bookOne, codeSent, verified(false), { type: "form", form: FORM }])).toEqual(["number", "code", "form", "services"]);
    expect(run([bookOne, verified(false), { type: "form", form: FORM }])).toMatchObject({ patientId: null, form: FORM });
  });

  it("offers someone new beside the number's patients", () => {
    expect(steps([bookOne, verified(true), { type: "someone_new" }, { type: "form", form: FORM }])).toEqual(["number", "who", "form", "services"]);
  });

  it("keeps the code step for a new code", () => {
    expect(run([bookOne, codeSent, { type: "code_sent", mobile: MOBILE, requestId: "r2" }])).toMatchObject({ step: "code", requestId: "r2" });
  });

  it("changes the date and time from the summary and returns to it (spec 3.3 step 7)", () => {
    expect(steps([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary)).toEqual(["time", "summary"]);
    expect(run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary)).toMatchObject({ startsAt: TEN, editing: false });
  });

  it("changes the services from the summary and returns to it while the time still fits", () => {
    const s = run([{ type: "change", part: "services" }, services(true, ["x1", "x2"])], summary);
    expect(s).toMatchObject({ step: "summary", procedureIds: ["x1", "x2"], startsAt: NINE, editing: false });
  });

  it("asks for a new time when the changed services no longer fit it (spec 2.3)", () => {
    const s = run([{ type: "change", part: "services" }, services(false, ["x1", "x2"])], summary);
    expect(s).toMatchObject({ step: "time", procedureIds: ["x1", "x2"], startsAt: null, editing: true });
    expect(flow(s, { type: "time", startsAt: TEN })).toMatchObject({ step: "summary", startsAt: TEN, editing: false });
  });

  it("changes the patient from the summary: one of the number's records, or someone new (add another patient)", () => {
    expect(run([{ type: "change", part: "patient" }, { type: "patient", patientId: "p2" }], summary)).toMatchObject({ step: "summary", patientId: "p2" });
    const s = run([{ type: "change", part: "patient" }, { type: "someone_new" }, { type: "form", form: FORM }], summary);
    expect(s).toMatchObject({ step: "summary", patientId: null, form: FORM, editing: false });
  });

  it("picks a time again when the server says the time was taken, then returns to the summary", () => {
    const s = flow(summary, { type: "taken" });
    expect(s).toMatchObject({ step: "time", startsAt: null, editing: true });
    expect(flow(s, { type: "time", startsAt: TEN })).toMatchObject({ step: "summary", startsAt: TEN });
  });
});

describe("back", () => {
  it("returns step by step and skips a code that was used", () => {
    const who = run([bookOne, codeSent, verified(true)]);
    expect(flow(who, { type: "back" })).toMatchObject({ step: "number" });
    expect(flow(run([bookOne, codeSent]), { type: "back" })).toMatchObject({ step: "number" });
    expect(flow(run([{ type: "start", path: "book", onlyBranchId: null }]), { type: "back" })).toEqual(START);
    expect(flow(summary, { type: "back" })).toMatchObject({ step: "time", startsAt: null });
  });

  it("cancels an open Change and keeps what the summary had", () => {
    const open = run([{ type: "change", part: "services" }, services(false, ["x2"])], summary);
    expect(run([{ type: "back" }, { type: "back" }], open)).toMatchObject({ step: "summary", procedureIds: ["x1"], startsAt: NINE, editing: false });
  });

  it("never walks back into a finished Change", () => {
    const changed = run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], summary);
    expect(flow(changed, { type: "back" })).toMatchObject({ step: "time", editing: false });
    expect(flow(changed, { type: "back" }).history).toEqual(flow(summary, { type: "back" }).history);
  });

  it("does nothing on the main page or once the request is sent", () => {
    expect(flow(START, { type: "back" })).toBe(START);
    const sent = flow(summary, { type: "done" });
    expect(flow(sent, { type: "back" })).toBe(sent);
  });
});

describe("reschedule or edit a booking (spec 3.4)", () => {
  it("goes number, code, appointments, booking details, sent", () => {
    expect(
      steps([{ type: "start", path: "change", onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }, { type: "done" }]),
    ).toEqual(["number", "code", "list", "details", "done"]);
    expect(details("change")).toMatchObject({ step: "details", appointmentId: "a1", branchId: MAKATI, patientId: "p1", procedureIds: ["x1"], dentistId: "d1", startsAt: NINE });
  });

  it("lists the appointments even for a number with no patients (the list says there are none)", () => {
    expect(run([{ type: "start", path: "change", onlyBranchId: null }, verified(false)]).step).toBe("list");
  });

  it("changes the date and time, or the services with a new time when it no longer fits, and returns to the details", () => {
    expect(run([{ type: "change", part: "time" }, { type: "time", startsAt: TEN }], details("change"))).toMatchObject({ step: "details", startsAt: TEN });
    expect(steps([{ type: "change", part: "services" }, services(false, ["x2"]), { type: "time", startsAt: TEN }], details("change"))).toEqual([
      "services",
      "time",
      "details",
    ]);
    expect(run([{ type: "change", part: "services" }, services(true, ["x2"])], details("change"))).toMatchObject({ step: "details", procedureIds: ["x2"], startsAt: NINE });
  });

  it("changes the patient to another record of the number or someone new", () => {
    expect(run([{ type: "change", part: "patient" }, { type: "patient", patientId: "p2" }], details("change"))).toMatchObject({ step: "details", patientId: "p2" });
    expect(run([{ type: "change", part: "patient" }, { type: "someone_new" }, { type: "form", form: FORM }], details("change"))).toMatchObject({
      step: "details",
      patientId: null,
      form: FORM,
    });
  });

  it("goes back from the details to the list, and picks a time again when the new one was taken", () => {
    expect(flow(details("change"), { type: "back" })).toMatchObject({ step: "list" });
    expect(run([{ type: "taken" }, { type: "time", startsAt: TEN }], details("change"))).toMatchObject({ step: "details", startsAt: TEN });
  });
});

describe("cancel a booking (spec 3.5)", () => {
  it("goes number, code, appointments, the question, cancelled", () => {
    expect(
      steps([{ type: "start", path: "cancel", onlyBranchId: null }, codeSent, verified(true), { type: "appointment", appointment: APPOINTMENT }, { type: "done" }]),
    ).toEqual(["number", "code", "list", "confirm_cancel", "done"]);
  });

  it("keeps the appointment and returns to the list on No", () => {
    expect(flow(details("cancel"), { type: "keep" })).toMatchObject({ step: "list" });
  });
});

describe("moves that are not allowed", () => {
  it("change nothing", () => {
    const cases: [FlowState, FlowAction][] = [
      [START, { type: "time", startsAt: NINE }],
      [START, { type: "done" }],
      [summary, { type: "start", path: "cancel", onlyBranchId: null }],
      [summary, { type: "appointment", appointment: APPOINTMENT }],
      [summary, { type: "keep" }],
      [details("change"), { type: "patient", patientId: "p2" }],
      [details("cancel"), { type: "change", part: "time" }],
      [run([bookOne]), { type: "form", form: FORM }],
      [run([bookOne, verified(true)]), { type: "code_sent", mobile: MOBILE, requestId: "r9" }],
    ];
    for (const [state, action] of cases) expect(flow(state, action), `${state.step} ${action.type}`).toBe(state);
  });

  it("home forgets everything, and a sent request forgets the form", () => {
    const withForm = run([bookOne, verified(false), { type: "form", form: FORM }, services(false), { type: "time", startsAt: NINE }]);
    expect(withForm).toMatchObject({ step: "summary", form: FORM });
    expect(flow(withForm, { type: "home" })).toEqual(START);
    expect(flow(withForm, { type: "done" })).toMatchObject({ step: "done", form: null });
  });
});
