import type { IntakeForm } from "@/lib/intake";

/**
 * The public booking page's flow (booking flow spec 3 and 7) as one pure reducer: the steps of booking (3.3),
 * rescheduling or editing (3.4), and cancelling (3.5), and every allowed move between them. The page renders the
 * current step and calls the Server Actions with what the state holds; it never decides the next step itself. The
 * server re-checks everything, so this only decides what the patient sees next.
 *
 * Moves carry what the page learned from the server (a code was sent, the number is verified, the time was taken)
 * and what the patient chose. A move that is not allowed from the current step changes nothing.
 */

export type Path = "book" | "change" | "cancel";

export type Step =
  | "main"
  | "branch"
  | "number"
  | "code"
  | "who"
  | "form"
  | "services"
  | "time"
  | "summary"
  | "list"
  | "details"
  | "confirm_cancel"
  | "done";

/** An upcoming appointment of the verified number (numberAppointments), where a change or a cancel starts. */
export type FlowAppointment = {
  id: string;
  branchId: string;
  patientId: string;
  procedureIds: string[];
  dentistId: string;
  startsAt: string;
};

type Snapshot = {
  path: Path | null;
  step: Step;
  /** True while a Change from the summary (booking) or the booking details (change) is open: finishing it returns there. */
  editing: boolean;
  branchId: string | null;
  mobile: string | null;
  /** The code request while the code step is open. */
  requestId: string | null;
  /** Whether the verified number had patients at the clinic: the booking goes to "Who" or straight to the form. */
  hasPatients: boolean;
  appointmentId: string | null;
  /** One of the number's patients, or null for someone new (then form holds them). */
  patientId: string | null;
  form: IntakeForm | null;
  procedureIds: string[];
  dentistId: string | null;
  startsAt: string | null;
};

/** The flow's state. history holds earlier states for Back, newest last. */
export type FlowState = Snapshot & { history: Snapshot[] };

export type FlowAction =
  /** A main page button. onlyBranchId: the clinic's one active branch, so booking skips the branch step. */
  | { type: "start"; path: Path; onlyBranchId: string | null }
  | { type: "branch"; branchId: string }
  /** The server texted a code (startVerification, or resendBookingCode on the code step). */
  | { type: "code_sent"; mobile: string; requestId: string }
  /** The number is verified on this phone: straight away, or after a right code. hasPatients from numberPatients. */
  | { type: "verified"; mobile: string; hasPatients: boolean }
  | { type: "patient"; patientId: string }
  | { type: "someone_new" }
  | { type: "form"; form: IntakeForm }
  /** timeFits: the chosen time is still open for these services and this dentist (the page asked the server). */
  | { type: "services"; procedureIds: string[]; dentistId: string; timeFits: boolean }
  | { type: "time"; startsAt: string }
  /** A summary line's Change button (spec 3.3 step 7, 3.4 step 3). */
  | { type: "change"; part: "time" | "services" | "patient" }
  /** The server answered that the chosen time is no longer open. */
  | { type: "taken" }
  | { type: "appointment"; appointment: FlowAppointment }
  /** "No, keep it" (spec 3.5 step 3). */
  | { type: "keep" }
  /** The server sent the request, sent the changes, or cancelled. */
  | { type: "done" }
  | { type: "back" }
  /** Back to the main page, forgetting everything. */
  | { type: "home" };

export const START: FlowState = {
  path: null,
  step: "main",
  editing: false,
  branchId: null,
  mobile: null,
  requestId: null,
  hasPatients: false,
  appointmentId: null,
  patientId: null,
  form: null,
  procedureIds: [],
  dentistId: null,
  startsAt: null,
  history: [],
};

/** The step each path ends on before "done": the booking's summary, the change's details, the cancel's question. */
const LAST: Record<Path, Step> = { book: "summary", change: "details", cancel: "confirm_cancel" };

