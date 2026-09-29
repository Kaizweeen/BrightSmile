"use client";

import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ExamForm } from "@/components/chart/exam-form";
import { ToothChart, type ChartEntryJson } from "@/components/chart/tooth-chart";
import { ToothPanel } from "@/components/chart/tooth-panel";
import { FormAlert } from "@/components/form-alert";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CHART_LEGEND } from "@/lib/chart";
import { api, errorMessage } from "@/lib/fetcher";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";
import type { PatientVisitJson } from "@/lib/visits";

/** Spec 10, the patient's Chart tab: the tooth chart, and the exam of a chosen visit. */
export function ChartTab({ patientId, staff }: { patientId: string; staff: Subject }) {
  const [tooth, setTooth] = useState<number | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const chart = useQuery({ queryKey: ["chart", patientId], queryFn: () => api<ChartEntryJson[]>(`/patients/${patientId}/chart`) });
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[] }>(`/patients/${patientId}/visits`),
  });
  const examVisits = (visits.data?.visits ?? []).filter((v) => v.status !== "cancelled" && v.status !== "no_show");
  // The visit in progress, else the latest that has started, else the soonest booked (the list is newest first).
  const now = new Date();
  const current =
    examVisits.find((v) => v.status === "checked_in" || v.status === "in_treatment") ??
    examVisits.find((v) => new Date(v.start) <= now) ??
    examVisits.at(-1);
  const chosen = visitId ?? current?.id ?? null;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="chart-title" className="grid gap-2">
        <h2 id="chart-title" className="text-lg font-semibold">
          Dental chart
        </h2>
        <p className="text-sm text-muted-foreground">{`Choose a tooth to see its history${can(staff, "clinical.write") ? " or chart it" : ""}.`}</p>
        {chart.isError ? (
          <FormAlert message={errorMessage(chart.error)} />
        ) : chart.isPending ? (
          <p className="text-muted-foreground">Loading the chart...</p>
        ) : (
          <ToothChart entries={chart.data} selected={tooth} onPick={setTooth} />
        )}
        <details className="text-sm">
          <summary className="cursor-pointer py-2">Legend</summary>
          <dl className="grid grid-cols-[3rem_1fr] gap-x-3 gap-y-1">
            {CHART_LEGEND.map((c) => (
              <Fragment key={c.code}>
                <dt className="font-medium">{c.mark}</dt>
                <dd>{c.label}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      </section>
      <section aria-labelledby="exam-title" className="grid gap-3">
        <h2 id="exam-title" className="text-lg font-semibold">
          Exam
        </h2>
        {visits.isError ? (
          <FormAlert message={errorMessage(visits.error)} />
        ) : visits.isPending ? (
          <p className="text-muted-foreground">Loading visits...</p>
        ) : examVisits.length === 0 ? (
          <p className="text-muted-foreground">No visits yet.</p>
        ) : (
          <>
            <label className="grid max-w-md gap-1.5 text-sm font-medium">
              Visit
              <NativeSelect value={chosen ?? ""} onChange={(event) => setVisitId(event.target.value)} className="w-full">
                {examVisits.map((v) => (
                  <NativeSelectOption key={v.id} value={v.id}>
                    {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${v.dentistName}`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            {chosen && <ExamForm key={chosen} appointmentId={chosen} staff={staff} />}
          </>
        )}
      </section>
      <ToothPanel key={tooth ?? "none"} patientId={patientId} tooth={tooth} entries={chart.data ?? []} staff={staff} onClose={() => setTooth(null)} />
    </div>
  );
}
