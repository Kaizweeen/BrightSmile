# DentaSync online booking design

Date: 2026-09-29. Status: design approved by Kai in chat on 2026-09-29. This is the first slice of the roadmap's part 3 (patient portal): patients book online, and nothing else from part 3 yet.

## 1. Decisions (brainstorming, 2026-09-29)

| Question | Kai's answer |
|---|---|
| How do patients identify themselves? | No account: name and mobile number. |
| Does an online booking wait for the clinic? | Yes: it enters as Requested, shows on the calendar at once, and the front desk confirms it. |
| Who chooses the dentist? | DentaSync assigns one; patients never see dentist names. |
| How long does a visit hold the dentist and chair? | A standard length the owner sets, changeable per visit by staff. Services have no length ("do not put length"). |
| Can any dentist do any service? | Each service can be limited to chosen dentists; all dentists until limited. |

Kai also asked for the practice's 13 services (from its "Services offered" sign) to be added once this is built: Dental Consultation; Oral Prophylaxis (Cleaning); Tooth Extraction (Bunot); Tooth Filling (Pasta); Dentures (Pustiso); Braces and Retainers; Laser Teeth Whitening (Bleach); Veneers and Crowns; Fixed Partial Dentures (Bridge); Mouthguard/Nightguard; Root Canal Therapy; Odontectomy (Impacted Wisdom Tooth Extraction); Fluoride Application and Sealants. The sign's spellings "Exatraction", "Theraphy", and "Flouride" are corrected.

## 2. Scope

**In:** the public booking page and its API; the clinic's list of online requests to confirm; visits whose length comes from a practice standard instead of procedure lengths; per-service online switch and dentist limits; the settings that control all of it; the 13 services, entered after release through Settings.

**Out:** patient accounts and logins; patients viewing, moving, or cancelling bookings online; SMS and email; the medical history intake; choosing a dentist online; several services in one online booking; a CAPTCHA; per-branch settings for any of the above.

## 3. What patients see

The page is `/book`, public, made for phones, titled with the practice name. It works in four steps on one page, each able to go back:

1. **Branch:** every active branch, by name.
2. **Service:** every active service with Offer online on. No lengths are shown.
3. **Day and time:** days from today to 30 days ahead (Manila dates), then the open start times that day (section 6.3), shown as times such as "10:30 AM". A day with no open times says "No open times this day. Try another day."
4. **Details:** first name, last name, and mobile number, all required; a note, optional ("What would you like the dentist to know?", up to 500 characters); and a required box, "I agree to the privacy notice", whose words "privacy notice" open `/book/privacy` in a new tab. A hidden field, `website`, is the bot trap (section 8).

**Done:** "Your request is in. {Practice name} will call or text you to confirm." with the branch, service, date, and time. Nothing else, in particular nothing about any existing patient record.

When online booking is off, `/book` shows only "Online booking isn't available right now. Please call the clinic." `/book/privacy` shows the owner's notice, and is available only while online booking is on.

Mobile numbers are accepted as `09XXXXXXXXX` or `+639XXXXXXXXX` (spaces and dashes ignored) and stored as `+639XXXXXXXXX`. Names are 1 to 50 characters after trimming.

## 4. What the clinic sees

- An online booking is a visit with status **Requested** and source `portal`, carrying the dentist and chair DentaSync assigned (section 6.4) and the patient's note. It appears at once, with the Requested badge and an **Online** marker, on the assigned dentist's My day and calendar and on the branch calendar, as any Requested visit does now.
- The branch calendar gains an **Online requests** button for anyone who may manage that branch's appointments, with a count of the branch's Requested online visits that start from now on. It opens a list, the oldest request first: patient name and mobile, service, date and time, dentist, note, and when it came in. Choosing one opens the existing visit panel, where staff confirm it (Requested to Confirmed), change it first (length, time, dentist, chair, through the usual checks), or cancel it with a reason.
- The access log shows each online booking as done by "Online booking".

## 5. Services

A service (the `procedures` table; the screens say "Services") has a name, an active switch, **Offer online** (on by default), and **Dentists** (the dentists who may be assigned it online). No dentists chosen means every dentist who sees patients may be. It has no length and no turnover.

The dentist limit applies only when DentaSync assigns a dentist online. Staff booking a visit may choose any dentist, as now.

## 6. Length, turnover, and open times

