import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import BookingSheet from "./BookingSheet";
import { loadClinic } from "@/lib/availability";
import { bookingOpen } from "@/lib/billing-data";
import { slugProblem } from "@/lib/validate";

// Open times depend on the current minute, so this page is never prerendered.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

// generateMetadata and the page share one lookup per request. Malformed links skip the database.
const clinicFor = cache(async (slug: string) => (slugProblem(slug) ? null : loadClinic({ slug })));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) return { title: "Booking link not found" };
  const title = `Book at ${clinic.name}`;
  const description = `Request a dental appointment at ${clinic.name}${clinic.address ? `, ${clinic.address}` : ""}.`;
  return { title, description, openGraph: { title, description, type: "website" } };
}

/**
 * A clinic's public booking page and website (spec 5.1). It receives no patient data and no busy times.
 * A lapsed clinic's page shows how to call instead of the booking form (billing spec 7.5).
 */
export default async function ClinicBookingPage({ params }: Params) {
  const clinic = await clinicFor((await params).slug);
  if (!clinic) notFound();
  const now = new Date();
  const open = await bookingOpen(clinic.id, now);
  return <BookingSheet clinic={clinic} nowIso={now.toISOString()} paused={!open} />;
}
