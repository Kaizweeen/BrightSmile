"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertMark } from "@/components/alert-mark";
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
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm font-medium">
        Find a patient
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Name, mobile, birthday (YYYY-MM-DD), or chart number"
          autoFocus={autoFocus}
        />
      </label>
      {hits.isError && <p className="text-sm text-destructive">The search did not work. Try again.</p>}
      <ul className="grid max-h-80 gap-1 overflow-y-auto">
        {hits.data?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span>
                <span className="font-medium">{`${p.lastName}, ${p.firstName}`}</span>
                <span className="block text-sm text-muted-foreground">{[`Chart ${p.chartNo}`, p.birthday, p.mobile].filter(Boolean).join(" · ")}</span>
              </span>
              {p.hasAlerts && <AlertMark />}
            </button>
          </li>
        ))}
        {hits.data?.length === 0 && <li className="text-sm text-muted-foreground">{term ? "No patient matches." : "No patients yet."}</li>}
      </ul>
    </div>
  );
}
