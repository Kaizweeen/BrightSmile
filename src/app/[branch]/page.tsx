import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { navItems } from "@/lib/nav";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { requireStaff } from "@/server/session";
import { OverviewScreen } from "./overview-screen";

export const metadata: Metadata = { title: "All branches" };

/** `/all` is the All branches overview (the layout admits only those who may see it); a bare branch URL opens its calendar. */
export default async function BranchIndex({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  const { branch } = await params;
  if (branch !== "all") redirect(navItems(staff, branch)[0].href);
  const today = manilaDate(new Date());
  return (
    <OverviewScreen
      date={dateParam((await searchParams).date, today)}
      today={today}
      staff={staff}
    />
  );
}
