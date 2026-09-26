"use client";

import { useActionState, useState } from "react";
import { extendTrialAction, recordGcashPayment, type AdminState } from "./actions";
import Field from "@/components/Field";
import { amountCentavos } from "@/lib/billing";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The prefilled amount: the tier price for these months, in pesos as typed. */
const pesosFor = (activeDentists: number, months: number) => String(amountCentavos(activeDentists, months) / 100);

function Result({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p className="field-err mt-2" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.done) {
    return (
      <p className="f-hint mt-2" role="status">
        {state.done}
      </p>
    );
  }
  return null;
}

/** Billing spec 7.6: the operator's two actions for one clinic. */
export default function ClinicActions({ clinicId, activeDentists }: { clinicId: string; activeDentists: number }) {
  const [months, setMonths] = useState(1);
  const [amount, setAmount] = useState(() => pesosFor(activeDentists, 1));
  const [paid, payAction, paying] = useActionState(recordGcashPayment, {});
  const [extended, extendAction, extending] = useActionState(extendTrialAction, {});

  return (
    <div className="mt-3">
      <form action={payAction} className="cf-box">
        <input type="hidden" name="clinicId" value={clinicId} />
        <p className="card-title">Record a GCash payment</p>
        <Field label="Months">
          <select
            name="months"
            className="f-input"
            value={months}
            onChange={(e) => {
              const next = Number(e.target.value);
              setMonths(next);
              setAmount(pesosFor(activeDentists, next));
            }}
          >
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m === 1 ? "1 month" : `${m} months`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount received, in pesos" hint="Prefilled with the price for these months. Change it if they sent a different amount.">
          <input name="amount" className="f-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="GCash reference number">
          <input name="reference" className="f-input" maxLength={100} autoComplete="off" required />
        </Field>
        <Result state={paid} />
        <button type="submit" className="btn btn-soft mt-4" disabled={paying}>
          {paying ? "Recording..." : "Record payment"}
        </button>
      </form>

      <form action={extendAction} className="mt-3">
        <input type="hidden" name="clinicId" value={clinicId} />
        <Field label="Days to add to the trial">
          <input name="days" type="number" className="f-input" min={1} max={365} defaultValue={14} required />
        </Field>
        <Result state={extended} />
        <button type="submit" className="btn btn-ghost mt-3" disabled={extending}>
          {extending ? "Extending..." : "Extend trial"}
        </button>
      </form>
    </div>
  );
}
