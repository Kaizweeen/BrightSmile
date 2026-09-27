"use client";

import { Fragment, useState, useTransition } from "react";
import type { Saved } from "@/lib/staff-input";
import { createInviteAction, removeMemberAction, revokeInviteAction } from "./actions";

export type MemberRow = { userId: string; email: string | null; owner: boolean; joined: string };
export type InviteRow = { id: string; created: string; expires: string };

/**
 * Teams spec 6.1: the members (email, role, joined) with Remove behind a confirm step, the open join links with Revoke,
 * and a new link shown once with Copy. The owner's row has no Remove.
 */
export default function TeamPanel({ members, invites }: { members: MemberRow[]; invites: InviteRow[] }) {
  const [link, setLink] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [memberResult, setMemberResult] = useState<Saved | null>(null);
  const [linkResult, setLinkResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  // Its own transition, so removing a member or revoking a link never flips this button's label to "One moment...".
  const [creating, startCreating] = useTransition();

  function create() {
    startCreating(async () => {
      const r = await createInviteAction();
      setLinkResult(r.ok ? null : r);
      if (r.ok) {
        setLink(r.link);
        setCopyNote("");
      }
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyNote("Copied.");
    } catch {
      setCopyNote("Copy did not work. Select the link and copy it.");
    }
  }

  return (
    <>
      <section className="card card-pad settings-section">
        <h2 className="font-display">Members</h2>
        <p className="f-hint">
          Staff handle requests, the schedule, patients, and dentists&apos; time off. Only you change the clinic&apos;s setup, pay, and manage the team.
        </p>
        <div className="member-list mt-2">
          {members.map((m) => (
            <Fragment key={m.userId}>
              <div className="member-row cursor-default">
                <span className="nm min-w-0 [overflow-wrap:anywhere]">
                  {m.email ?? "No email on file"}
                  <span className="meta block">Joined {m.joined}</span>
                </span>
                <span className={`chip ${m.owner ? "chip-brand" : "chip-blue"}`}>{m.owner ? "Owner" : "Staff"}</span>
                {!m.owner && (
                  <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(m.userId)}>
                    Remove
                  </button>
                )}
              </div>
              {confirming === m.userId && (
                <div className="note-box warn">
                  <p className="[overflow-wrap:anywhere]">
                    Remove {m.email ?? "this staff member"}? They lose access at once, and their devices stop getting this clinic&apos;s alerts.
                  </p>
                  <div className="action-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await removeMemberAction(m.userId);
                          setMemberResult(r.ok ? null : r);
                          if (r.ok) setConfirming(null);
                        })
                      }
                    >
                      Yes, remove
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
        </div>
        {memberResult && !memberResult.ok && (
          <p className="field-err" role="alert">
            {memberResult.error}
          </p>
        )}
      </section>

      <section className="card card-pad settings-section">
        <h2 className="font-display">Join links</h2>
        <p className="f-hint">Each link lets one person make an account and join your clinic as staff.</p>
        {link && (
          <div className="cf-box mt-3">
            <label className="f-label" htmlFor="join-link">
              New join link
            </label>
            <input id="join-link" className="f-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <p className="f-hint">Send it by Messenger or text. It works once, for 7 days. It is shown only now.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-soft" onClick={copy}>
                Copy link
              </button>
              <span className="f-hint" role="status">
                {copyNote}
              </span>
            </div>
          </div>
        )}
        {invites.length === 0 ? (
          <p className="f-hint mt-3">No open join links.</p>
        ) : (
          <div className="member-list mt-2">
            {invites.map((i) => (
              <div key={i.id} className="member-row cursor-default">
                <span className="nm">
                  Made {i.created}
                  <span className="meta block">Works until {i.expires}</span>
                </span>
                <span className="chip chip-amber">Open</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await revokeInviteAction(i.id);
                      setLinkResult(r);
                      // A revoked link is never shown again, whether or not it is the one still on screen.
                      if (r.ok) setLink(null);
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
        {linkResult && !linkResult.ok && (
          <p className="field-err" role="alert">
            {linkResult.error}
          </p>
        )}
        <button type="button" className="btn btn-primary mt-4" disabled={creating} onClick={create}>
          {creating ? "One moment..." : "Create join link"}
        </button>
      </section>
    </>
  );
}
