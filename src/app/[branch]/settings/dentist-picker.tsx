"use client";

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Dentist } from "@/lib/queries";

export function DentistPicker({ dentists, value, onChange }: { dentists: Dentist[]; value: string; onChange: (id: string) => void }) {
  if (dentists.length <= 1) return null;
  return (
    <label className="grid w-fit gap-1 text-sm font-medium">
      Dentist
      <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} className="w-64">
        {dentists.map((d) => (
          <NativeSelectOption key={d.id} value={d.id}>
            {d.title ? `${d.name}, ${d.title}` : d.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