This section replaces part 1's section 8.2 and changes 8.5 and 8.7.

### 6.1 Settings

The practice has a **standard visit length** (15 to 240 minutes in 15-minute steps; 60 to start) and a **chair cleaning time** (0 to 60 minutes in 5-minute steps; 10 to start). The owner changes them in Settings. A change affects visits booked afterwards, not existing ones.

### 6.2 A visit's length

- When staff book, they pick the visit's **length** (15 to 480 minutes in 15-minute steps), with the standard length selected. The visit ends start plus length; the chair is held until the end plus the cleaning time in force at booking (`chair_free_at`).
- An online booking takes the standard length and the cleaning time in force when it is made.
- Moving a visit keeps its length and its cleaning time. Staff may change the length as part of a move, through the same checks; the cleaning time stays the visit's own. Changing a visit's services no longer changes its length.
- Existing visits keep their stored times.

### 6.3 Open times

Open times (staff and online) take a length and a cleaning time instead of a set of procedures. Otherwise part 1's rules hold: the 15-minute grid, a dentist block at the branch covering the whole visit, no time off, no overlapping active visit for the dentist (or the patient, if given), an active chair free for the visit plus cleaning time, and a start not yet passed.

Online, the candidate dentists are the active dentists who see patients, belong to the branch (or are the owner who sees patients), and are allowed the service (section 5); and a start must also be at least 2 hours from now. Patients get only the start times, never who is free.

### 6.4 Assigning a dentist and a chair online

At the chosen start, among the candidates free then, DentaSync picks the dentist with the fewest visits on that Manila date across all branches (any status except Cancelled and No-Show); a tie goes to the name that sorts first, then the lower id. The chair is the lowest-numbered free chair for that dentist at that start. If the start is no longer open, the booking is refused with "That time was just taken. Please pick another." and the page reloads the day's times.

## 7. The patient record

Before booking, DentaSync looks for patients whose mobile number equals the normalized number and whose last name equals the typed one, ignoring case and surrounding spaces. If there are any, the visit goes to the one with the lowest chart number. Otherwise it creates a patient with the first name, last name, and mobile number, the booking's branch as home branch, and no creator; staff complete the record and record the signed privacy consent at the visit, as for any patient. The person booking is never told whether a record matched.

## 8. Limits and the bot trap

The bot trap is checked first; the rest in the booking's transaction, after an advisory lock (`dentasync.portal`) so that two bookings cannot both pass a count:

- **Bot trap:** a request whose `website` field is not empty gets the same 201 answer as a real booking, and nothing is saved.
- **Online booking must be on**, the branch active, and the service active with Offer online on; otherwise 404 with a plain message ("Online booking isn't available right now.", "That branch doesn't take online bookings.", "That service isn't offered online.").
- **Per connection:** at most 5 online bookings per client address per hour, counted from the access log as the join requests are (part 1 section 6.3); the sixth gets 429 "Too many bookings from this connection. Please call the clinic."
- **Per patient:** at most 2 Requested online visits starting from now on for the matched patient; the third gets 429 "You already have 2 requests waiting. The clinic will call you."

## 9. Data changes (two migrations: additions, then drops, so drizzle-kit never has to ask whether a column was renamed)

- `practice`: add `visit_minutes` (integer, 60, check 15 to 240 in steps of 15), `cleaning_minutes` (integer, 10, check 0 to 60 in steps of 5), `online_booking` (boolean, false), `privacy_notice` (text, empty, up to 5000 characters).
- `procedures`: drop `duration_minutes` and `buffer_minutes` (and their checks); add `online` (boolean, true).
- `appointment_procedures`: drop `duration_minutes` and `buffer_minutes`.
- New `procedure_dentists`: `procedure_id` (to `procedures`), `dentist_id` (to `users`), primary key on both, row level security on like every table.
- `appointments.source` already allows `portal`, and `created_by` may be empty.

The migration drops columns the running release reads, so the release goes out right after it: run `npm run db:migrate`, then merge. The site errors on service pages for the minute in between. That is acceptable while the practice is not yet taking patients; later releases must add before they drop.

## 10. API

Staff routes keep part 1's rules (sessions, permissions, `{ error }` bodies); the public routes need no session.

