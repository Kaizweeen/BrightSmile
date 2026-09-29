"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { FormAlert } from "@/components/form-alert";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime, manilaDate } from "@/lib/time";
import { chairName, type VisitJson } from "@/lib/visits";

/** Spec 6.5: a disabled dentist's upcoming visits, each linked to its day on the calendar so the desk can move it. */
export function DisabledVisits({ person }: { person: { id: string; name: string } }) {
  const visits = useQuery({ queryKey: ["appointments", "staff", person.id], queryFn: () => api<VisitJson[]>(`/staff/${person.id}/visits`) });
  if (visits.isError) return <FormAlert message={errorMessage(visits.error)} />;
  if (!visits.data || visits.data.length === 0) return null;
  const count = visits.data.length;
  return (
    <section aria-labelledby={`upcoming-${person.id}`} className="grid gap-2 rounded-lg border border-destructive/50 p-4">
      <h2 id={`upcoming-${person.id}`} className="font-semibold">
        {`${person.name} is disabled and still has ${count} upcoming ${count === 1 ? "visit" : "visits"}`}
      </h2>
      <p className="text-sm text-muted-foreground">Open each one on its calendar, then move it to another dentist or cancel it.</p>
      <ul className="grid gap-1 text-sm">
        {visits.data.map((v) => (
          <li key={v.id}>
            <Link href={`/${v.branchCode}/calendar?date=${manilaDate(new Date(v.start))}`} className="underline underline-offset-4">
              {`${formatDateTime(new Date(v.start))}, ${v.branchName}, ${chairName(v.chairNumber, v.chairLabel)}: ${v.patientName}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
