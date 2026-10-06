"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertMark } from "@/components/alert-mark";
import { EmptyState } from "@/components/empty-state";
import { LoadingRows } from "@/components/loading";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/fetcher";

export type PatientHit = {
  id: string;
  chartNo: number;
  lastName: string;
  firstName: string;
  birthday: string | null;
  mobile: string | null;
  hasAlerts: boolean;
};

const initials = (p: PatientHit) => `${p.firstName[0] ?? ""}${p.lastName[0] ?? ""}`.toUpperCase();

/** Find a patient by name, mobile, birthday, or chart number; an empty search lists the latest updated patients. */
export function PatientSearch({ onPick, autoFocus }: { onPick: (patient: PatientHit) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const hits = useQuery({ queryKey: ["patients", term], queryFn: () => api<PatientHit[]>(`/patients?q=${encodeURIComponent(term)}`) });
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-medium">
        Find a patient
        <span className="relative block">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Name, mobile, birthday (YYYY-MM-DD), or chart number"
            autoFocus={autoFocus}
            className="pl-9 sm:h-10"
          />
        </span>
      </label>
      {hits.isError && <p className="text-sm text-destructive">The search did not work. Try again.</p>}
      {hits.isPending && <LoadingRows rows={4} label="Searching..." />}
      {hits.data && hits.data.length > 0 && (
        <>
          {!term && <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Recently updated</p>}
          <ul className="grid max-h-96 gap-1.5 overflow-y-auto pr-0.5">
            {hits.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="group flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left shadow-xs outline-none transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {initials(p)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{`${p.lastName}, ${p.firstName}`}</span>
                    <span className="block truncate text-sm text-muted-foreground">{[`Chart ${p.chartNo}`, p.birthday, p.mobile].filter(Boolean).join(" · ")}</span>
                  </span>
                  {p.hasAlerts && <AlertMark />}
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {hits.data?.length === 0 && <EmptyState icon={UsersIcon} title={term ? "No patient matches" : "No patients yet"}>{term ? "Check the spelling, or search by mobile number or chart number." : "Add the first patient with the button above."}</EmptyState>}
    </div>
  );
}
