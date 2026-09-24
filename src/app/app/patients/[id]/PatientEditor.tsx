"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
import Field from "@/components/Field";
import { localMobile } from "@/lib/phone";
import type { Saved } from "@/lib/staff-input";
import { removePatient, savePatient } from "../actions";

type Patient = { id: string; first: string; last: string; mobile: string | null; birthday: string | null; hmo: string | null };

/** Editable details (spec 5.3) and Delete, which anonymizes (spec 12) after a confirm step. */
export default function PatientEditor({ patient }: { patient: Patient }) {
  const router = useRouter();
  const [form, setForm] = useState({
    first: patient.first,
    last: patient.last,
    mobile: patient.mobile ? localMobile(patient.mobile) : "",
    birthday: patient.birthday ?? "",
    hmo: patient.hmo ?? "",
  });
  const [result, setResult] = useState<Saved | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const fieldError = (field: string) => (result && !result.ok && result.field === field ? result.error : undefined);

  return (
    <>
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => setResult(await savePatient(patient.id, form)));
        }}
      >
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="First name" error={fieldError("first")}>
            <input className="f-input" value={form.first} onChange={set("first")} maxLength={50} autoComplete="off" required />
          </Field>
          <Field label="Last name" error={fieldError("last")}>
            <input className="f-input" value={form.last} onChange={set("last")} maxLength={50} autoComplete="off" required />
          </Field>
          <Field label="Mobile" optional hint="No mobile means no texts." error={fieldError("mobile")}>
            <input className="f-input" type="tel" inputMode="tel" value={form.mobile} onChange={set("mobile")} autoComplete="off" />
          </Field>
          <Field label="Birthday" optional error={fieldError("birthday")}>
            <input className="f-input" type="date" value={form.birthday} onChange={set("birthday")} />
          </Field>
          <Field label="HMO provider" optional error={fieldError("hmo")}>
            <input className="f-input" value={form.hmo} onChange={set("hmo")} maxLength={60} autoComplete="off" />
          </Field>
        </div>
        {result && !result.ok && !result.field && (
          <p className="field-err" role="alert">
            {result.error}
          </p>
        )}
        {result?.ok && (
          <p className="f-hint" role="status">
            Saved.
          </p>
        )}
        <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
          {pending ? "Saving..." : "Save details"}
        </button>
      </form>

      {!confirming ? (
        <button type="button" className="btn btn-danger mt-6" onClick={() => setConfirming(true)}>
          Delete patient
        </button>
      ) : (
        <div className="note-box warn mt-6" role="group" aria-label="Confirm deleting this patient">
          <p>
            Delete {patient.first} {patient.last}? Their name, mobile, birthday, and HMO are removed for good. Their appointments
            stay, shown as Deleted patient, so your counts stay right. Cancel any upcoming visits first if they will not come.
          </p>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Keep patient
            </button>
            <button
              type="button"
              className="btn btn-danger flex-1"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removePatient(patient.id);
                  if (r.ok) router.push("/app/patients");
                  else setResult(r);
                })
              }
            >
              {pending ? "Deleting..." : "Yes, delete"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
