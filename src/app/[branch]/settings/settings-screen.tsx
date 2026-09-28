"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Role } from "@/lib/permissions";
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
  practice,
}: {
  owner: boolean;
  canEditSchedules: boolean;
  me: Me;
  currentBranch: string;
  practice: string;
}) {
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">{owner ? "Settings" : "Schedules"}</h1>
      <Tabs defaultValue={owner ? "branches" : "schedules"}>
        <TabsList className="h-auto flex-wrap">
          {owner && <TabsTrigger value="practice">Practice</TabsTrigger>}
          {owner && <TabsTrigger value="branches">Branches</TabsTrigger>}
          {owner && <TabsTrigger value="chairs">Chairs</TabsTrigger>}
          {owner && <TabsTrigger value="procedures">Procedures</TabsTrigger>}
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
        </TabsList>
        {owner && (
          <TabsContent value="practice" className="pt-4">
            <PracticePanel initialName={practice} />
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
        <TabsContent value="schedules" className="pt-4">
          <SchedulePanel me={me} canEdit={canEditSchedules} />
        </TabsContent>
        <TabsContent value="time-off" className="pt-4">
          <TimeOffPanel canEdit={canEditSchedules} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
