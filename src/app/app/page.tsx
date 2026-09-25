import { redirect } from "next/navigation";

/** The dashboard opens on Requests. Log in and the proxy send staff to /app, which lands here. */
export default function AppHome() {
  redirect("/app/requests");
}
