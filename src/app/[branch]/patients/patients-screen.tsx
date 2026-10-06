"use client";

import { UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddPatientDialog } from "@/components/add-patient-dialog";
import { PageHeader } from "@/components/page-header";
import { PatientForms } from "@/components/patient-forms";
import { PatientSearch } from "@/components/patient-search";
import { Button } from "@/components/ui/button";

export function PatientsScreen({ branch, canAdd }: { branch: string; canAdd: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const open = (id: string) => router.push(`/${branch}/patients/${id}`);
  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="Patients"
        description="Search by name, mobile number, birthday, or chart number."
        actions={
          canAdd && (
            <>
              {/* Patient forms spec 5: a branch's forms, on that branch's page only. */}
              {branch !== "all" && <PatientForms branchCode={branch} onOpenPatient={open} />}
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon aria-hidden data-icon="inline-start" />
                Add patient
              </Button>
            </>
          )
        }
      />
      <PatientSearch onPick={(p) => open(p.id)} autoFocus />
      {canAdd && (
        <AddPatientDialog open={adding} onOpenChange={setAdding} onAdded={(p) => open(p.id)} homeBranch={branch === "all" ? undefined : branch} />
      )}
    </div>
  );
}
