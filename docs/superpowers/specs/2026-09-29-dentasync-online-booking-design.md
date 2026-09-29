# DentaSync online booking design

Date: 2026-09-29. Status: design approved by Kai in chat on 2026-09-29. This is the first slice of the roadmap's part 3 (patient portal): patients book online, and nothing else from part 3 yet.

## 1. Decisions (brainstorming, 2026-09-29)

| Question | Kai's answer |
|---|---|
| How do patients identify themselves? | No account: first name, last name, and mobile number. A booking reuses a record only when all three match (ignoring case and surrounding spaces), because families share phones (section 7). |
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
2. **Service:** every active service with Offer online on, and, once a branch is chosen, only those offered at it: a service limited to dentists is offered only at the branches where one of them works (section 5), and is not listed at all when that is nowhere. Changing the branch clears a service it does not offer. No lengths are shown.
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

A service (the `procedures` table; the screens say "Services") has a name, an active switch, **Offer online** (on by default), and **Dentists** (the dentists who may be assigned it online). No dentists chosen means every dentist who sees patients may be; only active dentists who see patients can be chosen (a pending join request cannot, since a link to it would block declining it). It has no length and no turnover.

The dentist limit applies only when DentaSync assigns a dentist online. Staff booking a visit may choose any dentist, as now. Online, a limited service is offered only at the branches where at least one of its dentists works (the dentist is active, sees patients, and is linked to the branch, or is the owner, who works at every branch).

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

Before booking, DentaSync looks for patients whose mobile number equals the normalized number and whose first name and last name equal the typed ones, ignoring case and surrounding spaces. Families share phones, so a child booked from a parent's number gets a record of their own instead of landing on the parent's chart. If there are any matches, the visit goes to the one with the lowest chart number. Otherwise it creates a patient with the first name, last name, and mobile number, the booking's branch as home branch, and no creator; staff complete the record and record the signed privacy consent at the visit, as for any patient. The booking shows nothing from any record. The record is looked up only after the start has passed every check that does not need it (section 8), so a refused start is the same answer whoever asks. Two answers can still tell someone who already knows a patient's mobile number and both names that the record exists: the 429 "2 requests waiting", and a 409 at a time that is open but clashes with the patient's own visit then. Nothing more is ever shown.

## 8. Limits and the bot trap

The refusals that need no lock come first, so a flood of them never queues behind real bookings, in this order: the closed practice, branch, and service checks (the 404s below); the bot trap; a start that is not from today to 30 days ahead (Manila dates), is off the 15-minute grid, or is less than 2 hours away, which gets 409 "That time was just taken. Please pick another."; a client already at the per-connection limit, which gets its 429; and a start that is not among the open starts right now (section 6.3), for example 03:00 or a day no dentist works, which gets the same 409. These checks read without the lock and can be a moment out of date, so the rest runs in the booking's transaction, which reads them again with the locks, and that decides. It runs after an advisory lock (`dentasync.portal`) so that two bookings cannot both pass a count. The transaction waits for the lock 5 seconds at most; then the booking is refused with 503 "Online booking is busy right now. Please try again in a moment."

- **Online booking must be on**, the branch active, and the service active with Offer online on; otherwise 404 with a plain message ("Online booking isn't available right now.", "That branch doesn't take online bookings.", "That service isn't offered online."). A bot gets the same 404s.
- **Bot trap:** a request whose `website` field is not empty gets the same 201 answer as a real booking, and nothing is saved.
- **Per connection:** at most 5 online bookings per client per hour, counted from the access log as the join requests are (part 1 section 6.3), by a keyed hash of the client address (`details.client`, section 12); the sixth gets 429 "Too many bookings from this connection. Please call the clinic." It is counted before the lock, and again inside it.
- **The start** must be among the public open starts (section 6.3, with no patient), checked without the lock and again inside the transaction; then a dentist and chair are picked (section 6.4); otherwise 409 as above.
- **Per patient,** once the record is looked up (section 7): at most 2 Requested online visits starting from now on for the matched patient, so the third gets 429 "You already have 2 requests waiting. The clinic will call you."; and no other active visit of the patient may overlap the booking's time, otherwise 409 as above. A new patient is created last.

## 9. Data changes (two migrations: additions, then drops, so drizzle-kit never has to ask whether a column was renamed)

