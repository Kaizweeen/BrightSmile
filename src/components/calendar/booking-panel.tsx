"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch } from "@/components/patient-search";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, RequestError } from "@/lib/fetcher";
import { useDentists } from "@/lib/queries";
import { formatDay, formatTime, fromMinutes, manilaDate, manilaInstant, manilaMinutes, toMinutes } from "@/lib/time";
import { chairName, type VisitDetailJson } from "@/lib/visits";

type Procedure = { id: string; name: string; durationMinutes: number; bufferMinutes: number };
type OpenTime = { start: string; dentists: { id: string; name: string; chairs: number[] }[] };
type Finding = { code: string; message: string };
type Check = { ok: boolean; errors: Finding[]; warnings: Finding[] };

/** What opened the panel: New booking, Walk-in, or an empty slot (with its time and chair), or Move on a visit. */
export type BookingIntent =
  | { kind: "new"; date: string; minutes?: number; chairNumber?: number; walkIn?: boolean }
  | { kind: "move"; visit: VisitDetailJson };

type Props = {
  intent: BookingIntent;
  branch: { id: string; code: string; name: string };
  chairs: { number: number; label: string }[];
  today: string;
  onClose: () => void;
};

/** "HH:MM" in Manila for an ISO instant. */
const clock = (iso: string) => fromMinutes(manilaMinutes(new Date(iso)));
const lowest = (numbers: number[] | undefined) => (numbers && numbers.length > 0 ? Math.min(...numbers) : null);

const toggleClass = "flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm sm:min-h-9";

