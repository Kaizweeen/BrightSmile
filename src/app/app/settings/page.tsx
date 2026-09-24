import type { Metadata } from "next";
import { AccountForms, ProfileForm, RulesForm } from "./ClinicForms";
import DentistEditor from "./DentistEditor";
import ProcedureEditor from "./ProcedureEditor";
import { loadSettings } from "@/lib/clinic-settings";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

/** Spec 5.3 Settings: clinic profile, booking rules and alerts, dentists, procedures, account. */
export default async function SettingsPage() {
  const staff = await requireStaff();
  const settings = await loadSettings(staff, new Date());

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Settings</h1>
      </div>
      <ProfileForm clinic={settings.clinic} appUrl={process.env.APP_URL ?? "http://localhost:3600"} />
      <RulesForm clinic={settings.clinic} />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Dentists</h2>
        <p className="f-hint">Patients choose a dentist only when 2 or more are active.</p>
        <div className="member-list mt-2">
          {settings.dentists.map((d) => (
            <DentistEditor key={d.id} dentist={d} />
          ))}
        </div>
        <DentistEditor dentist={null} />
      </section>
      <ProcedureEditor procedures={settings.procedures} />
      <AccountForms />
    </>
  );
}
