"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { PatientForms } from "@/components/patient-forms";
import { PatientSearch } from "@/components/patient-search";
import { Button } from "@/components/ui/button";

export function PatientsScreen({ branch, canAdd }: { branch: string; canAdd: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = (id: string) => router.push(`/${branch}/patients/${id}`);
  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Patients</h1>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            {/* Patient forms spec 5: a branch's forms, on that branch's page only. */}
            {branch !== "all" && <PatientForms branchCode={branch} onOpenPatient={open} />}
            <Button onClick={() => setAdding(true)}>Add patient</Button>
          </div>
        )}
      </div>
      <PatientSearch onPick={(p) => open(p.id)} autoFocus />
      {canAdd && (
        <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={(p) => open(p.id)} homeBranch={branch === "all" ? undefined : branch} />
      )}
    </div>
  );
}
