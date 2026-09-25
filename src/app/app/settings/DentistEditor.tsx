"use client";

import { useState, useTransition } from "react";
import Field from "@/components/Field";
import HoursEditor from "@/components/HoursEditor";
import type { SettingsView } from "@/lib/clinic-settings";
import { DEFAULT_HOURS } from "@/lib/onboarding";
import type { Saved } from "@/lib/staff-input";
import { formatDate, formatTime } from "@/lib/time";
import { addTimeOffAction, removeTimeOffAction, saveDentistAction, setDentistActiveAction } from "./actions";
import { errorFor, Feedback } from "./ClinicForms";

type Dentist = SettingsView["dentists"][number];

function span(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  return `${formatDate(s)}, ${formatTime(s)} to ${formatDate(e)}, ${formatTime(e)}`;
}

/** One dentist (or "Add a dentist" when null): name, short name, weekly hours, active, and time off. */
export default function DentistEditor({ dentist }: { dentist: Dentist | null }) {
  const blank = { name: "", smsName: "", hours: DEFAULT_HOURS };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(dentist ? { name: dentist.name, smsName: dentist.smsName, hours: dentist.hours } : blank);
  const [result, setResult] = useState<Saved | null>(null);
  const [off, setOff] = useState({ from: "", to: "", note: "" });
  const [offResult, setOffResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const offErr = errorFor(offResult);

  if (!open) {
    return dentist ? (
      <div className="member-row cursor-default">
        <span className="nm">
          {dentist.name}
          <span className="meta block">Texts say {dentist.smsName}</span>
        </span>
        <span className={`chip ${dentist.active ? "chip-green" : "chip-gold"}`}>{dentist.active ? "Active" : "Inactive"}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-soft mt-3" onClick={() => setOpen(true)}>
        Add a dentist
      </button>
    );
  }

  return (
    <div className="cf-box mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await saveDentistAction(dentist?.id ?? null, form);
            setResult(r);
            if (r.ok && !dentist) {
              setForm(blank);
              setOpen(false);
            }
          });
        }}
      >
        <Field label="Display name" hint='For example "Dr. Ana Reyes".' error={err("name")}>
          <input
            className="f-input"
            maxLength={60}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Short name for texts" hint="Up to 16 characters, like Dr. Reyes." error={err("smsName")}>
          <input className="f-input" maxLength={16} value={form.smsName} onChange={(e) => setForm({ ...form, smsName: e.target.value })} />
        </Field>
        <HoursEditor hours={form.hours} onChange={(hours) => setForm({ ...form, hours })} error={err("hours")} />
        <p className="f-hint mt-2">Changing hours cancels nothing. Visits outside the new hours show Outside hours on the schedule.</p>
        <Feedback result={result} inline={["name", "smsName", "hours"]} />
        <div className="action-row">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
            {pending ? "Saving..." : dentist ? "Save dentist" : "Add dentist"}
          </button>
        </div>
      </form>

      {dentist && (
        <>
          <button
            type="button"
            className={`btn mt-5 ${dentist.active ? "btn-danger" : "btn-soft"}`}
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await setDentistActiveAction(dentist.id, !dentist.active)))}
          >
            {dentist.active ? "Deactivate" : "Reactivate"}
          </button>
          <p className="f-hint">Inactive dentists leave the booking page and New appointment. Their appointments stay.</p>

          <h3 className="f-label mt-6">Time off</h3>
          {dentist.timeOff.length === 0 && <p className="f-hint">None planned.</p>}
          {dentist.timeOff.map((t) => (
            <div key={t.id} className="member-row cursor-default">
              <span className="nm">
                {span(t.startsAt, t.endsAt)}
                {t.note && <span className="meta block">{t.note}</span>}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={pending}
                onClick={() => startTransition(async () => setOffResult(await removeTimeOffAction(t.id)))}
              >
                Remove
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const r = await addTimeOffAction(dentist.id, off);
                setOffResult(r);
                if (r.ok) setOff({ from: "", to: "", note: "" });
              });
            }}
          >
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="From" error={offErr("from")}>
                <input className="f-input" type="datetime-local" value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} />
              </Field>
              <Field label="To" error={offErr("to")}>
                <input className="f-input" type="datetime-local" value={off.to} onChange={(e) => setOff({ ...off, to: e.target.value })} />
              </Field>
            </div>
            <Field label="Note" optional error={offErr("note")}>
              <input className="f-input" maxLength={100} value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} />
            </Field>
            <p className="f-hint mt-2">Visits already booked in this time stay, and show Outside hours on the schedule.</p>
            <Feedback result={offResult} inline={["from", "to", "note"]} />
            <button type="submit" className="btn btn-soft mt-3" disabled={pending}>
              Add time off
            </button>
          </form>
        </>
      )}
    </div>
  );
}
