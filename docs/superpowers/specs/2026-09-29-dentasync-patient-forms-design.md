# DentaSync patient QR and patient forms design

Date: 2026-09-29. Status: design approved by Kai in chat on 2026-09-29. The second slice of the roadmap's part 3 (patient portal), after online booking (`2026-09-29-dentasync-online-booking-design.md`): a patient QR poster for each branch, and a short patient form the front desk turns into a chart.

## 1. Decisions (brainstorming, 2026-09-29)

| Question | Kai's answer |
|---|---|
| What does the patient QR do? | Both on one poster: it opens a page with two choices, Book a visit and Fill in my patient form. |
| What happens to a sent form? | The front desk checks it first. It waits in a Patient forms list; staff turn it into a new chart or attach it to an existing one. Nothing a stranger types changes a chart on its own. |
| Which details does the form ask for? | Just the basics: name, birthday, sex, mobile number, and address. The front desk fills in the rest at the visit. |

Forms are kept apart from charts, in their own table, rather than saved as unchecked charts: unchecked charts would crowd patient search and spend chart numbers on spam.

## 2. Scope

**In:** a patient poster per branch; the public welcome page and patient form; the Patient forms list and its three actions (new chart, existing patient, discard); a Take patient forms switch; the booking page opening with a branch already chosen.

**Out:** patient accounts and logins; the form updating an existing chart by itself; the rest of the chart's fields (email, occupation, guardian, emergency contact, HMO, allergies, medical alerts) and the PDA medical history intake; photos or ID uploads; SMS and email; per-branch switches.

## 3. The patient poster

Each branch has one, printed from Settings, Branches, with a new **Print patient poster** link beside the staff one (renamed **Print staff poster**). It is `/poster/{code}/patients`, for staff who may edit settings, like the staff poster, and printed on white whatever the screen's theme (A4):

- the practice name and the branch name;
- a QR code for `APP_URL/welcome/{code}`, with the address printed small beneath it;
- "Patients", and "Scan to book a visit or fill in your patient form."

The QR holds only the branch code, which is not secret (it is in every staff address and on the booking page), so this poster has no Replace QR button; it keeps working until the branch's code changes or the branch is closed.

## 4. What patients see

**Welcome page,** `/welcome/{code}`, public and made for phones like `/book`: the practice name, the branch name, and up to two large buttons:

- **Book a visit**, shown while online booking is on: opens `/book?branch={code}`, where the branch is already chosen (it can still be changed).
- **Fill in my patient form**, shown while patient forms are on: opens `/welcome/{code}/form`.

With both off, it says "Please ask at the front desk." An unknown or closed branch answers 404.

**Patient form,** `/welcome/{code}/form`, titled "Patient form" with the branch name:

