"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage, fieldErrors, RequestError } from "@/lib/fetcher";
import { BOOKING_DAYS } from "@/lib/portal";
import { addDays, formatDay, formatTime, manilaDate } from "@/lib/time";

type Option = { value: string; label: string };
/** `branches`: the codes of the branches that offer the service, or null for all of them. */
type ServiceOption = Option & { branches: string[] | null };
type Done = { branch: string; service: string; start: string };

const EMPTY = { firstName: "", lastName: "", mobile: "", note: "", consent: false, website: "" };

/** Moves focus to the heading when it appears, so screen readers announce the outcome. One function for every render, so it runs on mount only. */
const focusHeading = (heading: HTMLHeadingElement | null) => heading?.focus();

/** Online booking spec 3: branch, service, day and time, then the patient's details, on one page. */
export function BookForm({
  practiceName,
  branches,
  services,
  today,
  initialBranch,
}: {
  practiceName: string;
  branches: Option[];
  services: ServiceOption[];
  today: string;
  initialBranch?: string;
}) {
  const [branch, setBranch] = useState(initialBranch ?? (branches.length === 1 ? branches[0].value : ""));
  const [service, setService] = useState("");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("");
  const [details, setDetails] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Done | null>(null);
  const consentErrorId = useId();
  const days = Array.from({ length: BOOKING_DAYS + 1 }, (_, i) => addDays(today, i));
  // A service is offered where its dentists work (online booking spec 3); every service until a branch is chosen.
  const offeredAt = (s: ServiceOption, code: string) => code === "" || s.branches === null || s.branches.includes(code);
  const times = useQuery({
    queryKey: ["portal-times", branch, service, date],
    queryFn: () => api<{ times: string[] }>(`/portal/times?branch=${encodeURIComponent(branch)}&service=${service}&date=${date}`),
    enabled: branch !== "" && service !== "",
  });
  // The picked time counts only while it is still among the open times: another day, branch, or service, or a time just taken, drops it.
  const chosen = times.data?.times.includes(start) ? start : "";
  const book = useMutation({
    mutationFn: () => api<Done>("/portal/bookings", { method: "POST", body: { branch, service, start: chosen, ...details } }),
    onSuccess: (data) => setDone(data),
    onError: (error) => {
      setErrors(fieldErrors(error));
      // Someone may have just taken the time: show the day's times as they are now.
      if (error instanceof RequestError && error.status === 409) void times.refetch();
    },
  });

  if (done) {
    const when = new Date(done.start);
    return (
      <section role="status" className="grid gap-3 rounded-lg border p-4">
        <h2 tabIndex={-1} ref={focusHeading} className="text-lg font-semibold outline-none">
          Your request is in.
        </h2>
        <p>{`${practiceName} will call or text you to confirm.`}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Branch</dt>
          <dd>{done.branch}</dd>
          <dt className="text-muted-foreground">Service</dt>
          <dd>{done.service}</dd>
          <dt className="text-muted-foreground">When</dt>
          <dd>{`${formatDay(manilaDate(when))}, ${formatTime(when)}`}</dd>
        </dl>
      </section>
    );
  }

  const set = (field: "firstName" | "lastName" | "mobile" | "note" | "website") => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDetails({ ...details, [field]: event.target.value });
  const general = book.error ? errorMessage(book.error) : null;

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        book.mutate();
      }}
    >
      <label className="grid gap-1.5 text-sm font-medium">
        Branch
        <NativeSelect
          className="w-full"
          value={branch}
          onChange={(event) => {
            setBranch(event.target.value);
            // A service the new branch does not offer is dropped.
            if (!services.some((s) => s.value === service && offeredAt(s, event.target.value))) setService("");
          }}
        >
          <NativeSelectOption value="">Pick a branch</NativeSelectOption>
          {branches.map((b) => (
            <NativeSelectOption key={b.value} value={b.value}>
              {b.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Service
        <NativeSelect className="w-full" value={service} onChange={(event) => setService(event.target.value)}>
          <NativeSelectOption value="">Pick a service</NativeSelectOption>
          {services.filter((s) => offeredAt(s, branch)).map((s) => (
            <NativeSelectOption key={s.value} value={s.value}>
              {s.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Day
        <NativeSelect className="w-full" value={date} onChange={(event) => setDate(event.target.value)}>
          {days.map((d) => (
            <NativeSelectOption key={d} value={d}>
              {formatDay(d)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Time</legend>
        {branch === "" || service === "" ? (
          <p className="text-sm text-muted-foreground">Pick a branch and a service to see the open times.</p>
        ) : times.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Finding open times...
          </p>
        ) : times.isError ? (
          <FormAlert message={errorMessage(times.error)} />
        ) : times.data.times.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            No open times this day. Try another day.
          </p>
        ) : (
          <div role="group" aria-label="Open times" className="flex flex-wrap gap-2">
            {times.data.times.map((t) => (
              <Button
                key={t}
                type="button"
                variant={chosen === t ? "default" : "outline"}
                aria-pressed={chosen === t}
                onClick={() => {
                  setStart(t);
                  // An old refusal must not linger once the patient picks again (never while a booking is being sent).
                  if (book.isError) book.reset();
                }}
              >
                {formatTime(new Date(t))}
              </Button>
            ))}
          </div>
        )}
      </fieldset>
      <TextField label="First name" value={details.firstName} onChange={set("firstName")} maxLength={50} autoComplete="given-name" error={errors.firstName} />
      <TextField label="Last name" value={details.lastName} onChange={set("lastName")} maxLength={50} autoComplete="family-name" error={errors.lastName} />
      <TextField label="Mobile number" value={details.mobile} onChange={set("mobile")} inputMode="tel" autoComplete="tel" hint="For example 0917 123 4567" error={errors.mobile} />
      <label className="grid gap-1.5 text-sm font-medium">
        What would you like the dentist to know? (optional)
        <Textarea value={details.note} maxLength={500} onChange={set("note")} />
      </label>
      {/* A trap for bots (online booking spec 8): people never see it, so they never fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input tabIndex={-1} autoComplete="off" value={details.website} onChange={set("website")} />
        </label>
      </div>
      <div className="grid gap-1">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            checked={details.consent}
            onChange={(event) => setDetails({ ...details, consent: event.target.checked })}
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
      <Button type="submit" disabled={book.isPending || chosen === ""}>
        {book.isPending ? "Sending..." : "Request this time"}
      </Button>
    </form>
  );
}
