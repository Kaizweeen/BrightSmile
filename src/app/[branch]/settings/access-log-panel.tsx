"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { PatientSearch, type PatientHit } from "@/components/patient-search";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actionText } from "@/lib/access-log";
import { api, errorMessage } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/time";

type AuditRow = {
  id: number;
  at: string;
  action: string;
  details: Record<string, unknown>;
  userId: string | null;
  userName: string | null;
  branchName: string | null;
  patientName: string | null;
};

const PAGE = 50;

/** Spec 10: the owner's access log, newest first, by patient and by staff member. */
export function AccessLogPanel() {
  const [patient, setPatient] = useState<PatientHit | null>(null);
  const [user, setUser] = useState("");
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<{ id: string; name: string }[]>("/staff") });
  const log = useInfiniteQuery({
    queryKey: ["audit-log", patient?.id ?? "", user],
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (patient) query.set("patient", patient.id);
      if (user) query.set("user", user);
      if (pageParam) query.set("before", String(pageParam));
      return api<AuditRow[]>(`/audit-log?${query}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = log.data?.pages.flat() ?? [];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Sign-ins, every view and change of a patient record, and every staff and settings change, newest first.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {patient ? (
          <div className="flex items-center justify-between gap-2 self-start rounded-md border p-2 text-sm">
            <span>{`Patient: ${patient.lastName}, ${patient.firstName}`}</span>
            <Button variant="ghost" onClick={() => setPatient(null)}>
              Every patient
            </Button>
          </div>
        ) : (
          <PatientSearch onPick={setPatient} />
        )}
        <label className="grid gap-1.5 self-start text-sm font-medium">
          Staff member
          <NativeSelect value={user} onChange={(event) => setUser(event.target.value)} className="w-full">
            <NativeSelectOption value="">Everyone</NativeSelectOption>
            {(staff.data ?? []).map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </div>
      {log.isError && <FormAlert message={errorMessage(log.error)} />}
      {log.isPending ? (
        <p className="text-muted-foreground">Loading the access log...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Nothing recorded for this choice.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Branch</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{formatDateTime(new Date(r.at))}</TableCell>
                  <TableCell>{r.userName ?? (r.userId ? "A removed account" : r.details.online === true ? "Online booking" : "No one signed in")}</TableCell>
                  <TableCell className="whitespace-normal">{actionText(r)}</TableCell>
                  <TableCell>{r.patientName ?? ""}</TableCell>
                  <TableCell>{r.branchName ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {log.hasNextPage && (
        <Button variant="outline" className="justify-self-start" disabled={log.isFetchingNextPage} onClick={() => log.fetchNextPage()}>
          {log.isFetchingNextPage ? "Loading..." : "Show older"}
        </Button>
      )}
    </div>
  );
}
