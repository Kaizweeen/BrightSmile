"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

const EMPTY = { firstName: "", middleName: "", lastName: "", birthday: "", sex: "", mobile: "", address: "", consent: false, website: "" };
type TextKey = Exclude<keyof typeof EMPTY, "consent">;

/** Moves focus to the heading when it appears, so screen readers announce the outcome. One function for every render, so it runs on mount only. */
const focusHeading = (heading: HTMLHeadingElement | null) => heading?.focus();

/** Patient forms spec 4: the patient's basic details and their agreement to the privacy notice, for the front desk to check. */
export function PatientForm({ branch, booking, today }: { branch: string; booking: boolean; today: string }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sexErrorId = useId();
  const consentErrorId = useId();
  const send = useMutation({
    mutationFn: () => api<{ firstName: string }>("/portal/forms", { method: "POST", body: { branch, ...form } }),
    onSuccess: () => setErrors({}),
    onError: (error) => setErrors(fieldErrors(error)),
  });

  if (send.data) {
    return (
      <section role="status" className="grid gap-3 rounded-lg border p-4">
        <h2 tabIndex={-1} ref={focusHeading} className="text-lg font-semibold outline-none">
          {`Thanks, ${send.data.firstName}.`}
        </h2>
        <p>Tell the front desk you filled in the form.</p>
        <div className="flex flex-wrap gap-2">
          {booking && (
            <Link href={`/book?branch=${encodeURIComponent(branch)}`} className={buttonVariants()}>
              Book a visit
            </Link>
          )}
          {/* A parent often fills in one for each child. */}
          <Button
            variant="outline"
            onClick={() => {
              setForm(EMPTY);
              send.reset();
            }}
          >
            Fill in another form
          </Button>
        </div>
      </section>
    );
  }

  const set = (key: TextKey) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });
  const general = send.error ? errorMessage(send.error) : null;
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <TextField label="First name" value={form.firstName} onChange={set("firstName")} maxLength={50} autoComplete="given-name" error={errors.firstName} />
      <TextField label="Middle name (optional)" value={form.middleName} onChange={set("middleName")} maxLength={50} autoComplete="additional-name" error={errors.middleName} />
      <TextField label="Last name" value={form.lastName} onChange={set("lastName")} maxLength={50} autoComplete="family-name" error={errors.lastName} />
      <TextField label="Birthday" type="date" value={form.birthday} onChange={set("birthday")} min="1900-01-01" max={today} autoComplete="bday" error={errors.birthday} />
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          Sex
          <NativeSelect
            className="w-full"
            value={form.sex}
            onChange={set("sex")}
            aria-invalid={errors.sex ? true : undefined}
            aria-describedby={errors.sex ? sexErrorId : undefined}
          >
            <NativeSelectOption value="">Pick one</NativeSelectOption>
            <NativeSelectOption value="female">Female</NativeSelectOption>
            <NativeSelectOption value="male">Male</NativeSelectOption>
          </NativeSelect>
        </label>
        {errors.sex && (
          <p id={sexErrorId} className="text-sm text-destructive">
            {errors.sex}
          </p>
        )}
      </div>
      <TextField label="Mobile number" value={form.mobile} onChange={set("mobile")} inputMode="tel" autoComplete="tel" hint="For example 0917 123 4567" error={errors.mobile} />
      <TextField label="Address" value={form.address} onChange={set("address")} maxLength={200} autoComplete="street-address" error={errors.address} />
      {/* A trap for bots (patient forms spec 7): people never see it, so they never fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
        </label>
      </div>
      <div className="grid gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={form.consent}
            onChange={(event) => setForm({ ...form, consent: event.target.checked })}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? consentErrorId : undefined}
          />
          <span>
            I agree to the{" "}
            <a href="/book/privacy" target="_blank" rel="noopener" className="underline">
              privacy notice
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p id={consentErrorId} className="text-sm text-destructive">
            {errors.consent}
          </p>
        )}
      </div>
      {general && <FormAlert message={general} />}
      <Button type="submit" disabled={send.isPending}>
        {send.isPending ? "Sending..." : "Send the form"}
      </Button>
    </form>
  );
}
