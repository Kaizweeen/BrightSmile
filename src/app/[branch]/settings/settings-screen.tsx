"use client";

import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Role } from "@/lib/permissions";
import { AccessLogPanel } from "./access-log-panel";
import { BillingPanel } from "./billing-panel";
import { BranchesPanel } from "./branches-panel";
import { ChairsPanel } from "./chairs-panel";
import { PracticePanel } from "./practice-panel";
import { ProceduresPanel } from "./procedures-panel";
import { SchedulePanel } from "./schedule-panel";
import { TimeOffPanel } from "./time-off-panel";

export type Me = { id: string; role: Role; branchIds: string[] };

/** The owner sees every section; managers and dentists see schedules and time off (spec section 5). */
export function SettingsScreen({
  owner,
  canEditSchedules,
  me,
  currentBranch,
  bookingUrl,
  qrImage,
}: {
  owner: boolean;
  canEditSchedules: boolean;
  me: Me;
  currentBranch: string;
  bookingUrl: string;
  qrImage: string | null;
}) {
  return (
    <div className="grid gap-4">
      <PageHeader
        title={owner ? "Settings" : "Schedules"}
        description={owner ? "The practice, its branches and chairs, services, billing, and who works when." : "Dentists' weekly hours and time off."}
      />
      <Tabs defaultValue={owner ? "branches" : "schedules"}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto overflow-y-hidden border-b pb-1.5 [&_[data-slot=tabs-trigger]]:flex-none [&_[data-slot=tabs-trigger]]:px-3.5">
          {owner && <TabsTrigger value="practice">Practice</TabsTrigger>}
          {owner && <TabsTrigger value="branches">Branches</TabsTrigger>}
          {owner && <TabsTrigger value="chairs">Chairs</TabsTrigger>}
          {owner && <TabsTrigger value="procedures">Services</TabsTrigger>}
          {owner && <TabsTrigger value="billing">Billing</TabsTrigger>}
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
          {owner && <TabsTrigger value="access-log">Access log</TabsTrigger>}
        </TabsList>
        {owner && (
          <TabsContent value="practice" className="pt-4">
            <PracticePanel bookingUrl={bookingUrl} />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="branches" className="pt-4">
            <BranchesPanel />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="chairs" className="pt-4">
            <ChairsPanel initialBranch={currentBranch} />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="procedures" className="pt-4">
            <ProceduresPanel />
          </TabsContent>
        )}
        {owner && (
          <TabsContent value="billing" className="pt-4">
            <BillingPanel initialImage={qrImage} />
          </TabsContent>
        )}
        <TabsContent value="schedules" className="pt-4">
          <SchedulePanel me={me} canEdit={canEditSchedules} />
        </TabsContent>
        <TabsContent value="time-off" className="pt-4">
          <TimeOffPanel canEdit={canEditSchedules} />
        </TabsContent>
        {owner && (
          <TabsContent value="access-log" className="pt-4">
            <AccessLogPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
