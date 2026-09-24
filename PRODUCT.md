# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: clinic staff in the Philippines.** The dentist (usually the owner) and whoever answers the phone, working on a mobile phone in short gaps between patients. They approve or decline booking requests, move appointments, book walk-ins, and mark who showed up. In v1 one login per clinic is shared by the dentist and the receptionist.
- **Secondary: patients booking on a phone.** They arrive from a link the clinic shares on its Facebook page or in a Messenger chat, on mid-range Android phones over mobile data. They range from students to seniors, and a parent often books several children using one mobile number. Seniors and PWDs who cannot book online are booked by staff instead.

## Product Purpose

Replace the back-and-forth of booking a dental visit through Messenger and a paper appointment book. A clinic shares one booking link, patients request a time from the dentist's real availability, the clinic approves in one tap, and both sides get text confirmations and reminders. Success is fewer no-shows and less admin time, measured from the Completed and No-show records the product captures from day one.

## Positioning

Booking built around a Philippine clinic's actual constraints: text messages as the one channel that reaches every patient, a request-and-approve loop that leaves the dentist in control of their own chair time, and a booking page that doubles as the clinic's website. Sold as a subscription per clinic.

## Operating Context

- Staff work one-handed, on a phone, interrupted; the dashboard is installed to the home screen.
- Patients are on mobile data, often arriving through a Facebook link, so the booking page must load fast and preview well when shared.
- Everything is scheduled in Manila time (UTC+8, no daylight saving). Clinics commonly work Monday to Saturday with a midday break.
- Texts cost money per message, so each one must fit a single 160 character text.
- Orthodontic patients return monthly for adjustments, so repeat booking is the common case, not the exception.
- The clinic's own phone number stays visible to patients: when the product cannot help, calling the clinic must always be the fallback.

## Capabilities and Constraints

- **In v1:** a public booking page per clinic, the request and approve loop, SMS verification codes, confirmations and day-before reminders, manual booking by staff, a schedule with move, cancel, completed and no-show, a patients list, clinic settings, and onboarding.
- **Not in v1:** billing, staff invites, analytics dashboards, patient accounts, online payments, dental charts, Filipino language interface.
- **Terminology to keep:** a patient's booking is a *request* until the clinic approves it; *procedures* carry durations that set the appointment length; a pending request holds its time slot.
- **Technical:** Next.js on Vercel with Supabase Postgres; texts through Semaphore; Philippine mobile numbers only, stored as `+639XXXXXXXXX`; a dentist can never hold two overlapping appointments, enforced in the database.
- **Legal:** under the Data Privacy Act (RA 10173) the clinic is the personal information controller and BrightSmile is its processor. Patient health details are sensitive personal information.
- **Undecided:** the production domain; prices and the monthly text allowance.

Full product truth, including the SMS templates and booking rules, lives in `docs/superpowers/specs/2026-09-22-brightsmile-core-booking-design.md`.

## Brand Commitments

- Name: BrightSmile. Repository: github.com/Kaizweeen/BrightSmile.
- **Logo: Kai will provide one.** Until it arrives the interface uses a typographic placeholder that the real file can replace without any layout change. Do not treat an invented mark as final.
- The SMS sender name is `BrightSmile`, exactly 11 characters, which is the maximum a sender name allows.
- Voice: plain, direct, honest. No em dashes or en dashes in any copy. Say what a screen does, and never imply a capability the product lacks.

## Evidence on Hand

- **One real clinic is involved; its details are still to come from Kai.** Until then no clinic name, logo, photo, quote or count may appear in the product or on the landing page. Leave those places marked pending rather than filling them.
- No testimonials, no user counts, no case studies, no press coverage. The competitor teardown in the spec is research, not endorsement.
- Real content that does exist: the procedure list with durations, the text message templates, and the booking rules in the spec.

## Product Principles

1. **Honest over impressive.** Never show a capability, number or endorsement the product cannot back.
2. **The clinic keeps control.** Nothing enters a dentist's day without their approval, and nothing is cancelled behind their back.
3. **Every text earns its cost.** One message, 160 characters, sent only when it changes what someone will do.
4. **Built for a phone in a hurry.** A hand-sized screen, mobile data, and interruptions are the normal case, not the edge case.
5. **Patients are not the customer, but they are the reason.** A booking must be finishable by a student, a senior, or a parent booking for three children.

## Accessibility & Inclusion

WCAG 2.2 AA is the bar for both surfaces: contrast, visible focus, complete keyboard paths, labelled fields and errors, touch targets of at least 44 by 44 pixels, and respect for reduced motion. The spec singles out seniors and PWDs (staff can book on their behalf), and a patient of any age must be able to finish a booking on a mid-range phone.
