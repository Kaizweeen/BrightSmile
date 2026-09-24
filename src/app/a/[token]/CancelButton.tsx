"use client";

import { useState, useTransition } from "react";
import { cancelVisit } from "./actions";

const PROBLEM = {
  not_allowed: "This visit can no longer be cancelled here. Please call the clinic.",
  not_found: "This link no longer works. Please call the clinic.",
  unavailable: "Cancelling is temporarily unavailable. Please try again in a few minutes.",
};

/** Spec 5.2: Cancel with a confirm step. */
export default function CancelButton({ token }: { token: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="btn btn-ghost wide-btn mt-6" onClick={() => setConfirming(true)}>
        Cancel this visit
      </button>
    );
  }

  return (
    <div className="note-box warn mt-6" role="group" aria-label="Confirm cancelling">
      <p>Cancel this visit? The clinic will be told, and the time goes back to other patients.</p>
      <div className="mt-3 flex gap-3">
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelVisit(token);
              if (result !== "cancelled") setError(PROBLEM[result]);
            })
          }
        >
          {pending ? "Cancelling..." : "Yes, cancel"}
        </button>
      </div>
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
