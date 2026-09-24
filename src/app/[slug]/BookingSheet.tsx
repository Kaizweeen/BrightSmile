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

const STEP_LABEL: Record<Step, string> = {
  what: "Sheet 1 of 3",
  when: "Sheet 2 of 3",
  who: "Sheet 3 of 3",
  code: "Checking your number",
  sent: "Your stub",
};

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
    <main className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
      <article className="paper relative border border-line bg-surface shadow-[0_1px_0_0_var(--line)]">
        <header className="relative overflow-hidden bg-panel px-5 py-7 sm:px-7">
          <p className="label-type text-panel-gold">Dental clinic</p>
          <h1 className="display-type mt-1 text-3xl leading-[1.05] text-panel-gold sm:text-4xl">{clinic.name}</h1>
          <p className="mt-3 text-sm text-on-panel/85">
            {clinic.address}
            {clinic.mapsUrl && (
              <>
                {" "}
                <a
                  href={clinic.mapsUrl}
                  className="text-on-panel underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-panel-gold"
                  target="_blank"
                  rel="noreferrer"
                >
                  Map
                </a>
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-on-panel/85">{hoursSummary(clinic.hoursByWeekday)}</p>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-panel-gold/60" />
        </header>

        <div className="relative px-5 py-6 sm:px-7">
          <p aria-hidden="true" className="stamp label-type absolute right-4 top-5 px-2 py-1 text-[0.6rem] sm:right-6">
            Sample
          </p>
          <p className="label-type text-gold">{STEP_LABEL[step]}</p>

          {step === "what" && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="display-type mt-1 text-2xl outline-none">
                What do you need?
              </h2>
              <p className="mt-2 text-sm text-muted">Pick everything you need in one visit. The times you see will fit all of it.</p>

              <ul className="mt-5 border-t border-line">
                {clinic.procedures.map((p) => {
                  const checked = procedureIds.includes(p.id);
                  return (
                    <li key={p.id} className="border-b border-line">
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProcedure(p.id)}
                          aria-label={`${p.name}, ${p.minutes} minutes`}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className="grid size-6 shrink-0 place-items-center border border-ink bg-surface text-surface peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pending"
                        >
                          {checked ? "✓" : ""}
                        </span>
                        <span className="flex-1">{p.name}</span>
                        <span className="tabular-nums text-sm text-muted">{p.minutes} min</span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {showDentist && (
                <fieldset className="mt-6">
                  <legend className="label-type text-muted">Dentist</legend>
                  <div className="mt-2 border-t border-line">
                    {clinic.dentists.map((d) => (
                      <label key={d.id} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line py-2">
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
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className="grid size-6 shrink-0 place-items-center rounded-full border border-ink peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pending"
                        />
                        <span className="flex-1">{d.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="tear-rule mt-6 flex items-baseline justify-between pt-4">
                <span className="label-type text-muted">Estimated time</span>
                <span className={duration > 0 ? "display-type text-2xl tabular-nums" : "text-base text-muted"}>
                  {duration > 0 ? `${duration} min` : "Nothing chosen yet"}
                </span>
              </div>

              {tooLong && (
                <p className="mt-4 border border-danger bg-danger/5 p-4 text-sm text-danger">
                  No single opening fits all of these. Choose fewer procedures, or call the clinic at{" "}
                  <a href={`tel:${clinic.mobile}`} className="underline underline-offset-2">
                    {clinic.mobile}
                  </a>
                  .
                </p>
              )}

              <Primary
                disabled={duration === 0 || tooLong || (showDentist && !dentistId)}
                onClick={() => setStep("when")}
              >
                {duration === 0 ? "Pick what you need" : showDentist && !dentistId ? "Choose a dentist" : "Pick a day"}
              </Primary>
            </section>
          )}

          {step === "when" && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="display-type mt-1 text-2xl outline-none">
                When suits you?
              </h2>
              <p className="mt-2 text-sm text-muted">
                {duration} minutes with {dentist.name}. Closed and fully booked days are struck out.
              </p>

              <div className="mt-5">
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
              </div>

              {date && (
                <div className="tear-open tear-rule mt-6 pt-5">
                  <h3 className="display-type text-xl">{formatDate(new Date(`${date}T00:00:00+08:00`))}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {starts.length} {starts.length === 1 ? "opening" : "openings"}. Each one holds {duration} minutes.
                  </p>
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {starts.map((s) => {
                      const iso = s.toISOString();
                      const picked = iso === startIso;
                      return (
                        <li key={iso}>
                          <button
                            type="button"
                            onClick={() => setStartIso(iso)}
                            aria-pressed={picked}
                            className={`min-h-12 w-full border border-ink tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pending ${
                              picked ? "bg-ink text-surface" : "bg-surface hover:bg-canvas"
                            }`}
                          >
                            {formatTime(s)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="mt-6 flex gap-3">
                <Secondary onClick={() => setStep("what")}>Back</Secondary>
                <Primary disabled={!startIso} onClick={() => setStep("who")} className="flex-1">
                  {startIso ? `Take ${formatTime(new Date(startIso))}` : "Pick a time"}
                </Primary>
              </div>
            </section>
          )}

          {step === "who" && start && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="display-type mt-1 text-2xl outline-none">
                Who is this for?
              </h2>

              <dl className="mt-4 border-y border-line py-3 text-sm">
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted">When</dt>
                  <dd className="tabular-nums">{`${formatDate(start)}, ${formatTime(start)}`}</dd>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted">With</dt>
                  <dd>{dentist.name}</dd>
                </div>
                <div className="flex justify-between gap-4 py-1">
                  <dt className="text-muted">For</dt>
                  <dd className="text-right">{chosen.map((p) => p.name).join(", ")}</dd>
                </div>
              </dl>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="First name" error={errors.first}>
                  <input
                    className="field"
                    value={form.first}
                    autoComplete="given-name"
                    maxLength={LIMITS.personName}
                    onChange={(e) => setForm({ ...form, first: e.target.value })}
                  />
                </Field>
                <Field label="Last name" error={errors.last}>
                  <input
                    className="field"
                    value={form.last}
                    autoComplete="family-name"
                    maxLength={LIMITS.personName}
                    onChange={(e) => setForm({ ...form, last: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Mobile number" error={errors.mobile} hint="The clinic texts this number to confirm.">
                <div className="flex items-stretch">
                  <span aria-hidden="true" className="label-type grid place-items-center border border-r-0 border-line bg-canvas px-3 text-ink">
                    +63
                  </span>
                  <input
                    className="field"
                    value={form.mobile}
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="917 123 4567"
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  />
                </div>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Birthday" optional error={errors.birthday}>
                  <input
                    type="date"
                    className="field"
                    value={form.birthday}
                    max={today}
                    min="1900-01-01"
                    onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                  />
                </Field>
                <Field label="HMO provider" optional error={errors.hmo}>
                  <input
                    className="field"
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

              <label className="mt-5 flex cursor-pointer items-start gap-3 border border-line bg-canvas p-4">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  className="peer sr-only"
                  aria-describedby={errors.consent ? "consent-error" : undefined}
                />
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center border border-ink bg-surface text-surface peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-pending"
                >
                  {form.consent ? "✓" : ""}
                </span>
                <span className="text-sm">
                  I agree to {clinic.name} and BrightSmile using these details to manage this appointment, as set out in the
                  privacy notice.
                </span>
              </label>
              {errors.consent && (
                <p id="consent-error" className="mt-2 text-sm text-danger">
                  {errors.consent}
                </p>
              )}

              <div className="mt-6 flex gap-3">
                <Secondary onClick={() => setStep("when")}>Back</Secondary>
                <Primary onClick={submitDetails} className="flex-1">
                  Send request
                </Primary>
              </div>

              <p className="mt-4 text-sm text-muted">
                Need help? Call{" "}
                <a href={`tel:${clinic.mobile}`} className="text-pending underline underline-offset-2">
                  {clinic.mobile}
                </a>
                .
              </p>
            </section>
          )}

          {step === "code" && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="display-type mt-1 text-2xl outline-none">
                Check your texts
              </h2>
              <p className="mt-2 text-sm text-muted">
                We sent a 6 digit code to {normalizeMobile(form.mobile) ?? form.mobile}. It expires in 5 minutes.
              </p>

              <Field label="Code from the text" error={errors.code}>
                <input
                  className="field display-type text-center text-2xl tracking-[0.3em] tabular-nums"
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </Field>

              <div className="mt-6 flex gap-3">
                <Secondary onClick={() => setStep("who")}>Back</Secondary>
                <Primary onClick={verifyCode} className="flex-1">
                  Confirm request
                </Primary>
              </div>

              <p className="mt-4 text-sm text-muted">
                {resendIn > 0 ? (
                  <span className="tabular-nums">You can ask for another code in {resendIn}s.</span>
                ) : (
                  <button type="button" onClick={() => setResendIn(60)} className="text-pending underline underline-offset-2">
                    Send another code
                  </button>
                )}
              </p>
              <p className="mt-4 border border-line bg-canvas p-3 text-sm">
                <span className="label-type text-danger">Sample page</span>
                <span className="mt-1 block text-muted">
                  No text is sent here. Any 6 digits will do. The real page sends a code through Semaphore.
                </span>
              </p>
            </section>
          )}

          {step === "sent" && start && (
            <section>
              <h2 ref={headingRef} tabIndex={-1} className="display-type mt-1 text-2xl outline-none">
                Request sent
              </h2>
              <p className="mt-2 text-sm text-muted">
                {clinic.name} will confirm by text. Nothing is booked until they do.
              </p>

              <div className="tear-open tear-rule mt-6 border-x border-b border-line bg-canvas p-5">
                <p className="label-type text-gold">Keep this stub</p>
                <p className="display-type mt-2 text-4xl leading-none tabular-nums">{formatTime(start)}</p>
                <p className="display-type text-xl">{formatDate(start)}</p>
                <dl className="mt-4 border-t border-line pt-3 text-sm">
                  <div className="flex justify-between gap-4 py-1">
                    <dt className="text-muted">With</dt>
                    <dd>{dentist.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-1">
                    <dt className="text-muted">For</dt>
                    <dd className="text-right">{chosen.map((p) => p.name).join(", ")}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-1">
                    <dt className="text-muted">Reference</dt>
                    <dd className="tabular-nums">{reference}</dd>
                  </div>
                </dl>
              </div>

              <p className="mt-5 text-sm text-muted">
                No reply within a day? Call{" "}
                <a href={`tel:${clinic.mobile}`} className="text-pending underline underline-offset-2">
                  {clinic.mobile}
                </a>
                .
              </p>

              <Secondary onClick={startOver} className="mt-6 w-full">
                Book another time
              </Secondary>
            </section>
          )}
        </div>

        <footer className="tear-rule flex items-center justify-between px-5 py-4 sm:px-7">
          <span className="label-type text-muted">Booking by BrightSmile</span>
          <span className="text-sm text-muted">brightsmile.ph</span>
        </footer>
      </article>
    </main>
  );
}

function Field({
  label,
  children,
  error,
  hint,
  optional,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <label className="mt-5 block">
      <span className="label-type flex items-baseline justify-between text-muted">
        <span>{label}</span>
        {optional && <span className="text-muted/70">Optional</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && !error && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-sm text-danger">{error}</span>}
    </label>
  );
}

function Primary({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`mt-6 min-h-12 w-full bg-accent px-5 text-on-accent transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:border disabled:border-line disabled:bg-canvas disabled:text-muted ${className}`}
    >
      <span className="label-type">{children}</span>
    </button>
  );
}

function Secondary({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-6 min-h-12 border border-ink px-5 transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pending ${className}`}
    >
      <span className="label-type">{children}</span>
    </button>
  );
}
