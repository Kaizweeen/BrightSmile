"use client";

import { LoadingRows } from "@/components/loading";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { usePractice, type PracticeSettings } from "@/lib/queries";
import { durationText } from "@/lib/time";

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15); // 15 minutes to 4 hours
const CLEANING = Array.from({ length: 13 }, (_, i) => i * 5); // none to 60 minutes

/** Online booking spec 11: the practice's name, standard visit length, cleaning time, and online booking. */
export function PracticePanel({ bookingUrl }: { bookingUrl: string }) {
  const settings = usePractice();
  if (settings.isPending) return <LoadingRows rows={3} label="Loading the practice settings..." />;
  if (settings.isError) return <FormAlert message={errorMessage(settings.error)} />;
  return <PracticeForm initial={settings.data} bookingUrl={bookingUrl} />;
}

function PracticeForm({ initial, bookingUrl }: { initial: PracticeSettings; bookingUrl: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const id = useId();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api<PracticeSettings>("/practice", { method: "PATCH", body: form }),
    onSuccess: async () => {
      toast.success("Practice settings saved.");
      setErrors({});
      await client.invalidateQueries({ queryKey: ["practice"] });
      router.refresh();
    },
    onError: (error) => {
      const fields = fieldErrors(error);
      setErrors(fields);
      // Only the name and the privacy notice show their own errors; any other failure is told in a toast.
      if (!fields.name && !fields.privacyNotice) toast.error(errorMessage(error));
    },
  });
  return (
    <form
      className="grid max-w-2xl gap-4 rounded-xl border bg-card p-5 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <TextField label="Practice name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} error={errors.name} />
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Standard visit length
          <NativeSelect value={String(form.visitMinutes)} onChange={(event) => setForm({ ...form, visitMinutes: Number(event.target.value) })} aria-describedby={`${id}-length`}>
            {LENGTHS.map((m) => (
              <NativeSelectOption key={m} value={String(m)}>
                {durationText(m)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <p id={`${id}-length`} className="text-sm text-muted-foreground">
          {"New visits and online bookings start at this length; staff can change a visit's length."}
        </p>
      </div>
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Chair cleaning time
          <NativeSelect value={String(form.cleaningMinutes)} onChange={(event) => setForm({ ...form, cleaningMinutes: Number(event.target.value) })} aria-describedby={`${id}-cleaning`}>
            {CLEANING.map((m) => (
              <NativeSelectOption key={m} value={String(m)}>
                {m === 0 ? "None" : durationText(m)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <p id={`${id}-cleaning`} className="text-sm text-muted-foreground">
          The chair stays blocked this long after each visit.
        </p>
      </div>
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Privacy notice
          <Textarea
            value={form.privacyNotice}
            maxLength={5000}
            rows={8}
            onChange={(event) => setForm({ ...form, privacyNotice: event.target.value })}
            aria-invalid={errors.privacyNotice ? true : undefined}
            aria-describedby={errors.privacyNotice ? `${id}-notice ${id}-notice-error` : `${id}-notice`}
          />
        </label>
        <p id={`${id}-notice`} className="text-sm text-muted-foreground">
          Patients agree to it when they book online or send a patient form. Have a lawyer review it (RA 10173).
        </p>
        {errors.privacyNotice && (
          <p id={`${id}-notice-error`} className="text-sm text-destructive">
            {errors.privacyNotice}
          </p>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={form.onlineBooking} onChange={(event) => setForm({ ...form, onlineBooking: event.target.checked })} />
        Take online bookings
      </label>
      <TextField
        label="Booking page address"
        value={bookingUrl}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        hint={form.onlineBooking ? "Share it with patients. Their requests come in as Requested, marked Online, for the front desk to confirm." : "Patients can use it once online booking is on."}
      />
      <div className="grid gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={form.patientForms} onChange={(event) => setForm({ ...form, patientForms: event.target.checked })} />
          Take patient forms
        </label>
        <p className="text-sm text-muted-foreground">Patients reach the form from each branch&apos;s patient poster (Branches, Print patient poster).</p>
      </div>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
