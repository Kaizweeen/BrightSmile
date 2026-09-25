"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { StaffAction } from "@/lib/schedule";
import { setStatus, type Done } from "./actions";

type Target = "confirmed" | "declined" | "cancelled" | "completed" | "no_show";

// Spec 5.3 quick picks. Each fits the 36 character reason limit.
const REASONS = ["Dentist unavailable", "Please call the clinic"];

/** Staff buttons for one appointment. Decline and Cancel ask for an optional reason first. */
export default function AppointmentActions({ id, actions }: { id: string; actions: StaffAction[] }) {
  const [asking, setAsking] = useState<"declined" | "cancelled" | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  if (actions.length === 0) return null;

  function run(to: Target, why = "") {
    startTransition(async () => {
      const r = await setStatus(id, to, why);
      setResult(r);
      if (r.ok) {
        setAsking(null);
        setReason("");
      }
    });
  }

  const message = result ? (result.ok ? result.notice : result.error) : undefined;
  const feedback = message && (
    <p className={result?.ok ? "f-hint" : "field-err"} role={result?.ok ? "status" : "alert"}>
      {message}
    </p>
  );

  if (asking) {
    const verb = asking === "declined" ? "Decline" : "Cancel visit";
    return (
      <div className="note-box warn mt-3" role="group" aria-label={`${verb}: reason`}>
        <label className="block">
          <span className="f-label">
            Reason for the patient <span className="f-optional">Optional</span>
          </span>
          <input className="f-input" maxLength={36} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="chip-row">
          {REASONS.map((r) => (
            <button key={r} type="button" className="btn btn-ghost" onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <div className="action-row">
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setAsking(null)}>
            Back
          </button>
          <button type="button" className="btn btn-danger flex-1" disabled={pending} onClick={() => run(asking, reason)}>
            {pending ? "Saving..." : `${verb} and text the patient`}
          </button>
        </div>
        {feedback}
      </div>
    );
  }

  return (
    <div>
      <div className="action-row">
        {actions.includes("approve") && (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run("confirmed")}>
            {pending ? "Saving..." : "Approve"}
          </button>
        )}
        {actions.includes("decline") && (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => setAsking("declined")}>
            Decline
          </button>
        )}
        {actions.includes("move") && (
          <Link href={`/app/schedule/move/${id}`} className="btn btn-ghost">
            Move
          </Link>
        )}
        {actions.includes("cancel") && (
          <button type="button" className="btn btn-danger" disabled={pending} onClick={() => setAsking("cancelled")}>
            Cancel visit
          </button>
        )}
        {actions.includes("completed") && (
          <button type="button" className="btn btn-soft" disabled={pending} onClick={() => run("completed")}>
            Completed
          </button>
        )}
        {actions.includes("no_show") && (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run("no_show")}>
            No-show
          </button>
        )}
      </div>
      {feedback}
    </div>
  );
}
