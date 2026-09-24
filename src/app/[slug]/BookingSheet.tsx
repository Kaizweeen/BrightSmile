"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Field from "@/components/Field";
import MonthSheet from "./MonthSheet";
import { getOpenDates, getOpenStarts, requestBooking, resendBookingCode, verifyBookingCode } from "./actions";
import type { BookingOutcome } from "@/lib/booking";
import { detailErrors, HMO_SUGGESTIONS, type Details, type PublicClinic } from "@/lib/booking-input";
import { localMobile, normalizeMobile } from "@/lib/phone";
import { fitsAnyBlock, mergeWeeks, type Block } from "@/lib/slots";
import { addDays, formatDate, formatMinutes, formatTime, manilaDate } from "@/lib/time";
import { LIMITS } from "@/lib/validate";

type Props = { clinic: PublicClinic; nowIso: string };
type Step = "what" | "when" | "who" | "code" | "sent";

const STEPS: { id: Step; label: string }[] = [
  { id: "what", label: "What" },
  { id: "when", label: "When" },
  { id: "who", label: "Who" },
];
const EMPTY_FORM: Details = { first: "", last: "", mobile: "", birthday: "", hmo: "", consent: false };
const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNAVAILABLE = "Booking is temporarily unavailable. Please try again in a few minutes.";

