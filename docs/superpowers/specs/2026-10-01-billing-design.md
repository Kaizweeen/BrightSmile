# Billing: checkout, receipts, and end-of-day reconcile (design)

Date: 2026-10-01. Follows the front-desk flowchart: patient done, encode services and items, show the total, pay by cash or QR, issue an official receipt, log the sale, reconcile at end of day.

Part 1 left billing out of scope (scheduling spec, section 17). This adds it.

## 1. Decisions

- **QR payment is manual.** Staff show the clinic's static QR image, check their own banking or e-wallet app, then press "Payment received" (optional reference number). No gateway.
- **Bill lines:** the visit's procedures (default price, overridable per bill) plus free-text lines (name, quantity, price). No inventory link (part 2).
- **No discounts, no VAT.** The total is the sum of the lines.
- **Reconcile:** a per-branch daily summary with a counted-cash entry and over/short, then a manager closes the day. Closed days lock.
- **Mistakes:** void with a required reason. Nothing is edited or deleted.

## 2. Data

Money is integer centavos everywhere.

- `procedures.price` integer not null default 0, check `>= 0`. Edited in Settings, Procedures.
- `practice.qr_image` text null: the clinic QR as a data URL, at most 200 KB, PNG or JPEG only.
- `bills`: id, branch_id, patient_id (null for a walk-in sale with no patient record), appointment_id (null), method (`cash` | `qr`), total (> 0), tendered and change (cash only, `tendered >= total`, `change = tendered - total`), reference (null, at most 60 chars), receipt_no (unique), day (date, Manila), status (`paid` | `void`), issued_by, issued_at, void_reason, voided_by, voided_at. Checks: void fields are all set or all null; cash has tendered/change and qr has neither.
- `bill_lines`: bill_id, position, name (1 to 100 chars), qty (1 to 999), unit_price (>= 0), procedure_id (null). A snapshot, so later price edits never change an old receipt.
- `bill_counters`: branch_id, day, last_seq. The receipt number is `OR-<BRANCH CODE>-<YYYYMMDD>-<6-digit seq>`, taken by an upsert-and-return inside the issuing transaction, so there are no gaps or duplicates.
- `cash_closes`: branch_id, day (primary key together), expected_cash, expected_qr, counted_cash, closed_by, closed_at.
- All tables have row level security on, like the rest.
- One open bill per appointment is not enforced in the database: a visit can be paid in parts only by separate walk-in sales. The issue call refuses a second non-void bill for the same appointment.

## 3. Rules

- A bill is created paid. There are no drafts and no unpaid bills.
- Totals, change, and the receipt number are computed on the server. The client's numbers are never trusted.
- Issue is refused when the day is closed, when the appointment already has a paid bill, or when the appointment is not `completed`.
- Void needs a reason of 1 to 200 characters, works only on a paid bill of an open day, and writes an audit entry. Voided bills stay listed and drop out of totals.
- Close day: expected cash is the sum of paid cash bills, expected QR the sum of paid QR bills, for that branch and day. The counted cash is required. Over/short is counted minus expected. A closed day cannot be reopened in this version.
- Days use Asia/Manila.

## 4. Permissions

New actions `billing.view`, `billing.issue`, `billing.void`, `billing.close`. The owner and a manager covering the branch may do all four; a dentist may do none. Audit entries: `bill.issue`, `bill.void`, `day.close` (amounts and receipt numbers only, no health data).

## 5. Screens

- **Checkout** (a dialog or page reached from a completed visit on the calendar and staff screens, and from "New sale"): editable lines prefilled from the visit, a large total, a Cash or QR choice. Cash asks for the amount received and shows the change live. QR shows the clinic QR and an optional reference, then "Payment received". Issuing opens the receipt.
- **Receipt:** a printable page (print CSS) with clinic and branch name, receipt number, date, patient, lines, total, method, cash received and change.
- **`/[branch]/billing`:** the day's bills (receipt number, time, patient, method, total, status, void action), a date picker, totals per method, and the reconcile panel with counted cash, over/short, and Close day.
- **Settings:** a price field on each procedure, and the QR image upload in the practice panel.

## 6. Testing

- Unit tests for totals, change, receipt number formatting, and the Manila day.
- Integration tests on PGlite (the existing suite's pattern) for issue, void and close, the permission matrix, branch isolation, the closed-day lock, the duplicate-bill refusal, and concurrent issue producing distinct receipt numbers.

## 7. Out of scope

VAT and discounts, payment gateways, refunds beyond a void, partial payments and balances, inventory deduction, emailed receipts (part 3), and reopening a closed day.
