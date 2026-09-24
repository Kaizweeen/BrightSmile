import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BookingSheet from "./BookingSheet";
import { SAMPLE_CLINIC, sampleBusy } from "@/lib/sample-clinic";

// Open times depend on the current minute, so this page is never prerendered.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (slug !== SAMPLE_CLINIC.slug) return {};
  return {
    title: `Book at ${SAMPLE_CLINIC.name}`,
    description: `Request a dental appointment at ${SAMPLE_CLINIC.name}.`,
  };
}

/**
 * A clinic's public booking page. The sample clinic is served while the
 * database is being set up; Plan 2 swaps this loader for Supabase queries
 * and keeps everything below it unchanged.
 */
export default async function ClinicBookingPage({ params }: Params) {
  const { slug } = await params;
  if (slug !== SAMPLE_CLINIC.slug) notFound();

  const now = new Date();
  const busy = sampleBusy(now).map((b) => ({ id: b.id, start: b.start.toISOString(), end: b.end.toISOString() }));

  return <BookingSheet clinic={SAMPLE_CLINIC} busy={busy} nowIso={now.toISOString()} />;
}
