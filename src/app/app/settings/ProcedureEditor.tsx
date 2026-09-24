"use client";

import { useState, useTransition } from "react";
import type { SettingsView } from "@/lib/clinic-settings";
import type { Saved } from "@/lib/staff-input";
import { saveProcedureAction, setProcedureActiveAction } from "./actions";
import { Feedback } from "./ClinicForms";

type Procedure = SettingsView["procedures"][number];

/** One procedure row, or the "add" row when procedure is null. */
function ProcedureRow({ procedure }: { procedure: Procedure | null }) {
  const [form, setForm] = useState({ name: procedure?.name ?? "", minutes: String(procedure?.minutes ?? 30) });
  const [result, setResult] = useState<Saved | null>(null);
  const [pending, startTransition] = useTransition();
  const label = procedure?.name ?? "New procedure";

  return (
    <form
      className="mt-3 grid grid-cols-[1fr_96px] items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await saveProcedureAction(procedure?.id ?? null, form);
          setResult(r);
          if (r.ok && !procedure) setForm({ name: "", minutes: "30" });
        });
      }}
    >
      <input
        className="f-input"
        aria-label={`${label}: name`}
        placeholder={procedure ? undefined : "New procedure"}
        maxLength={60}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        className="f-input"
        aria-label={`${label}: minutes`}
        type="number"
        inputMode="numeric"
        min={5}
        max={480}
        step={5}
        value={form.minutes}
        onChange={(e) => setForm({ ...form, minutes: e.target.value })}
      />
      <div className="col-span-2 flex flex-wrap items-center gap-2">
        {procedure && !procedure.active && <span className="chip chip-gold">Archived</span>}
        <button type="submit" className="btn btn-soft" disabled={pending}>
          {procedure ? "Save" : "Add procedure"}
        </button>
        {procedure && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => startTransition(async () => setResult(await setProcedureActiveAction(procedure.id, !procedure.active)))}
          >
            {procedure.active ? "Archive" : "Restore"}
          </button>
        )}
      </div>
      <div className="col-span-2">
        <Feedback result={result} inline={[]} />
      </div>
    </form>
  );
}

/** Procedures (spec 5.3): add, edit, archive. Archived ones leave the booking page; past visits keep their names. */
export default function ProcedureEditor({ procedures }: { procedures: Procedure[] }) {
  return (
    <section className="card card-pad settings-section">
      <h2 className="font-display">Procedures</h2>
      <p className="f-hint">Minutes set how long each visit takes. Archived procedures leave the booking page; past appointments keep their names.</p>
      {procedures.map((p) => (
        <ProcedureRow key={p.id} procedure={p} />
      ))}
      <ProcedureRow procedure={null} />
    </section>
  );
}
