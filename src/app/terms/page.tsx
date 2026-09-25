import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Spec 16: draft Terms of Service with the data processing terms for clinics. A lawyer reviews it before launch. */
export default function TermsPage() {
  const contact = CONTACT ? (
    <a href={`mailto:${CONTACT}`} className="link">
      {CONTACT}
    </a>
  ) : (
    "[contact email]"
  );
  return (
    <main className="flow-wrap">
      <article className="flow-card legal">
        <p className="note-box warn" role="note">
          Draft for legal review. These terms are not final and may change before BrightSmile opens to the public.
        </p>
        <h1 className="font-display mt-5">Terms of Service</h1>
        <p className="f-hint">Last updated: [date of final version]</p>

        <h2>The service</h2>
        <p>
          BrightSmile gives a dental clinic a public booking page, a dashboard to approve and manage visits, and text messages and
          alerts about those visits. These terms are between BrightSmile [legal name and address of the business] and the clinic that
          signs up.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>Each clinic has one login in this version. Keep the password private; you are responsible for what happens under it.</li>
          <li>Give accurate clinic details, hours, and mobile number. Patients rely on them.</li>
          <li>Use BrightSmile only to take and manage appointments for your clinic.</li>
        </ul>

        <h2>Patient data: our data processing terms</h2>
        <p>
          You are the personal information controller for your patients&apos; data, and BrightSmile is your personal information
          processor under the Data Privacy Act of 2012. BrightSmile:
        </p>
        <ul>
          <li>Processes patient data only to run the booking service for you, and only as these terms and your use of the dashboard instruct.</li>
          <li>Keeps it confidential and limits access to people and systems that need it to run the service.</li>
          <li>Protects it with the measures described in the Privacy Notice.</li>
          <li>Uses only the service providers listed in the Privacy Notice, and tells you before adding a new one.</li>
          <li>Tells you without undue delay, and within 72 hours of finding out, about a personal data breach affecting your patients.</li>
          <li>Helps you answer patients who use their rights (access, correction, erasure, and the others in the Privacy Notice).</li>
          <li>Deletes your patients&apos; data, or gives you a copy first, when you close your account.</li>
          <li>Keeps codes for 24 hours and the words of text messages for 90 days, as the Privacy Notice says.</li>
        </ul>
        <p>
          You are responsible for having a lawful basis for the data you collect, for asking patients for consent where the law needs it
          (the booking page asks every patient), and for answering your patients&apos; requests. [Legal review: full data processing
          agreement wording and NPC registration.]
        </p>

        <h2>Texts and alerts</h2>
        <p>
          BrightSmile sends texts through a Philippine text gateway and push alerts through the device maker&apos;s service. We work
          to deliver every message, but delivery is not guaranteed. The dashboard shows when a text was not delivered so you can call
          the patient. Check your dashboard for new requests.
        </p>

        <h2>Fees</h2>
        <p>[To be decided before launch: price, text allowance, billing, and notice before any change.]</p>

        <h2>Availability</h2>
        <p>
          We aim to keep BrightSmile running at all times but cannot promise it will never be interrupted, for example during
          maintenance or a provider outage.
        </p>

        <h2>Ending</h2>
        <p>
          You can stop using BrightSmile at any time and ask us to delete your clinic&apos;s account. We may suspend an account that
          misuses the service, for example by sending texts that are not about appointments or by booking on behalf of people without
          their consent.
        </p>

        <h2>Liability</h2>
        <p>[Legal review: limitation of liability and warranties.]</p>

        <h2>Law and contact</h2>
        <p>These terms are governed by the laws of the Philippines. Questions: {contact}.</p>

        <p className="mt-6">
          <Link href="/" className="link">
            Back to BrightSmile
          </Link>
        </p>
      </article>
    </main>
  );
}