/** Spec 10, the booking panel. Moving uses the same checks as booking, with the visit itself left out (spec 8.7). */
export function BookingPanel({ intent, branch, chairs, today, onClose }: Props) {
  const client = useQueryClient();
  const moving = intent.kind === "move" ? intent.visit : null;
  const fresh = intent.kind === "new" ? intent : null;
  const chairOnly = moving?.status === "checked_in";
  const [patient, setPatient] = useState(moving ? { id: moving.patientId, name: moving.patientName } : null);
  const [adding, setAdding] = useState(false);
  const [procedureIds, setProcedureIds] = useState<string[]>(moving?.procedureIds ?? []);
  const [walkIn, setWalkIn] = useState(fresh?.walkIn === true);
  const [date, setDate] = useState(moving ? manilaDate(new Date(moving.start)) : (fresh?.date ?? today));
  const [anyTime, setAnyTime] = useState(moving !== null || fresh?.minutes !== undefined);
  const [time, setTime] = useState(moving ? clock(moving.start) : fresh?.minutes !== undefined ? fromMinutes(fresh.minutes) : "");
  const [dentistFilter, setDentistFilter] = useState("");
  const [dentistId, setDentistId] = useState(moving?.dentistId ?? "");
  const [chairNumber, setChairNumber] = useState<number | null>(moving?.chairNumber ?? fresh?.chairNumber ?? null);
  const [requested, setRequested] = useState(false);
  const [note, setNote] = useState("");

  const procedures = useQuery({ queryKey: ["procedures", "active"], queryFn: () => api<Procedure[]>("/procedures?active=1") });
  const dentists = useDentists();
  const picked = (procedures.data ?? []).filter((p) => procedureIds.includes(p.id));
  const minutes = picked.reduce((sum, p) => sum + p.durationMinutes, 0);
  const turnover = Math.max(0, ...picked.map((p) => p.bufferMinutes));
  const open = useQuery({
    queryKey: ["availability", branch.code, date, procedureIds.join(","), patient?.id ?? ""],
    queryFn: () =>
      api<{ times: OpenTime[] }>(
        `/availability?branch=${branch.code}&date=${date}&procedures=${procedureIds.join(",")}${patient ? `&patient=${patient.id}` : ""}`,
      ),
    enabled: procedureIds.length > 0 && !walkIn && !anyTime && !chairOnly,
  });
  const working = [...new Map((open.data?.times ?? []).flatMap((t) => t.dentists.map((d) => [d.id, d.name] as const))).entries()];
  const times = (open.data?.times ?? []).filter((t) => !dentistFilter || t.dentists.some((d) => d.id === dentistFilter));
  const slot = anyTime || walkIn ? undefined : times.find((t) => clock(t.start) === time);
  const slotDentist = slot?.dentists.find((d) => d.id === dentistId);
  const here = (dentists.data ?? []).filter((d) => d.branchIds.includes(branch.id));

  const start = walkIn || !time ? null : manilaInstant(date, toMinutes(time)).toISOString();
  const complete = patient !== null && procedureIds.length > 0 && dentistId !== "" && chairNumber !== null && (walkIn || start !== null);
  const request = { branch: branch.code, chairNumber, dentistId, patientId: patient?.id, start, procedureIds, walkIn };
  const check = useQuery({
    queryKey: ["validate", request, moving?.id ?? null],
    queryFn: () => api<Check>("/appointments/validate", { method: "POST", body: { ...request, excludeAppointmentId: moving?.id ?? null } }),
    enabled: complete && !chairOnly,
  });
  const save = useMutation({
    mutationFn: (acknowledgeWarnings: boolean) =>
      moving
        ? api(`/appointments/${moving.id}`, {
            method: "PATCH",
            body: chairOnly ? { chairNumber } : { chairNumber, dentistId, start, procedureIds, acknowledgeWarnings },
          })
        : api("/appointments", { method: "POST", body: { ...request, requested, note, acknowledgeWarnings } }),
    onSuccess: async () => {
      toast.success(moving ? "Moved." : walkIn ? "Checked in." : "Booked.");
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment"] });
      await client.invalidateQueries({ queryKey: ["availability"] });
      onClose();
    },
  });
  const errors = check.data?.errors ?? [];
  const warnings =
    check.data && check.data.warnings.length > 0
      ? check.data.warnings
      : save.error instanceof RequestError
        ? (save.error.body.warnings ?? [])
        : [];

  const pick = (t: OpenTime) => {
    const d = t.dentists.find((x) => x.id === dentistFilter) ?? t.dentists[0];
    setTime(clock(t.start));
    setDentistId(d.id);
    setChairNumber(lowest(d.chairs));
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{moving ? `Move ${moving.patientName}` : walkIn ? "Walk-in" : "New booking"}</DialogTitle>
          <DialogDescription>
            {moving
              ? `Now ${formatDay(manilaDate(new Date(moving.start)))}, ${formatTime(new Date(moving.start))}, ${chairName(moving.chairNumber, moving.chairLabel)}, with ${moving.dentistName}.`
              : `At ${branch.name}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {!moving && (
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Patient</h3>
              {patient ? (
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="font-medium">{patient.name}</span>
                  <Button variant="ghost" onClick={() => setPatient(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <PatientSearch onPick={(p) => setPatient({ id: p.id, name: `${p.lastName}, ${p.firstName}` })} autoFocus />
                  <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>
                    Add a new patient
                  </Button>
                  <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={setPatient} homeBranch={branch.code} />
                </>
              )}
            </section>
          )}

          {!chairOnly && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Procedures</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {(procedures.data ?? []).map((p) => (
                  <label key={p.id} className={toggleClass}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={procedureIds.includes(p.id)}
                      onChange={(event) => {
                        setProcedureIds(event.target.checked ? [...procedureIds, p.id] : procedureIds.filter((id) => id !== p.id));
                        if (!anyTime) setTime("");
                      }}
                    />
                    {`${p.name}, ${p.durationMinutes} min`}
                  </label>
                ))}
              </div>
              {picked.length > 0 && <p className="text-sm text-muted-foreground">{`${minutes} minutes, then ${turnover} minutes of chair turnover.`}</p>}
            </fieldset>
          )}

          {!moving && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={toggleClass}>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={walkIn}
                  onChange={(event) => {
                    setWalkIn(event.target.checked);
                    setTime("");
                  }}
                />
                Walk-in: the patient is here now
              </label>
              {!walkIn && (
                <label className={toggleClass}>
                  <input type="checkbox" className="size-4 accent-primary" checked={requested} onChange={(event) => setRequested(event.target.checked)} />
                  The patient still has to confirm
                </label>
              )}
            </div>
          )}

          {!walkIn && !chairOnly && (
            <section className="grid gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1.5 text-sm font-medium">
                  Date
                  <Input
                    type="date"
                    min={today}
                    value={date}
                    onChange={(event) => {
                      if (!event.target.value) return;
                      setDate(event.target.value);
                      if (!anyTime) setTime("");
                    }}
                  />
                </label>
                {anyTime ? (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Start
                    <Input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} />
                  </label>
                ) : (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Dentist
                    <NativeSelect
                      value={dentistFilter}
                      onChange={(event) => {
                        setDentistFilter(event.target.value);
                        setTime("");
                      }}
                    >
                      <NativeSelectOption value="">Any dentist</NativeSelectOption>
                      {working.map(([id, name]) => (
                        <NativeSelectOption key={id} value={id}>
                          {name}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </label>
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAnyTime(!anyTime);
                    setTime("");
                  }}
                >
                  {anyTime ? "Show open times" : "Pick another time"}
                </Button>
              </div>
              {!anyTime &&
                (procedureIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pick procedures to see the open times.</p>
                ) : open.isPending ? (
                  <p className="text-sm text-muted-foreground">Finding open times...</p>
                ) : open.isError ? (
                  <FormAlert message={errorMessage(open.error)} />
                ) : times.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open times on this day. Try another day, or pick another time.</p>
                ) : (
                  <div role="group" aria-label="Open times" className="flex flex-wrap gap-2">
                    {times.map((t) => {
                      const chosen = clock(t.start) === time;
                      return (
                        <Button key={t.start} variant={chosen ? "default" : "outline"} aria-pressed={chosen} onClick={() => pick(t)}>
                          {formatTime(new Date(t.start))}
                        </Button>
                      );
                    })}
                  </div>
                ))}
            </section>
          )}

          {(slot || anyTime || walkIn || chairOnly) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {!chairOnly && (
                <label className="grid gap-1.5 text-sm font-medium">
                  Dentist for this visit
                  <NativeSelect
                    value={dentistId}
                    onChange={(event) => {
                      setDentistId(event.target.value);
                      if (slot) setChairNumber(lowest(slot.dentists.find((d) => d.id === event.target.value)?.chairs));
                    }}
                  >
                    {!slot && <NativeSelectOption value="">Pick a dentist</NativeSelectOption>}
                    {(slot ? slot.dentists : here).map((d) => (
                      <NativeSelectOption key={d.id} value={d.id}>
                        {d.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              )}
              <label className="grid gap-1.5 text-sm font-medium">
                Chair
                <NativeSelect value={chairNumber === null ? "" : String(chairNumber)} onChange={(event) => setChairNumber(event.target.value ? Number(event.target.value) : null)}>
                  {chairNumber === null && <NativeSelectOption value="">Pick a chair</NativeSelectOption>}
                  {chairs
                    .filter((c) => !slotDentist || slotDentist.chairs.includes(c.number))
                    .map((c) => (
                      <NativeSelectOption key={c.number} value={String(c.number)}>
                        {chairName(c.number, c.label)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </label>
            </div>
          )}

          {!moving && (
            <label className="grid gap-1.5 text-sm font-medium">
              Note (optional)
              <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>This booking cannot be saved</AlertTitle>
              <AlertDescription>
                <ul className="grid gap-1">
                  {errors.map((e) => (
                    <li key={`${e.code}-${e.message}`}>{e.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert>
              <AlertTitle>Check before booking</AlertTitle>
              <AlertDescription>
                <ul className="grid gap-1">
                  {warnings.map((w) => (
                    <li key={w.code}>{w.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {save.error && !(save.error instanceof RequestError && save.error.body.code === "warnings") && <FormAlert message={errorMessage(save.error)} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go back
          </Button>
          <Button
            disabled={!complete || errors.length > 0 || save.isPending || (!chairOnly && check.isFetching)}
            onClick={() => save.mutate(warnings.length > 0)}
          >
            {save.isPending
              ? "Saving..."
              : warnings.length > 0
                ? moving
                  ? "Move anyway"
                  : "Book anyway"
                : moving
                  ? "Move visit"
                  : walkIn
                    ? "Check in now"
                    : "Book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
