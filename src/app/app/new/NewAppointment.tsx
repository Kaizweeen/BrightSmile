"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import Field from "@/components/Field";
import type { BookingOptions } from "@/lib/dashboard";
import type { PatientHit } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { manilaDate } from "@/lib/time";
import { createVisit } from "../actions";
import { findPatients } from "../patients/actions";
import SlotPicker, { type Slot } from "../SlotPicker";

type Props = BookingOptions & { today: string; initialPatient: PatientHit | null };

/** Spec 5.3 New appointment: for walk-ins, phone and Messenger bookings, seniors and PWDs. Confirmed immediately. */
export default function NewAppointment({ dentists, procedures, today, initialPatient }: Props) {
  const router = useRouter();
  const [patient, setPatient] = useState<PatientHit | null>(initialPatient);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState({ first: "", last: "", mobile: "" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [procedureIds, setProcedureIds] = useState<string[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [sendText, setSendText] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const searches = useRef(0);

  const duration = procedures.filter((p) => procedureIds.includes(p.id)).reduce((sum, p) => sum + p.minutes, 0);
  const hasMobile = patient ? Boolean(patient.mobile) : adding && fields.mobile.trim() !== "";
  const hasPatient = patient !== null || (adding && fields.first.trim() !== "" && fields.last.trim() !== "");
  const ready = hasPatient && procedureIds.length > 0 && slot !== null;

  async function search(e: FormEvent) {
    e.preventDefault();
    const n = ++searches.current;
    setHits(null);
    const list = await findPatients(query);
    if (n === searches.current) setHits(list);
  }

  function toggleProcedure(id: string) {
    setProcedureIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setSlot(null); // the picker remounts (its key is the chosen procedures)
  }

  function submit() {
    if (!slot) return;
    setError("");
    const input = {
      patientId: patient?.id ?? null,
      patient: patient ? null : fields,
      procedureIds,
      slot,
      sendText: hasMobile && sendText,
    };
    startTransition(async () => {
      const result = await createVisit(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/app/schedule?date=${manilaDate(new Date(slot.startsAt))}`);
    });
  }

  return (
    <>
      <section className="card card-pad mb-3" aria-labelledby="patient-h">
        <h2 id="patient-h" className="font-display text-[17px] font-bold">
          Patient
        </h2>
        {patient ? (
          <div className="member-row cursor-default">
            <span className="nm">
              {patient.first} {patient.last}
              <span className="meta block">{patient.mobile ? localMobile(patient.mobile) : "No mobile, so no texts"}</span>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setPatient(null)}>
              Change
            </button>
          </div>
        ) : adding ? (
          <>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="First name">
                <input className="f-input" maxLength={50} value={fields.first} onChange={(e) => setFields({ ...fields, first: e.target.value })} />
              </Field>
              <Field label="Last name">
                <input className="f-input" maxLength={50} value={fields.last} onChange={(e) => setFields({ ...fields, last: e.target.value })} />
              </Field>
            </div>
            <Field label="Mobile" optional hint="Leave blank for patients without a phone. No mobile means no texts.">
              <input
                className="f-input"
                type="tel"
                inputMode="tel"
                value={fields.mobile}
                onChange={(e) => setFields({ ...fields, mobile: e.target.value })}
              />
            </Field>
            <button type="button" className="link py-3" onClick={() => setAdding(false)}>
              Find an existing patient instead
            </button>
          </>
        ) : (
          <>
            <form onSubmit={search} role="search" className="mt-2 flex gap-2">
              <input
                className="f-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or mobile"
                aria-label="Find a patient by name or mobile"
              />
              <button type="submit" className="btn btn-soft">
                Find
              </button>
            </form>
            {hits?.length === 0 && <p className="f-hint mt-2">No patient matches. Add them as a new patient.</p>}
            {hits && hits.length > 0 && (
              <div className="member-list mt-2">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="member-row w-full text-left"
                    onClick={() => {
                      setPatient(h);
                      setHits(null);
                    }}
                  >
                    <span className="nm">
                      {h.first} {h.last}
                    </span>
                    <span className="meta">{h.mobile ? localMobile(h.mobile) : "No mobile"}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="btn btn-ghost mt-3" onClick={() => setAdding(true)}>
              New patient
            </button>
          </>
        )}
      </section>

      <section className="card card-pad mb-3" aria-labelledby="what-h">
        <h2 id="what-h" className="font-display text-[17px] font-bold">
          Procedures
        </h2>
        <div className="member-list mt-2">
          {procedures.map((p) => (
            <label key={p.id} className="member-row">
              <input type="checkbox" checked={procedureIds.includes(p.id)} onChange={() => toggleProcedure(p.id)} />
              <span className="nm">{p.name}</span>
              <span className="meta">{p.minutes} min</span>
            </label>
          ))}
        </div>
        {duration > 0 && <p className="f-hint">Total: {duration} minutes</p>}
      </section>

      <section className="card card-pad mb-3" aria-labelledby="when-h">
        <h2 id="when-h" className="font-display text-[17px] font-bold">
          When
        </h2>
        {duration === 0 ? (
          <p className="f-hint">Choose procedures first.</p>
        ) : (
          <SlotPicker key={procedureIds.join(",")} dentists={dentists} duration={duration} today={today} onChange={setSlot} />
        )}
      </section>

      <section className="card card-pad">
        {hasMobile && (
          <label className="member-row">
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            <span className="nm">Send confirmation text</span>
          </label>
        )}
        {error && (
          <p className="field-err" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary wide-btn mt-3" disabled={!ready || pending} onClick={submit}>
          {pending ? "Booking..." : "Book and confirm"}
        </button>
      </section>
    </>
  );
}
