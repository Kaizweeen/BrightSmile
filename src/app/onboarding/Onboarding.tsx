"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(auth)/actions";
import Field from "@/components/Field";
import { createClinic } from "./actions";
import {
  clinicProblems,
  DEFAULT_HOURS,
  DEFAULT_PROCEDURES,
  dentistProblems,
  dentistShortName,
  procedureProblems,
  type Clock,
  type OnboardingField,
  type OnboardingInput,
  type ProcedureDraft,
  type Problems,
} from "@/lib/onboarding";
import { LIMITS, slugFromName } from "@/lib/validate";

type Screen = "clinic" | "dentist" | "procedures" | "ready";
type Errors = Problems & { form?: string };

const STEPS: { id: Screen | "account"; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "clinic", label: "Clinic" },
  { id: "dentist", label: "Dentist" },
  { id: "procedures", label: "Procedures" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCREEN_OF: Record<OnboardingField, Screen> = {
  name: "clinic",
  smsName: "clinic",
  slug: "clinic",
  mobile: "clinic",
  address: "clinic",
  dentistName: "dentist",
  dentistSmsName: "dentist",
  hours: "dentist",
  procedures: "procedures",
};
const START: OnboardingInput = {
  name: "",
  smsName: "",
  slug: "",
  mobile: "",
  address: "",
  dentistName: "",
  dentistSmsName: "",
  hours: DEFAULT_HOURS,
  procedures: DEFAULT_PROCEDURES,
};

export default function Onboarding({ appUrl }: { appUrl: string }) {
  const [screen, setScreen] = useState<Screen>("clinic");
  const [input, setInput] = useState<OnboardingInput>(START);
  const [edited, setEdited] = useState({ smsName: false, slug: false, dentistSmsName: false });
  const [errors, setErrors] = useState<Errors>({});
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const host = appUrl.replace(/^https?:\/\//, "");
  const link = `${appUrl}/${input.slug}`;
  const stepIndex = STEPS.findIndex((s) => s.id === screen);

  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);

  function set<K extends keyof OnboardingInput>(key: K, value: OnboardingInput[K]) {
    setInput((i) => ({ ...i, [key]: value }));
  }

  // The short name and booking link follow the clinic name until the clinic edits them.
  function setName(name: string) {
    setInput((i) => ({
      ...i,
      name,
      smsName: edited.smsName ? i.smsName : name.trim().slice(0, LIMITS.clinicSmsName).trim(),
      slug: edited.slug ? i.slug : slugFromName(name),
    }));
  }

  function setDentistName(name: string) {
    setInput((i) => ({ ...i, dentistName: name, dentistSmsName: edited.dentistSmsName ? i.dentistSmsName : dentistShortName(name) }));
  }

  function setDay(day: number, blocks: Clock[]) {
    setInput((i) => ({ ...i, hours: i.hours.map((b, d) => (d === day ? blocks : b)) }));
  }

  function setProcedure(index: number, change: Partial<ProcedureDraft>) {
    setInput((i) => ({ ...i, procedures: i.procedures.map((p, k) => (k === index ? { ...p, ...change } : p)) }));
  }

  function next(problems: Problems, to: Screen) {
    setErrors(problems);
    if (Object.keys(problems).length === 0) setScreen(to);
  }

  async function finish() {
    const problems = procedureProblems(input);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setWorking(true);
    try {
      const result = await createClinic(input);
      if (result.ok) {
        setScreen("ready");
        return;
      }
      setErrors({ [result.field]: result.error } as Errors);
      if (result.field !== "form") setScreen(SCREEN_OF[result.field]);
    } catch {
      setErrors({ form: "Something went wrong. Please try again." });
    } finally {
      setWorking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ title: input.name, url: link });
    } catch {
      // The share sheet was dismissed.
    }
  }

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        {screen !== "ready" && (
          <div className="step-row" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s.id} className="flex items-center gap-2" style={{ flex: i < STEPS.length - 1 ? 1 : "0 0 auto" }}>
                <span className={`step-pip ${s.id === screen ? "active" : ""} ${i < stepIndex ? "done" : ""}`}>
                  <span className="num">{i < stepIndex ? "✓" : i + 1}</span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="step-sep" />}
              </span>
            ))}
          </div>
        )}

        {errors.form && (
          <p role="alert" className="note-box warn mb-4">
            {errors.form}
          </p>
        )}

        {screen === "clinic" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your clinic
            </h1>
            <p className="sub">Patients see this on your booking page.</p>

            <Field label="Clinic name" error={errors.name}>
              <input
                className="f-input"
                value={input.name}
                maxLength={LIMITS.clinicName}
                autoComplete="organization"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Short name for texts"
              error={errors.smsName}
              hint={`Starts every text your patients get. Up to ${LIMITS.clinicSmsName} characters.`}
            >
              <input
                className="f-input"
                value={input.smsName}
                maxLength={LIMITS.clinicSmsName}
                onChange={(e) => {
                  setEdited((x) => ({ ...x, smsName: true }));
                  set("smsName", e.target.value);
                }}
              />
            </Field>
            <Field label="Booking link" error={errors.slug}>
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  {host}/
                </span>
                <input
                  className="f-input"
                  value={input.slug}
                  maxLength={24}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setEdited((x) => ({ ...x, slug: true }));
                    set("slug", e.target.value.toLowerCase());
                  }}
                />
              </span>
            </Field>
            <Field label="Clinic mobile" error={errors.mobile} hint="Shown to patients, and where we text you new requests.">
              <span className="prefix-row">
                <span aria-hidden="true" className="px">
                  +63
                </span>
                <input
                  className="f-input"
                  value={input.mobile}
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="917 123 4567"
                  onChange={(e) => set("mobile", e.target.value)}
                />
              </span>
            </Field>
            <Field label="Address" error={errors.address}>
              <input
                className="f-input"
                value={input.address}
                maxLength={LIMITS.address}
                autoComplete="street-address"
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>

            <button type="button" className="btn btn-primary wide-btn mt-6" onClick={() => next(clinicProblems(input), "dentist")}>
              Next: dentist and hours
            </button>
          </section>
        )}

        {screen === "dentist" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your first dentist
            </h1>
            <p className="sub">You can add more dentists later.</p>

            <Field label="Dentist name" error={errors.dentistName}>
              <input
                className="f-input"
                value={input.dentistName}
                maxLength={LIMITS.dentistName}
                placeholder="Dr. Ana Reyes"
                onChange={(e) => setDentistName(e.target.value)}
              />
            </Field>
            <Field
              label="Short name for texts"
              error={errors.dentistSmsName}
              hint={`Like Dr. Reyes. Up to ${LIMITS.dentistSmsName} characters.`}
            >
              <input
                className="f-input"
                value={input.dentistSmsName}
                maxLength={LIMITS.dentistSmsName}
                onChange={(e) => {
                  setEdited((x) => ({ ...x, dentistSmsName: true }));
                  set("dentistSmsName", e.target.value);
                }}
              />
            </Field>

            <fieldset className="mt-5">
              <legend className="f-label">Working hours</legend>
              {input.hours.map((blocks, day) => (
                <div key={day} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                  <p className="font-semibold">
                    {DAYS[day]}
                    {blocks.length === 0 && <span className="meta"> (closed)</span>}
                  </p>
                  {blocks.map((b, k) => (
                    <div key={k} className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <input
                        type="time"
                        step={900}
                        className="f-input"
                        aria-label={`${DAYS[day]}, block ${k + 1}, starts`}
                        value={b.start}
                        onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)))}
                      />
                      <span className="meta">to</span>
                      <input
                        type="time"
                        step={900}
                        className="f-input"
                        aria-label={`${DAYS[day]}, block ${k + 1}, ends`}
                        value={b.end}
                        onChange={(e) => setDay(day, blocks.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)))}
                      />
                    </div>
                  ))}
                  <div className="flex gap-5">
                    <button
                      type="button"
                      className="link py-3"
                      onClick={() => setDay(day, [...blocks, blocks.length === 0 ? { start: "09:00", end: "12:00" } : { start: "13:00", end: "17:00" }])}
                    >
                      Add hours
                    </button>
                    {blocks.length > 0 && (
                      <button type="button" className="link py-3" onClick={() => setDay(day, blocks.slice(0, -1))}>
                        {blocks.length === 1 ? "Mark closed" : "Remove last"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {errors.hours && <p className="field-err">{errors.hours}</p>}
            </fieldset>

            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setScreen("clinic")}>
                Back
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => next(dentistProblems(input), "procedures")}>
                Next: procedures
              </button>
            </div>
          </section>
        )}

        {screen === "procedures" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your procedures
            </h1>
            <p className="sub">Patients pick from this list. The minutes set how long each visit takes.</p>

            {input.procedures.map((p, k) => (
              <div key={k} className="py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                <input
                  className="f-input"
                  aria-label={`Procedure ${k + 1} name`}
                  value={p.name}
                  maxLength={LIMITS.procedureName}
                  onChange={(e) => setProcedure(k, { name: e.target.value })}
                />
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="number"
                    className="f-input"
                    style={{ width: 96 }}
                    aria-label={`${p.name || `Procedure ${k + 1}`} minutes`}
                    min={5}
                    max={480}
                    step={5}
                    value={Number.isFinite(p.minutes) ? p.minutes : ""}
                    onChange={(e) => setProcedure(k, { minutes: e.target.valueAsNumber })}
                  />
                  <span className="meta">min</span>
                  <button
                    type="button"
                    className="link ml-auto py-3"
                    onClick={() => set("procedures", input.procedures.filter((_, j) => j !== k))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="link py-3"
              onClick={() => set("procedures", [...input.procedures, { name: "", minutes: 30 }])}
            >
              Add a procedure
            </button>
            {errors.procedures && <p className="field-err">{errors.procedures}</p>}

            <div className="mt-6 flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setScreen("dentist")}>
                Back
              </button>
              <button type="button" className="btn btn-primary flex-1" disabled={working} onClick={() => void finish()}>
                {working ? "Creating your link..." : "Create my booking link"}
              </button>
            </div>
          </section>
        )}

        {screen === "ready" && (
          <section>
            <h1 ref={headingRef} tabIndex={-1} className="font-display outline-none">
              Your link is ready
            </h1>
            <p className="sub">Share it on your Facebook page and in Messenger. Patients request times from it.</p>

            <div className="cf-box">
              <p className="font-display text-[15px] font-semibold break-all">{link}</p>
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" className="btn btn-ghost flex-1" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="btn btn-primary flex-1" onClick={() => void share()}>
                Share
              </button>
            </div>
            <p className="f-hint mt-4">
              <Link href={`/${input.slug}`} className="link">
                Open your booking page
              </Link>
            </p>
            <Link href="/app" className="btn btn-soft wide-btn mt-6">
              Go to your requests
            </Link>
          </section>
        )}

        {screen !== "ready" && (
          <form action={signOut} className="mt-6 text-center">
            <button type="submit" className="link py-3">
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