| Route | Change |
|---|---|
| `GET /api/v1/practice`, `PATCH /api/v1/practice` | Also `visitMinutes`, `cleaningMinutes`, `onlineBooking`, `privacyNotice` (owner only to change). Turning online booking on with an empty notice is refused (422, "Add the privacy notice first."). |
| `GET/POST /api/v1/procedures`, `PATCH /api/v1/procedures/[id]` | Fields are `name`, `active`, `online`, `dentistIds` (empty means all); no lengths. A dentist id that is not a dentist who sees patients is refused (400). |
| `POST /api/v1/appointments` | Adds `minutes` (optional, the standard length when missing). Procedures no longer set the length. |
| `PATCH /api/v1/appointments/[id]` | Adds `minutes` (optional; the visit's own length when missing). |
| `GET /api/v1/availability` | Takes `minutes` (optional, the standard length when missing) instead of `procedures`; the rest as now. |
| `GET /api/v1/online-requests?branch=` | New, staff: the branch's Requested `portal` visits starting from now on, oldest request first (section 4). |
| `GET /api/v1/portal/times?branch=&service=&date=` | New, public: `{ times: string[] }`, the open starts as instants (section 6.3); 404 when closed as in section 8. Dates outside today to 30 days ahead give an empty list. |
| `POST /api/v1/portal/bookings` | New, public: `{ branch, service, start, firstName, lastName, mobile, note?, consent: true, website? }`. 201 `{ branch, service, start }` (names, not ids). Refusals as in sections 6.4 and 8; field errors as `fields`. |

`/book` and `/book/privacy` read the practice's settings, branches, and services on the server, so they need no route of their own.

Every online booking writes one access log row: action `appointment.requested_online`, the appointment as entity, no user, and details `{ ip, privacyNoticeAccepted: true, online: true }`. A patient created by a booking gets a `patient.created` row with no user and `{ online: true }`. The access log and the visit's history name both "Online booking".

## 11. Screens

- **Settings, Practice** (owner): standard visit length, chair cleaning time, online booking on/off, and the privacy notice, with the booking page's address to copy.
- **Settings, Services** (renamed from Procedures): name, Offer online, Dentists (a list to tick; "All dentists" when none), active. The table shows name, Online (Yes/No), and dentists ("All" or their names).
- **Booking panel:** a Length select (15-minute steps, the standard selected); the services list shows names only.
- **Branch calendar:** the Online requests button and list (section 4); visit cards and My day rows of `portal` visits show the Online marker.
- **`/book`** and **`/book/privacy`** (section 3).

## 12. Security and privacy (RA 10173)

- The public routes reveal only what section 10 lists: branch names and codes, online service names, open start times, and the notice. Nothing about patients, visits, or dentists leaves through them.
- A booking can attach a Requested visit to an existing patient only by knowing both their mobile number and last name, and it shows the booker nothing; the clinic's confirming call reaches the number on file.
- The client address is kept in the access log for the per-connection limit, as for join requests; the privacy notice should say so.
- Online booking stays off until the owner turns it on with a notice, which a lawyer should review (part 1 section 16).

## 13. Testing

- **Unit:** mobile number normalization; the assignment choice (fewest visits, ties by name then id); open times with a length and cleaning time; the portal input schemas.
- **Database:** an online booking creates a Requested `portal` visit with the assigned dentist and chair and the standard length; the service's dentist limit; matching an existing patient (and creating one when none matches); each refusal in section 8, the bot trap saving nothing, and a start taken in between; the access log row; staff booking and moving with a length; turning online booking on without a notice; row level security on `procedure_dentists` (the existing check covers it).
- **End to end:** the existing run, updated for lengths, and a new run where a patient books at `/book` and the front desk confirms it from Online requests.

## 14. Going live

1. Run `npm run db:migrate` against Supabase, then merge (section 9).
2. In Settings: the standard length and cleaning time; the 13 services with Offer online and their dentists (for example Braces and Retainers limited to the orthodontist); the privacy notice; then switch online booking on.
3. Share `https://dentasync-ph.vercel.app/book`, for example on the clinic's Facebook page.

## 15. Changes to part 1

Part 1's spec keeps its text; this spec overrides it where they differ: section 8.2 (length and turnover), 8.5 (open times take a length), 8.7 (moving keeps the visit's length), the procedure fields in sections 7 and 10, and the `procedures` part of `GET /api/v1/availability` in section 11. Part 1's section 15 development data changes to match: services without lengths, visits with lengths.
