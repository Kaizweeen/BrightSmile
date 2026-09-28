"use client";

import { useState, useTransition } from "react";
import Field from "@/components/Field";
import type { SettingsView } from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { LIMITS } from "@/lib/validate";
import { moveBranchAction, saveBranchAction, setBranchActiveAction } from "./actions";
import { errorFor, Feedback } from "./ClinicForms";

type Branch = SettingsView["branches"][number];

const FIELDS = ["name", "smsName", "address", "mapsUrl"];

/**
 * One branch (or "Add a branch" when null): name, short name for texts, address, map link, its place in the order, and
 * active. `named` is true when texts name the branch: the clinic has, or with this one will have, 2 or more active.
 */
function BranchRow({ branch, clinicSmsName, named, first, last }: { branch: Branch | null; clinicSmsName: string; named: boolean; first?: boolean; last?: boolean }) {
  const blank = { name: "", smsName: "", address: "", mapsUrl: "" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(branch ? { name: branch.name, smsName: branch.smsName, address: branch.address, mapsUrl: branch.mapsUrl } : blank);
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const err = errorFor(result);
  const room = Math.max(1, LIMITS.clinicSmsName - clinicSmsName.trim().length - 1);
  const example = `${clinicSmsName} ${form.smsName.trim() || "Makati"}`;
  const act = (action: () => Promise<Saved>) => startTransition(async () => setResult(await action()));

  if (!open) {
    return branch ? (
      <div className="member-row cursor-default">
        <span className="nm">
          {branch.name}
          <span className="meta block">{branch.address}</span>
        </span>
        <span className={`chip ${branch.active ? "chip-green" : "chip-gold"}`}>{branch.active ? "Active" : "Inactive"}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
          Edit
        </button>
      </div>
    ) : (
      <button type="button" className="btn btn-soft mt-3" onClick={() => setOpen(true)}>
        Add a branch
      </button>
    );
  }

  return (
    <div className="cf-box mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await saveBranchAction(branch?.id ?? null, form);
            setResult(r);
            if (r.ok && !branch) {
              setForm(blank);
              setOpen(false);
            }
          });
        }}
      >
        <Field label="Branch name" hint='Patients see it, like "Makati".' error={err("name")}>
          <input className="f-input" maxLength={LIMITS.branchName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field
          label="Short name for texts"
          hint={named ? `Up to ${room} characters. Texts say "${example}".` : `With 2 or more active branches, texts add it after your clinic's name, like "${example}".`}
          error={err("smsName")}
        >
          <input className="f-input" maxLength={LIMITS.branchSmsName} value={form.smsName} onChange={(e) => setForm({ ...form, smsName: e.target.value })} />
        </Field>
        <Field label="Address" hint="Where patients go. It shows on your booking page." error={err("address")}>
          <input className="f-input" maxLength={LIMITS.address} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Map link" optional hint="Paste a Google Maps share link. It shows on your booking page." error={err("mapsUrl")}>
          <input
            className="f-input"
            type="url"
            inputMode="url"
            maxLength={LIMITS.mapsUrl}
            placeholder="https://maps.app.goo.gl/..."
            value={form.mapsUrl}
            onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
          />
        </Field>
        <Feedback result={result} inline={FIELDS} />
        <div className="action-row">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Close
          </button>
          <button type="submit" className="btn btn-primary flex-1" disabled={pending}>
            {pending ? "Saving..." : branch ? "Save branch" : "Add branch"}
          </button>
        </div>
      </form>

      {branch && (
        <>
          <h3 className="f-label mt-6">Order on the booking page</h3>
          <div className="action-row">
            <button type="button" className="btn btn-ghost" disabled={pending || first} onClick={() => act(() => moveBranchAction(branch.id, "up"))}>
              Move up
            </button>
            <button type="button" className="btn btn-ghost" disabled={pending || last} onClick={() => act(() => moveBranchAction(branch.id, "down"))}>
              Move down
            </button>
          </div>
          <button
            type="button"
            className={`btn mt-5 ${branch.active ? "btn-danger" : "btn-soft"}`}
            disabled={pending}
            onClick={() => act(() => setBranchActiveAction(branch.id, !branch.active))}
          >
            {branch.active ? "Deactivate" : "Reactivate"}
          </button>
          <p className="f-hint">Inactive branches leave the booking page. Their visits stay on the schedule.</p>
        </>
      )}
    </div>
  );
}

/** Settings > Branches (booking flow spec 4), for the owner: each branch's address and calendar, and their order. */
export default function BranchEditor({ branches, clinicSmsName }: { branches: Branch[]; clinicSmsName: string }) {
  const active = branches.filter((b) => b.active).length;
  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Branches</h2>
      <p className="f-hint">
        Each branch has its own address and calendar. With 2 or more active branches, patients choose one when they book, and texts name it.
      </p>
      <div className="member-list mt-2">
        {branches.map((b, i) => (
          <BranchRow key={b.id} branch={b} clinicSmsName={clinicSmsName} named={b.active ? active > 1 : active > 0} first={i === 0} last={i === branches.length - 1} />
        ))}
      </div>
      <BranchRow branch={null} clinicSmsName={clinicSmsName} named={active > 0} />
    </section>
  );
}
