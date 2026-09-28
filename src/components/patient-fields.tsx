"use client";

import { TextField } from "@/components/text-field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ALLERGY_KEYS, ALLERGY_LABELS } from "@/lib/patients";

export type PatientDraft = {
  lastName: string;
  firstName: string;
  middleName: string;
  birthday: string;
  sex: string;
  mobile: string;
  email: string;
  address: string;
  occupation: string;
  guardianName: string;
  emergencyName: string;
  emergencyMobile: string;
  hmoProvider: string;
  hmoMemberNo: string;
  insuranceEffective: string;
  allergies: string[];
  allergiesOther: string;
  medicalAlerts: string;
  consent: boolean;
};

export const EMPTY_PATIENT: PatientDraft = {
  lastName: "",
  firstName: "",
  middleName: "",
  birthday: "",
  sex: "",
  mobile: "",
  email: "",
  address: "",
  occupation: "",
  guardianName: "",
  emergencyName: "",
  emergencyMobile: "",
  hmoProvider: "",
  hmoMemberNo: "",
  insuranceEffective: "",
  allergies: [],
  allergiesOther: "",
  medicalAlerts: "",
  consent: false,
};

type TextKey = Exclude<keyof PatientDraft, "allergies" | "consent">;

/** The patient form (spec 7 `patients`). Empty text fields are sent as empty strings; the server stores them as empty. */
export function PatientFields({
  value,
  onChange,
  errors,
  alertsOnly = false,
  showConsent = false,
}: {
  value: PatientDraft;
  onChange: (next: PatientDraft) => void;
  errors: Record<string, string>;
  alertsOnly?: boolean;
  showConsent?: boolean;
}) {
  const text = (key: TextKey, label: string, props: React.ComponentProps<"input"> = {}) => (
    <TextField label={label} value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} error={errors[key]} {...props} />
  );
  const alerts = (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Allergies and medical alerts</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {ALLERGY_KEYS.map((key) => (
          <label key={key} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm sm:min-h-9">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={value.allergies.includes(key)}
              onChange={(event) =>
                onChange({ ...value, allergies: event.target.checked ? [...value.allergies, key] : value.allergies.filter((a) => a !== key) })
              }
            />
            {ALLERGY_LABELS[key]}
          </label>
        ))}
      </div>
      {text("allergiesOther", "Other allergy", { maxLength: 100 })}
      <label className="grid gap-1.5 text-sm font-medium">
        Medical alerts
        <Textarea
          value={value.medicalAlerts}
          maxLength={500}
          onChange={(event) => onChange({ ...value, medicalAlerts: event.target.value })}
          placeholder="For example: hypertension, on blood thinners, pregnant"
        />
        {errors.medicalAlerts && <span className="text-destructive">{errors.medicalAlerts}</span>}
      </label>
    </fieldset>
  );
  if (alertsOnly) return alerts;
  return (
    <div className="grid gap-5">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">Name</legend>
        {text("lastName", "Last name", { maxLength: 50, autoComplete: "off" })}
        {text("firstName", "First name", { maxLength: 50, autoComplete: "off" })}
        {text("middleName", "Middle name", { maxLength: 50, autoComplete: "off" })}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {text("birthday", "Birthday", { type: "date" })}
        <label className="grid gap-1.5 text-sm font-medium">
          Sex
          <NativeSelect value={value.sex} onChange={(event) => onChange({ ...value, sex: event.target.value })} className="w-full">
            <NativeSelectOption value="">Not given</NativeSelectOption>
            <NativeSelectOption value="female">Female</NativeSelectOption>
            <NativeSelectOption value="male">Male</NativeSelectOption>
          </NativeSelect>
        </label>
        {text("mobile", "Mobile", { type: "tel", inputMode: "tel", placeholder: "0917 123 4567" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("email", "Email", { type: "email" })}
        {text("occupation", "Occupation", { maxLength: 60 })}
      </div>
      {text("address", "Home address", { maxLength: 200 })}
      <div className="grid gap-3 sm:grid-cols-3">
        {text("guardianName", "Parent or guardian (minors)", { maxLength: 100 })}
        {text("emergencyName", "Emergency contact", { maxLength: 100 })}
        {text("emergencyMobile", "Emergency mobile", { type: "tel", inputMode: "tel" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {text("hmoProvider", "HMO or dental insurance", { maxLength: 60 })}
        {text("hmoMemberNo", "Member number", { maxLength: 40 })}
        {text("insuranceEffective", "Effective date", { type: "date" })}
      </div>
      {alerts}
      {showConsent && (
        <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={value.consent} onChange={(event) => onChange({ ...value, consent: event.target.checked })} />
          The patient signed the data privacy consent form.
        </label>
      )}
    </div>
  );
}
