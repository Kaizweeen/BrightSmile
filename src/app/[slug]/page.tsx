import { permanentRedirect } from "next/navigation";

/**
 * The booking page lives at "/" now that the site serves one clinic (Kai, 2026-09-28). Old booking links, including the
 * rebooking link in texts and links already posted on Facebook, land there.
 */
export default function OldBookingLink(): never {
  permanentRedirect("/");
}
