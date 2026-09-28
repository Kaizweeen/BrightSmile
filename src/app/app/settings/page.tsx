import type { Metadata } from "next";
import Link from "next/link";
import BranchEditor from "./BranchEditor";
import { AccountForms, ProfileForm, RulesForm } from "./ClinicForms";
import DentistEditor from "./DentistEditor";
import ProcedureEditor from "./ProcedureEditor";
import PushSetup from "@/components/PushSetup";
import { appUrl } from "@/lib/app-url";
import { loadSettings } from "@/lib/clinic-settings";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Settings" };

/**
 * Spec 5.3 Settings: clinic profile, branches (booking flow spec 4), booking rules and alerts, dentists, procedures,
 * account. Staff see only what they may use (teams spec 4): alerts on their device, dentists' time off, the plan's
 * status, and their account.
 */
export default async function SettingsPage() {
  const staff = await requireStaff();
  const owner = staff.role === "owner";
  const settings = await loadSettings(staff, new Date());
  const branches = settings.branches.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }));

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Settings</h1>
      </div>
      {owner && <ProfileForm clinic={settings.clinic} appUrl={appUrl()} />}
      {owner && <BranchEditor branches={settings.branches} clinicSmsName={settings.clinic.smsName} />}
      {owner && <RulesForm clinic={settings.clinic} />}
      <PushSetup />
      <section className="card card-pad settings-section">
        <h2 className="font-display">Dentists</h2>
        <p className="f-hint">
          {owner
            ? "Patients choose a dentist only when 2 or more are active."
            : "Add or remove a dentist's time off. Only the clinic's owner changes dentists and their hours."}
        </p>
        <div className="member-list mt-2">
          {settings.dentists.map((d) => (
            <DentistEditor key={d.id} dentist={d} canEdit={owner} branches={branches} />
          ))}
        </div>
        {owner && <DentistEditor dentist={null} branches={branches} />}
      </section>
      {owner && <ProcedureEditor procedures={settings.procedures} />}
      {owner && (
        <section className="card card-pad settings-section">
          <h2 className="font-display">Team</h2>
          <p className="f-hint">Invite staff with a join link, and remove staff who leave.</p>
          <Link href="/app/settings/team" className="btn btn-soft mt-3">
            Open Team
          </Link>
        </section>
      )}
      <AccountForms />
    </>
  );
}
