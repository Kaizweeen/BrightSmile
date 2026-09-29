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
import { useDentists, usePractice } from "@/lib/queries";
import { durationText, formatDay, formatTime, fromMinutes, manilaDate, manilaInstant, manilaMinutes, toMinutes } from "@/lib/time";
import { chairName, type VisitDetailJson } from "@/lib/visits";

type Procedure = { id: string; name: string };
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
const LENGTHS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15); // 15 minutes to 8 hours
const minutesBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);

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
  const [length, setLength] = useState<number | null>(null);
  // The inputs of the last save: its error and warnings show only while the inputs are still the same.
  const [tried, setTried] = useState<string | null>(null);

  const procedures = useQuery({ queryKey: ["procedures", "active"], queryFn: () => api<Procedure[]>("/procedures?active=1") });
  const dentists = useDentists();
  const practice = usePractice();
  // Online booking spec 6.2: a new visit starts at the standard length, a moved one keeps its own; staff can change either.
  const own = moving ? minutesBetween(moving.start, moving.end) : undefined;
  const lengthMinutes = length ?? own ?? practice.data?.visitMinutes;
  const cleaningMinutes = moving ? minutesBetween(moving.end, moving.chairFreeAt) : practice.data?.cleaningMinutes;
  // A moved visit's own length may be off the 15-minute steps: it stays in the list, so staff can go back to it.
  const lengthOptions = own !== undefined && !LENGTHS.includes(own) ? [...LENGTHS, own].sort((a, b) => a - b) : LENGTHS;
  // A moved visit's own length is sent only when staff pick another: the server keeps it otherwise, and takes only 15-minute steps.
  const sentMinutes = moving && (length === null || length === own) ? undefined : lengthMinutes;
  // Open times are found for the length rounded up to the grid: any time that fits the longer visit fits the real one.
  const searchMinutes = lengthMinutes === undefined ? undefined : Math.min(480, Math.ceil(lengthMinutes / 15) * 15);
  // The standard length could not be loaded, so a new visit has no length to book or search with.
  const practiceFailed = practice.isError && lengthMinutes === undefined;
  const open = useQuery({
    queryKey: ["availability", branch.code, date, searchMinutes, patient?.id ?? ""],
    queryFn: () =>
      api<{ times: OpenTime[] }>(`/availability?branch=${branch.code}&date=${date}&minutes=${searchMinutes}${patient ? `&patient=${patient.id}` : ""}`),
    enabled: searchMinutes !== undefined && !walkIn && !anyTime && !chairOnly,
  });
  const working = [...new Map((open.data?.times ?? []).flatMap((t) => t.dentists.map((d) => [d.id, d.name] as const))).entries()];
  const times = (open.data?.times ?? []).filter((t) => !dentistFilter || t.dentists.some((d) => d.id === dentistFilter));
  const slot = anyTime || walkIn ? undefined : times.find((t) => clock(t.start) === time);
  const slotDentist = slot?.dentists.find((d) => d.id === dentistId);
  const here = (dentists.data ?? []).filter((d) => d.branchIds.includes(branch.id));

  const start = walkIn || !time ? null : manilaInstant(date, toMinutes(time)).toISOString();
  const complete = patient !== null && procedureIds.length > 0 && dentistId !== "" && chairNumber !== null && (walkIn || start !== null);
  const request = { branch: branch.code, chairNumber, dentistId, patientId: patient?.id, start, procedureIds, minutes: sentMinutes, walkIn };
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
            body: chairOnly
              ? { chairNumber, expectedUpdatedAt: moving.updatedAt }
              : { chairNumber, dentistId, start, procedureIds, minutes: sentMinutes, acknowledgeWarnings, expectedUpdatedAt: moving.updatedAt },
          })
        : api("/appointments", { method: "POST", body: { ...request, requested, note, acknowledgeWarnings } }),
    onSuccess: async () => {
      toast.success(moving ? "Moved." : walkIn ? "Checked in." : "Booked.");
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment"] });
      await client.invalidateQueries({ queryKey: ["availability"] });
      onClose();
    },
    onError: async () => {
      // Another desk may have just taken the time or changed the visit: show the calendar and open times as they are now.
      await client.invalidateQueries({ queryKey: ["availability"] });
      await client.invalidateQueries({ queryKey: ["validate"] });
      await client.invalidateQueries({ queryKey: ["appointments"] });
      await client.invalidateQueries({ queryKey: ["appointment"] });
    },
  });
  const attempt = JSON.stringify([request, requested, note]);
  const failed = save.error && tried === attempt ? save.error : null;
  // A check the server refuses outright, such as a start off the 15-minute grid, is an error too: Book stays disabled.
  const errors = check.data?.errors ?? (check.error ? [{ code: "invalid", message: errorMessage(check.error) }] : []);
  const warnings =
    check.data && check.data.warnings.length > 0
      ? check.data.warnings
      : failed instanceof RequestError
        ? (failed.body.warnings ?? [])
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
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Services</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {(procedures.data ?? []).map((p) => (
                    <label key={p.id} className={toggleClass}>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={procedureIds.includes(p.id)}
                        onChange={(event) => setProcedureIds(event.target.checked ? [...procedureIds, p.id] : procedureIds.filter((id) => id !== p.id))}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2">
                <label className="grid gap-1.5 text-sm font-medium sm:max-w-xs">
                  Length
                  <NativeSelect
                    value={lengthMinutes === undefined ? "" : String(lengthMinutes)}
                    disabled={lengthMinutes === undefined}
                    onChange={(event) => {
                      setLength(Number(event.target.value));
                      if (!anyTime) setTime("");
                    }}
                  >
                    {lengthOptions.map((m) => (
                      <NativeSelectOption key={m} value={String(m)}>
                        {durationText(m)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                {practiceFailed && <FormAlert message={errorMessage(practice.error)} />}
                {lengthMinutes !== undefined && cleaningMinutes !== undefined && (
                  <p className="text-sm text-muted-foreground">{`${durationText(lengthMinutes)}, then ${cleaningMinutes === 0 ? "no chair cleaning" : `${durationText(cleaningMinutes)} of chair cleaning`}.`}</p>
                )}
              </div>
            </>
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
                (practiceFailed ? (
                  <FormAlert message={errorMessage(practice.error)} />
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
          {failed && !(failed instanceof RequestError && failed.body.code === "warnings") && <FormAlert message={errorMessage(failed)} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Go back
          </Button>
          <Button
            disabled={!complete || errors.length > 0 || save.isPending || (!chairOnly && check.isFetching)}
            onClick={() => {
              setTried(attempt);
              save.mutate(warnings.length > 0);
            }}
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
