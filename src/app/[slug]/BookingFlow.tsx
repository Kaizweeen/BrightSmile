"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import Field from "@/components/Field";
import TimeStep from "./TimeStep";
import {
  bookForNumber,
  cancelForNumber,
  changeForNumber,
  checkVerification,
  getBranch,
  getOpenStarts,
  numberAppointments,
  numberPatients,
  resendBookingCode,
  startVerification,
} from "./actions";
import type { PublicClinic, PublicDentist } from "@/lib/booking-input";
import { flow, START, type FlowAction, type Path } from "@/lib/booking-flow";
import { intakeInput, type IntakeForm } from "@/lib/intake";
import type { NumberAppointment, NumberPatient, Refused } from "@/lib/number-booking";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { fitsAnyBlock, mergeWeeks } from "@/lib/slots";
import { formatDate, formatTime, manilaDate } from "@/lib/time";

// Only new patients see the form, and it is long, so its code loads when that step opens: a phone's first visit to the
// page stays light.
const PatientForm = dynamic(() => import("./PatientForm"), {
  loading: () => (
    <p className="empty-note" aria-live="polite">
      Opening the form...
    </p>
  ),
});

type Props = { clinic: PublicClinic; nowIso: string };

const H2 = "font-display text-[19px] font-bold outline-none";
const UNAVAILABLE = "Booking is temporarily unavailable. Please try again in a few minutes.";
const MOBILE_HINT = "Enter a Philippine mobile number, like 0917 123 4567.";
const VERIFY_AGAIN = "Please enter your number again to continue.";
const CHANGED = "This appointment changed a moment ago. Here are your appointments now.";
const REFUSED: Record<Refused["status"], string> = {
  unverified: "This phone did not keep your verified number. Allow cookies for this site, then try again.",
  invalid: "This booking link doesn't exist.",
  unavailable: UNAVAILABLE,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/**
 * One line of a summary: what it is, its value, and its Change button when it can change (spec 3.3 step 7). `working`
 * disables Change while a send is in flight, so a late answer can never land on a step the reducer has left.
 */
function Row({ k, v, onChange, working }: { k: string; v: ReactNode; onChange?: () => void; working?: boolean }) {
  return (
    <div className="cf-row items-center">
      <span className="k">{k}</span>
      <span className="v">
        {v}
        {onChange && (
          <button
            type="button"
            className="link ml-3 inline-flex min-h-11 items-center"
            aria-label={`Change the ${k.toLowerCase()}`}
            disabled={working}
            onClick={onChange}
          >
            Change
          </button>
        )}
      </span>
    </div>
  );
}

function Place({ name, address }: { name: string; address: string }) {
  return (
    <>
      {name}
      {address && <span className="f-hint block">{address}</span>}
    </>
  );
}

/**
 * Services (spec 3.3 step 5): the branch's active procedures, several allowed, and the dentist when the branch has 2 or
 * more. It starts from what the flow already holds, so a Change opens with the earlier choice.
 */
function ServicesStep({
  branch,
  initialIds,
  initialDentistId,
  editing,
  working,
  call,
  onDone,
  onBack,
}: {
  branch: PublicClinic;
  initialIds: string[];
  initialDentistId: string | null;
  editing: boolean;
  working: boolean;
  call: ReactNode;
  onDone: (procedureIds: string[], dentistId: string) => void;
  onBack: () => void;
}) {
  const [ids, setIds] = useState(() => initialIds.filter((id) => branch.procedures.some((p) => p.id === id)));
  const [dentistId, setDentistId] = useState(() =>
    branch.dentists.some((d) => d.id === initialDentistId) ? (initialDentistId as string) : branch.dentists.length === 1 ? branch.dentists[0].id : "",
  );
  const [query, setQuery] = useState("");
  const showDentist = branch.dentists.length > 1;
  const dentist = branch.dentists.find((d) => d.id === dentistId);
  const duration = branch.procedures.filter((p) => ids.includes(p.id)).reduce((sum, p) => sum + p.minutes, 0);
  const tooLong = duration > 0 && !fitsAnyBlock(duration, dentist ? dentist.hours : mergeWeeks(branch.dentists.map((d) => d.hours)));
  const search = query.trim().toLowerCase();
  const listed = search ? branch.procedures.filter((p) => p.name.toLowerCase().includes(search)) : branch.procedures;
  const back = (
    <button type="button" className="btn btn-ghost" onClick={onBack}>
      Back
    </button>
  );

  if (branch.dentists.length === 0 || branch.procedures.length === 0) {
    return (
      <>
        <p className="note-box">This branch isn&apos;t taking online bookings yet. Call {call} to book.</p>
        <div className="mt-6">{back}</div>
      </>
    );
  }

  return (
    <>
      {branch.procedures.length > 6 && (
        <input
          type="search"
          className="f-input mb-3"
          placeholder="Search procedures"
          aria-label="Search procedures"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="member-list">
        {listed.map((p) => (
          <label key={p.id} className="member-row">
            <input
              type="checkbox"
              checked={ids.includes(p.id)}
              onChange={() => setIds((list) => (list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id]))}
              aria-label={`${p.name}, ${p.minutes} minutes`}
            />
            <span className="nm">{p.name}</span>
            <span className="meta">{p.minutes} min</span>
          </label>
        ))}
        {listed.length === 0 && <p className="empty-note">No procedure matches that search.</p>}
      </div>

      {showDentist && (
        <fieldset className="mt-5">
          <legend className="f-label">Dentist</legend>
          <div className="member-list">
            {branch.dentists.map((d) => (
              <label key={d.id} className="member-row">
                <input type="radio" name="dentist" value={d.id} aria-label={d.name} checked={dentistId === d.id} onChange={() => setDentistId(d.id)} />
                <span className="nm">{d.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="cf-row mt-4">
        <span className="k">Estimated time</span>
        <span className="v">{duration > 0 ? `${duration} min` : "Nothing chosen yet"}</span>
      </div>
      {tooLong && <p className="note-box warn mt-4">No single opening fits all of these. Choose fewer procedures or call {call}.</p>}

      <div className="mt-6 flex gap-3">
        {back}
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={working || duration === 0 || tooLong || !dentist}
          onClick={() => onDone(ids, dentistId)}
        >
          {duration === 0 ? "Pick what you need" : !dentist ? "Choose a dentist" : editing ? "Continue" : "Pick a day"}
        </button>
      </div>
    </>
  );
}

/**
 * The public booking page (booking flow spec 3): the main page and the paths to book, to reschedule or edit, and to
 * cancel. The page shows the flow reducer's step and calls the Server Actions with what the flow holds; the reducer
 * alone decides the next step (spec 7). The server checks the verified number and every row again on each call.
 * Nothing about a patient goes into the address bar, and the patient form stays in memory until it is sent.
 */
export default function BookingFlow({ clinic, nowIso }: Props) {
  const [state, dispatch] = useReducer(flow, START);
  // The clinic as loaded at the branch in use: its dentists, their hours there, and the procedures.
  const [branch, setBranch] = useState<PublicClinic>(clinic);
  const [patients, setPatients] = useState<NumberPatient[]>([]);
  const [appointments, setAppointments] = useState<NumberAppointment[]>([]);
  const [picked, setPicked] = useState<NumberAppointment | null>(null);
  const [mobileText, setMobileText] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [token, setToken] = useState("");
  // The day of a time that stopped fitting (taken, or too short for new services), where the time step reopens.
  const [retryDate, setRetryDate] = useState<string | null>(null);
  // The last patient form filled in this visit: the reducer's own history forgets it on Back (spec 7 history holds the
  // state from before the form step), so the page remembers it here and offers it again rather than making the
  // patient retype health information. Cleared at the same points the reducer would have forgotten state.form.
  const [lastForm, setLastForm] = useState<IntakeForm | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const today = manilaDate(new Date(nowIso));
  const phone = localMobile(clinic.mobile);
  const call = (
    <a href={`tel:${clinic.mobile}`} className="link">
      {phone}
    </a>
  );
  // Words for the answers several actions share.
  const said = {
    limited: `Too many codes for now. Try again in an hour, or call ${phone}.`,
    sms_failed: `We couldn't send the code. Try again, or call ${phone}.`,
    unavailable: UNAVAILABLE,
  };
  const closed = clinic.procedures.length === 0 || (clinic.branches.length === 1 && clinic.dentists.length === 0);
  const chosen = branch.procedures.filter((p) => state.procedureIds.includes(p.id));
  const duration = chosen.reduce((sum, p) => sum + p.minutes, 0);
  const dentist: PublicDentist | null = branch.dentists.find((d) => d.id === state.dentistId) ?? null;
  const start = state.startsAt ? new Date(state.startsAt) : null;
  const person = patients.find((p) => p.id === state.patientId);
  const patientName = state.form ? `${state.form.first} ${state.form.last}` : person ? `${person.first} ${person.last}` : "";
  const services = chosen.length > 0 ? `${chosen.map((p) => p.name).join(", ")} (${duration} min)` : "Choose again";
  const when = start ? `${formatDate(start)}, ${formatTime(start)}` : "Choose again";
  // What the server checks open times for: the chosen branch, or the appointment being changed (its own branch, its own
  // time counted as free). Memoized so the time step asks again only when the choice changes.
  const selection = useMemo(
    () =>
      state.path === "change"
        ? { changing: state.appointmentId, mobile: state.mobile, dentistId: state.dentistId, procedureIds: state.procedureIds }
        : { branchId: state.branchId, dentistId: state.dentistId, procedureIds: state.procedureIds },
    [state.path, state.appointmentId, state.mobile, state.branchId, state.dentistId, state.procedureIds],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.step]);

  // The resend countdown starts where the code was sent, so nothing sets state straight from an effect.
  useEffect(() => {
    if (state.step !== "code") return;
    const tick = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [state.step]);

  function go(action: FlowAction) {
    setNotice("");
    setFieldError("");
    dispatch(action);
  }

  async function run(task: () => Promise<void>) {
    setWorking(true);
    setNotice("");
    try {
      await task();
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  function home() {
    setBranch(clinic);
    setPicked(null);
    setToken("");
    setRetryDate(null);
    setLastForm(null);
    go({ type: "home" });
  }

  /** The server no longer sees this number as verified on this phone (the cookie went): start again from the number. */
  function again() {
    home();
    setNotice(VERIFY_AGAIN);
  }

  function begin(path: Path) {
    setBranch(clinic);
    go({ type: "start", path, onlyBranchId: clinic.branches.length === 1 ? clinic.branch.id : null });
  }

  /**
   * Spec 3.3 step 1: the branch's dentists and hours come with it. A branch with no dentist hours or no procedures yet
   * is normal for a newly added one, so it stays off the flow rather than dispatching into a dead end.
   */
  function chooseBranch(id: string) {
    void run(async () => {
      const data = id === clinic.branch.id ? clinic : await getBranch(clinic.slug, id);
      if (!data || data.dentists.length === 0 || data.procedures.length === 0) {
        setNotice(`That branch isn't taking online bookings now. Choose another, or call ${phone}.`);
        return;
      }
      setBranch(data);
      go({ type: "branch", branchId: id });
    });
  }

  /**
   * After the number is verified: the lists the path shows next (spec 3.3 step 3, 3.4 and 3.5 step 2). Next sends one
   * Server Action at a time from a page, so they are asked one after the other.
   */
  async function verified(mobile: string) {
    const people = state.path === "cancel" ? null : await numberPatients(clinic.slug, mobile);
    const visits = state.path === "book" ? null : await numberAppointments(clinic.slug, mobile);
    for (const outcome of [people, visits]) {
      if (outcome && outcome.status !== "ok") {
        setNotice(REFUSED[outcome.status]);
        return;
      }
    }
    const found = people?.status === "ok" ? people.patients : [];
    setPatients(found);
    setAppointments(visits?.status === "ok" ? visits.appointments : []);
    go({ type: "verified", mobile, hasPatients: found.length > 0 });
  }

  /** Spec 3.2: straight on for a number this phone verified before, otherwise a code by text. */
  function sendNumber() {
    const mobile = normalizeMobile(mobileText);
    if (!mobile) {
      setFieldError(MOBILE_HINT);
      return;
    }
    setFieldError("");
    void run(async () => {
      const outcome = await startVerification(clinic.slug, mobile);
      switch (outcome.status) {
        case "verified":
          return verified(outcome.mobile);
        case "code":
          setCode("");
          setResendIn(60);
          go({ type: "code_sent", mobile: outcome.mobile, requestId: outcome.requestId });
          return;
        case "invalid":
          setFieldError(MOBILE_HINT);
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  function checkCode() {
    const requestId = state.requestId;
    if (!/^\d{6}$/.test(code) || !requestId) {
      setFieldError("Enter the 6 digits from the text.");
      return;
    }
    setFieldError("");
    void run(async () => {
      const outcome = await checkVerification(requestId, code);
      switch (outcome.status) {
        case "verified":
          return verified(outcome.mobile);
        case "wrong":
          setFieldError(
            outcome.attemptsLeft > 0
              ? `That code is not right. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? "try" : "tries"} left.`
              : "Too many wrong tries. Send another code.",
          );
          return;
        case "expired":
          setFieldError("That code has expired. Send another code.");
          return;
        case "locked":
          setFieldError("Too many wrong tries. Send another code.");
          return;
        case "used":
          setFieldError("That code was already used. Send another code.");
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  function resend() {
    const { requestId, mobile } = state;
    if (!requestId || !mobile) return;
    void run(async () => {
      const outcome = await resendBookingCode(requestId);
      switch (outcome.status) {
        case "code":
          setCode("");
          setResendIn(60);
          go({ type: "code_sent", mobile, requestId: outcome.requestId });
          return;
        case "wait":
          setResendIn(outcome.seconds);
          return;
        case "gone":
          go({ type: "back" });
          setNotice(VERIFY_AGAIN);
          return;
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** Spec 2.3: new services change the visit's length, so the chosen time is checked again before the summary. */
  function chooseServices(procedureIds: string[], dentistId: string) {
    const startsAt = state.startsAt;
    if (!state.editing || !startsAt) {
      go({ type: "services", procedureIds, dentistId, timeFits: false });
      return;
    }
    void run(async () => {
      const at = new Date(startsAt);
      const open = await getOpenStarts(clinic.slug, { ...selection, dentistId, procedureIds }, manilaDate(at));
      const timeFits = open.some((s) => new Date(s).getTime() === at.getTime());
      setRetryDate(manilaDate(at));
      go({ type: "services", procedureIds, dentistId, timeFits });
      if (!timeFits) setNotice("Your time doesn't fit these services. Pick a new time.");
    });
  }

  function timeTaken(message: string) {
    if (state.startsAt) setRetryDate(manilaDate(new Date(state.startsAt)));
    dispatch({ type: "taken" });
    setNotice(message);
  }

  /**
   * A send the server refused on its own checks: back to the part that needs a new choice. errors.slot means the
   * dentist or procedures no longer resolve at this branch (not merely that the time was taken), so the branch loads
   * again and services are chosen again, not just the time. errors.patient means the chosen patient is gone, so the
   * list loads again before "Who" shows it.
   */
  async function refusedParts(errors: Record<string, string>) {
    if (errors.slot) {
      const id = state.branchId ?? clinic.branch.id;
      const data = id === clinic.branch.id ? clinic : await getBranch(clinic.slug, id);
      if (data) setBranch(data);
      dispatch({ type: "change", part: "services" });
      setNotice(errors.slot);
      return;
    }
    if (errors.branch) {
      home();
      setNotice(errors.branch);
      return;
    }
    if (errors.patient) {
      const found = await numberPatients(clinic.slug, state.mobile ?? "");
      if (found.status === "ok") setPatients(found.patients);
      dispatch({ type: "change", part: "patient" });
      setNotice(errors.patient);
      return;
    }
    // The new patient's form has a problem.
    dispatch({ type: "change", part: "patient" });
    setNotice("Please check the patient form again.");
  }

  const who = () => (state.form ? { form: intakeInput(state.form) } : { patientId: state.patientId });

  /** Spec 3.3 step 7 "Send request". */
  function sendRequest() {
    void run(async () => {
      const outcome = await bookForNumber(clinic.slug, {
        mobile: state.mobile,
        branchId: state.branchId,
        dentistId: state.dentistId,
        procedureIds: state.procedureIds,
        startsAt: state.startsAt,
        ...who(),
      });
      switch (outcome.status) {
        case "sent":
          setToken(outcome.token);
          setLastForm(null);
          go({ type: "done" });
          return;
        case "taken":
          return timeTaken("That time was just taken. Pick another one.");
        case "too_many":
          setNotice(`You already have requests waiting. Please call the clinic at ${phone}.`);
          return;
        case "invalid":
          return refusedParts(outcome.errors);
        case "unverified":
          return again();
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** The list again, after the server said the appointment changed underneath (spec 3.4, 3.5). */
  async function listAgain() {
    const found = await numberAppointments(clinic.slug, state.mobile ?? "");
    if (found.status === "ok") setAppointments(found.appointments);
    go({ type: "back" });
    setNotice(CHANGED);
  }

  /** Spec 3.4 step 3 and 3.5 step 3: a change needs the branch's services and dentists; a cancel needs nothing more. */
  function openAppointment(a: NumberAppointment) {
    const choose = () => {
      setPicked(a);
      go({
        type: "appointment",
        appointment: { id: a.id, branchId: a.branch.id, patientId: a.patient.id, procedureIds: a.procedureIds, dentistId: a.dentist.id, startsAt: a.startsAt },
      });
    };
    if (state.path === "cancel") return choose();
    void run(async () => {
      const data = a.branch.id === clinic.branch.id ? clinic : await getBranch(clinic.slug, a.branch.id);
      if (!data) {
        setNotice(`Please call the clinic to change it: ${phone}.`);
        return;
      }
      setBranch(data);
      choose();
    });
  }

  /** Spec 3.4 step 4 "Send changes". */
  function sendChanges() {
    void run(async () => {
      const outcome = await changeForNumber(clinic.slug, {
        mobile: state.mobile,
        appointmentId: state.appointmentId,
        dentistId: state.dentistId,
        procedureIds: state.procedureIds,
        startsAt: state.startsAt,
        ...who(),
      });
      switch (outcome.status) {
        case "sent":
          setLastForm(null);
          go({ type: "done" });
          return;
        case "taken":
          return timeTaken("That time was just taken. Pick another one.");
        case "call_clinic":
          setNotice(`It's too close to the visit to change it online. Please call the clinic to change it: ${phone}.`);
          return;
        case "unchanged":
          setNotice("Nothing is changed yet. Use Change on the part you want to change.");
          return;
        case "gone":
          return listAgain();
        case "invalid":
          return refusedParts(outcome.errors);
        case "unverified":
          return again();
        default:
          setNotice(said[outcome.status]);
      }
    });
  }

  /** Spec 3.5 step 3 "Yes, cancel it". */
  function cancelIt() {
    const id = state.appointmentId;
    if (!id) return;
    void run(async () => {
      const outcome = await cancelForNumber(clinic.slug, state.mobile ?? "", id);
      switch (outcome) {
        case "cancelled":
          go({ type: "done" });
          return;
        case "not_allowed":
          setNotice(`This appointment can't be cancelled online any more. Please call the clinic at ${phone}.`);
          return;
        case "gone":
          return listAgain();
        case "unverified":
          return again();
        case "unavailable":
          setNotice(UNAVAILABLE);
          return;
      }
    });
  }

  const back = (
    <button type="button" className="btn btn-ghost" disabled={working} onClick={() => go({ type: "back" })}>
      Back
    </button>
  );
  const mainButton = (
    <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={home}>
      Back to the main page
    </button>
  );
  const heading = (text: string) => (
    <h2 ref={headingRef} tabIndex={-1} className={H2}>
      {text}
    </h2>
  );

  let screen: ReactNode = null;
  switch (state.step) {
    case "main":
      screen = (
        <section>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-[17px] font-semibold outline-none">
            Book a visit, or change or cancel one you have.
          </h2>
          <div className="mt-5">
            {closed ? (
              <p className="note-box">Online booking isn&apos;t open yet. Call {call} to book.</p>
            ) : (
              <button type="button" className="btn btn-primary wide-btn" onClick={() => begin("book")}>
                Book an appointment
              </button>
            )}
            <button type="button" className="btn btn-ghost wide-btn mt-3" onClick={() => begin("change")}>
              Reschedule or edit a booking
            </button>
            <button type="button" className="btn btn-ghost wide-btn mt-3" onClick={() => begin("cancel")}>
              Cancel a booking
            </button>
          </div>
          <h3 className="f-label mt-7">{clinic.branches.length > 1 ? "Our branches" : "Where to find us"}</h3>
          <div className="member-list">
            {clinic.branches.map((b) => (
              <div key={b.id} className="member-row cursor-default">
                <span className="nm">
                  {b.name}
                  {b.address && <span className="meta block">{b.address}</span>}
                </span>
                {b.mapsUrl && (
                  <a href={b.mapsUrl} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" aria-label={`Map of ${b.name}`}>
                    Map
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      );
      break;

    case "branch":
      screen = (
        <section>
          {heading("Which branch?")}
          <p className="sub">Choose where you want to go.</p>
          <div className="member-list">
            {clinic.branches.map((b) => (
              <button key={b.id} type="button" className="member-row w-full text-left" disabled={working} onClick={() => chooseBranch(b.id)}>
                <span className="nm">
                  {b.name}
                  {b.address && <span className="meta block">{b.address}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "number":
      screen = (
        <section>
          {heading("Your mobile number")}
          <p className="sub">We text a 6 digit code to check it is yours. A phone that checked this number before goes straight on.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendNumber();
            }}
          >
            <Field label="Mobile number" error={fieldError}>
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  +63
                </span>
                <input
                  className="f-input"
                  value={mobileText}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="917 123 4567"
                  onChange={(e) => setMobileText(e.target.value)}
                />
              </span>
            </Field>
            <div className="mt-6 flex gap-3">
              {back}
              <button type="submit" className="btn btn-primary flex-1" disabled={working}>
                {working ? "Checking..." : "Continue"}
              </button>
            </div>
          </form>
        </section>
      );
      break;

    case "code":
      screen = (
        <section>
          {heading("Check your texts")}
          <p className="sub">We sent a 6 digit code to {localMobile(state.mobile ?? "+63")}. It expires in 5 minutes.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              checkCode();
            }}
          >
            <Field label="Code from the text" error={fieldError}>
              <input
                className="f-input text-center text-2xl font-bold tracking-[0.3em] tabular-nums"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="mt-6 flex gap-3">
              {back}
              <button type="submit" className="btn btn-primary flex-1" disabled={working}>
                {working ? "Checking..." : "Verify"}
              </button>
            </div>
          </form>
          <p className="f-hint mt-4">
            {resendIn > 0 ? (
              <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
            ) : (
              <button type="button" onClick={resend} className="link inline-flex min-h-11 items-center" disabled={working}>
                Send another code
              </button>
            )}
          </p>
        </section>
      );
      break;

    case "who":
      screen = (
        <section>
          {heading("Who is the appointment for?")}
          <p className="sub">Choose a patient on this number, or someone new.</p>
          <div className="member-list">
            {patients.map((p) => (
              <button
                key={p.id}
                type="button"
                className="member-row w-full text-left"
                onClick={() => {
                  setLastForm(null);
                  go({ type: "patient", patientId: p.id });
                }}
              >
                <span className="nm">
                  {p.first} {p.last}
                </span>
              </button>
            ))}
            <button type="button" className="member-row w-full text-left" onClick={() => go({ type: "someone_new" })}>
              <span className="nm">Someone new</span>
              <span className="meta">Fill in the patient form</span>
            </button>
          </div>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "form":
      screen = (
        <section>
          {heading("New patient form")}
          <p className="sub">The clinic keeps one form for each patient. It takes about 5 minutes.</p>
          <PatientForm
            clinicName={clinic.name}
            mobile={state.mobile ?? ""}
            today={today}
            initial={state.form ?? lastForm}
            onDone={(form) => {
              setLastForm(form);
              go({ type: "form", form });
            }}
            onBack={() => go({ type: "back" })}
          />
        </section>
      );
      break;

    case "services":
      screen = (
        <section>
          {heading("What do you need?")}
          <p className="sub">Pick everything you need in one visit. The times you see will fit all of it.</p>
          <ServicesStep
            branch={branch}
            initialIds={state.procedureIds}
            initialDentistId={state.dentistId}
            editing={state.editing}
            working={working}
            call={call}
            onDone={chooseServices}
            onBack={() => go({ type: "back" })}
          />
        </section>
      );
      break;

    case "time":
      screen = dentist ? (
        <section>
          {heading("When suits you?")}
          <p className="sub">
            {duration} minutes with {dentist.name} at {branch.branch.name}.
          </p>
          <TimeStep
            key={state.history.length}
            slug={clinic.slug}
            selection={selection}
            dentist={dentist}
            duration={duration}
            rules={clinic.rules}
            nowIso={nowIso}
            initialDate={start ? manilaDate(start) : retryDate}
            initialStart={state.startsAt}
            onPick={(startsAt) => {
              setRetryDate(null);
              go({ type: "time", startsAt });
            }}
            onBack={() => go({ type: "back" })}
          />
        </section>
      ) : (
        <section>
          {heading("When suits you?")}
          <p className="note-box">Choose the services and the dentist again first.</p>
          <div className="mt-6">{back}</div>
        </section>
      );
      break;

    case "summary":
      screen = (
        <section>
          {heading("Check your request")}
          <p className="sub">Change anything before you send it.</p>
          <div className="cf-box">
            <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
            <Row k="Patient" v={patientName} working={working} onChange={() => go({ type: "change", part: "patient" })} />
            <Row k="Services" v={services} working={working} onChange={() => go({ type: "change", part: "services" })} />
            {branch.dentists.length > 1 && (
              <Row k="Dentist" v={dentist?.name ?? "Choose again"} working={working} onChange={() => go({ type: "change", part: "services" })} />
            )}
            <Row k="Date and time" v={when} working={working} onChange={() => go({ type: "change", part: "time" })} />
          </div>
          <p className="f-hint mt-4">The clinic confirms by text. Nothing is booked until they do.</p>
          <div className="mt-6 flex gap-3">
            {back}
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={sendRequest}>
              {working ? "Sending..." : "Send request"}
            </button>
          </div>
        </section>
      );
      break;

    case "list":
      screen = (
        <section>
          {heading("Your appointments")}
          {appointments.length === 0 ? (
            <>
              <p className="note-box mt-4">There is no upcoming appointment for this number.</p>
              {mainButton}
            </>
          ) : (
            <>
              <p className="sub">{state.path === "cancel" ? "Choose the appointment to cancel." : "Choose the appointment to change."}</p>
              <div className="member-list">
                {appointments.map((a) => {
                  const at = new Date(a.startsAt);
                  const locked = state.path === "change" && !a.changeable;
                  const body = (
                    <>
                      <span className="nm">
                        {formatDate(at)}, {formatTime(at)}
                        <span className="meta block">
                          {a.patient.first} {a.patient.last}, {a.branch.name}
                        </span>
                        <span className="meta block">{a.procedures.join(", ")}</span>
                        {locked && <span className="meta block">Please call the clinic to change it.</span>}
                      </span>
                      <span className={`chip ${a.status === "confirmed" ? "chip-green" : "chip-amber"}`}>
                        {a.status === "confirmed" ? "Confirmed" : "Waiting for the clinic"}
                      </span>
                    </>
                  );
                  return locked ? (
                    <div key={a.id} className="member-row cursor-default">
                      {body}
                    </div>
                  ) : (
                    <button key={a.id} type="button" className="member-row w-full text-left" disabled={working} onClick={() => openAppointment(a)}>
                      {body}
                    </button>
                  );
                })}
              </div>
              <div className="mt-6">{back}</div>
            </>
          )}
        </section>
      );
      break;

    case "details":
      screen = (
        <section>
          {heading("Booking details")}
          <p className="sub">Change what you need, then send the changes. The clinic confirms again by text.</p>
          <div className="cf-box">
            <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
            <Row k="Patient" v={patientName} working={working} onChange={() => go({ type: "change", part: "patient" })} />
            <Row k="Services" v={services} working={working} onChange={() => go({ type: "change", part: "services" })} />
            {branch.dentists.length > 1 && (
              <Row k="Dentist" v={dentist?.name ?? picked?.dentist.name ?? ""} working={working} onChange={() => go({ type: "change", part: "services" })} />
            )}
            <Row k="Date and time" v={when} working={working} onChange={() => go({ type: "change", part: "time" })} />
          </div>
          <p className="f-hint mt-4">The branch stays the same. To go to another branch, cancel this one and book again.</p>
          <div className="mt-6 flex gap-3">
            {back}
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={sendChanges}>
              {working ? "Sending..." : "Send changes"}
            </button>
          </div>
        </section>
      );
      break;

    case "confirm_cancel":
      screen = picked ? (
        <section>
          {heading("Cancel this appointment?")}
          <p className="sub">The clinic is told, and the time goes back to other patients.</p>
          <div className="cf-box">
            <Row k="Patient" v={`${picked.patient.first} ${picked.patient.last}`} />
            <Row k="Branch" v={<Place name={picked.branch.name} address={picked.branch.address} />} />
            <Row k="Date and time" v={`${formatDate(new Date(picked.startsAt))}, ${formatTime(new Date(picked.startsAt))}`} />
            <Row k="Services" v={picked.procedures.join(", ")} />
            <Row k="Dentist" v={picked.dentist.name} />
          </div>
          <div className="mt-6 flex gap-3">
            <button type="button" className="btn btn-ghost" disabled={working} onClick={() => go({ type: "keep" })}>
              No, keep it
            </button>
            <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={cancelIt}>
              {working ? "Cancelling..." : "Yes, cancel it"}
            </button>
          </div>
        </section>
      ) : null;
      break;

    case "done":
      if (state.path === "change") {
        screen = (
          <section>
            {heading("Changes sent")}
            <p className="sub">The clinic will confirm by text.</p>
            <p>
              <span className="chip chip-amber">Waiting for the clinic</span>
            </p>
            {mainButton}
          </section>
        );
      } else if (state.path === "cancel") {
        screen = (
          <section>
            {heading("Cancelled")}
            <p className="sub">Your appointment is cancelled.</p>
            {mainButton}
          </section>
        );
      } else if (start) {
        screen = (
          <section>
            {heading("Request sent")}
            <p className="sub">The clinic will confirm by text. Nothing is booked until they do.</p>
            <div className="cf-box screen-in">
              <span aria-hidden="true" className="cf-check">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <p className="big-time">{formatTime(start)}</p>
              <p className="font-display text-[15px] font-semibold">{formatDate(start)}</p>
              <p className="mt-3">
                <span className="chip chip-amber">Waiting for the clinic</span>
              </p>
              <div className="mt-4">
                <Row k="Branch" v={<Place name={branch.branch.name} address={branch.branch.address} />} />
                {dentist && <Row k="With" v={dentist.name} />}
                <Row k="For" v={chosen.map((p) => p.name).join(", ")} />
              </div>
            </div>
            {branch.branch.mapsUrl && (
              <a href={branch.branch.mapsUrl} className="link inline-flex min-h-11 items-center" target="_blank" rel="noreferrer">
                Open the map to {branch.branch.name}
              </a>
            )}
            <p className="f-hint mt-4">No reply within a day? Call {call}.</p>
            {token && (
              <p className="f-hint mt-2">
                <Link href={`/a/${token}`} className="link inline-flex min-h-11 items-center">
                  View or cancel this request
                </Link>
              </p>
            )}
            {mainButton}
          </section>
        );
      }
      break;
  }

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <div className="clinic-head">
          <span aria-hidden="true" className="brand-mark">
            {initials(clinic.name)}
          </span>
          <div>
            <h1 className="name">{clinic.name}</h1>
            <p className="meta">{call}</p>
          </div>
        </div>
        <hr className="rule-gold" />
        {notice && (
          <p role="alert" className="note-box warn mb-4">
            {notice}
          </p>
        )}
        {screen}
      </div>

      <p className="mt-5 text-center">
        <span className="brand-lockup">
          <Image src="/brand/logo.png" alt="" width={22} height={22} />
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </span>
      </p>
    </div>
  );
}
