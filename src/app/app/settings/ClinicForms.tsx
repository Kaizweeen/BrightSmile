"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { signOut } from "@/app/(auth)/actions";
import Field from "@/components/Field";
import type { SettingsView } from "@/lib/clinic-settings";
import { localMobile } from "@/lib/phone";
import type { Saved } from "@/lib/staff-input";
import { changePassword, updateProfile, updateRules } from "./actions";

type Clinic = SettingsView["clinic"];

/** The error for one field, when the last save failed on it. */
export const errorFor = (result: Saved | null) => (field: string) =>
  result && !result.ok && result.field === field ? result.error : undefined;

/** "Saved." or an error that no field shows inline. */
export function Feedback({ result, inline }: { result: Saved | null; inline: string[] }) {
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="f-hint" role="status">
        Saved.
      </p>
    );
  }
  if (result.field && inline.includes(result.field)) return null;
  return (
    <p className="field-err" role="alert">
      {result.error}
    </p>
  );
}

const PROFILE_FIELDS = ["name", "smsName", "slug", "mobile", "address", "mapsUrl"];

/** Clinic profile, including the map link. Warns before the booking link changes (spec 5.3). */
export function ProfileForm({ clinic, appUrl }: { clinic: Clinic; appUrl: string }) {
  const [form, setForm] = useState({
    name: clinic.name,
    smsName: clinic.smsName,
    slug: clinic.slug,
    mobile: localMobile(clinic.mobile),
    address: clinic.address,
    mapsUrl: clinic.mapsUrl,
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="card card-pad settings-section"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await updateProfile(form)));
      }}
    >
      <h2 className="font-display">Clinic profile</h2>
      <Field label="Clinic name" error={err("name")}>
        <input className="f-input" maxLength={80} value={form.name} onChange={set("name")} />
      </Field>
      <Field label="Short name for texts" hint="Up to 20 characters. Every text to patients starts with it." error={err("smsName")}>
        <input className="f-input" maxLength={20} value={form.smsName} onChange={set("smsName")} />
      </Field>
      <Field label="Booking link" hint={`${appUrl}/${form.slug}`} error={err("slug")}>
        <input
          className="f-input"
          maxLength={24}
          autoCapitalize="none"
          spellCheck={false}
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))}
        />
      </Field>
      {form.slug !== clinic.slug && (
        <p className="note-box warn mt-3" role="alert">
          If you change the booking link, the old link stops working right away, including in texts and posts that already have it.
        </p>
      )}
      <Field label="Clinic mobile" hint="Shown to patients and used for text alerts." error={err("mobile")}>
        <input className="f-input" type="tel" inputMode="tel" value={form.mobile} onChange={set("mobile")} />
      </Field>
      <Field label="Address" error={err("address")}>
        <input className="f-input" maxLength={200} value={form.address} onChange={set("address")} />
      </Field>
      <Field label="Map link" optional hint="Paste a Google Maps share link. It shows on your booking page." error={err("mapsUrl")}>
        <input
          className="f-input"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://maps.app.goo.gl/..."
          value={form.mapsUrl}
          onChange={set("mapsUrl")}
        />
      </Field>
      <Feedback result={result} inline={PROFILE_FIELDS} />
      <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}

const NOTICE = [0, 60, 120, 180, 240, 360, 720, 1440, 2880, 4320, 10080];

function noticeLabel(minutes: number): string {
  if (minutes === 0) return "No notice";
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Booking rules (spec 5.3) and where new request alerts go (spec 10.4). */
export function RulesForm({ clinic }: { clinic: Clinic }) {
  const [form, setForm] = useState({
    slotMinutes: clinic.slotMinutes,
    minNoticeMinutes: clinic.minNoticeMinutes,
    maxDaysAhead: String(clinic.maxDaysAhead),
    alertChannel: clinic.alertChannel,
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const notices = NOTICE.includes(form.minNoticeMinutes) ? NOTICE : [...NOTICE, form.minNoticeMinutes].sort((x, y) => x - y);

  return (
    <form
      className="card card-pad settings-section"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => setResult(await updateRules(form)));
      }}
    >
      <h2 className="font-display">Booking rules</h2>
      <Field label="Time between start times">
        <select className="f-input" value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })}>
          {[15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </Field>
      <Field label="Minimum notice" hint="How soon before a visit patients can still book online.">
        <select className="f-input" value={form.minNoticeMinutes} onChange={(e) => setForm({ ...form, minNoticeMinutes: Number(e.target.value) })}>
          {notices.map((m) => (
            <option key={m} value={m}>
              {noticeLabel(m)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Booking window" hint="How many days ahead patients can book online, 1 to 365.">
        <input
          className="f-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          value={form.maxDaysAhead}
          onChange={(e) => setForm({ ...form, maxDaysAhead: e.target.value })}
        />
      </Field>
      <fieldset className="mt-4">
        <legend className="f-label">New request alerts</legend>
        <label className="member-row">
          <input type="radio" name="alertChannel" checked={form.alertChannel === "push"} onChange={() => setForm({ ...form, alertChannel: "push" })} />
          <span className="nm">Push notification, with a text if no device gets it</span>
        </label>
        <label className="member-row">
          <input type="radio" name="alertChannel" checked={form.alertChannel === "sms"} onChange={() => setForm({ ...form, alertChannel: "sms" })} />
          <span className="nm">Text to the clinic mobile</span>
        </label>
        <p className="f-hint">
          Turn push on for each phone or computer under{" "}
          <a href="#alerts" className="link">
            Alerts on this device
          </a>
          . Until a device has it on, or when no device gets the push, alerts arrive by text.
        </p>
      </fieldset>
      <Feedback result={result} inline={[]} />
      <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
        {pending ? "Saving..." : "Save rules"}
      </button>
    </form>
  );
}

/** Change password and sign out (spec 5.3). */
export function AccountForms() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);

  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Account</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await changePassword(current, next);
            setResult(r);
            if (r.ok) {
              setCurrent("");
              setNext("");
            }
          });
        }}
      >
        <Field label="Current password" error={err("current")}>
          <input className="f-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters." error={err("next")}>
          <input
            className="f-input"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Feedback result={result} inline={["current", "next"]} />
        <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
          {pending ? "Saving..." : "Change password"}
        </button>
      </form>
      <form action={signOut}>
        <button type="submit" className="btn btn-ghost wide-btn mt-6">
          Sign out
        </button>
      </form>
    </section>
  );
}
