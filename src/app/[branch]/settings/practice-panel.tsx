"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { durationText } from "@/lib/time";

type PracticeSettings = { name: string; visitMinutes: number; cleaningMinutes: number; onlineBooking: boolean; privacyNotice: string };

const LENGTHS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15); // 15 minutes to 4 hours
const CLEANING = Array.from({ length: 13 }, (_, i) => i * 5); // none to 60 minutes

/** Online booking spec 11: the practice's name, standard visit length, cleaning time, and online booking. */
export function PracticePanel({ bookingUrl }: { bookingUrl: string }) {
  const settings = useQuery({ queryKey: ["practice"], queryFn: () => api<PracticeSettings>("/practice") });
  if (settings.isPending) return <p className="text-muted-foreground">Loading the practice settings...</p>;
  if (settings.isError) return <FormAlert message={errorMessage(settings.error)} />;
  return <PracticeForm initial={settings.data} bookingUrl={bookingUrl} />;
}

function PracticeForm({ initial, bookingUrl }: { initial: PracticeSettings; bookingUrl: string }) {
  const router = useRouter();
  const client = useQueryClient();
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
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <form
      className="grid max-w-xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <TextField label="Practice name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} error={errors.name} />
      <label className="grid gap-1.5 text-sm font-medium">
        Standard visit length
        <NativeSelect value={String(form.visitMinutes)} onChange={(event) => setForm({ ...form, visitMinutes: Number(event.target.value) })}>
          {LENGTHS.map((m) => (
            <NativeSelectOption key={m} value={String(m)}>
              {durationText(m)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="font-normal text-muted-foreground">{"New visits and online bookings start at this length; staff can change a visit's length."}</span>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Chair cleaning time
        <NativeSelect value={String(form.cleaningMinutes)} onChange={(event) => setForm({ ...form, cleaningMinutes: Number(event.target.value) })}>
          {CLEANING.map((m) => (
            <NativeSelectOption key={m} value={String(m)}>
              {m === 0 ? "None" : durationText(m)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="font-normal text-muted-foreground">The chair stays blocked this long after each visit.</span>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Privacy notice
        <Textarea value={form.privacyNotice} maxLength={5000} rows={8} onChange={(event) => setForm({ ...form, privacyNotice: event.target.value })} aria-invalid={errors.privacyNotice ? true : undefined} />
        <span className="font-normal text-muted-foreground">Patients agree to it when they book online. Have a lawyer review it (RA 10173).</span>
        {errors.privacyNotice && <span className="font-normal text-destructive">{errors.privacyNotice}</span>}
      </label>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={form.onlineBooking} onChange={(event) => setForm({ ...form, onlineBooking: event.target.checked })} />
        Take online bookings
      </label>
      <p className="text-sm text-muted-foreground">
        {`Patients book at ${bookingUrl}. Their requests come in as Requested, marked Online, for the front desk to confirm.`}
      </p>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
