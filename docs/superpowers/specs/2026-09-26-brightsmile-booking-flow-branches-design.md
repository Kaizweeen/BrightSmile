# BrightSmile: Booking flow and branches

- **Date:** 2026-09-26
- **Status:** Draft for Kai's review
- **Scope:** Reworks the patient side of piece 1 to follow Kai's flowchart (2026-09-26), and adds branches. Builds on pieces 1 to 3 (plans 1 to 6).

The public booking page becomes a main page with three choices: book, reschedule or edit, and cancel. Booking starts with the branch and the patient's mobile number; a number that already has patient records offers them, and a new patient fills in the clinic's patient form and waiver. Every booking ends on a summary where any part can be changed before sending. Patients reschedule, edit, or cancel by entering their number and choosing the appointment. A clinic can have several branches, each with its own address and calendar.

---

## 1. Decisions (Kai, 2026-09-26)

| Question | Decision |
|---|---|
| Flow | Kai's flowchart, with the changes in section 2. |
| Branches | One clinic, many branches: one account and one booking link. Each branch has its own address and calendar. Patient records, procedures, and staff are shared by the clinic. A dentist can work at more than one branch, on different days or hours. |
| Approval | Unchanged: an online booking is a request that holds the time until the clinic approves it. A patient's reschedule or edit sends the appointment back to the clinic for approval, even if it was confirmed. |
| Patient form | A standard Philippine dental patient information form and consent waiver (section 6), drafted by us. Kai corrects the fields and wording later. |
| Verification | A text code right after the number, in all three paths, skipped on a phone that verified that number before. |

## 2. Where the build differs from the flowchart, and why

1. **A code after the number.** The flowchart shows patient records and appointments right after the number is typed. Without a check, anyone could type a stranger's number and read or cancel their appointments, and see which family members are patients. That would break the Data Privacy Act (RA 10173). So every path asks for the 6 digit code the clinic already sends, and a phone that verified the number before (the existing verified-device cookie) goes straight through.
2. **Confirm means send.** In the flowchart the booking Confirm diamond's arrows read "Yes: which part to edit" and "No: save". The build does what the words mean: "Send request" saves, and each part of the summary has its own Change button (the flowchart's edit choices).
3. **Changing the services re-checks the time.** A different set of services changes the visit's length, so when the chosen time no longer fits, the patient picks a new time before the summary.
4. **Saving a booking holds the time.** "Update the calendar and time of the specific branch" happens at once: a request blocks its time for that dentist, as today. The clinic's approval sends the confirmation text.
5. **The branch stays fixed when rescheduling.** The flowchart's edit choices are date and time, service, and patient. Moving to another branch means cancelling and booking again.

## 3. The public booking page (`/{slug}`)

### 3.1 Main page

The clinic's name and a short line ("Book a visit, or change or cancel one you have."), then three buttons: **Book an appointment** (primary), **Reschedule or edit a booking**, and **Cancel a booking**. Below them, each active branch with its address and a map link, so patients know where they are going.

A lapsed clinic (piece 2) shows today's paused notice instead of the three buttons; its patients can still cancel through the links in their texts.

### 3.2 Number and code (the start of every path)

1. The patient types their mobile number.
2. If this phone already verified that number (verified-device cookie), the next step opens at once. Otherwise the clinic texts a 6 digit code (the existing `issue_otp` limits and resend wait apply) and the patient types it.
3. A correct code marks the phone as verified for that number (the existing cookie), and the path continues. Every later server action checks the cookie for that number, so nothing below can be reached by calling an action directly.

### 3.3 Book an appointment