export function flow(state: FlowState, action: FlowAction): FlowState {
  const { history, ...now } = state;
  // Forward: remember this state, so Back returns to it.
  const go = (next: Partial<Snapshot>): FlowState => ({ ...now, ...next, history: [...history, now] });
  // In place: Back skips this state (a used code, a time that was taken).
  const stay = (next: Partial<Snapshot>): FlowState => ({ ...now, ...next, history });
  // Finishing a Change returns to the summary or the booking details with the history it had there, so Back from it
  // never walks into the finished Change.
  const finish = (next: Partial<Snapshot>): FlowState => {
    const home = state.path === "change" ? "details" : "summary";
    const at = history.map((h) => h.step).lastIndexOf(home);
    return { ...now, ...next, step: home, editing: false, history: at >= 0 ? history.slice(0, at) : history };
  };
  const at = (...steps: Step[]) => steps.includes(state.step);

  switch (action.type) {
    case "home":
      return START;
    case "back":
      if (state.step === "done" || history.length === 0) return state;
      return { ...history[history.length - 1], history: history.slice(0, -1) };
    case "start":
      if (!at("main")) return state;
      if (action.path === "book" && action.onlyBranchId === null) return go({ path: "book", step: "branch" });
      return go({ path: action.path, step: "number", branchId: action.path === "book" ? action.onlyBranchId : null });
    case "branch":
      return at("branch") ? go({ step: "number", branchId: action.branchId }) : state;
    case "code_sent":
      if (at("number")) return go({ step: "code", mobile: action.mobile, requestId: action.requestId });
      return at("code") ? stay({ requestId: action.requestId }) : state;
    case "verified": {
      if (!at("number", "code")) return state;
      const step: Step = state.path !== "book" ? "list" : action.hasPatients ? "who" : "form";
      const next = { step, mobile: action.mobile, requestId: null, hasPatients: action.hasPatients };
      // Back from the next step returns to the number, never to a code that is already used.
      return at("code") ? stay(next) : go(next);
    }
    case "patient":
      if (!at("who")) return state;
      return state.editing ? finish({ patientId: action.patientId, form: null }) : go({ step: "services", patientId: action.patientId, form: null });
    case "someone_new":
      return at("who") ? go({ step: "form" }) : state;
    case "form":
      if (!at("form")) return state;
      return state.editing ? finish({ patientId: null, form: action.form }) : go({ step: "services", patientId: null, form: action.form });
    case "services": {
      if (!at("services")) return state;
      const chosen = { procedureIds: action.procedureIds, dentistId: action.dentistId };
      // Spec 2.3: new services change the visit's length, so a time that no longer fits is chosen again.
      if (state.editing && action.timeFits && state.startsAt !== null) return finish(chosen);
      return go({ ...chosen, step: "time", startsAt: null });
    }
    case "time":
      if (!at("time")) return state;
      return state.editing ? finish({ startsAt: action.startsAt }) : go({ step: "summary", startsAt: action.startsAt });
    case "change": {
      if (!at("summary", "details")) return state;
      // Spec 3.3 step 3: with no patients to choose from, "Change patient" opens the new patient form directly,
      // the same place a first-time verify with no patients goes, instead of a who step with nothing to list.
      const part = action.part === "patient" ? (state.hasPatients ? "who" : "form") : action.part;
      return go({ step: part, editing: true });
    }
    case "taken":
      return at("summary", "details") ? stay({ step: "time", startsAt: null, editing: true }) : state;
    case "appointment": {
      if (!at("list")) return state;
      const a = action.appointment;
      return go({
        step: state.path === "cancel" ? "confirm_cancel" : "details",
        appointmentId: a.id,
        branchId: a.branchId,
        patientId: a.patientId,
        form: null,
        procedureIds: a.procedureIds,
        dentistId: a.dentistId,
        startsAt: a.startsAt,
      });
    }
    case "keep":
      return at("confirm_cancel") ? flow(state, { type: "back" }) : state;
    case "done":
      // The form holds health information: forget it once it is sent. Back is over; the main page is next.
      return state.path !== null && at(LAST[state.path]) ? { ...now, step: "done", editing: false, form: null, history: [] } : state;
  }
}
