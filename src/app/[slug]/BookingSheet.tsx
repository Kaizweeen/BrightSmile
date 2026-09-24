"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import MonthSheet from "./MonthSheet";
import { busyFor, HMO_SUGGESTIONS, type SampleClinic } from "@/lib/sample-clinic";
import { fitsAnyBlock, openDates as openDatesFor, openStarts, type Block, type Busy } from "@/lib/slots";
import { addDays, formatDate, formatMinutes, formatTime, manilaDate, monthDates, weekday } from "@/lib/time";
import { normalizeMobile } from "@/lib/phone";
import { cleanBirthday, cleanText, LIMITS } from "@/lib/validate";

type SerialBusy = { id?: string; start: string; end: string };
type Props = { clinic: SampleClinic; busy: SerialBusy[]; nowIso: string };
type Step = "what" | "when" | "who" | "code" | "sent";

const STEPS: { id: Step; label: string }[] = [
  { id: "what", label: "What" },
  { id: "when", label: "When" },
  { id: "who", label: "Who" },
];
const EMPTY_FORM = { first: "", last: "", mobile: "", birthday: "", hmo: "", consent: false };
const DAY_HEADS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The clinic's hours, read off its own working blocks so the line cannot lie. */
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

export default function BookingSheet({ clinic, busy, nowIso }: Props) {
  const [step, setStep] = useState<Step>("what");
  const [procedureIds, setProcedureIds] = useState<string[]>([]);
  const [dentistId, setDentistId] = useState(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
  const [month, setMonth] = useState(() => manilaDate(new Date(nowIso)).slice(0, 7));
  const [date, setDate] = useState<string | null>(null);
  const [startIso, setStartIso] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(60);
  const [reference, setReference] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The React Compiler memoizes these; a month of dates against a handful of
  // busy intervals is cheap arithmetic either way.
  const now = new Date(nowIso);
  const today = manilaDate(now);
  const lastBookable = addDays(today, clinic.rules.maxDaysAhead);
  const allBusy: Busy[] = busy.map((b) => ({ id: b.id, start: new Date(b.start), end: new Date(b.end) }));

  const chosen = clinic.procedures.filter((p) => procedureIds.includes(p.id));
  const duration = chosen.reduce((sum, p) => sum + p.minutes, 0);
  const dentist = clinic.dentists.find((d) => d.id === dentistId) ?? clinic.dentists[0];
  const myBusy = busyFor(dentist.id, allBusy);
  const tooLong = duration > 0 && !fitsAnyBlock(duration, clinic.hoursByWeekday);

  const monthOpen =
    duration && !tooLong
      ? openDatesFor({
          dates: monthDates(month),
          blocksByWeekday: clinic.hoursByWeekday,
          busy: myBusy,
          durationMinutes: duration,
          rules: clinic.rules,
          now,
        })
      : [];

  const starts =
    date && duration
      ? openStarts({
          date,
          blocks: clinic.hoursByWeekday[weekday(date)],
          busy: myBusy,
          durationMinutes: duration,
          rules: clinic.rules,
          now,
        })
      : [];

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // The countdown starts where the code was requested, so nothing sets state
  // straight from an effect.
  useEffect(() => {
    if (step !== "code") return;
    const tick = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [step]);

  const start = startIso ? new Date(startIso) : null;
  const showDentist = clinic.dentists.length > 1;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function toggleProcedure(id: string) {
    setProcedureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setDate(null);
    setStartIso(null);
  }

  function submitDetails() {
    const next: Record<string, string> = {};
    if (!cleanText(form.first, LIMITS.personName)) next.first = "Please enter your first name.";
    if (!cleanText(form.last, LIMITS.personName)) next.last = "Please enter your last name.";
    if (!normalizeMobile(form.mobile)) next.mobile = "Enter a Philippine mobile number, like 0917 123 4567.";
    if (cleanBirthday(form.birthday, today) === null) next.birthday = "Use a real past date, or leave this blank.";
    if (cleanText(form.hmo, LIMITS.hmo, true) === null) next.hmo = `Keep this under ${LIMITS.hmo} characters.`;
    if (!form.consent) next.consent = "Please agree before sending your request.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setResendIn(60);
    setStep("code");
  }

  function verifyCode() {
    if (!/^\d{6}$/.test(code.trim())) {
      setErrors({ code: "Enter the 6 digits from the text." });
      return;
    }
    setErrors({});
    setReference(`SD-${(startIso ?? "").slice(5, 10).replace("-", "")}-${formatTime(start!).replace(/[: ]/g, "")}`);
    setStep("sent");
  }

  function startOver() {
    setProcedureIds([]);
    setDentistId(clinic.dentists.length === 1 ? clinic.dentists[0].id : "");
    setDate(null);
    setStartIso(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setCode("");
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
            <p className="meta">{hoursSummary(clinic.hoursByWeekday)}</p>
            <p className="mt-2">
              <span className="chip chip-amber">Sample data</span>
            </p>
          </div>
        </div>
        <hr className="rule-gold" />

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

        {step === "what" && (
          <section>
            <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
              What do you need?
            </h2>
            <p className="sub">Pick everything you need in one visit. The times you see will fit all of it.</p>

            <div className="member-list">
              {clinic.procedures.map((p) => (
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
                        onChange={() => {
                          setDentistId(d.id);
                          setDate(null);
                          setStartIso(null);
                        }}
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
                No single opening fits all of these. Choose fewer procedures, or call the clinic at{" "}
                <a href={`tel:${clinic.mobile}`} className="font-semibold underline">
                  {clinic.mobile}
                </a>
                .
              </p>
            )}

            <button
              type="button"
              className="btn btn-primary wide-btn mt-6"
              disabled={duration === 0 || tooLong || (showDentist && !dentistId)}
              onClick={() => setStep("when")}
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
              openDates={monthOpen}
              selected={date}
              onSelect={(d) => {
                setDate(d);
                setStartIso(null);
              }}
              onMonth={(delta) => {
                const first = `${month}-01`;
                setMonth(addDays(first, delta > 0 ? 31 : -1).slice(0, 7));
                setDate(null);
                setStartIso(null);
              }}
            />

            {date && (
              <div className="screen-in mt-6">
                <div className="mini-head">
                  <p className="m font-display">{formatDate(new Date(`${date}T00:00:00+08:00`))}</p>
                  <span className="chip chip-brand">
                    {starts.length} {starts.length === 1 ? "opening" : "openings"}
                  </span>
                </div>
                {starts.length === 0 ? (
                  <p className="empty-note">Nothing left on this day.</p>
                ) : (
                  <div className="slot-grid">
                    {starts.map((s) => {
                      const iso = s.toISOString();
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setStartIso(iso)}
                          aria-pressed={iso === startIso}
                          className={`slot ${iso === startIso ? "sel" : ""}`}
                        >
                          {formatTime(s)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setStep("what")}>
                Back
              </button>
              <button type="button" className="btn btn-primary flex-1" disabled={!startIso} onClick={() => setStep("who")}>
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
                I agree to {clinic.name} and BrightSmile using these details to manage this appointment, as set out in the
                privacy notice.
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
              <button type="button" className="btn btn-primary flex-1" onClick={submitDetails}>
                Send request
              </button>
            </div>

            <p className="f-hint mt-4">
              Need help? Call{" "}
              <a href={`tel:${clinic.mobile}`} className="link">
                {clinic.mobile}
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
              We sent a 6 digit code to {normalizeMobile(form.mobile) ?? form.mobile}. It expires in 5 minutes.
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
              <button type="button" className="btn btn-primary flex-1" onClick={verifyCode}>
                Confirm request
              </button>
            </div>

            <p className="f-hint mt-4">
              {resendIn > 0 ? (
                <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
              ) : (
                <button type="button" onClick={() => setResendIn(60)} className="link">
                  Send another code
                </button>
              )}
            </p>

            <p className="note-box warn mt-4">
              No text is sent on this sample page, so any 6 digits will do. The real page sends a code through Semaphore.
            </p>
          </section>
        )}

        {step === "sent" && start && (
          <section>
            <h2 ref={headingRef} tabIndex={-1} className="font-display text-[19px] font-bold outline-none">
              Request sent
            </h2>
            <p className="sub">{clinic.name} will confirm by text. Nothing is booked until they do.</p>

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
                <div className="cf-row">
                  <span className="k">Reference</span>
                  <span className="v">{reference}</span>
                </div>
              </div>
            </div>

            <p className="f-hint mt-4">
              No reply within a day? Call{" "}
              <a href={`tel:${clinic.mobile}`} className="link">
                {clinic.mobile}
              </a>
              .
            </p>

            <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={startOver}>
              Book another time
            </button>
          </section>
        )}
      </div>

      <p className="mt-5 text-center">
        <span className="brand-lockup">
          {/* Placeholder mark in the logo's colours. Swap for /brand/logo.png when Kai adds the file. */}
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3c2.2 0 3.3 1.1 5 1.1 1.4 0 2.5.9 2.5 3.2 0 3.1-1.3 4.6-2 7.4-.6 2.6-1 4.8-2.4 4.8-1.2 0-1.4-1.6-3.1-1.6s-1.9 1.6-3.1 1.6c-1.4 0-1.8-2.2-2.4-4.8-.7-2.8-2-4.3-2-7.4 0-2.3 1.1-3.2 2.5-3.2 1.7 0 2.8-1.1 5-1.1Z"
              fill="var(--primary)"
            />
            <path d="M8.8 15.6c1.9 1.5 4.5 1.5 6.4 0" stroke="var(--gold)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </svg>
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </span>
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  error,
  optional,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
}) {
  return (
    <label className="mt-4 block">
      <span className="f-label">
        {label}
        {optional && <span className="f-optional">Optional</span>}
      </span>
      {children}
      {error && <span className="field-err block">{error}</span>}
    </label>
  );
}
