"use client";

import { useActionState, useState } from "react";
import { payOnline, type PayState } from "./actions";
import { amountCentavos, formatPesos, MONTH_CHOICES } from "@/lib/billing";

type Props = {
  activeDentists: number;
  slug: string;
  gcash: { name: string; number: string } | null;
  online: boolean;
};

const monthsText = (months: number) => (months === 1 ? "1 month" : `${months} months`);

/** Billing spec 7.1: the months picker, the amount due, GCash details, and Pay online when PayMongo is set up. */
export default function PayPanel({ activeDentists, slug, gcash, online }: Props) {
  const [months, setMonths] = useState<number>(1);
  const [state, formAction, pending] = useActionState<PayState, FormData>(payOnline, {});
  const amount = formatPesos(amountCentavos(activeDentists, months));

  return (
    <>
      <form action={formAction} className="card card-pad settings-section">
        <h2 className="font-display">Pay ahead</h2>
        <fieldset className="mt-2">
          <legend className="f-label">How many months</legend>
          <div className="member-list">
            {MONTH_CHOICES.map((m) => (
              <label key={m} className="member-row">
                <input type="radio" name="months" value={m} checked={months === m} onChange={() => setMonths(m)} />
                <span className="nm">{monthsText(m)}</span>
                <span className="meta">{formatPesos(amountCentavos(activeDentists, m))}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="cf-row">
          <span className="k">Amount due for {monthsText(months)}</span>
          <span className="v">{amount}</span>
        </div>
        {online && (
          <>
            {state.error && (
              <p className="field-err mt-3" role="alert">
                {state.error}
              </p>
            )}
            <button type="submit" className="btn btn-primary wide-btn mt-4" disabled={pending}>
              {pending ? "Opening checkout..." : `Pay ${amount} online`}
            </button>
            <p className="f-hint mt-2">GCash, Maya, or card, on PayMongo&apos;s secure page.</p>
          </>
        )}
      </form>

      <section className="card card-pad settings-section">
        <h2 className="font-display">Pay by GCash</h2>
        {gcash ? (
          <div className="cf-box mt-2">
            <div className="cf-row">
              <span className="k">Send to</span>
              <span className="v">{gcash.name}</span>
            </div>
            <div className="cf-row">
              <span className="k">GCash number</span>
              <span className="v">{gcash.number}</span>
            </div>
            <div className="cf-row">
              <span className="k">Amount</span>
              <span className="v">{amount}</span>
            </div>
            <div className="cf-row">
              <span className="k">Type this in the GCash note</span>
              <span className="v">{slug}</span>
            </div>
          </div>
        ) : (
          <p className="note-box mt-2">GCash payment details are not set up yet.</p>
        )}
        <p className="f-hint mt-3">Your plan is extended once we see the payment, usually the same day.</p>
      </section>
    </>
  );
}
