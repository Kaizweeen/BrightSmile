import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { branchByCode, listChairs } from "@/server/branches";
import { requireStaff } from "@/server/session";
import { CalendarScreen } from "./calendar-screen";

export const metadata: Metadata = { title: "Calendar" };

/** `?date=YYYY-MM-DD&view=day|week`, so a shared link opens the same day. The layout already checked the branch. */
export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { branch: code } = await params;
  if (code === "all") redirect("/all");
  const branch = await branchByCode(code);
  if (!branch) notFound();
  const query = await searchParams;
  const today = manilaDate(new Date());
  const date = dateParam(query.date, today);
  const chairs = (await listChairs(branch.id)).filter((c) => c.active).map((c) => ({ number: c.number, label: c.label }));
  return (
    <CalendarScreen
      branch={{ id: branch.id, code: branch.code, name: branch.name, hours: branch.operatingHours }}
      chairs={chairs}
      date={date}
      view={query.view === "week" ? "week" : "day"}
      today={today}
      staff={staff}
      canBook={can(staff, "appointment.book", { branchId: branch.id })}
      canManage={can(staff, "appointment.manage", { branchId: branch.id })}
    />
  );
}
