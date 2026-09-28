import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import BookingFlow from "./[slug]/BookingFlow";
import { loadClinic } from "@/lib/availability";
import { theClinicSlug } from "@/lib/the-clinic";

// Open times depend on the current minute, so this page is never prerendered.
export const dynamic = "force-dynamic";

// generateMetadata and the page share one lookup per request.
const theClinic = cache(async () => {
  const slug = await theClinicSlug();
  return slug ? loadClinic({ slug }) : null;
});

export async function generateMetadata(): Promise<Metadata> {
  const clinic = await theClinic();
  if (!clinic) return { title: { absolute: "Book a dental appointment" } };
  const title = `Book at ${clinic.name}`;
  const description = `Request a dental appointment at ${clinic.name}${clinic.address ? `, ${clinic.address}` : ""}.`;
  return { title: { absolute: title }, description, openGraph: { title, description, type: "website" } };
}

/**
 * The site is the clinic's own booking page (Kai, 2026-09-28): book, reschedule or edit, or cancel (booking flow spec 3).
 * Before the owner's one-time setup at /signup it says booking is not open yet, without linking to the setup, so no
 * visitor can claim the site first.
 */
export default async function Home() {
  const clinic = await theClinic();
  return (
    <>
      {clinic ? (
        <BookingFlow clinic={clinic} nowIso={new Date().toISOString()} />
      ) : (
        <main className="flow-wrap">
          <div className="flow-card screen-in">
            <h1 className="font-display">Online booking opens soon</h1>
            <p className="sub">Please call or message the clinic to book for now.</p>
          </div>
        </main>
      )}
      <p className="f-hint mt-5 pb-6 text-center">
        <Link href="/privacy" className="link">
          Privacy Notice
        </Link>
        {" · "}
        <Link href="/login" className="link">
          Staff log in
        </Link>
      </p>
    </>
  );
}