1. **Branch:** the active branches with address. Skipped when the clinic has one.
2. **Number and code** (3.2).
3. **Who is the appointment for?** When the number has patients on record at this clinic (not anonymized), they are listed by name, plus **Someone new**. When it has none, the new patient form opens directly.
4. **New patient form and waiver** (section 6), for someone new. The verified number is filled in and cannot be changed there. On a family phone, each person gets their own record with the same number, as today.
5. **Services:** the clinic's active procedures, several allowed, with their durations (today's first step).
6. **Date and time:** the month calendar and open times for the chosen branch (today's second step, limited to the branch).
7. **Summary:** branch and address, patient, services and total time, dentist (when the branch has 2 or more), date and time. Each line has **Change**: date and time goes to step 6, services to step 5 (then step 6 again if the time no longer fits), patient to step 3 (where **Someone new** is the flowchart's "add another patient"). **Send request** is the one primary button.
8. **Sent:** today's "Request sent" screen, now naming the branch. The clinic gets today's new request alert.

### 3.4 Reschedule or edit a booking

1. **Number and code** (3.2).
2. **Your appointments:** every pending or confirmed appointment at this clinic, in the future, whose patient has this number: patient, branch, date and time, services, and status in words. None: "There is no upcoming appointment for this number." and a way back to the main page (the flowchart's "No existing appointment").
3. **Booking details:** the chosen appointment as a summary with the same **Change** buttons as 3.3 step 7 (date and time within its branch, services, patient among this number's records or someone new).
4. **Send changes** saves them in one step: the new time holds at once and the old time frees, the appointment becomes pending again, and the clinic gets a "changed request" alert. An appointment whose start is less than the clinic's minimum notice away cannot be changed online ("Please call the clinic to change it.").
5. **Sent:** "Changes sent. The clinic will confirm by text."

### 3.5 Cancel a booking

1. **Number and code** (3.2).
2. **Your appointments** (as 3.4 step 2).
3. **Cancel this appointment?** with its details. **No, keep it** goes back to the list. **Yes, cancel it** cancels it exactly as the patient link does today: the time frees, the clinic gets today's cancellation alert, and the event is recorded.
4. **Cancelled:** "Your appointment is cancelled." with a button back to the main page.

The patient link in every text (`/a/{token}`) keeps working as today.

## 4. Branches

- **`branches` table:** `clinic_id`, `name` (up to 40), `sms_name` (short name for texts, see below), `address` (up to 200), `maps_url`, `active`, `sort`, `created_at`. Members read; only the owner (piece 3) adds, edits, and deactivates. The last active branch cannot be deactivated.
- **Working hours** get a `branch_id`: each block says where the dentist works on that weekday. A dentist's blocks may not overlap on the same weekday even across branches (validated on save, as blocks are today).
- **Appointments** get a `branch_id`. Composite keys keep a branch, its clinic, and the dentist's clinic consistent, like the existing ones.
- **Open times** for a branch come from the working hours at that branch. The existing no-overlap guard is per dentist, so a dentist can never be booked at two branches at once.
- **Texts:** texts keep one clinic field of at most 20 characters, so every template still fits one text. For a clinic with 2 or more active branches that field is the clinic's text name plus the branch's `sms_name`, and Settings refuses a branch short name that would push the pair past 20 characters.
- **Onboarding** creates the first branch from the clinic's address, named "Main"; the owner renames it in Settings. The migration does the same for every existing clinic and moves all its working hours and appointments to that branch.

**Dashboard, only when the clinic has 2 or more branches:** the schedule and requests show the branch on each appointment and filter by branch; a new appointment asks for the branch; the working hours editor asks for each block's branch. **Settings > Branches** (owner) adds, renames, edits the address and map link, orders, and deactivates branches.

## 5. Changing a booking (`change_booking`)

A new database function, called with the secret key after the server has checked the verified number and the rules:

- The appointment must belong to this clinic, be pending or confirmed, start in the future, and start at least the clinic's minimum notice from now.
- It updates the start, end, dentist, services, and patient in one statement, so the old time frees as the new one is taken; the no-overlap guard refuses a clash.
- It sets the status to pending, clears `confirmed_at` and `reminder_sent_at`, and records an event (actor `patient`, reason "Changed by patient").

The server re-validates the new time exactly as a new booking (open times, minimum notice, days ahead) before calling it.

## 6. The patient form and waiver

Shown once per new patient, in short sections on one scrolling screen. Required fields are marked; everything else may stay empty.

1. **Patient:** last name (required), first name (required), middle name, birthday (required), sex (female or male, required), home address (required), occupation, email.
2. **Parent or guardian:** name (required when the patient is under 18 today, since the form comes before the visit date is chosen).
3. **HMO or dental insurance:** provider, card or member number.
4. **Dental history:** previous dentist, last dental visit (month and year), reason for the visit.
5. **Medical history** (each Yes or No, with a detail box that appears on Yes):
   - Are you in good health? Are you under medical treatment now? (condition)
   - Have you had a serious illness or an operation? (what) Have you been in the hospital? (when and why)
   - Are you taking any medicine now? (which) Do you smoke or use tobacco?
   - Allergies, tick any: local anaesthetic (for example lidocaine), penicillin or other antibiotics, sulfa drugs, aspirin, latex, other (which).
   - Women: are you pregnant, nursing, or taking birth control pills?
   - Tick any you have or had: high blood pressure, low blood pressure, heart disease, heart surgery or pacemaker, diabetes, asthma, bleeding problems, hepatitis or liver disease, kidney disease, epilepsy or seizures, stroke, cancer, tuberculosis, thyroid problems, HIV, other (which).
6. **Emergency contact:** name and mobile.
7. **Waiver and consent:** the text below, a box "I have read and agree", and the patient's full name typed as their signature (required). The date and the waiver version are stored with it.

> **Consent for dental examination and treatment.** I confirm that the information I gave is true and complete to the best of my knowledge, and I will tell the clinic of any change in my health. I allow the dentists of {clinic} to examine me and to explain the treatment I need; no treatment will start without my consent to it. I understand that dental treatment carries risks the dentist will explain before treatment, and that results cannot be guaranteed.
>
> **Data privacy consent.** I allow {clinic}, and BrightSmile as its booking service, to collect, keep, and use my personal and health information to book and manage my appointments and for my dental care, as described in the Privacy Notice. I may ask to see, correct, or delete it. [Legal review: wording, cancellation and no-show policy, minors signing through a guardian.]

**Where it lives:** new nullable columns on `patients` (middle name, sex, address, occupation, email, guardian name, HMO number, previous dentist, last visit, visit reason, emergency name and mobile, waiver name, waiver version, waiver time) and `medical` (the answers, a JSON object with a fixed shape validated on the server). Health information is sensitive personal information under RA 10173: only the clinic's members read it (existing RLS), it never appears in texts, pushes, logs, or reports, and anonymizing a patient clears all of it. The Privacy Notice gains a paragraph on health information.

**In the dashboard:** the patient page shows the form in a "Patient form" section, allergies and ticked conditions first, and says when there is none (patients from before this change). Staff edit the basic fields as today; editing the medical answers in the dashboard is out of scope.

## 7. Flow as one pure state machine

`src/lib/booking-flow.ts` holds the steps and every allowed move of 3.3 to 3.5 as a pure reducer (step, action to next step). `BookingSheet` renders the current step and calls server actions; it never decides the next step itself. The reducer is unit tested move by move against the flowchart, including every Change path, so the flow can be checked without a database.

## 8. Security and privacy

- Patient names, forms, and appointments for a number are shown only after that number is verified on this phone, and every server action re-checks it.
- `change_booking` and cancelling only act on appointments whose patient has the verified number, at this clinic.
- The code's existing limits (3 per number and 10 per connection an hour, 60 seconds between resends) cover all three paths.
- New server actions validate every field on the server; the waiver stores the typed name, version, and time.

## 9. Out of scope

Changing branch while rescheduling; branch-level staff permissions; per-branch procedures or prices; per-branch reports; patients editing their form after the first time; staff editing medical answers; drawn signatures; a form builder; printing the form.

## 10. Testing

- **Database, offline (tests/sql):** branches are readable by members and writable by the owner only; the backfill gives each existing clinic one branch holding all its hours and appointments; composite keys refuse a branch from another clinic; one dentist cannot be booked at two branches at once; `create_booking` stores the branch and the new patient's form; `change_booking` changes only future pending or confirmed appointments outside the minimum notice, returns them to pending, clears confirmation and reminder, and respects the no-overlap guard; anonymizing clears the new patient fields; the function lists in the isolation tests stay exact.
- **Unit:** the flow reducer move by move, form validation (required fields, a guardian for minors, lengths, the medical answers' shape), the branch text name limit, open times per branch, the verified-number checks in the new actions.
- **Not possible locally:** the pages against a real database (no development project). They are checked by typecheck, build, the reducer tests, and review, then walked on production after deploy.

## Revisions

**2026-09-28**, after Kai decided BrightSmile is free: billing was removed before release, so a clinic can no longer lapse; the "lapsed clinic" paused notice this spec describes (section 3) no longer applies, and the three buttons always show.
