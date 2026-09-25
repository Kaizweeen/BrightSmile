import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Notice" };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

/** Spec 12 and 16: draft Privacy Notice. A lawyer reviews it before real patient data arrives. */
export default function PrivacyPage() {
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
          Draft for legal review. This notice is not final and may change before BrightSmile opens to the public.
        </p>
        <h1 className="font-display mt-5">Privacy Notice</h1>
        <p className="f-hint">Last updated: [date of final version]</p>

        <h2>Who is responsible for your data</h2>
        <p>
          BrightSmile is online booking software for dental clinics in the Philippines. When you book with a clinic through
          BrightSmile, that clinic is the personal information controller for your details under the Data Privacy Act of 2012 (Republic
          Act No. 10173). BrightSmile processes your details on the clinic&apos;s behalf, as its personal information processor, and only
          to run the booking service for that clinic.
        </p>

        <h2>What we collect</h2>
        <p>From patients who book online:</p>
        <ul>
          <li>First and last name, and mobile number.</li>
          <li>The procedures you choose and the time you ask for. These can say something about your health, so we treat them as sensitive personal information.</li>
          <li>Your birthday and HMO provider, only if you give them.</li>
          <li>When you agreed to this notice.</li>
          <li>
            A one-time verification code (we keep only a scrambled form of it), your internet address to stop repeated code requests,
            and a cookie that remembers a verified mobile number on your device for 180 days.
          </li>
        </ul>
        <p>From clinic staff: email address, password (stored scrambled by our login provider), the clinic&apos;s details, and a push notification address for each device that turns on alerts.</p>

        <h2>Why we use it</h2>
        <ul>
          <li>To send your request to the clinic and let the clinic confirm, move, or cancel it.</li>
          <li>To text you the verification code, the clinic&apos;s answer, changes, and a reminder the day before your visit.</li>
          <li>To give you a private link where you can view or cancel your visit.</li>
          <li>To keep the service safe, for example by limiting how many codes one number can request.</li>
        </ul>
        <p>We do not sell your data, show ads, or send marketing texts.</p>

        <h2>Who else handles it</h2>
        <p>BrightSmile uses these service providers, each only for the job described:</p>
        <ul>
          <li>Supabase: database and staff logins, hosted in Singapore.</li>
          <li>Vercel: hosting of the website.</li>
          <li>Semaphore: delivery of text messages in the Philippines.</li>
          <li>
            Google, Apple, Mozilla, or Microsoft, when clinic staff turn on push alerts: they deliver the alert to the staff member&apos;s
            device. Alerts carry the date, time, and dentist only, never a patient&apos;s name.
          </li>
        </ul>
        <p>Some of these providers may store data outside the Philippines. [Legal review: cross-border transfer wording.]</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Verification codes: deleted after 24 hours.</li>
          <li>The words of text messages: erased after 90 days. A record that a text was sent, and its cost, is kept for billing.</li>
          <li>
            Patient records and appointments: kept while the clinic uses BrightSmile. When the clinic deletes a patient, the name becomes
            &quot;Deleted patient&quot; and the mobile number, birthday, and HMO are erased; the visits stay only as counts.
          </li>
          <li>A clinic&apos;s whole account: deleted when the clinic asks us to.</li>
        </ul>

        <h2>How we protect it</h2>
        <p>
          All traffic is encrypted. Each clinic sees only its own patients, which our database enforces. Codes are stored scrambled,
          and the database is backed up daily. [Legal review: list of organizational measures.]
        </p>

        <h2>Your rights</h2>
        <p>
          Under the Data Privacy Act you have the right to be informed, to access your data, to object, to have it corrected, erased,
          or blocked, to data portability, and to damages, and you may complain to the National Privacy Commission. Because the clinic
          controls your data, please contact the clinic first; BrightSmile helps the clinic answer. You can also write to us at {contact}.
        </p>

        <h2>Changes</h2>
        <p>If this notice changes, we update this page and its date.</p>

        <p className="mt-6">
          <Link href="/" className="link">
            Back to BrightSmile
          </Link>
        </p>
      </article>
    </main>
  );
}