/** The clinic's hours, read off its dentists' own working blocks so the line cannot lie. */
function hoursSummary(week: Block[][]): string {
  const describe = (blocks: Block[]) =>
    blocks.length === 0 ? "closed" : blocks.map((b) => `${formatMinutes(b.start)} to ${formatMinutes(b.end)}`).join(", ");
  const groups: { from: number; to: number; text: string }[] = [];
  for (let day = 0; day < 7; day++) {
    const text = describe(week[day]);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = day;
    else groups.push({ from: day, to: day, text });
  }
  return groups
    .map((g) => `${DAY_HEADS[g.from]}${g.to > g.from ? ` to ${DAY_HEADS[g.to]}` : ""} ${g.text}`)
    .join(" · ");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export default function BookingSheet({ clinic, nowIso }: Props) {
  const [step, setStep] = useState<Step>("what");
  const [procedureIds, setProcedureIds] = useState<string[]>([]);
  const [dentistId, setDentistId] = useState(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => manilaDate(new Date(nowIso)).slice(0, 7));
  const [monthOpen, setMonthOpen] = useState<string[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [starts, setStarts] = useState<string[] | null>(null);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [form, setForm] = useState<Details>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [resendIn, setResendIn] = useState(60);
  const [token, setToken] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Each availability load gets a number; a reply that is no longer the latest is dropped.
  const loads = useRef(0);

  const now = new Date(nowIso);
  const today = manilaDate(now);
  const lastBookable = addDays(today, clinic.rules.maxDaysAhead);
  const week = mergeWeeks(clinic.dentists.map((d) => d.hours));
  const phone = localMobile(clinic.mobile);
  const closed = clinic.dentists.length === 0 || clinic.procedures.length === 0;
  const showDentist = clinic.dentists.length > 1;
  const dentist = clinic.dentists.find((d) => d.id === dentistId) ?? clinic.dentists[0];
  const chosen = clinic.procedures.filter((p) => procedureIds.includes(p.id));
  const duration = chosen.reduce((sum, p) => sum + p.minutes, 0);
  const tooLong = duration > 0 && !fitsAnyBlock(duration, dentistId ? dentist.hours : week);
  const selection = { dentistId: dentist?.id ?? "", procedureIds };
  const closedWeekdays = dentist ? [0, 1, 2, 3, 4, 5, 6].filter((d) => dentist.hours[d].length === 0) : [];
  const search = query.trim().toLowerCase();
  const listed = search ? clinic.procedures.filter((p) => p.name.toLowerCase().includes(search)) : clinic.procedures;
  const start = startIso ? new Date(startIso) : null;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // The countdown starts where the code was requested, so nothing sets state straight from an effect.
  useEffect(() => {
    if (step !== "code") return;
    const tick = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [step]);

  function clearTime() {
    setDate(null);
    setStarts(null);
    setStartIso(null);
  }

  function toggleProcedure(id: string) {
    setProcedureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setMonthOpen(null);
    clearTime();
  }

  function chooseDentist(id: string) {
    setDentistId(id);
    setMonthOpen(null);
    clearTime();
  }

  async function loadMonth(nextMonth: string) {
    const n = ++loads.current;
    setMonth(nextMonth);
    setMonthOpen(null);
    clearTime();
    try {
      const open = await getOpenDates(clinic.slug, selection, nextMonth);
      if (n === loads.current) setMonthOpen(open);
    } catch {
      if (n === loads.current) {
        setMonthOpen([]);
        setNotice(UNAVAILABLE);
      }
    }
  }

  async function loadDay(day: string) {
    const n = ++loads.current;
    setDate(day);
    setStarts(null);
    setStartIso(null);
    try {
      const list = await getOpenStarts(clinic.slug, selection, day);
      if (n === loads.current) setStarts(list);
    } catch {
      if (n === loads.current) {
        setStarts([]);
        setNotice(UNAVAILABLE);
      }
    }
  }

  function goToWhen() {
    setNotice("");
    setStep("when");
    if (monthOpen === null) void loadMonth(month);
  }

  function handleBooking(outcome: BookingOutcome) {
    switch (outcome.status) {
      case "code":
        setRequestId(outcome.requestId);
        setCode("");
        setResendIn(60);
        setStep("code");
        return;
      case "sent":
        setToken(outcome.token);
        setStep("sent");
        return;
      case "taken":
        setStarts(outcome.starts);
        setStartIso(null);
        setNotice("That time was just taken. Pick another one below.");
        setStep("when");
        return;
      case "invalid":
        setErrors(outcome.errors);
        if (outcome.errors.slot) {
          setNotice(outcome.errors.slot);
          setStep("when");
        }
        return;
      case "limited":
        setNotice(`Too many attempts. Try again in an hour or call ${phone}.`);
        return;
      case "sms_failed":
        setNotice(`We couldn't send the code. Try again, or call ${phone}.`);
        return;
      case "unavailable":
        setNotice(UNAVAILABLE);
        return;
    }
  }

  async function submitDetails() {
    const problems = detailErrors(form, today);
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !startIso) return;
    setWorking(true);
    setNotice("");
    try {
      handleBooking(await requestBooking(clinic.slug, { ...selection, startsAt: startIso, ...form }));
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setErrors({ code: "Enter the 6 digits from the text." });
      return;
    }
    setErrors({});
    setNotice("");
    setWorking(true);
    try {
      const outcome = await verifyBookingCode(requestId, code);
      switch (outcome.status) {
        case "sent":
          setToken(outcome.token);
          setStep("sent");
          break;
        case "wrong":
          setErrors({
            code:
              outcome.attemptsLeft > 0
                ? `That code is not right. ${outcome.attemptsLeft} ${outcome.attemptsLeft === 1 ? "try" : "tries"} left.`
                : "Too many wrong tries. Send another code.",
          });
          break;
        case "expired":
          setErrors({ code: "That code has expired. Send another code." });
          break;
        case "locked":
          setErrors({ code: "Too many wrong tries. Send another code." });
          break;
        case "used":
          setErrors({ code: "That code was already used. Send another code." });
          break;
        case "taken":
          setStarts(outcome.starts);
          setStartIso(null);
          setNotice("That time was just taken. Your number is verified, so pick another time and send again.");
          setStep("when");
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
      }
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  async function resend() {
    setNotice("");
    setWorking(true);
    try {
      const outcome = await resendBookingCode(requestId);
      switch (outcome.status) {
        case "code":
          setRequestId(outcome.requestId);
          setCode("");
          setErrors({});
          setResendIn(60);
          break;
        case "wait":
          setResendIn(outcome.seconds);
          break;
        case "limited":
          setNotice(`Too many attempts. Try again in an hour or call ${phone}.`);
          break;
        case "sms_failed":
          setNotice(`We couldn't send the code. Try again, or call ${phone}.`);
          break;
        case "gone":
          setNotice("Please send your request again.");
          setStep("who");
          break;
        case "unavailable":
          setNotice(UNAVAILABLE);
          break;
      }
    } catch {
      setNotice(UNAVAILABLE);
    } finally {
      setWorking(false);
    }
  }

  function startOver() {
    setProcedureIds([]);
    setDentistId(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
    setQuery("");
    setMonthOpen(null);
    clearTime();
    setForm(EMPTY_FORM);
    setErrors({});
    setNotice("");
    setCode("");
    setRequestId("");
    setToken("");
    setStep("what");
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
            <p className="meta">
              {clinic.address}
              {clinic.mapsUrl && (
                <>
                  {" "}
                  <a href={clinic.mapsUrl} className="link" target="_blank" rel="noreferrer">
                    Map
                  </a>
                </>
              )}
            </p>
            <p className="meta">{hoursSummary(week)}</p>
            <p className="meta">
              <a href={`tel:${clinic.mobile}`} className="link">
                {phone}
              </a>
            </p>
          </div>
        </div>
        <hr className="rule-gold" />

        {closed ? (
          <p className="note-box">
            {"Online booking isn't open yet. Call "}
            <a href={`tel:${clinic.mobile}`} className="font-semibold underline">
              {phone}
            </a>
            {" to book."}
          </p>
        ) : (
          <>
            {step !== "sent" && (
              <div className="step-row" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s.id} className="flex items-center gap-2" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                    <span className={`step-pip ${s.id === step ? "active" : ""} ${i < stepIndex || step === "code" ? "done" : ""}`}>
                      <span className="num">{i < stepIndex || step === "code" ? "✓" : i + 1}</span>
                      {s.label}
                    </span>
                    {i < STEPS.length - 1 && <span className="step-sep" />}
                  </span>
                ))}
              </div>
            )}

            {notice && step !== "sent" && (
              <p role="alert" className="note-box warn mb-4">
                {notice}
              </p>
            )}

            {step === "what" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  What do you need?
                </h2>
                <p className="sub">Pick everything you need in one visit. The times you see will fit all of it.</p>

                {clinic.procedures.length > 6 && (
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
                        checked={procedureIds.includes(p.id)}
                        onChange={() => toggleProcedure(p.id)}
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
                      {clinic.dentists.map((d) => (
                        <label key={d.id} className="member-row">
                          <input
                            type="radio"
                            name="dentist"
                            value={d.id}
                            aria-label={d.name}
                            checked={dentistId === d.id}
                            onChange={() => chooseDentist(d.id)}
                          />
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

                {tooLong && (
                  <p className="note-box warn mt-4">
                    No single opening fits all of these. Choose fewer procedures or call{" "}
                    <a href={`tel:${clinic.mobile}`} className="font-semibold underline">
                      {phone}
                    </a>
                    .
                  </p>
                )}

                <button
                  type="button"
                  className="btn btn-primary wide-btn mt-6"
                  disabled={duration === 0 || tooLong || (showDentist && !dentistId)}
                  onClick={goToWhen}
                >
                  {duration === 0 ? "Pick what you need" : showDentist && !dentistId ? "Choose a dentist" : "Pick a day"}
                </button>
              </section>
            )}

            {step === "when" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  When suits you?
                </h2>
                <p className="sub">
                  {duration} minutes with {dentist.name}.
                </p>

                <MonthSheet
                  month={month}
                  today={today}
                  lastBookable={lastBookable}
                  openDates={monthOpen ?? []}
                  loading={monthOpen === null}
                  closedWeekdays={closedWeekdays}
                  selected={date}
                  onSelect={(d) => void loadDay(d)}
                  onMonth={(delta) => void loadMonth(addDays(`${month}-01`, delta > 0 ? 31 : -1).slice(0, 7))}
                />

                {date && (
                  <div className="screen-in mt-6">
                    <div className="mini-head">
                      <p className="m font-display">{formatDate(new Date(`${date}T00:00:00+08:00`))}</p>
                      {starts && (
                        <span className="chip chip-brand">
                          {starts.length} {starts.length === 1 ? "opening" : "openings"}
                        </span>
                      )}
                    </div>
                    {starts === null ? (
                      <p className="empty-note" aria-live="polite">
                        Checking times...
                      </p>
                    ) : starts.length === 0 ? (
                      <p className="empty-note">Nothing left on this day.</p>
                    ) : (
                      <div className="slot-grid">
                        {starts.map((iso) => (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => setStartIso(iso)}
                            aria-pressed={iso === startIso}
                            className={`slot ${iso === startIso ? "sel" : ""}`}
                          >
                            {formatTime(new Date(iso))}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-6 flex gap-3">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("what")}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary flex-1"
                    disabled={!startIso}
                    onClick={() => {
                      setNotice("");
                      setStep("who");
                    }}
                  >
                    {startIso ? `Take ${formatTime(new Date(startIso))}` : "Pick a time"}
                  </button>
                </div>
              </section>
            )}

            {step === "who" && start && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Who is this for?
                </h2>
                <p className="sub">The clinic texts this number to confirm.</p>

                <div className="cf-box mb-5">
                  <div className="cf-row">
                    <span className="k">When</span>
                    <span className="v">{`${formatDate(start)}, ${formatTime(start)}`}</span>
                  </div>
                  <div className="cf-row">
                    <span className="k">With</span>
                    <span className="v">{dentist.name}</span>
                  </div>
                  <div className="cf-row">
                    <span className="k">For</span>
                    <span className="v">{chosen.map((p) => p.name).join(", ")}</span>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" error={errors.first}>
                    <input
                      className="f-input"
                      value={form.first}
                      autoComplete="given-name"
                      maxLength={LIMITS.personName}
                      onChange={(e) => setForm({ ...form, first: e.target.value })}
                    />
                  </Field>
                  <Field label="Last name" error={errors.last}>
                    <input
                      className="f-input"
                      value={form.last}
                      autoComplete="family-name"
                      maxLength={LIMITS.personName}
                      onChange={(e) => setForm({ ...form, last: e.target.value })}
                    />
                  </Field>
                </div>

                <Field label="Mobile number" error={errors.mobile}>
                  <span className="prefix-row">
                    <span aria-hidden="true" className="px">
                      +63
                    </span>
                    <input
                      className="f-input"
                      value={form.mobile}
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="917 123 4567"
                      onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    />
                  </span>
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Birthday" optional error={errors.birthday}>
                    <input
                      type="date"
                      className="f-input"
                      value={form.birthday}
                      max={today}
                      min="1900-01-01"
                      onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                    />
                  </Field>
                  <Field label="HMO provider" optional error={errors.hmo}>
                    <input
                      className="f-input"
                      list="hmo-list"
                      value={form.hmo}
                      maxLength={LIMITS.hmo}
                      onChange={(e) => setForm({ ...form, hmo: e.target.value })}
                    />
                    <datalist id="hmo-list">
                      {HMO_SUGGESTIONS.map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  </Field>
                </div>

                <label className="member-row mt-4 items-start">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                    aria-describedby={errors.consent ? "consent-error" : undefined}
                    style={{ marginTop: 2 }}
                  />
                  <span className="nm" style={{ fontSize: 13.5 }}>
                    I agree to {clinic.name} and BrightSmile using my details to manage this appointment, as described in the
                    Privacy Notice.
                  </span>
                </label>
                {errors.consent && (
                  <p id="consent-error" className="field-err">
                    {errors.consent}
                  </p>
                )}

                <div className="mt-6 flex gap-3">
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("when")}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void submitDetails()}>
                    {working ? "Sending..." : "Send request"}
                  </button>
                </div>

                <p className="f-hint mt-4">
                  Need help? Call{" "}
                  <a href={`tel:${clinic.mobile}`} className="link">
                    {phone}
                  </a>
                  .
                </p>
              </section>
            )}

            {step === "code" && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Check your texts
                </h2>
                <p className="sub">
                  We sent a 6 digit code to {localMobile(normalizeMobile(form.mobile) ?? "+63")}. It expires in 5 minutes.
                </p>

                <Field label="Code from the text" error={errors.code}>
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
                  <button type="button" className="btn btn-ghost" onClick={() => setStep("who")}>
                    Back
                  </button>
                  <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void verify()}>
                    {working ? "Checking..." : "Confirm request"}
                  </button>
                </div>

                <p className="f-hint mt-4">
                  {resendIn > 0 ? (
                    <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
                  ) : (
                    <button type="button" onClick={() => void resend()} className="link" disabled={working}>
                      Send another code
                    </button>
                  )}
                </p>
              </section>
            )}

            {step === "sent" && start && (
              <section>
                <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
                  Request sent
                </h2>
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
                    <div className="cf-row">
                      <span className="k">With</span>
                      <span className="v">{dentist.name}</span>
                    </div>
                    <div className="cf-row">
                      <span className="k">For</span>
                      <span className="v">{chosen.map((p) => p.name).join(", ")}</span>
                    </div>
                  </div>
                </div>

                <p className="f-hint mt-4">
                  No reply within a day? Call{" "}
                  <a href={`tel:${clinic.mobile}`} className="link">
                    {phone}
                  </a>
                  .
                </p>
                {token && (
                  <p className="f-hint mt-2">
                    <Link href={`/a/${token}`} className="link">
                      View or cancel this request
                    </Link>
                  </p>
                )}

                <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={startOver}>
                  Book another time
                </button>
              </section>
            )}
          </>
        )}
      </div>

      <p className="mt-5 text-center">
        <span className="brand-lockup">
          <Image src="/brand/logo.png" alt="BrightSmile" width={22} height={22} />
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </span>
      </p>
    </div>
  );
}
