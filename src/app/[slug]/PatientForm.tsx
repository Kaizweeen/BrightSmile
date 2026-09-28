"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import Field from "@/components/Field";
import { HMO_SUGGESTIONS } from "@/lib/booking-input";
import {
  ageOn,
  ALLERGIES,
  CONDITIONS,
  INTAKE_LIMITS,
  NO_ANSWERS,
  parseIntakeForm,
  QUESTIONS,
  WOMEN_QUESTIONS,
  type Allergy,
  type Condition,
  type IntakeForm,
  type Medical,
  type Question,
} from "@/lib/intake";
import { localMobile } from "@/lib/phone";
import { waiverText } from "@/lib/waiver";

type Props = {
  clinicName: string;
  /** The verified number ("+639..."): the patient's mobile, shown here and never changed (booking flow spec 3.3 step 4). */
  mobile: string;
  /** Manila's date, "YYYY-MM-DD". */
  today: string;
  /** The form as filled earlier in this visit, when the patient comes back to it from the summary. */
  initial: IntakeForm | null;
  onDone: (form: IntakeForm) => void;
  onBack: () => void;
};

/** What the inputs hold: exactly the keys parseIntakeForm reads. */
type Draft = {
  last: string;
  first: string;
  middle: string;
  birthday: string;
  sex: "" | "female" | "male";
  address: string;
  occupation: string;
  email: string;
  guardian: string;
  hmo: string;
  hmoNumber: string;
  previousDentist: string;
  lastVisit: string;
  visitReason: string;
  emergencyName: string;
  emergencyMobile: string;
  medical: Medical;
  agree: boolean;
  signature: string;
};

type TextKey = Exclude<keyof Draft, "sex" | "medical" | "agree">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function draftOf(f: IntakeForm | null): Draft {
  return {
    last: f?.last ?? "",
    first: f?.first ?? "",
    middle: f?.middle ?? "",
    birthday: f?.birthday ?? "",
    sex: f?.sex ?? "",
    address: f?.address ?? "",
    occupation: f?.occupation ?? "",
    email: f?.email ?? "",
    guardian: f?.guardian ?? "",
    hmo: f?.hmo ?? "",
    hmoNumber: f?.hmoNumber ?? "",
    previousDentist: f?.previousDentist ?? "",
    lastVisit: f?.lastVisit ?? "",
    visitReason: f?.visitReason ?? "",
    emergencyName: f?.emergencyName ?? "",
    emergencyMobile: f?.emergencyMobile ? localMobile(f.emergencyMobile) : "",
    medical: f?.medical ?? NO_ANSWERS,
    agree: f !== null,
    signature: f?.waiverName ?? "",
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className="font-display text-[16px] font-bold">{title}</h3>
      {children}
    </section>
  );
}

/** A Yes or No question: two radio rows, the answer always in words. */
function YesNo({ question, value, onChange }: { question: Question; value: boolean | null; onChange: (value: boolean) => void }) {
  return (
    <fieldset className="mt-4">
      <legend className="f-label">{question.label}</legend>
      <div className="flex gap-3">
        <label className="member-row flex-1">
          <input type="radio" name={question.key} checked={value === true} onChange={() => onChange(true)} />
          <span className="nm">Yes</span>
        </label>
        <label className="member-row flex-1">
          <input type="radio" name={question.key} checked={value === false} onChange={() => onChange(false)} />
          <span className="nm">No</span>
        </label>
      </div>
    </fieldset>
  );
}

/**
 * The new patient form and waiver (booking flow spec 6): short sections on one scrolling screen, required fields marked
 * in words, and the answers checked here with the same parser the server runs again. Nothing is stored or logged here:
 * the parsed form goes to the flow, and it reaches the server only with "Send request" (or "Send changes").
 */
