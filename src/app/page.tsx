import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "BrightSmile: online booking for dental clinics" },
  description: "One booking link for your clinic's Facebook page. Patients request open times, you approve, and BrightSmile texts the confirmation and a reminder.",
};

const POINTS = [
  "Patients pick a time that is really open, from their phone, with no app or account.",
  "You approve or decline each request in one tap, with a push or a text when one arrives.",
  "BrightSmile texts the confirmation and a reminder the day before, so fewer patients forget.",
];

/** Spec 5.5: one screen. What BrightSmile does, the demo clinic, Sign up, Log in. */
export default function Home() {
  return (
    <main className="flow-wrap">
      <div className="flow-card screen-in">
        <p className="brand-lockup">
          <Image src="/brand/logo.png" alt="" width={28} height={28} priority />
          <span className="wm">BrightSmile</span>
          <span className="tag">Booking</span>
        </p>
        <h1 className="font-display mt-5">Online booking for your dental clinic</h1>
        <p className="sub">Share one link on your Facebook page and in Messenger. Patients request a time, and you stay in charge of the schedule.</p>
        <ul className="grid gap-3">
          {POINTS.map((point) => (
            <li key={point} className="flex gap-3">
              <span aria-hidden="true" className="font-bold text-primary">
                ✓
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <Link href="/signup" className="btn btn-primary wide-btn mt-6">
          Sign up your clinic
        </Link>
        <Link href="/demo" className="btn btn-soft wide-btn mt-3">
          Try the demo booking page
        </Link>
        <p className="f-hint mt-4 text-center">
          Already using BrightSmile?{" "}
          <Link href="/login" className="link">
            Log in
          </Link>
        </p>
      </div>
      <p className="f-hint mt-5 text-center">
        <Link href="/privacy" className="link">
          Privacy Notice
        </Link>
        {" · "}
        <Link href="/terms" className="link">
          Terms of Service
        </Link>
      </p>
    </main>
  );
}
