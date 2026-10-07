import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Landing } from "@/app/clinic/landing";
import { homePath } from "@/server/home";
import { staffFromHeaders } from "@/server/session";
import { ownerExists } from "@/server/setup";

export { metadata } from "@/app/clinic/landing";

/** The clinic's landing page for everyone else; signed-in staff go straight to their own home. */
export default async function Home() {
  // Request time only: `next build` must never open the database.
  await connection();
  if (!(await ownerExists())) redirect("/setup");
  const staff = await staffFromHeaders(await headers());
  if (!staff || staff.status === "disabled") return <Landing />;
  if (staff.status === "pending") redirect("/waiting");
  redirect(await homePath(staff));
}
