"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarClockIcon, CalendarX2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AlertBanner } from "@/components/alert-banner";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { EMPTY_PATIENT, PatientFields, type PatientDraft } from "@/components/patient-fields";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { ageOn, ALLERGY_LABELS, alertLines, fullName, type Allergy } from "@/lib/patients";
import { formatDateTime, manilaDate } from "@/lib/time";
import type { PatientVisitJson } from "@/lib/visits";
import type { Subject } from "@/lib/permissions";
import { ChartTab } from "./chart-tab";
import { NotesTab } from "./notes-tab";

export type PatientJson = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthday: string | null;
  sex: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  guardianName: string | null;
  emergencyName: string | null;
  emergencyMobile: string | null;
  hmoProvider: string | null;
  hmoMemberNo: string | null;
  insuranceEffective: string | null;
  allergies: string[];
  allergiesOther: string | null;
  medicalAlerts: string;
  consentAt: string | null;
  consentByName: string | null;
  homeBranchName: string | null;
};

export function PatientScreen({ patient, canEdit, staff, initialTab }: { patient: PatientJson; canEdit: boolean; staff: Subject; initialTab: string }) {
  const age = patient.birthday ? ageOn(patient.birthday, manilaDate(new Date())) : null;
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-xs">
        <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 font-heading text-xl font-semibold text-primary">
          {`${patient.firstName[0] ?? ""}${patient.lastName[0] ?? ""}`.toUpperCase()}
        </span>
        <div className="grid min-w-0 gap-1">
          <h1 className="truncate text-2xl leading-tight font-semibold">{fullName(patient)}</h1>
          <p className="text-sm text-muted-foreground">
            {[`Chart ${patient.chartNo}`, age !== null ? `${age} years old` : null, patient.hmoProvider ? `HMO: ${patient.hmoProvider}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <AlertBanner lines={alertLines(patient)} />
      <Tabs defaultValue={initialTab}>
        <TabsList variant="line" className="w-full justify-start border-b [&_[data-slot=tabs-trigger]]:flex-none [&_[data-slot=tabs-trigger]]:px-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="chart">Chart</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <DetailsPanel patient={patient} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="visits" className="pt-4">
          <VisitsPanel patientId={patient.id} />
        </TabsContent>
        <TabsContent value="chart" className="pt-4">
          <ChartTab patientId={patient.id} staff={staff} />
        </TabsContent>
        <TabsContent value="notes" className="pt-4">
          <NotesTab patientId={patient.id} staff={staff} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function draftOf(p: PatientJson): PatientDraft {
  const text = (value: string | null) => value ?? "";
  return {
    ...EMPTY_PATIENT,
    lastName: p.lastName,
    firstName: p.firstName,
    middleName: text(p.middleName),
    birthday: text(p.birthday),
    sex: text(p.sex),
    mobile: text(p.mobile),
    email: text(p.email),
    address: text(p.address),
    occupation: text(p.occupation),
    guardianName: text(p.guardianName),
    emergencyName: text(p.emergencyName),
    emergencyMobile: text(p.emergencyMobile),
    hmoProvider: text(p.hmoProvider),
    hmoMemberNo: text(p.hmoMemberNo),
    insuranceEffective: text(p.insuranceEffective),
    allergies: p.allergies,
    allergiesOther: text(p.allergiesOther),
    medicalAlerts: p.medicalAlerts,
    consent: p.consentAt !== null,
  };
}

function DetailsPanel({ patient, canEdit }: { patient: PatientJson; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(() => draftOf(patient));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Only changed fields are sent, so the audit log names only what changed (spec 13).
  const changes = () => {
    const before = draftOf(patient);
    return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof PatientDraft])));
  };
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/patients/${patient.id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Saved.");
      setEditing(false);
      setErrors({});
      router.refresh();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });

  if (editing) {
    return (
      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = changes();
          if (Object.keys(body).length === 0) setEditing(false);
          else save.mutate(body);
        }}
      >
        <PatientFields value={draft} onChange={setDraft} errors={errors} alertsOnly={!canEdit} showConsent={canEdit && patient.consentAt === null} />
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setEditing(false)}>
            Go back
          </Button>
        </div>
      </form>
    );
  }
  const row = (label: string, value: string | null | undefined) => (
    <div className="grid gap-0.5 px-4 py-3 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={value ? undefined : "text-muted-foreground"}>{value || "Not given"}</dd>
    </div>
  );
  return (
    <div className="grid max-w-3xl gap-4">
      <dl className="divide-y rounded-xl border bg-card shadow-xs">
        {row("Birthday", patient.birthday)}
        {row("Sex", patient.sex === "female" ? "Female" : patient.sex === "male" ? "Male" : null)}
        {row("Mobile", patient.mobile)}
        {row("Email", patient.email)}
        {row("Home address", patient.address)}
        {row("Occupation", patient.occupation)}
        {row("Parent or guardian", patient.guardianName)}
        {row("Emergency contact", [patient.emergencyName, patient.emergencyMobile].filter(Boolean).join(", "))}
        {row("HMO or insurance", [patient.hmoProvider, patient.hmoMemberNo, patient.insuranceEffective && `effective ${patient.insuranceEffective}`].filter(Boolean).join(", "))}
        {row("Allergies", [...patient.allergies.map((a) => ALLERGY_LABELS[a as Allergy] ?? a), patient.allergiesOther].filter(Boolean).join(", "))}
        {row("Medical alerts", patient.medicalAlerts)}
        {row("Privacy consent", patient.consentAt ? `Signed, recorded ${formatDateTime(new Date(patient.consentAt))} by ${patient.consentByName ?? "staff"}` : "Not recorded yet")}
        {row("First registered at", patient.homeBranchName)}
      </dl>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            // Start from the record as it is now, never from an earlier, abandoned draft.
            setDraft(draftOf(patient));
            setErrors({});
            setEditing(true);
          }}
        >
          {canEdit ? "Edit details" : "Edit allergies and alerts"}
        </Button>
      </div>
    </div>
  );
}

function VisitsPanel({ patientId }: { patientId: string }) {
  const visits = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => api<{ visits: PatientVisitJson[]; next: PatientVisitJson | null }>(`/patients/${patientId}/visits`),
  });
  if (visits.isPending) return <LoadingRows rows={3} label="Loading visits..." />;
  if (visits.isError) return <FormAlert message={errorMessage(visits.error)} />;
  const { next } = visits.data;
  return (
    <div className="grid gap-3">
      <p className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary dark:text-foreground">
        <CalendarClockIcon aria-hidden className="size-4 shrink-0" />
        {next ? `Next visit: ${formatDateTime(new Date(next.start))} at ${next.branchName} with ${next.dentistName}.` : "No upcoming visit."}
      </p>
      {visits.data.visits.length === 0 ? (
        <EmptyState icon={CalendarX2Icon} title="No visits yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Chair</TableHead>
                <TableHead>Teeth</TableHead>
                <TableHead>Services</TableHead>
                <TableHead>Dentist</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.data.visits.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>{formatDateTime(new Date(v.start))}</TableCell>
                  <TableCell>{v.branchName}</TableCell>
                  <TableCell>{v.chairLabel ? `${v.chairNumber}, ${v.chairLabel}` : v.chairNumber}</TableCell>
                  <TableCell>{v.teeth.join(", ")}</TableCell>
                  <TableCell className="whitespace-normal">{v.procedures.join(", ")}</TableCell>
                  <TableCell>{v.dentistName}</TableCell>
                  <TableCell>
                    <StatusBadge status={v.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
