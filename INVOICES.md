# Wanderlust Booking Engine — Invoices (one-to-many)

A booking can have MANY invoices over its life. The original is created at
booking; a NEW invoice is created whenever an edit changes the totals (e.g. a
guest calls a week later to add nights). ALL invoices are KEPT — the original is
never overwritten. The newest is marked **current**; older ones are
**superseded** but stay fully viewable.

Each invoice keeps its own sequential WBE-INV-#### number (an edit gets a new,
unrelated number — not a revision suffix).

## Collection: `Invoices` (one row per invoice)
Linked to `BookingReports` by `bookingId` (one booking → many invoices).

| Field         | Type    | Notes                                          |
|---------------|---------|------------------------------------------------|
| bookingId     | Text    | _id of the BookingReports row it belongs to    |
| invoiceNumber | Text    | WBE-INV-#### (unique per invoice)              |
| invoiceUrl    | Text    | Wix Media URL of the stored PDF                |
| total         | Number  | invoice grand total at issue time              |
| issueDate     | Date    | when this invoice was issued                   |
| isCurrent     | Boolean | true for the latest; false once superseded     |
Permissions: Admin read/write only.

## Convenience pointer on `BookingReports`
For fast display, the booking row caches the current invoice:
| Field                 | Type | Notes                                |
|-----------------------|------|--------------------------------------|
| currentInvoiceNumber  | Text | the latest invoice's number          |
| currentInvoiceUrl     | Text | the latest invoice's PDF URL         |
(The full history is always in the `Invoices` collection.)

## How it works
`velo/backend/invoices.web.js`:
- `storeInvoice(bookingId, serviceResult)` — `serviceResult` is the JSON from the
  external service `/issue-invoice` (now includes `pdf_base64`, `pdf_filename`,
  `issue_date`). It:
  1. Uploads the PDF (base64) to Wix Media Manager `/invoices` (private).
  2. Marks the booking's current invoice(s) as superseded (isCurrent=false).
  3. Inserts the new invoice row as isCurrent=true.
  4. Updates the booking's `currentInvoiceNumber` / `currentInvoiceUrl`.
- `listInvoices(bookingId)` — ALL invoices for a booking, newest first
  (current + superseded), for the admin to view/download any of them.
- `getCurrentInvoice(bookingId)` — the single current invoice.

## The edit-creates-a-new-invoice flow (your example)
Guest books, then calls a week later to add 2 nights:
1. Admin edits the reservation (new check-out date). Totals/taxes recompute
   (see REPORTING.md `/recompute` + applyEditedReservation).
2. Admin issues a new invoice: call the external service `/issue-invoice` again
   → fresh WBE-INV-#### number + new PDF.
3. `storeInvoice(bookingId, result)` files the new invoice as current and marks
   the original superseded. BOTH remain in the `Invoices` collection.

Verified (Node simulation): original WBE-INV-0007 → edit creates WBE-INV-0012 →
original kept but superseded, exactly one current at all times, booking pointer
follows the newest, full history listed newest-first. A third edit (WBE-INV-0020)
behaves the same.

## Service change
`/issue-invoice` now also returns `pdf_base64` + `pdf_filename` + `issue_date`
so Velo can upload the PDF to Wix Media and store its URL on a new Invoices row.

## Verified vs. needs live testing
- Verified by me: the supersede/current/keep-all logic (Node) and that the
  service returns the PDF bytes + builds the report record.
- Needs live testing in Wix: the `mediaManager.upload` to Wix Media and the
  Invoices collection inserts/queries (Wix-only APIs).
