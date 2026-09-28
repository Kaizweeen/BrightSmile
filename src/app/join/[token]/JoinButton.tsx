"use client";

import { useActionState } from "react";
import { joinClinic, type JoinState } from "../actions";

/** "Join {clinic}", with a refusal or an error in words (teams spec 6.2, 9). */
export default function JoinButton({ token, clinic }: { token: string; clinic: string }) {
  const [state, formAction, pending] = useActionState<JoinState, FormData>(joinClinic, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <p className="note-box warn mb-4" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary wide-btn" disabled={pending}>
        {pending ? "Joining..." : `Join ${clinic}`}
      </button>
    </form>
  );
}