- `practice`: add `visit_minutes` (integer, 60, check 15 to 240 in steps of 15), `cleaning_minutes` (integer, 10, check 0 to 60 in steps of 5), `online_booking` (boolean, false), `privacy_notice` (text, empty, up to 5000 characters).
- `procedures`: drop `duration_minutes` and `buffer_minutes` (and their checks); add `online` (boolean, true).
- `appointment_procedures`: drop `duration_minutes` and `buffer_minutes`.
- New `procedure_dentists`: `procedure_id` (to `procedures`), `dentist_id` (to `users`), primary key on both, row level security on like every table.
- `appointments.source` already allows `portal`, and `created_by` may be empty.

The second migration (0004) drops columns the running release still reads, and it cannot be undone. From the moment `npm run db:migrate` finishes until the new release is live, the calendar, My day, the visit panel, patient visit lists, bookings, and moves all fail, not only the Services pages. So the release goes out in this order: the branch's Vercel preview build has passed; a fresh backup is taken just before (the README's step 4, pg_dump); `npm run db:migrate` runs outside clinic hours; and the merge follows right after. Later releases must add before they drop.

## 10. API

Staff routes keep part 1's rules (sessions, permissions, `{ error }` bodies); the public routes need no session.

| Route | Change |
|---|---|
| `GET /api/v1/practice`, `PATCH /api/v1/practice` | Also `visitMinutes`, `cleaningMinutes`, `onlineBooking`, `privacyNotice` (owner only to change). Turning online booking on with an empty notice is refused (422, "Add the privacy notice first."). |
| `GET/POST /api/v1/procedures`, `PATCH /api/v1/procedures/[id]` | Fields are `name`, `active`, `online`, `dentistIds` (empty means all); no lengths. A dentist id that is not an active dentist who sees patients is refused (400). |
| `POST /api/v1/appointments` | Adds `minutes` (optional, the standard length when missing). Procedures no longer set the length. |
| `PATCH /api/v1/appointments/[id]` | Adds `minutes` (optional; the visit's own length when missing). |
| `GET /api/v1/availability` | Takes `minutes` (optional, the standard length when missing) instead of `procedures`; the rest as now. |
| `GET /api/v1/online-requests?branch=` | New, staff: the branch's Requested `portal` visits starting from now on, oldest request first (section 4). |
| `GET /api/v1/portal/times?branch=&service=&date=` | New, public: `{ times: string[] }`, the open starts as instants (section 6.3); 404 when closed as in section 8. Dates outside today to 30 days ahead give an empty list. |
| `POST /api/v1/portal/bookings` | New, public: `{ branch, service, start, firstName, lastName, mobile, note?, consent: true, website? }`. 201 `{ branch, service, start }` (names, not ids). Refusals as in sections 6.4 and 8; field errors as `fields`. |

`/book` and `/book/privacy` read the practice's settings, branches, and services on the server, so they need no route of their own.

Every online booking writes one access log row: action `appointment.requested_online`, the appointment as entity, no user, and details `{ client, privacyNoticeAccepted: true, online: true, start }`. `client` is a keyed hash of the client address, never the address (section 12), and `start` is the visit's start time as an instant. A patient created by a booking gets a `patient.created` row with no user and `{ online: true }`. The access log and the visit's history name both "Online booking".

## 11. Screens

- **Settings, Practice** (owner): standard visit length, chair cleaning time, online booking on/off, and the privacy notice, with the booking page's address to copy.
- **Settings, Services** (renamed from Procedures): name, Offer online, Dentists (a list to tick; "All dentists" when none), active. The table shows name, Online (Yes/No), and dentists ("All" or their names).
- **Booking panel:** a Length select (15-minute steps, the standard selected); the services list shows names only.
- **Branch calendar:** the Online requests button and list (section 4); visit cards and My day rows of `portal` visits show the Online marker.
- **`/book`** and **`/book/privacy`** (section 3).

## 12. Security and privacy (RA 10173)

- The public routes reveal only what section 10 lists: branch names and codes, online service names (with the branches that offer each), open start times, and the notice. Nothing about patients, visits, or dentists leaves through them.
- A booking can attach a Requested visit to an existing patient only by knowing their mobile number, first name, and last name, and it shows the booker nothing from the record (section 7 names the two answers that can confirm a record exists to someone who already knows those three); the clinic's confirming call reaches the number on file.
- The client address is never stored. A booking, like a join request, keeps only a keyed hash of it in the access log (`details.client`: HMAC-SHA256 of the address with the app's secret, as 22 base64url characters; "unknown" when the host gives no address), and counts those hashes for the per-connection limit. Staff sign-in rows are different: they still hold the address, and only the owner reads the access log. The privacy notice should say that the booking page stores a scrambled code (a keyed hash) of the internet address each booking request comes from, never the address itself, and uses it to limit bookings from one connection to five an hour.
- "Never the address itself" is true of DentaSync's database only. Vercel, which hosts the site, sees every visitor's internet address and keeps it in its own request logs for as long as its plan keeps logs, and the privacy notice should say so.
- Consent evidence: every booking records `privacyNoticeAccepted`, and every change to the notice is logged in full (`practice.updated`, `privacyNotice`, at most 5000 characters and no personal data), so the clinic can show which notice was in force when a patient agreed.
- The form has no guardian field, so it does not say who may agree for a child; the lawyer who reviews the notice should say who may.
- Online booking stays off until the owner turns it on with a notice, which a lawyer should review (part 1 section 16).

## 13. Testing

- **Unit:** mobile number normalization; the assignment choice (fewest visits, ties by name then id); open times with a length and cleaning time; the portal input schemas.
- **Database:** an online booking creates a Requested `portal` visit with the assigned dentist and chair and the standard length; the service's dentist limit; matching an existing patient by mobile number, first name, and last name (and creating one when any differs); each refusal in section 8, the refusals that need no lock opening no transaction, the bot trap saving nothing, and a start taken in between; the access log row holding a keyed hash and no address; the services and branches `/book` offers; staff booking and moving with a length; turning online booking on without a notice; row level security on `procedure_dentists` (the existing check covers it).
- **End to end:** the existing run, updated for lengths, and a new run where a patient books at `/book` (the Service list follows the branch) and the front desk confirms it from Online requests.

## 14. Going live

1. The migration (section 9). First check that the branch's Vercel preview build passed. Take a fresh backup (the README's step 4, pg_dump) just before. Run `npm run db:migrate` against Supabase outside clinic hours, and merge right after: until the new release is live, the calendar, My day, the visit panel, patient visit lists, bookings, and moves all fail, and 0004 cannot be undone.
2. Checks before online booking goes on:
   - No branch is coded `all`, `api`, `book`, `join`, `login`, `poster`, `reset`, `setup`, or `waiting`: `select code from branches where code in ('all', 'api', 'book', 'join', 'login', 'poster', 'reset', 'setup', 'waiting');` returns nothing (such a branch's pages would be hidden behind the app's own).
   - Every other address the site answers at (the bare domain, any old `.vercel.app` address) redirects to APP_URL, because bookings are refused from any other origin (part 1 section 11).
3. In Settings: the standard length and cleaning time; the 13 services with Offer online and their dentists (for example Braces and Retainers limited to the orthodontist); and the privacy notice (section 12: the keyed hash of the address, that Vercel still sees and logs addresses, and, for the lawyer, who may agree for a child).
4. Just before switching online booking on, add the rate-limit rule: in Vercel, Firewall, Configure, New Rule: If Request Path starts with `/api/v1/portal/`, Then Rate Limit, Fixed Window, 60 seconds, 100 requests, keyed by IP, Default (429) action, then Review Changes and Publish. Every plan allows at least one rate-limit rule; Hobby allows one per project. 100 a minute is generous on purpose: Philippine mobile networks put many patients behind one shared address. Then switch online booking on.
5. Share `APP_URL/book` (https://www.brightsmile.pro/book since 2026-09-29), for example on the clinic's Facebook page.
6. After the first real booking, check its access log row: in Supabase's SQL editor, `select details->>'client' from audit_log where action = 'appointment.requested_online' order by id desc limit 1;` shows a 22-character code, not `unknown` ("unknown" means the host gave no address, so every visitor would share one limit of five bookings an hour; the README's step 2 names the header).
7. If spam arrives: switch online booking off in Settings, then cancel the fake requests from Online requests. The rate-limit rule from item 4 can be tightened.

## 15. Changes to part 1

Part 1's spec keeps its text; this spec overrides it where they differ: section 8.2 (length and turnover), 8.5 (open times take a length), 8.7 (moving keeps the visit's length), the procedure fields in sections 7 and 10, and the `procedures` part of `GET /api/v1/availability` in section 11. Part 1's section 15 development data changes to match: services without lengths, visits with lengths.
