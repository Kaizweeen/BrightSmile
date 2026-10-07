"use client";

import { LoadingRows } from "@/components/loading";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXAM_SECTIONS } from "@/lib/exam";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";

type Findings = Record<string, Record<string, string>>;
type Exam = { findings: Findings; updatedAt: string | null; authorName: string | null; dentistId: string; editable: boolean };

/** Spec 9.2: a visit's PDA exam. Its dentist (or the owner who sees patients) edits it until the visit closes. */
export function ExamForm({ appointmentId, staff }: { appointmentId: string; staff: Subject }) {
  const exam = useQuery({ queryKey: ["exam", appointmentId], queryFn: () => api<Exam>(`/appointments/${appointmentId}/exam`) });
  if (exam.isPending) return <LoadingRows rows={3} label="Loading the exam..." />;
  if (exam.isError) return <FormAlert message={errorMessage(exam.error)} />;
  const { findings, editable, dentistId, authorName, updatedAt } = exam.data;
  const saved = authorName && updatedAt ? `Saved by ${authorName}, ${formatDateTime(new Date(updatedAt))}.` : "No exam saved for this visit yet.";
  if (editable && can(staff, "clinical.write", { dentistId })) {
    return <ExamFields key={updatedAt ?? "new"} appointmentId={appointmentId} initial={findings} saved={saved} />;
  }
  const marked = EXAM_SECTIONS.flatMap((s) =>
    s.items.filter((i) => findings[s.key]?.[i.key] !== undefined).map((i) => `${s.label}: ${i.label}${findings[s.key][i.key] ? ` (${findings[s.key][i.key]})` : ""}`),
  );
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">{saved}</p>
      {marked.length > 0 && (
        <ul className="grid gap-1">
          {marked.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamFields({ appointmentId, initial, saved }: { appointmentId: string; initial: Findings; saved: string }) {
  const client = useQueryClient();
  const [findings, setFindings] = useState<Findings>(initial);
  const save = useMutation({
    mutationFn: () => api(`/appointments/${appointmentId}/exam`, { method: "PUT", body: { findings } }),
    onSuccess: async () => {
      toast.success("Exam saved.");
      await client.invalidateQueries({ queryKey: ["exam", appointmentId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const setItem = (section: string, item: string, value: string | null) => {
    const next = { ...(findings[section] ?? {}) };
    if (value === null) delete next[item];
    else next[item] = value;
    const all = { ...findings, [section]: next };
    if (Object.keys(next).length === 0) delete all[section];
    setFindings(all);
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{saved}</p>
      {EXAM_SECTIONS.map((section) => (
        <fieldset key={section.key} className="grid gap-1">
          <legend className="mb-1 font-medium">{section.label}</legend>
          {section.items.map((item) => {
            const value = findings[section.key]?.[item.key];
            return (
              <div key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={value !== undefined}
                    onChange={(event) => setItem(section.key, item.key, event.target.checked ? "" : null)}
                  />
                  {item.label}
                </label>
                {value !== undefined && (
                  <Input
                    aria-label={`${item.label}: detail`}
                    placeholder="Detail (optional)"
                    maxLength={60}
                    value={value}
                    onChange={(event) => setItem(section.key, item.key, event.target.value)}
                    className="w-56"
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <Button type="submit" className="justify-self-start" disabled={save.isPending}>
        {save.isPending ? "Saving..." : "Save the exam"}
      </Button>
    </form>
  );
}
