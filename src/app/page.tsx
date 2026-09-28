import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homePath } from "@/server/home";
import { staffFromHeaders } from "@/server/session";
import { ownerExists } from "@/server/setup";

/** Sends each visitor where they belong: setup, sign-in, the waiting page, or their home. */
export default async function Home() {
  if (!(await ownerExists())) redirect("/setup");
  const staff = await staffFromHeaders(await headers());
  if (!staff || staff.status === "disabled") redirect("/login");
  if (staff.status === "pending") redirect("/waiting");
  redirect(await homePath(staff));
}
