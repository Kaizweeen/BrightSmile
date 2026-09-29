import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { manilaDate } from "@/lib/time";
import { dateParam } from "@/lib/visits";
import { requireStaff } from "@/server/session";
import { MyDayScreen } from "./my-day-screen";

export const metadata: Metadata = { title: "My day" };

export default async function MyDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ branch: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();
  if (!staff.seesPatients) notFound();
  const { branch } = await params;
  const today = manilaDate(new Date());
  return <MyDayScreen branch={branch} date={dateParam((await searchParams).date, today)} today={today} staffId={staff.id} />;
}