- first name, middle name (optional), and last name, each 1 to 50 characters after trimming;
- birthday (a date from 1900-01-01 to today in Manila);
- sex (Female or Male, the chart's two values);
- mobile number (`09XXXXXXXXX` or `+639XXXXXXXXX`, spaces and dashes ignored, stored as `+639XXXXXXXXX`);
- address (1 to 200 characters);
- a required box, "I agree to the privacy notice", whose words "privacy notice" open `/book/privacy` in a new tab;
- the hidden `website` field, the bot trap (section 7).

Everything but the middle name is required. **Done:** "Thanks, {first name}. Tell the front desk you filled in the form." and, while online booking is on, a **Book a visit** link to `/book?branch={code}`. Nothing is shown about any existing record.

While patient forms are off, the form page says "Patient forms aren't available right now. Please ask at the front desk." `/book/privacy` is available while online booking or patient forms is on.

## 5. What the front desk sees

- A branch's Patients page gains a **Patient forms** button for the owner and the branch's managers (those who may add patients, `patient.edit`, and whose branches include this one; dentists cannot add patients, so they do not see it), reading "Patient forms (N)" once the count of waiting forms has loaded. `/all/patients` has none, as the calendar's Online requests has none there.
- It opens the branch's waiting forms, the newest first: name, birthday, mobile number, and when it was sent.
- Choosing one shows all its details, and the existing patients it may be: those with the same last name, first name, and birthday, or the same mobile number and first name (the rule `createPatient` already uses for its duplicate warning). Three actions:
  - **New chart:** the Add patient dialog opens, filled in from the form, with the form's branch as home branch. Staff check it with the patient, complete what they like, and save. The duplicate warning works as it does now. Saving makes the chart and removes the form in one transaction.
  - **Existing patient:** staff pick one of the listed patients (or search for another). The form is removed and the patient's record opens, where staff change any detail that differs, as they would now.
  - **Discard:** after "Discard this form? Its details are deleted.", for spam or a form sent twice.
- A form someone else has just handled answers "That form was already handled." and the list reloads.

## 6. Data (one migration, additions only)

`patient_forms`, with row level security like every table:

| Column | Type | Rule |
|---|---|---|
| id | uuid | primary key |
| branch_id | uuid | not null, references branches |
| last_name, first_name | text | not null, 1 to 50 characters |
| middle_name | text | null, or 1 to 50 characters |
| birthday | date | not null, from 1900-01-01 |
| sex | text | not null, female or male |
| mobile | text | not null, `^\+639[0-9]{9}$` |
| address | text | not null, 1 to 200 characters |
| created_at | timestamptz | not null, default now; indexed with branch_id |

`practice` gains `patient_forms boolean not null default false`. Turning it on needs a privacy notice, as online booking does ("Add the privacy notice first.").

A form is deleted when it is handled or discarded. A form still waiting after 30 days is deleted too: every listing of forms and every new form first deletes the forms older than 30 days (no scheduled job).

## 7. Limits and the bot trap

In order, for `POST /api/v1/portal/forms`, as for bookings:

1. The fields (section 4): 400 with a message per field; the privacy box: "Agree to the privacy notice to send the form."
2. Patient forms off: 404 "Patient forms aren't available right now." An unknown or closed branch: 404 "That branch doesn't take patient forms."
3. The bot trap: a filled `website` gets the normal answer, and nothing is saved or logged.
4. Five forms an hour per connection: 429 "Too many forms from this connection. Please ask at the front desk." The connection is the keyed hash of its address (`clientKey`, as for bookings), counted from the `patient.form_received` rows of the last hour. There is no lock: two forms at once can both pass the count, letting a sixth through, which does no harm.

Staff can switch forms off at once in Settings, and the Vercel Firewall rule on `/api/v1/portal/` already covers this address.

## 8. API

| Method and path | Who | Does |
|---|---|---|
| `POST /api/v1/portal/forms` | anyone | Saves a form (sections 4 and 7). 201 `{ firstName }`. |
| `GET /api/v1/patient-forms?branch={code}` | the owner, or a manager of that branch | The branch's waiting forms, newest first, each with its possible patients. |
| `POST /api/v1/patients` | patient.edit (as now) | Also takes `formId`: the chart is made and the form deleted in one transaction; a form already gone answers 404 "That form was already handled." and makes no chart. The form's branch must be one of the manager's (any branch for the owner). |
| `POST /api/v1/patient-forms/{id}/attach` | the owner, or a manager of the form's branch | `{ patientId }`: deletes the form. 404 when the form or the patient is gone. |
| `DELETE /api/v1/patient-forms/{id}` | the owner, or a manager of the form's branch | Deletes the form. 404 when it is gone. |

Access log rows, none holding a form's details:

| Action | Row | In words |
|---|---|---|
| `patient.form_received` | no user, entity `patient_form` and the form's id, the branch, details `{ client, privacyNoticeAccepted: true }` | "Sent a patient form", by "Patient form" |
| `patient.created` | as now, with details `{ form: id }` when made from a form | "Added the patient" |
| `patient.form_attached` | entity `patient` and the patient's id, details `{ form: id }` | "Added a patient form to the record" |
| `patient.form_discarded` | entity `patient_form` and the form's id | "Discarded a patient form" |

## 9. Screens

- **Settings, Practice:** a **Take patient forms** box beside Take online bookings, with the same rule about the privacy notice. The hint under the privacy notice says it covers the booking page and the patient form.
- **Settings, Branches:** Print staff poster and Print patient poster; the panel's line reads "Each branch has its own hours, chairs, and QR posters."
- **Patients page:** the Patient forms button and its dialogs (section 5). The Add patient dialog takes starting values and a form id.
- **`/book`:** `?branch={code}` chooses that branch when it is one the page lists; any other value is ignored.
- **`/welcome/{code}` and its form:** built like `/book`: one column, big touch targets, readable at 375 px, with tab titles "Welcome to {practice}" and "Patient form at {practice}".
- `welcome` joins the reserved branch codes (`RESERVED_CODES`), since it is a top-level page.

## 10. Security and privacy (RA 10173)

- A form holds personal information, and the birthday (age) is sensitive personal information under RA 10173. It is taken only with the patient's agreement to the practice's notice, kept only until the front desk handles it or 30 days pass, and seen only by the owner and the managers of its branch.
- The privacy notice must cover the form: what it asks, why, that it waits for the front desk and is deleted when handled or after 30 days. Owners update the notice before switching forms on; the README's go-live steps say so.
- As for bookings, the connection is stored only as a keyed hash, never the address, and no row of the access log holds a form's details. Vercel's own request logs see addresses, as they do for every page.
- The form has no guardian field, as the booking page has none: the lawyer says who may agree for a child, and the front desk fills in the guardian at the visit.
- Nothing on the public pages says whether anyone is already a patient.

## 11. Testing

- **Database tests** (PGlite): a form saves with its `patient.form_received` row and no personal data in it; off, an unknown branch, and a closed branch answer 404 and save nothing; each field's refusal; the privacy box; the bot trap saves and logs nothing; the sixth form in an hour from one connection answers 429 while another connection still gets through; forms older than 30 days are deleted by a listing and by a new form; the list is per branch, newest first, with its possible patients, and refused to dentists and to managers of other branches; New chart makes the chart and deletes the form together, and a second use of the form answers 404 and makes no chart; the duplicate warning still stops a chart made from a form; attach and discard delete the form and write their rows; the practice refuses Take patient forms without a notice; `/book/privacy` shows with either switch on.
- **Unit tests:** the reserved codes still match `src/app`'s top-level folders (the existing test, now with `welcome`).
- **End to end:** the existing run gains: the owner switches patient forms on, a patient opens `/welcome/{code}`, fills in the form, and the front desk makes a chart from it.

## 12. Going live

- The migration only adds, so the usual order holds: `npm run db:migrate` first (at any hour), then merge.
- The go-live check for reserved codes gains `welcome` (`select code from branches where code in (...)` still returns nothing).
- Before switching forms on: the lawyer-reviewed notice covers the form (section 10). Then tick Take patient forms, print each branch's patient poster, and put it where patients wait.

## 13. Changes to earlier parts

- `RESERVED_CODES` gains `welcome`; the README's reserved-codes query too.
- `/book/privacy` is available while either switch is on (it was online booking only).
- `/book` reads `?branch=`.
- Settings, Branches: "Print QR poster" becomes "Print staff poster".
- `POST /api/v1/patients` takes an optional `formId`.