export default function PatientForm({ clinicName, mobile, today, initial, onDone, onBack }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = draft.medical;
  // Spec 6 item 2: the form comes before the visit date is chosen, so "under 18" is as of today.
  const minor = DATE.test(draft.birthday) && draft.birthday <= today && ageOn(draft.birthday, today) < 18;

  const text = (key: TextKey) => (e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  function answer<K extends keyof Medical>(key: K, value: Medical[K]) {
    setDraft((d) => ({ ...d, medical: { ...d.medical, [key]: value } }));
  }
  const toggle = <K extends Allergy | Condition>(list: K[], key: K) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

  function submit() {
    const parsed = parseIntakeForm(draft, today);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    onDone(parsed.form);
  }

  const question = (q: Question) => {
    const detail = q.detail;
    return (
      <div key={q.key}>
        <YesNo question={q} value={m[q.key]} onChange={(value) => answer(q.key, value)} />
        {detail && m[q.key] === true && (
          <Field label={detail.label}>
            <input
              className="f-input"
              maxLength={INTAKE_LIMITS.detail}
              value={m[detail.key] ?? ""}
              onChange={(e) => answer(detail.key, e.target.value === "" ? null : e.target.value)}
            />
          </Field>
        )}
      </div>
    );
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="f-hint">Fields marked Required must be filled in. Everything else can stay empty. Only the clinic reads this form.</p>

      <Section title="Patient">
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Last name" required error={errors.last}>
            <input className="f-input" autoComplete="family-name" maxLength={INTAKE_LIMITS.name} value={draft.last} onChange={text("last")} />
          </Field>
          <Field label="First name" required error={errors.first}>
            <input className="f-input" autoComplete="given-name" maxLength={INTAKE_LIMITS.name} value={draft.first} onChange={text("first")} />
          </Field>
        </div>
        <Field label="Middle name" error={errors.middle}>
          <input className="f-input" autoComplete="additional-name" maxLength={INTAKE_LIMITS.name} value={draft.middle} onChange={text("middle")} />
        </Field>
        <Field label="Birthday" required error={errors.birthday}>
          <input type="date" className="f-input" min="1900-01-01" max={today} value={draft.birthday} onChange={text("birthday")} />
        </Field>
        <fieldset className="mt-4">
          <legend className="f-label">
            Sex<span className="f-optional">Required</span>
          </legend>
          <div className="flex gap-3">
            <label className="member-row flex-1">
              <input type="radio" name="sex" checked={draft.sex === "female"} onChange={() => setDraft((d) => ({ ...d, sex: "female" }))} />
              <span className="nm">Female</span>
            </label>
            <label className="member-row flex-1">
              <input type="radio" name="sex" checked={draft.sex === "male"} onChange={() => setDraft((d) => ({ ...d, sex: "male" }))} />
              <span className="nm">Male</span>
            </label>
          </div>
          {errors.sex && <p className="field-err">{errors.sex}</p>}
        </fieldset>
        <Field label="Home address" required error={errors.address}>
          <input className="f-input" autoComplete="street-address" maxLength={INTAKE_LIMITS.address} value={draft.address} onChange={text("address")} />
        </Field>
        <Field label="Occupation" error={errors.occupation}>
          <input className="f-input" maxLength={INTAKE_LIMITS.occupation} value={draft.occupation} onChange={text("occupation")} />
        </Field>
        <Field label="Email" error={errors.email}>
          <input className="f-input" type="email" inputMode="email" autoComplete="email" maxLength={254} value={draft.email} onChange={text("email")} />
        </Field>
        <Field label="Mobile number" hint="The number you verified. It can't be changed here.">
          <input className="f-input" value={localMobile(mobile)} readOnly />
        </Field>
      </Section>

      <Section title="Parent or guardian">
        <p className="f-hint">{minor ? "The patient is under 18, so a parent or guardian is needed." : "Needed when the patient is under 18."}</p>
        <Field label="Parent or guardian's name" required={minor} error={errors.guardian}>
          <input className="f-input" maxLength={INTAKE_LIMITS.guardian} value={draft.guardian} onChange={text("guardian")} />
        </Field>
      </Section>

      <Section title="HMO or dental insurance">
        <Field label="Provider" error={errors.hmo}>
          <input className="f-input" list="hmo-list" maxLength={INTAKE_LIMITS.hmo} value={draft.hmo} onChange={text("hmo")} />
          <datalist id="hmo-list">
            {HMO_SUGGESTIONS.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </Field>
        <Field label="Card or member number" error={errors.hmoNumber}>
          <input className="f-input" maxLength={INTAKE_LIMITS.hmoNumber} value={draft.hmoNumber} onChange={text("hmoNumber")} />
        </Field>
      </Section>

      <Section title="Dental history">
        <Field label="Previous dentist" error={errors.previousDentist}>
          <input className="f-input" maxLength={INTAKE_LIMITS.previousDentist} value={draft.previousDentist} onChange={text("previousDentist")} />
        </Field>
        <Field label="Last dental visit" hint="Month and year." error={errors.lastVisit}>
          <input type="month" className="f-input" min="1900-01" max={today.slice(0, 7)} value={draft.lastVisit} onChange={text("lastVisit")} />
        </Field>
        <Field label="Reason for this visit" error={errors.visitReason}>
          <input className="f-input" maxLength={INTAKE_LIMITS.visitReason} value={draft.visitReason} onChange={text("visitReason")} />
        </Field>
      </Section>

      <Section title="Medical history">
        {QUESTIONS.map(question)}
        <fieldset className="mt-5">
          <legend className="f-label">Allergies: tick any</legend>
          <div className="member-list">
            {(Object.keys(ALLERGIES) as Allergy[]).map((key) => (
              <label key={key} className="member-row">
                <input type="checkbox" checked={m.allergies.includes(key)} onChange={() => answer("allergies", toggle(m.allergies, key))} />
                <span className="nm">{ALLERGIES[key]}</span>
              </label>
            ))}
          </div>
          {m.allergies.includes("other") && (
            <Field label="Which other allergy?">
              <input
                className="f-input"
                maxLength={INTAKE_LIMITS.detail}
                value={m.allergyOther ?? ""}
                onChange={(e) => answer("allergyOther", e.target.value === "" ? null : e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {draft.sex === "female" && WOMEN_QUESTIONS.map(question)}
        <fieldset className="mt-5">
          <legend className="f-label">Tick any you have or had</legend>
          <div className="member-list">
            {(Object.keys(CONDITIONS) as Condition[]).map((key) => (
              <label key={key} className="member-row">
                <input type="checkbox" checked={m.conditions.includes(key)} onChange={() => answer("conditions", toggle(m.conditions, key))} />
                <span className="nm">{CONDITIONS[key]}</span>
              </label>
            ))}
          </div>
          {m.conditions.includes("other") && (
            <Field label="Which other condition?">
              <input
                className="f-input"
                maxLength={INTAKE_LIMITS.detail}
                value={m.conditionOther ?? ""}
                onChange={(e) => answer("conditionOther", e.target.value === "" ? null : e.target.value)}
              />
            </Field>
          )}
        </fieldset>
        {errors.medical && <p className="field-err">{errors.medical}</p>}
      </Section>

      <Section title="Emergency contact">
        <Field label="Name" error={errors.emergencyName}>
          <input className="f-input" maxLength={INTAKE_LIMITS.emergencyName} value={draft.emergencyName} onChange={text("emergencyName")} />
        </Field>
        <Field label="Emergency contact's mobile number" error={errors.emergencyMobile}>
          <input className="f-input" type="tel" inputMode="tel" placeholder="0917 123 4567" value={draft.emergencyMobile} onChange={text("emergencyMobile")} />
        </Field>
      </Section>

      <Section title="Waiver and consent">
        <div className="note-box mt-3">
          {waiverText(clinicName).map((p) => (
            <p key={p.title} className="mt-2 first:mt-0">
              <strong>{p.title}</strong> {p.text}
            </p>
          ))}
        </div>
        <label className="member-row mt-3">
          <input type="checkbox" checked={draft.agree} onChange={(e) => setDraft((d) => ({ ...d, agree: e.target.checked }))} />
          <span className="nm">I have read and agree</span>
        </label>
        {errors.agree && <p className="field-err">{errors.agree}</p>}
        <Field label="Patient's full name, as the signature" required hint="Typing the name signs the waiver." error={errors.signature}>
          <input className="f-input" autoComplete="name" maxLength={INTAKE_LIMITS.signature} value={draft.signature} onChange={text("signature")} />
        </Field>
        <p className="f-hint mt-3">
          How the clinic and BrightSmile keep this information:{" "}
          <a href="/privacy" target="_blank" rel="noopener" className="link">
            Privacy Notice
          </a>
          .
        </p>
      </Section>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="note-box warn mt-6">
          Some answers need a look. They are marked above.
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn btn-primary flex-1">
          Continue
        </button>
      </div>
    </form>
  );
}
